# Windows releases through winget

Aulora's initial Windows releases use unsigned x64 NSIS installers. The winget
package identifier is `dev.spwnd.aulora`, matching the application identifier.
Downloads will use `chark1es/Aulora` GitHub Releases once the repository becomes
public for v1. Keep the repository private until that release is ready.

Winget does not sign the executable. Its community repository validates the
manifest, downloads the installer and checks installation behavior and security.
Submission acceptance is a separate step from building the application.
[Microsoft's distribution guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path),
[winget validation checks](https://github.com/microsoft/winget-pkgs/blob/master/doc/Validation.md).

## Build a candidate

The manually dispatched **Windows release candidate** workflow accepts a stable
version such as `1.0.0`. It builds with a temporary Tauri version override, leaving
the checked-in development version alone. It produces an unsigned x64 NSIS
installer, three winget manifests and `SHA256SUMS` in a downloadable Actions
artifact. It checks silent installation, the installed name/publisher/version,
silent uninstallation and `winget validate` on the Windows runner.

The workflow has read-only repository permissions. It does not publish a GitHub
Release, change repository visibility or open a winget submission. It can run
while the repository is private. Actions artifact links cannot be used as public
winget installer URLs.

The manifest generator is also available from `apps/desktop`:

```sh
bun run winget \
  --installer src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Aulora_1.0.0_x64-setup.exe \
  --version 1.0.0
```

This creates the repository layout under `apps/desktop/dist/winget/`:

```text
manifests/d/dev/spwnd/aulora/1.0.0/
  dev.spwnd.aulora.yaml
  dev.spwnd.aulora.installer.yaml
  dev.spwnd.aulora.locale.en-US.yaml
SHA256SUMS
```

Checksums are computed from the supplied installer. The generator refuses
placeholder checksums, prerelease versions and mismatched installer filenames.
Its tests use file fixtures to check manifest generation, not Windows executables.

## Publish v1 and submit to winget

Once the release candidate is approved, make the repository public and publish
the installer from that exact Actions artifact as a release asset at tag
`v1.0.0`. The generated installer URL is:

```text
https://github.com/chark1es/Aulora/releases/download/v1.0.0/Aulora_1.0.0_x64-setup.exe
```

The tag must contain the source for the build, including the license. Later
releases use their own tag, versioned filename and checksum. Do not replace an
installer asset after its checksum has been submitted to winget.

Before submitting, regenerate using the downloaded candidate installer and
verify that the anonymously accessible release URL serves the same bytes:

```sh
bun run winget \
  --installer /path/to/Aulora_1.0.0_x64-setup.exe \
  --version 1.0.0 \
  --verify-download
```

On Windows, validate the generated folder and test it on a clean machine:

```powershell
winget validate --manifest dist/winget/manifests/d/dev/spwnd/aulora/1.0.0
winget install --manifest dist/winget/manifests/d/dev/spwnd/aulora/1.0.0
```

Local manifest installation requires winget's local-manifest setting to be
enabled on the test machine. Also test notification permission, alerts, tray,
deep links, reconnect behavior and upgrading an existing Aulora install.

Copy the three generated YAML files into the same path in a fork of
[`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs) and submit a pull
request. Complete the contributor agreement if requested, and address the
repository's validation results.
[Manifest submission instructions](https://learn.microsoft.com/en-us/windows/package-manager/package/repository).

After acceptance, users can run:

```powershell
winget install --id dev.spwnd.aulora --exact --source winget
winget upgrade --id dev.spwnd.aulora --exact --source winget
```

These commands are not available until the community submission is accepted.
Repeat manifest generation and submission for each new stable Windows release.
Winget upgrade is user-initiated; this setup does not add an in-app updater.
