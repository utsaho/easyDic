# Bundled offline English pronunciation

This directory contains eSpeak NG **1.52.0**, compiled with Emscripten **6.0.6** for EasyDic. The engine runs in a dedicated worker with no network voice service, native audio driver, or browser/system speech API. Only the English dictionary and US English voice configuration are packaged; the phoneme tables are shared upstream data. The voice runs at 175 words per minute, pitch 50.

Runtime files: `espeak.js`, `espeak.wasm`, `espeak.data`. These are all required and total about 1.2 MiB. The separate corresponding-source archive adds about 17 MiB to the extension folder. They are loaded only after the user clicks a speaker. No remote code or `eval` is used (`DYNAMIC_EXECUTION=0`); Manifest V3's existing `wasm-unsafe-eval` allows WebAssembly compilation.

## Source and licensing

[eSpeak NG](https://github.com/espeak-ng/espeak-ng/tree/1.52.0) is distributed under GPL version 3 or later. `COPYING` contains GPLv3. The complete upstream source, including its component notices, is included as `source/espeak-ng-1.52.0.tar.gz`. `source/speech.c` is the EasyDic synchronous PCM wrapper, licensed under GPL-3.0-or-later. `source/build.sh` records the source modification and all configuration/link commands used to produce these files. Preserve the license and corresponding source when redistributing this engine.

The generated JavaScript also contains Emscripten runtime support, distributed under the MIT license in `EMSCRIPTEN-LICENSE`; linked musl libc notices are in `MUSL-COPYRIGHT` and compiler runtime notices in `COMPILER-RT-LICENSE`. Upstream eSpeak source includes Unicode data and ucd-tools notices; they remain in the source archive. Neither Sonic nor SpeechPlayer is linked into this build.

`SHA256SUMS.json` records hashes of the runtime, upstream source, wrapper, build script and licenses. The archive was downloaded from:

https://github.com/espeak-ng/espeak-ng/archive/refs/tags/1.52.0.tar.gz

SHA-256: `bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23`

## Rebuild

Normal extension users do **not** need to build anything. Development prerequisites: a native C/C++ compiler, Python 3.10+, CMake 3.31.6, Ninja 1.11.1, and Emscripten SDK 6.0.6. Install these outside the extension directory.

```sh
# In your separate toolchain directory:
git clone --branch 6.0.6 --depth 1 https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 6.0.6
./emsdk activate 6.0.6
source ./emsdk_env.sh

# From the EasyDic repository, with cmake and ninja on PATH:
bash vendor/speech/source/build.sh
npm test
npm run test:pronunciation:offline
```

The script extracts the included source into a temporary directory, removes upstream's unconditional Sonic download (unused with `USE_LIBSONIC=OFF`), ensures libc wide-character declarations precede eSpeak's predicate macros for Emscripten compatibility, compiles native English data, builds static Wasm libraries, and links the wrapper with the local data. Native audio, asynchronous threads, MBROLA, Sonic, and SpeechPlayer are disabled. The standard Klatt support remains available in eSpeak, although the selected voice uses the default formant synthesizer. Build output overwrites the three runtime files and updates checksums. Temporary build directories are removed on exit. There is no runtime build step or runtime source download.

PCM is mono signed 16-bit, 22,050 Hz. `speech.js` validates input and encodes WAV; `audio.js` plays it through ordinary browser audio. Initialization is limited to 30 seconds and each synthesis to 15 seconds. Generation is bounded to five minutes of PCM; an oversized result fails explicitly, without returning truncated speech. Cancellation during synthesis terminates the worker, and the next request starts a fresh engine. The worker is released after 60 seconds idle, independently of the OCR worker.

This is a compact, robotic voice. Successful synthesis does not guarantee correct pronunciation of every name, abbreviation, or unusual word.
