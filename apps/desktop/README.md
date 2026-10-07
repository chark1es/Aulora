# Aulora desktop

A Tauri 2 shell that wraps the `apps/web` Vite SPA. The webview is the same
React client as the browser build; this crate contributes only the native
surface and the OS integrations. Message encryption is server-side using a local key or an optional
external key manager, so the client stores no keys and the shell has no key
store of its own.

## What the shell adds

| Feature | Where |
| --- | --- |
| Native menu bar (app/File/Edit/View/Window), `Cmd/Ctrl+K` quick switcher | `src-tauri/src/menu.rs` |
| System tray / menu-bar item with open, connect and quit | `src-tauri/src/tray.rs` |
| Native notifications with device-computed text | `commands.rs` (`show_notification`) |
| Dock/taskbar unread badge (macOS/Linux count, Windows overlay icon) | `commands.rs`, `window.rs` |
| `aulora://connect` and `aulora://invite` deep links, single instance | `deep_link.rs` |
| Signed in-app updates from the GitHub `latest.json` feed | `updater.rs`, `tauri.conf.json` |
| macOS Sidebar vibrancy behind translucent rails | `window.rs`, `tauri.macos.conf.json` |
| Locked-down CSP: bundled code only, no remote script origins (`'wasm-unsafe-eval'` allows WebAssembly for noise suppression and background blur, not JavaScript `eval`) | `tauri.conf.json` |
| Call picture-in-picture: the window shrinks to a small always-on-top window; `bun run verify` keeps its restore size in sync | `src-tauri/src/mini_window.rs` |
| Native drag-drop disabled (`dragDropEnabled: false`) so the web composer accepts files dropped anywhere in the window | `tauri.conf.json`, `tauri.macos.conf.json` |

The web player (`apps/web`) talks to the shell through `window.__TAURI__`
(commands `set_unread_badge`, `show_notification`, `take_deep_links`;
events `aulora://deep-link`, `aulora://quick-switcher`). It carries
no `@tauri-apps/*` npm dependency, so the web build is unchanged.

## Requirements

- Bun 1.4+, Rust stable (1.77.2+), and the Tauri platform prerequisites
  (Xcode CLT on macOS; WebView2 on Windows; `webkit2gtk-4.1`, `libdbus-1-dev`
  and `libssl-dev` on Linux).
- Node deps installed at the repo root: `bun install`.

## Commands

```sh
bun run make:icons   # regenerate src-tauri/app-icon.png and the badge
bun run icons        # fan app-icon.png out into src-tauri/icons (Tauri CLI)
bun run verify       # structural Tauri config / CSP checks (no Rust needed)
bun run tauri:dev    # dev: starts apps/web on :5173 and opens the shell
bun run tauri:build  # production bundle for the current OS
```

`src-tauri/icons/` is generated and gitignored; run `bun run icons` before a
local `tauri:build`. CI runs it automatically.

## Building

```sh
bun run build:macos            # native macOS .app + .dmg
bun run build:windows          # Windows NSIS installer, cross-built from macOS
bun run build:windows:native   # Windows NSIS on a Windows host
node scripts/build.mjs --target linux  # Linux .deb (cross from macOS via cargo-zigbuild)
bun run build:all              # macOS, then Windows
bun run cache:setup            # report sccache / print install instructions
```

`scripts/build.mjs` wraps `tauri build` and injects sccache when it is on `PATH`
or at `~/.cargo/bin/sccache`; install it with `cargo install --locked sccache`.
The cache lives in `.cache/sccache` (gitignored); pass `--no-cache` to disable it.

Windows installers are intentionally unsigned for the initial releases. The
current Tauri configuration and CI workflow need no Windows certificate or
Azure signing credentials. Windows may show an unknown-publisher or SmartScreen
warning when users install a downloaded release. Signing can be added later.

Windows installers are distributed through GitHub Releases. The manual Windows
release candidate workflow builds an installer, computes its checksum, and
checks silent installation and uninstallation. See the
[GitHub Actions release guide](../../docs/github-actions.md).

Cross-compiling the Windows NSIS installer from macOS:

```sh
cargo install --locked cargo-xwin
rustup target add x86_64-pc-windows-msvc
brew install llvm && export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
bun run build:windows
```

The installer lands in
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. **MSI/WiX needs a
Windows host**; cargo-xwin only produces NSIS.

## Updates

Release builds check `https://github.com/chark1es/Aulora/releases/latest/download/latest.json`,
check automatically at startup and every six hours. **Your settings → Updates**
shows the installed version and offers **Check for updates**, **Download update**,
and then **Restart to update**. Download verifies the minisign signature and keeps
the running app open; installation happens only on restart. A dot on settings
indicates an available update. Check for Updates is also in the app menu and tray. The public key is embedded in `tauri.conf.json`. The
private key and password originals are kept in `.secrets/release/desktop/` (gitignored).
Back them up. A lost private key cannot update installs that already shipped
with this public key.

`tauri build` signs updater artifacts only when `TAURI_SIGNING_PRIVATE_KEY` is
set. That passes `src-tauri/tauri.release.conf.json`, which turns on
`createUpdaterArtifacts`. CI bundle builds leave it off, so they do not need the
key. Releases are built by `.github/workflows/release.yml` when the version in
`tauri.conf.json` increases on `main`. Signing credentials are held in the
`main`-only `release-signing` Actions environment. The desktop release workflow
builds candidates separately. See the [GitHub Actions guide](../../docs/github-actions.md).

Linux in-app updates use the AppImage. The `.deb` package is a manual install.

## Verification

`bun run verify` checks the configs and CSP locally. The Rust shell itself can
only be compiled and exercised on a machine with the Rust toolchain and the
platform SDK; the `.github/workflows/desktop.yml` workflow is the verification
path, building the shell on macOS, Windows and Linux and uploading the bundles.

## Caveats

- Call picture-in-picture, background effects and screen capture are exercised in Chromium. The system webviews (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) differ, so confirm each on real installs: the window shrinking and staying on top, `getDisplayMedia`, and WebAssembly in the audio worklet. Record the evidence in the release checklist.
- Release acceptance covers menus, tray, badges, deep links, vibrancy, and installed updates. Configuration checks and successful builds do not verify those interactions. Record platform evidence in the [release checklist](../../docs/releasing.md).
- The dev CSP is strict (`script-src 'self'`); if Vite's HMR needs more during
  `tauri:dev`, pass a relaxed `--config` override rather than weakening the
  production policy.
