# Third-party software and assets

Aulora's [license](LICENSE) applies to Aulora's original code and assets. Dependencies, bundled third-party code, fonts, icons, and container images retain their own licenses. A commercial agreement for Aulora does not change those licenses.

## JavaScript packages

Dependency versions are recorded in `bun.lock`; workspace manifests declare direct dependencies. Run `bun run notices` after a frozen install to generate `dist/legal/THIRD_PARTY_JAVASCRIPT.txt`. It records installed package versions, declared licenses, and license/notice files supplied with each installed package, including build tools. Review entries without license text before distributing a release. The inventory is broader than any individual client bundle and does not prove license compatibility.

Notable components include React, React Native, Expo, Convex, Better Auth, Tauri's JavaScript tools, TanStack Router, Tailwind CSS, NativeWind, and Blobatar. Each package's own license text controls its use.

The Material Symbols icon paths are sourced from `@iconify-json/material-symbols`, whose metadata identifies the Apache-2.0 license. See `packages/tokens/scripts/generate-icons.mjs`. Material Symbols are by Google and distributed through [google/material-design-icons](https://github.com/google/material-design-icons). The upstream [Apache-2.0 license text](licenses/material-symbols-LICENSE.txt) ships in this repository and the legal release archive. Preserve its license and notices when redistributing the generated icon paths.

## Native and infrastructure components

Rust dependency versions are in `apps/desktop/src-tauri/Cargo.lock`. iOS dependencies are in `apps/mobile/ios/Podfile.lock`; Android dependencies are resolved by Gradle. Generate and review their license inventories with the native release builds. The JavaScript inventory does not cover these dependencies.

Docker image references live in `infra/docker/docker-compose.yml` and the Dockerfiles. Postgres, nginx, Bun, Convex, MinIO, the MinIO client, and optional Vault are separate upstream products. In particular, the bundled MinIO community image carries AGPL obligations; inspect its upstream source and license before redistributing images or modifying that service. Operating a paid Aulora deployment does not waive third-party obligations. Keep upstream source references for the exact image revisions distributed.

## Project assets

Before release, verify ownership or redistribution permission for logos, application icons, avatar assets, and notification sounds. Record any required third-party attribution here and include its license in the release notices.

## Distribution

Keep `LICENSE`, `NOTICE`, `COMMERCIAL.md`, and this file with source distributions. Release automation attaches these files and the generated JavaScript notices, and includes them in the web/docs archives. Desktop bundles contain the source license and notices, and signed mobile release builds embed the generated notices. Native dependency and asset provenance review is part of the [release checklist](docs/releasing.md).
