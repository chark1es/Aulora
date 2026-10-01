> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

# V1 preparation status

Checked 2026-09-30 against the working tree. Existing application and release-workflow changes were preserved. This report records local verification; it is not a publication or signed-release certification.

## Prepared

The repository README now separates joining a workspace, hosting a server, and development. Public docs cover first setup, everyday use, admin, Coolify, privacy, troubleshooting, updates, and recovery. The static site has 12 pages, readable tables, local legal copies, and link checks.

Licensing remains PolyForm Noncommercial 1.0.0. Personal/noncommercial use is free; business use requires a paid written agreement through `cnguyen@spwnd.dev`. The license text is unchanged. Source manifests use its SPDX identifier. `NOTICE`, the commercial-use process, CLA acceptance procedure, security policy, third-party inventory, upstream Material Symbols license, issue forms, and PR guidance are included.

Release archives carry source-license and generated JavaScript notices. Desktop resources include legal files. Signed mobile workflows prepare bundled notices and check for them in APK/IPA outputs. The legal ZIP preserves upstream license files. The publisher still needs to review native dependencies and asset provenance.

`bun run check` includes source checks, tests, infrastructure/release tests, builds, and docs checks. CI also includes the pinned Gitleaks history scanner. `bun run release:version -- 1.0.0` synchronizes 25 files and was verified in a disposable checkout; the real checkout's release version remains 0.1.0 so preparation does not trigger publication.

## Verified locally

| Check | Result |
| --- | --- |
| `bun run check` | Passed |
| Desktop configuration verification | Passed |
| macOS `cargo check --locked` | Passed |
| Workflow syntax with actionlint | Passed |
| Ruby release-signing script syntax and Xcode legal folder operation | Passed on a disposable project |
| Documentation | 32 public guides and generated links passed; all 12 served pages returned valid HTML |
| Frozen Docker install with Bun 1.4.0 | Fresh isolated installation passed |
| Installer rerun | Passed; correct configured URL/owner, one setup process, original key preserved |
| Live API checks | Owner sign-in, channel creation, encrypted message round trip, and attachment upload passed |
| Backup | ARM64 image built; uploaded-file bytes present in exported snapshot |
| Restore | Documented snapshot import passed; owner sign-in, old message, and decrypted attachment download passed |
| Git history scan | 260 commits, no findings after two narrowly scoped example-value exceptions |
| Public-file snapshot scan | No findings after the same reviewed exceptions |

Local JavaScript checks used the already-installed Bun 1.3.14 and Node.js 26.4.0. The fresh container install/build used pinned Bun 1.4.0. The complete Node.js 22.18.0/native platform matrix remains a CI check.

The T3 browser preview could not reach the local documentation server and returned connection/preload errors. HTTP checks and renderer tests passed; visual browser and interactive UI verification were not completed in this pass.

## Release fixes

- Excluded private signing files and nested environment files from Docker contexts.
- Fixed installers launching setup twice, which caused deployment-environment races.
- Fixed saved-config reruns printing the wrong URL and a blank owner.
- Included uploaded files in Convex exports.
- Replaced a removed MinIO client download URL with the stack's pinned multi-architecture client image.
- Replaced invalid restore commands with a mounted positional snapshot import, tested on disposable data.
- Clarified that raw database backups can include sensitive backend configuration; they must not be treated as key-free ciphertext.
- Corrected Coolify instructions to use its rendered configuration and existing project, preserving the shared volumes.
- Fixed formatting/import failures so lint is part of the required source check.

## Before publication

Complete the [release checklist](releasing.md). The remaining checks include:

- Full native CI and installed signed release builds on supported desktop platforms and physical mobile devices.
- Public HTTPS/WSS, OAuth/SSO, multi-account permissions, calls across TURN, and live notification behavior.
- Native dependency license inventories, JavaScript entries flagged in `dist/legal/review-required.json`, asset provenance, and existing contribution rights.
- Reachable documentation/privacy/support URLs, mobile store disclosures and required deletion flow, App Store/Play submission and approval.
- Repository visibility and security settings, restricted signing environment, candidate asset inspection, and the final version bump.

The JavaScript notice generator records installed runtime packages and build tools. Missing license files are a review queue, not an assurance of license compatibility. Generated inventories belong to the exact clean release install.

Use the [v1 release-notes draft](release-notes-v1.md) after replacing candidate language with the actual publication date and verified distribution links. Merging a higher Tauri version into `main` automatically publishes after all release jobs succeed. No tag, release, PR, store submission, or visibility change was made during this preparation.
