#!/usr/bin/env bash
set -euo pipefail
# Requires Emscripten 6.0.6 activated, CMake 3.31.6, Ninja 1.11.1 and a C compiler.
source_dir=$(cd "$(dirname "$0")" && pwd)
output_dir=$(cd "$source_dir/.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/easydic-espeak.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT
tar -xzf "$source_dir/espeak-ng-1.52.0.tar.gz" -C "$build_dir"
upstream="$build_dir/espeak-ng-1.52.0"
# Upstream fetches Sonic unconditionally even when USE_LIBSONIC=OFF.
# Remove that discovery block: this build does not use Sonic or its source.
python3 - "$upstream/cmake/deps.cmake" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
a = s.index('if (SONIC_LIB AND SONIC_INC)')
b = s.index('if (PCAUDIO_LIB AND PCAUDIO_INC)', a)
p.write_text(s[:a] + s[b:])
# Emscripten's libc declares wide-character predicates in wchar.h as well.
# Load those declarations before eSpeak's Unicode predicate macro remapping.
compat = p.parent.parent / 'src/include/compat/wctype.h'
compat.write_text(compat.read_text().replace('#include <ucd/ucd.h>', '#ifdef __EMSCRIPTEN__\n#include_next <wchar.h>\n#endif\n\n#include <ucd/ucd.h>'))
PY
options=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF
  -DUSE_ASYNC=OFF -DUSE_MBROLA=OFF -DUSE_LIBSONIC=OFF -DUSE_LIBPCAUDIO=OFF -DUSE_SPEECHPLAYER=OFF)
cmake -S "$upstream" -B "$build_dir/native" "${options[@]}"
cmake --build "$build_dir/native" --target espeak-ng-data/en_dict
mkdir -p "$build_dir/english/espeak-ng-data/lang/gmw"
for file in en_dict phondata phonindex phontab intonations; do
  cp "$build_dir/native/espeak-ng-data/$file" "$build_dir/english/espeak-ng-data/"
done
cp "$upstream/espeak-ng-data/lang/gmw/en-US" "$build_dir/english/espeak-ng-data/lang/gmw/"
emcmake cmake -S "$upstream" -B "$build_dir/wasm" "${options[@]}"
cmake --build "$build_dir/wasm" --target espeak-ng
emcc "$source_dir/speech.c" -I"$upstream/src/include" \
  "$build_dir/wasm/src/libespeak-ng/libespeak-ng.a" "$build_dir/wasm/src/ucd-tools/libucd.a" \
  -O3 -sDYNAMIC_EXECUTION=0 -sMODULARIZE=1 -sEXPORT_NAME=createSpeechEngine \
  -sENVIRONMENT=worker -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=134217728 \
  '-sEXPORTED_FUNCTIONS=["_speech_init","_speech_synthesize","_speech_pcm","_speech_length"]' \
  '-sEXPORTED_RUNTIME_METHODS=["ccall","HEAP16"]' \
  --preload-file "$build_dir/english@/speech" -o "$output_dir/espeak.js"
python3 - "$output_dir" <<'PY'
import hashlib, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
names = ['espeak.js', 'espeak.wasm', 'espeak.data', 'COPYING', 'EMSCRIPTEN-LICENSE', 'MUSL-COPYRIGHT', 'COMPILER-RT-LICENSE', 'source/speech.c', 'source/build.sh', 'source/espeak-ng-1.52.0.tar.gz']
(p / 'SHA256SUMS.json').write_text(json.dumps({name: hashlib.sha256((p/name).read_bytes()).hexdigest() for name in names}, indent=2) + '\n')
PY
