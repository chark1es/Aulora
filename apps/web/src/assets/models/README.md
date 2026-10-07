# Bundled models

`selfie_segmenter_landscape.tflite` is Google's MediaPipe **Selfie Segmenter (landscape)** model, used for
background blur and replacement in calls (`src/lib/voice/effects/segmenter.ts`).

| | |
| --- | --- |
| Source | `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite` |
| SHA-256 | `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e` |
| Size | 250,177 bytes |
| License | Apache License 2.0 (the model card links `https://www.apache.org/licenses/LICENSE-2.0.html`); text in `licenses/mediapipe-LICENSE.txt` |
| Copyright | Google LLC |

It is committed rather than downloaded at build time so a build never depends on a third-party host, and so the
exact bytes are reviewable. To update it, download the new file, replace it, and update the hash above. Do not
change the model without re-testing the effect on real camera frames.

The MediaPipe WebAssembly runtime (`@mediapipe/tasks-vision`, Apache-2.0) is served from the app's own origin by
Vite (`?url` imports in `src/lib/voice/effects/segmenter.ts`); it is not copied into the repository.
