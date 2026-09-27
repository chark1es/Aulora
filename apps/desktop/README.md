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
