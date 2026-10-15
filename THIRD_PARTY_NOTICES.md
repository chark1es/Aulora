# Third-party software and assets

Aulora's [license](LICENSE) applies to Aulora's original code and assets. Dependencies, bundled third-party code, fonts, icons, and container images retain their own licenses. A commercial agreement for Aulora does not change those licenses.

## JavaScript packages

Dependency versions are recorded in `bun.lock`; workspace manifests declare direct dependencies. Run `bun run notices` after a frozen install to generate `dist/legal/THIRD_PARTY_JAVASCRIPT.txt`. It records installed package versions, declared licenses, and license/notice files supplied with each installed package, including build tools. Review entries without license text before distributing a release. The inventory is broader than any individual client bundle and does not prove license compatibility.

Notable components include React, React Native, Expo, Convex, Better Auth, Tauri's JavaScript tools, TanStack Router, Tailwind CSS, NativeWind, and Blobatar. Each package's own license text controls its use.

The Material Symbols icon paths are sourced from `@iconify-json/material-symbols`, whose metadata identifies the Apache-2.0 license. See `packages/tokens/scripts/generate-icons.mjs`. Material Symbols are by Google and distributed through [google/material-design-icons](https://github.com/google/material-design-icons). The upstream [Apache-2.0 license text](licenses/material-symbols-LICENSE.txt) ships in this repository and the legal release archive. Preserve its license and notices when redistributing the generated icon paths.

## Calling: noise suppression, background effects and streaming

These components ship in the web and desktop clients, or run as an optional service. All are permissively licensed (MIT, BSD, Apache-2.0) and compatible with Aulora's license; each keeps its own license and notices.

| Component | Used for | License |
| --- | --- | --- |
| [`@sapphi-red/web-noise-suppressor`](https://github.com/sapphi-red/web-noise-suppressor) | Audio worklets for the noise gate and denoiser | MIT |
| [RNNoise](https://github.com/xiph/rnnoise) (compiled to WebAssembly by [shiguredo/rnnoise-wasm](https://github.com/shiguredo/rnnoise-wasm)) | "Enhanced" noise suppression model | BSD-3-Clause (RNNoise), Apache-2.0 (the WebAssembly build) |
| [`@mediapipe/tasks-vision`](https://github.com/google-ai-edge/mediapipe) | Runtime for background blur and replacement | Apache-2.0 |
| MediaPipe Selfie Segmenter (landscape) model | Person segmentation (see `apps/web/src/assets/models/README.md`) | Apache-2.0 |
| [`livekit-client`](https://github.com/livekit/client-sdk-js) and its dependencies (`@livekit/protocol`, `@livekit/mutex`, `@bufbuild/protobuf`, `rxjs`, `sdp-transform`, `sdp`, `webrtc-adapter`, `loglevel`, `machina`, `events`, `typed-emitter`) | Client for the optional streaming server | Apache-2.0, MIT, BSD-3-Clause |
| [LiveKit server](https://github.com/livekit/livekit) (`livekit/livekit-server` image, compose profile `streaming`) | Optional relay for screen and window streams, run as a separate container and not modified | Apache-2.0 |

The license texts for RNNoise and MediaPipe are in [`licenses/`](licenses/rnnoise-COPYING.txt) and ship in the legal release archive. The streaming server image is pulled from its publisher; keep its source reference for the exact tag you deploy (`infra/docker/docker-compose.yml`). Background effects and noise suppression run on the user's device and send nothing to a third party; the MediaPipe runtime and model are served from the Aulora origin, not a CDN.

## Native and infrastructure components

Rust dependency versions are in `apps/desktop/src-tauri/Cargo.lock`. iOS dependencies are in `apps/mobile/ios/Podfile.lock`; Android dependencies are resolved by Gradle. Generate and review their license inventories with the native release builds. The JavaScript inventory does not cover these dependencies.

Docker image references live in `infra/docker/docker-compose.yml` and the Dockerfiles. Postgres, nginx, Bun, Convex, MinIO, the MinIO client, optional LiveKit, and optional Vault are separate upstream products. In particular, the bundled MinIO community image carries AGPL obligations; inspect its upstream source and license before redistributing images or modifying that service. Operating a paid Aulora deployment does not waive third-party obligations. Keep upstream source references for the exact image revisions distributed.

## Project assets

Before release, verify ownership or redistribution permission for logos, application icons, avatar assets, and notification sounds. Record any required third-party attribution here and include its license in the release notices. Files in `spikes/` are experiments and are not part of the supported release.

## Distribution

Keep `LICENSE`, `NOTICE`, `COMMERCIAL.md`, and this file with source distributions. Release automation attaches these files and the generated JavaScript notices, and includes them in the web/docs archives. Desktop bundles contain the source license and notices, and signed mobile release builds embed the generated notices. Native dependency and asset provenance review is part of the [release checklist](docs/releasing.md).
