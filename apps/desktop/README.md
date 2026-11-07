# Aulora desktop

A Tauri 2 shell that wraps the `apps/web` Vite SPA. The webview is the same
React client as the browser build; this crate contributes only the native
surface and the OS integrations. Message encryption is server-side using a local key or an optional
external key manager, so the client stores no keys and the shell has no key
store of its own.

## What the shell adds

| Feature | Where |
| --- | --- |
| Native menu bar (app/File/Edit/View/Window), `Cmd/Ctrl+K` quick switcher | `src-tauri/src/menu.rs` (macOS only; Windows and Linux use the tray and the webview shortcuts) |
| System tray / menu-bar item with open, connect, quick switcher, sidebar toggle and quit | `src-tauri/src/tray.rs` |
| Windows/Linux shortcuts: Ctrl+N connect, Ctrl+Shift+D sidebar, F11 fullscreen | `apps/web/src/lib/use-desktop-shortcuts.ts` |
| Native notifications with device-computed text | `commands.rs` (`show_notification`) |
| Dock/taskbar unread badge (macOS/Linux count, Windows overlay icon) | `commands.rs`, `window.rs` |
| `aulora://connect` and `aulora://invite` deep links, single instance | `deep_link.rs` |
| Signed in-app updates from the GitHub `latest.json` feed | `updater.rs`, `tauri.conf.json` |
| macOS Sidebar vibrancy behind translucent rails | `window.rs`, `tauri.macos.conf.json` |
| Locked-down CSP: bundled code only, no remote script origins (`'wasm-unsafe-eval'` allows WebAssembly for noise suppression and background blur, not JavaScript `eval`) | `tauri.conf.json` |
| Call picture-in-picture: a separate small, always-on-top call window that can be dragged anywhere — including off the app window and onto another screen — while the app window stays visible and usable | `src-tauri/src/pip_window.rs`, `apps/web/src/components/voice/CallPipWindow.tsx` |
| The call window is a second webview of the same bundle (`index.html#pip`); the app streams the call to it over events and it sends control presses back, because the peer connections and media cannot leave the main webview | `apps/web/src/lib/call-pip.ts`, `apps/web/src/providers/use-call-pip.ts` |
| Closing the call window never ends the call: the app window keeps the audio, the participants and its own controls; `bun run verify` keeps the window's entry and label in sync | `src-tauri/src/lib.rs`, `tauri.conf.json` (`backgroundThrottling`) |
| Native media prompts: mic/camera/notifications in the main webview are auto-allowed, macOS keeps its TCC prompt | `src-tauri/src/lib.rs`, `Info.plist`, `Entitlements.plist` |
| Native drag-drop disabled (`dragDropEnabled: false`) so the web composer accepts files dropped anywhere in the window | `tauri.conf.json`, `tauri.macos.conf.json` |
| In-app screen/window share picker: the shell lists the screens and windows (with thumbnails) and streams the chosen one as frames, so no engine picker names the `tauri.localhost` origin | `src-tauri/src/capture.rs`, `apps/web/src/lib/voice/display-picker.ts`, `apps/web/src/components/voice/DisplaySourcePicker.tsx` |
| Screen-sharing permission prompt: the picker asks the OS before capturing, explains why the permission is needed, and opens the pane that grants it instead of showing black frames | `src-tauri/src/capture.rs` (`screen_capture_permission`, `open_capture_permission_settings`), `apps/web/src/components/voice/DisplaySourcePicker.tsx` |
| System audio in a share: the shell streams 20 ms PCM chunks over an IPC channel and the web client plays them into a worklet-backed track (WASAPI exclude-process loopback, ScreenCaptureKit audio, or a PulseAudio monitor) | `src-tauri/src/capture_audio/`, `apps/web/src/lib/voice/system-audio.ts`, `apps/web/public/worklets/pcm-playback.js` |

The web player (`apps/web`) talks to the shell through `window.__TAURI__`
(commands `set_unread_badge`, `show_notification`, `take_deep_links`,
`open_pip_window`, `close_pip_window`, `is_pip_window_open`,
`focus_main_window`, `list_capture_sources`, `capture_source_frame`; events
`aulora://deep-link`, `aulora://quick-switcher`, `aulora://call-pip-state`,
`aulora://call-pip-action`, `aulora://call-pip-closed`). It carries no
`@tauri-apps/*` npm dependency, so the web build is unchanged.

