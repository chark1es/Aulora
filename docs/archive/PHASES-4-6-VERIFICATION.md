> Archived work record. This file can describe removed code or unresolved work that has since changed. Use [the current documentation](../README.md) and [project status](../project-status.md).

> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM). This report is a historical record of the earlier MLS design.

# Phases 4–6 — Verification Status

Date: 2026-09-26. This closes the source work for Phases 4–6 and records exactly what was
proven on real hardware versus what remains blocked. All phases have runnable source, tests,
and docs; the gaps below are verification gaps, not missing features.

## What shipped (source complete, committed)

- **Phase 4 — Clients:** `apps/desktop` (Tauri 2: native menus, tray, notifications, unread
  badge, OS-keychain key store, `aulora://` deep links, single-instance, macOS vibrancy,
  Cmd/Ctrl+K) with a macOS/Windows/Linux CI workflow; `apps/mobile` (Expo + Expo Router +
  NativeWind, secure-store keys, notifications tokens, react-native-svg avatars, PKCE sign-in,
  camera/paste uploads) and `packages/ui-native`; web push (VAPID + service worker) and
  desktop/web deep links.
- **Phase 5 — Keys + mobile push:** device verification (safety numbers + QR), Argon2id
  recovery backup, X25519 history-key sharing, and the `infra/push-relay` service (APNs/FCM/
  UnifiedPush, content-free wakeups only, `POST /v1/wake`).
- **Phase 6 — Beta:** admin panel (auth providers, quotas, backups, push-relay settings),
  license status screen, `LICENSE` (PolyForm Noncommercial 1.0.0) + `COMMERCIAL.md` +
  `CLA.md`/`CONTRIBUTING.md`, nightly backup runner, static docs site, and a one-command
  installer (`install.sh` / `install.ps1`).

Test suite at this revision: **466 Vitest tests**, plus a `node:test` push-relay suite;
`turbo run typecheck lint test` is green (10/10, 12/12, 10/10).

## Verified on the Mac (macOS 26.5.1, Xcode 26.6, iPhone 17 Pro sim, Android SDK)

- **Networking/auth across the tailnet.** The Windows host runs the stack; the Mac reaches it at
  `http://100.64.0.10:8080`. `/.well-known/aulora.json` → 200 with the correct
  `convexUrl`/`siteUrl`; `POST /api/auth/sign-in/email` → 200 issuing
  `better-auth.session_token` + `better-auth.convex_jwt` for the owner. So one account
  authenticates against the server **from the Mac**.
- **Desktop (macOS):** `bun run tauri build --debug` compiled the Rust shell and bundled
  **`Aulora.app`**, which launches (`aulora-desktop` running). Only the optional DMG step fails
  in a headless session; CI runs it on `macos-latest`.
- **Android:** `expo run:android` reached **`BUILD SUCCESSFUL`** and installed/launched the dev
  client on the emulator. The first launch exposed a real bug — a stale `expo-screen-orientation`
  import with no declared dependency — which is already removed at HEAD; native deps were also
  corrected to their Expo SDK 57 versions (`react-native-svg` 15.15.4, async-storage 2.2.0,
  single React). A clean rebuild with those deps was still compiling at hand-off.
- **Web:** no baked-in backend; the built bundle contains no owner/server origin.

## Follow-up (same day)

- **iOS toolchain fixed.** The CocoaPods crash was the environment's locale: with `LANG`/`LC_ALL`
  unset, CocoaPods normalizes the project path as ASCII-8BIT and throws
  `Encoding::CompatibilityError: Unicode Normalization not appropriate for ASCII-8BIT`. Running
  with `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` makes `pod install` succeed; iOS prebuild, pod
  install, and `expo run:ios` then build and install **Aulora.app on the iPhone 17 Pro simulator**
  (0 errors).
