> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phase 4.1 — Aulora desktop: Gate Report

Date: 2026-09-26. Scope: the Tauri 2 desktop shell only. iOS/Android, mobile
push and the five-client gate remain for the rest of Phase 4.

**Verdict: NOT independently gated on device.** No Rust toolchain or platform
SDK was available in the authoring environment, so nothing here was compiled or
run as a desktop binary. What could be checked locally was checked; the rest is
delegated to CI and a manual pass.

## What shipped

- **`apps/desktop`**: a Tauri 2 shell over the existing `apps/web` SPA.
  - Native app menu (app/File/Edit/View/Window) with `Cmd/Ctrl+K` quick switcher,
    `Cmd/Ctrl+N` connect, close-to-tray.
  - System tray / menu-bar item: open, connect, quit; left click focuses.
  - Notifications with device-computed title/body (`show_notification`).
  - Unread badge: macOS/Linux via `set_badge_count`, Windows via a generated
    overlay icon (`set_overlay_icon`).
  - OS keychain key store commands (`keychain_get/set/delete/list`); each record
    is one entry, with a JSON index for enumeration.
  - `aulora://connect` and `aulora://invite` deep links, buffered for
    cold-start, plus single-instance forwarding.
  - macOS `Sidebar` vibrancy behind translucent rails; overlay title bar.
  - CSP: bundled code only (`script-src 'self'`), `ipc:`/`http://ipc.localhost`
    for commands, no remote script origins.
- **`packages/crypto`**: `tauriKeychainKeyStore()` implemented to the `KeyStore`
  contract with an injectable transport, exported and unit-tested.
- **`apps/web`**: `DesktopBridge` (deep links, quick switcher, View > Toggle
  Sidebar) and `useDesktopNotifications` (notifications + badge); theme bootstrap
  moved out of `index.html` so a strict CSP needs no inline script; device record
  reports `platform: "desktop"`.
- **`.github/workflows/desktop.yml`** (name **Desktop**): builds and bundles the
  shell on macOS, Windows and Linux.

## Verified locally

- Crypto adapter contract: 6 new tests, 32/32 crypto tests pass; typecheck/lint
  clean.
- Web: `tsc --noEmit`, 40/40 unit tests, production `vite build`; `theme-boot.js`
  copied to `dist/`.
- Tauri configs: `bun run verify` structural/CSP checks pass; base and the three
  platform-merged configs validate against the official `https://schema.tauri.app/config/2`
  JSON Schema (Ajv, RFC 7396 merge).
- Workflow YAML parses; step list and matrix confirmed.

## Not verified locally (CI/manual required)

- **Rust compilation** of the shell on any target.
- On-device: native menus, tray, notifications, badge/overlay, keychain access,
  deep-link registration and behaviour, vibrancy, single instance.
- Keychain caveat: Windows Credential Manager caps a generic credential at 2560
  bytes; large MLS group states may exceed it.

## Next

Run the **Desktop** workflow; then a manual pass on a macOS and Windows machine
for the native surfaces above before the five-client gate.
