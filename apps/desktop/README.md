# Aulora desktop

A Tauri 2 shell that wraps the `apps/web` Vite SPA. The webview is the same
React client as the browser build; this crate contributes only the native
surface and the OS integrations. Message encryption is server-side behind an
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
| macOS Sidebar vibrancy behind translucent rails | `window.rs`, `tauri.macos.conf.json` |
| Locked-down CSP: bundled code only, no remote script origins | `tauri.conf.json` |
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
checks silent installation and uninstallation.

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

## Verification

`bun run verify` checks the configs and CSP locally. The Rust shell itself can
only be compiled and exercised on a machine with the Rust toolchain and the
platform SDK; the `.github/workflows/desktop.yml` workflow is the verification
path, building the shell on macOS, Windows and Linux and uploading the bundles.

## Caveats

- On-device behaviour (menus, tray, badge, deep links, vibrancy) has
  **not** been verified locally: no Rust toolchain was available when this
  landed. CI builds only prove it compiles and bundles.
- The dev CSP is strict (`script-src 'self'`); if Vite's HMR needs more during
  `tauri:dev`, pass a relaxed `--config` override rather than weakening the
  production policy.