- **Native MLS resolved without OpenMLS.** `react-native-quick-crypto@1.1.7`'s `crypto.subtle`
  covers every primitive ts-mls and `@hpke/core` need (X25519, Ed25519, HKDF, HMAC, AES-GCM,
  SHA-256, `getRandomValues`), so mobile runs the **same ts-mls engine** behind `MlsEngine` via
  `createReactNativeMlsEngine()` (commit `c4e38ea`). No Rust/UniFFI build is required. Remaining:
  confirm the primitive probe on a real Hermes build and mobile↔web interop.
- **Runtime capture caveat.** The simulator is shared with another React Native project whose
  Metro (port 8081) and error screen interfere with the Aulora dev client; the app loads a stale/
  wrong JS bundle and shows an old `ExpoScreenOrientation` error that no longer exists in source.
  A clean capture needs a dedicated simulator and a single Metro (port 8082). Android builds and
  installs (`BUILD SUCCESSFUL`); iOS builds and installs.

## Follow-up 2 (Android release capture — signed in)

A Metro-independent **release** build was driven on the emulator via `adb` against the stack
(exposed to the emulator with `adb reverse` + a Windows→Mac reverse SSH tunnel, origins set back
to `localhost`):

- The app launches, fetches the well-known, and shows the workspace-confirmation card with the
  real **Blobatar** server icon and `Aulora v0.1.0 · API v1`.
- Signing in as the owner reaches the **signed-in chat shell**: server rail, `Aulora`, presence
  (`0 online`), `Sign out`, `Select a channel to start.`
- So **one account signs in on the Android native client**.

One remaining defect: the shell shows "End-to-end encryption is not active on this build …
react-native-quick-crypto is unavailable", even though the rebuilt APK **does** contain
`lib/arm64-v8a/libQuickCrypto.so` + `libNitroModules.so` (all four ABIs) and
`newArchEnabled=true`. `adb logcat` confirms the native side works:
`QuickCrypto: Loading C++ library... / Successfully loaded C++ library!` and `libNitroModules.so`
+ `libQuickCrypto.so` loaded. So the failure is in the app's **JS-side install/detection**
(`installReactNativeCrypto` → `globalThis.crypto.subtle` still missing, or a probe primitive
failing), not the build. The likely culprit is the `install` named import / global patching under
Hermes. Fixing and re-verifying needs one focused code pass + an ~9 min rebuild; optionally add a
one-line `mlsError` log to make the next diagnosis instant.

## Blocked / not yet verified (with causes)

1. **iOS build** — CocoaPods 1.17.0 crashes under the Mac's Ruby 4.0.5
   (`String#unicode_normalize` in `Pod::Config#installation_root`), so `pod install` cannot run.
   This is a host-toolchain bug, not the app. Fix: install CocoaPods on a Ruby 3.x, or use a
   prebuilt dev client. Then `expo run:ios` should proceed.
2. **Native MLS (OpenMLS) on device** — `createNativeMlsEngine()` is still a typed
   not-implemented boundary; mobile shows an E2EE-unavailable banner. Message E2EE and attachment
   AES-GCM on device need the OpenMLS UniFFI build for iOS/Android (Phase 4 follow-up,
   documented in `packages/crypto/MOBILE.md`).
3. **Five-client live gate** — sign-in is proven for web and (via the API) from the Mac;
   desktop macOS builds/launches; Android builds/installs. A single signed-in session on all five
   simultaneously was not captured, pending items 1–2 and an Android UI pass.
4. **Real push delivery** — web/desktop/mobile push code paths are unit-tested; actual APNs/FCM/
   UnifiedPush delivery needs real credentials and devices.
5. **Phase 6 self-host gate** — the installer, backups, admin panel, and docs are built and
   unit-tested; an outside tester completing the install unaided has not happened.

## Immediate next steps

1. Fix the Mac's CocoaPods/Ruby and run `expo run:ios`; finish the Android UI pass.
2. Build OpenMLS for iOS/Android and wire `createNativeMlsEngine()`.
3. Capture one account signed in on web + desktop + iOS + Android.