## Requirements

- Bun 1.4+, Rust stable (1.77.2+), and the Tauri platform prerequisites
  (Xcode CLT on macOS; WebView2 on Windows; `webkit2gtk-4.1`, `libdbus-1-dev`,
  `libssl-dev`, the X11 headers `libxcb1-dev` + `libxcb-randr0-dev`, and
  `libpulse-dev` for the system-audio monitor, on Linux).
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
- Mic, camera and notification prompts in the main webview are auto-allowed (the OS TCC prompt on macOS is unchanged). Screen sharing in the shell does not use `getDisplayMedia` at all: `list_capture_sources` / `capture_source_frame` (see `capture.rs`, built on `xcap`) enumerate screens and windows and return JPEG frames, and the web client draws them into a canvas it captures. The browser build still uses the engine picker.
- Screen-sharing permission: the picker asks the shell first (`screen_capture_permission`). On macOS that is `CGPreflightScreenCaptureAccess`, and the dialog's **Open System Settings** action calls `CGRequestScreenCaptureAccess` (which lists Aulora in Privacy & Security › Screen Recording) and then opens that pane; the dialog also has **Check again** and says that nothing is shared until the grant lands. Declining or a still-denied permission fails the share with that reason instead of capturing black frames. Windows and X11 need no grant. Wayland is reported as unsupported before any capture: xcap would have to ask the compositor/portal for a screenshot per frame, which is too slow and can re-prompt for a live share.
- Screen capture limits: `xcap` is pinned to 0.4 because 0.9+ needs PipeWire and libclang on Linux and Rust 1.85 (edition 2024); macOS capture is `CGWindowListCreateImage` in both lines, so the 10.15 floor is unchanged.
- System audio (`settings.streamAudio`, or the picker's **Share system audio** switch) comes from a backend of its own, because the frame path has no audio. Windows uses WASAPI process loopback in exclude mode (Windows 10 2004+), so the call's own playback stays out and nobody hears themselves. It excludes the WebView2 browser process rather than Aulora's own: Windows only follows a process's direct children, and the page's sound is played by a helper that is a grandchild of the app (measured on Windows 11: excluding the app's own PID let the page audio through, excluding the browser process silenced it, even when playback began after the capture); older Windows falls back to default-endpoint loopback and the picker warns that it will echo. macOS uses ScreenCaptureKit audio (macOS 13+) with `excludesCurrentProcessAudio`, under the same Screen Recording grant the share already asks for — there is no second permission. Linux records the default sink's PulseAudio/PipeWire monitor, which cannot exclude one process, so the picker warns that the capture includes Aulora's own call audio. The web client resamples to the AudioContext rate in an AudioWorklet with a 300 ms ring buffer that drops the oldest frames, so audio latency stays bounded; a backend that fails only costs the audio and the call shows a dismissible notice while the video share continues.
- The worklet module is served from the app origin (`public/worklets/pcm-playback.js`) because the CSP is `script-src 'self'`; it must stay a plain bundled asset, never a blob or inline module. Frames are pulled one at a time as base64 JPEG over IPC, so latency tracks the profile (15 or 30 fps, 720p/1080p) rather than video-game smoothness, and a slow machine simply shares fewer frames. Measured on Windows 11 (release build, capture scaled to 1280×720): a window ~60 fps, a 1920×1200 screen ~15 fps, a 3840×2160 screen ~7 fps, because `xcap` 0.4 captures the Windows desktop with GDI and a 4K grab alone takes ~70 ms; a faster capture backend (DXGI or Windows Graphics Capture) is the way to raise that. Windows that are minimized, owned by Aulora, tiny helper windows, or that cannot be captured are not offered. The canvas hand-off (`canvas.captureStream`) is exercised in Chromium/WebView2; browser data says Safari 11+ (so WKWebView) has it, but that and WebKitGTK are unverified here and belong in the release checklist.
- Release acceptance covers menus, tray, badges, deep links, vibrancy, and installed updates. Configuration checks and successful builds do not verify those interactions. Record platform evidence in the [release checklist](../../docs/releasing.md).
- The dev CSP is strict (`script-src 'self'`); if Vite's HMR needs more during
  `tauri:dev`, pass a relaxed `--config` override rather than weakening the
  production policy.
