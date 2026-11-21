# Bundled OCR components

EasyDic bundles these components without modifying their distributed runtime files:

| Component | Version | Upstream | License |
| --- | --- | --- | --- |
| Tesseract.js | 7.0.0 | https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract.js core | 7.0.0 | https://github.com/naptha/tesseract.js-core | Apache-2.0 |
| English recognition data (`4.0.0_best_int`) | `@tesseract.js-data/eng` 1.0.0 | https://github.com/naptha/tessdata | Upstream trained data: Apache-2.0; npm package metadata declares MIT |

The English trained-data license is copied from the upstream tessdata repository. Full notices for the OCR libraries and their packaged dependencies are retained in `vendor/ocr/licenses/` and the adjacent `*.LICENSE.txt` files. Dependency package metadata is recorded in `vendor/ocr/packages.json`.

The core includes standard, SIMD, and relaxed-SIMD LSTM builds with embedded WebAssembly. The runtime selects the supported build. Legacy recognition is disabled, so legacy core variants are not included. The English model is compressed and loaded locally.

The source packages were obtained from npm with install scripts disabled. `vendor/ocr/SHA256SUMS.json` records SHA-256 checksums for the bundled files. The unused development maps, CDN defaults, and Node-only dependency paths are not invoked by the extension.

# Bundled offline speech engine

EasyDic also bundles **eSpeak NG 1.52.0**, compiled with **Emscripten 6.0.6**, with the English dictionary and US English voice. eSpeak NG is GPL-3.0-or-later. The GPL text, complete upstream source archive, PCM wrapper source, build script, runtime checksums, and build instructions are in `vendor/speech/`. The wrapper is GPL-3.0-or-later. Generated Emscripten runtime support is covered by the included MIT notice. Original Unicode/ucd-tools notices are preserved in the upstream source archive.

The speech engine generates audio locally. EasyDic no longer downloads or redistributes dictionary/Wikimedia recordings.
