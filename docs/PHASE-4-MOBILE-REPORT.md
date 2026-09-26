# Phase 4.2 — Aulora mobile: Gate Report

Date: 2026-09-26. Scope: the Expo (iOS + Android) client and its native
packages. Companion to `PHASE-4-DESKTOP-REPORT.md`; the five-client gate still
needs a reachable macOS host.

**Verdict: verified as far as Windows allows.** Typecheck, lint, unit tests and
`expo export` for both platforms pass locally. Nothing was run on a device or
simulator, and the OpenMLS native engine is a documented boundary, not a build.

## What shipped

- **`packages/ui-native`** (new): the React Native mirror of `@aulora/ui-web`.
  `Text`, `Heading`, `Button`, `IconButton`, `Card`, `Input`, `Spinner` (the
  particle spinner via `react-native-svg` + `Animated`) and `Logo`, all styled
  with NativeWind and the shared token preset. Class composition lives in pure
  `variants.ts`/`colors.ts` modules and is unit-tested.
- **`packages/crypto`**: `expoSecureStoreKeyStore()` is now a real adapter over
  `expo-secure-store` (iOS Keychain / Android Keystore): base64 values chunked
  under the SecureStore size cap with a JSON key index (SecureStore has no
  enumeration API). `createNativeMlsEngine()` is the OpenMLS native boundary:
  the full `MlsEngine` interface over an injected `NativeMlsBridge`, with a
  typed `not-implemented` error and `NATIVE_MLS_TODO` when no bridge exists.
- **`packages/avatars`**: `@aulora/avatars/native` now renders the Blobatar
  `<svg>` string through `react-native-svg`'s `SvgXml`, with the optional 2px
  role-color ring, so a user looks identical on web and mobile.
- **`apps/mobile`** (new Expo Router + NativeWind app):
  - Server rail + connect screen driven by `/.well-known/aulora.json`
    (API-version check, `aulora://connect?server=…` deep link).
  - Sign-in driven entirely by the profile's `auth` block: local email/password
    and one button per provider. OAuth/OIDC runs Authorization Code + PKCE in
    the system browser (`expo-web-browser` + `expo-linking`) and returns via
    `aulora://auth/callback`; the session cookie is persisted by a custom
    `fetch` (React Native has no cookie jar).
  - Chat UI: channel drawer, decrypted message list with day separators,
    composer, threads, reactions, presence/typing, and uploads through
    camera / photo library / clipboard paste / document picker with client-side
    EXIF-stripping re-encode and encryption.
  - `expo-notifications`: permission flow, a local notification channel, and
    **native APNs/FCM tokens via `getDevicePushTokenAsync()` — never Expo's
    hosted push**. Incoming messages decrypt locally and are rewritten into a
    local notification.
  - `expo-secure-store` key store and the OpenMLS engine boundary wired into
    the same `ChatSession`, port and subscriptions as web.
- **Docs**: `packages/crypto/MOBILE.md` updated with the Phase 4 status and the
  precise `crypto.subtle` gap (`getRandomValues` but no `subtle`, so no X25519
  keygen/DH, Ed25519 signing or HKDF — the reason ts-mls cannot run on Hermes).

## Verified locally (Windows, Bun 1.4.0, Node 22.18)

- `bun run typecheck` — **9/9 tasks pass** (mobile + ui-native added).
- `bun run lint` — **11/11 tasks pass**.
- `bun run test` — **366 tests pass** across nine packages (mobile 19,
  ui-native 8, crypto 37, avatars 6, core 115, convex 119, web 40, tokens 11,
  ui-web 11).
- `bun run --cwd apps/mobile export:android` → `Exported: dist/android`.
- `bun run --cwd apps/mobile export:ios` → `Exported: dist/ios`.

`expo export` bundles JS and assets only; it does **not** compile native code,
so it proves the app graph resolves (including the `@aulora/*` TS sources via a
Metro `.js`→`.ts` resolver) and bundles, not that the native modules run.

## What works vs TODO

**Works:** the full JS/TS surface above; profiles, connect, auth wiring, Convex
port/subscriptions, chat state, notifications logic and the key-store adapter
are all unit-tested where they can be.

**TODO — native MLS (the important one):** `createNativeMlsEngine()` throws a
typed `not-implemented` until OpenMLS is built. Because of that,
`createMobileChatRuntime()` returns `{ runtime: null, mlsError }` and the app
shows a clear banner: channels and presence are live from Convex, but messages
stay undecryptable and sending is disabled. This is deliberate — better than a
fake "encrypted" channel. Build steps are enumerated in
`packages/crypto/src/native-engine.ts` (`NATIVE_MLS_TODO`).

**Also gated on the missing engine:** attachment encryption/decryption also uses
`crypto.subtle` AES-GCM (`@aulora/crypto/attachment`), so it shares the same
gap until OpenMLS (or a WebCrypto shim) lands.

**Not wired:** push-token registration needs the device MLS identity key, which
only exists once the OpenMLS bridge exists; `registerDevicePushToken()` is ready
but dormant. Admin/roles UI, key backup and device verification are later
phases.

## What needs the Mac

1. Build OpenMLS for iOS/Android (UniFFI), provide the `NativeMlsBridge`, and
   pass it to `createMobileChatRuntime`. Verify with
   `packages/crypto/test/scenario.ts` plus a `ts-mls` web-peer interop run.
2. Run on a simulator/device: keychain round-trips, the PKCE browser flow,
   camera/clipboard uploads, and APNs/FCM token + local notification display.
3. Provide the `aulora://` scheme association and (for real push) the project
   push relay for store builds.
4. The five-client gate: one account on web, desktop, iOS and Android.

## Notes for the macOS host (Bun monorepo quirks found here)

- Bun's isolated installs do not hoist Expo's transitive deps, so the app
  declares `babel-preset-expo`, `@babel/plugin-transform-react-jsx` and
  `react-native-css-interop` directly.
- `@aulora/*` packages are TS source with ESM `./x.js` specifiers; the Metro
  config retries extension-less resolution (Vite already handles this).
- Windows Credential Manager's 2560-byte cap and SecureStore's 2048-byte cap
  are why MLS records are chunked.

## Commits

- `feat(ui-native): add React Native design-system primitives`
- `feat(crypto,avatars): expo secure-store key store, OpenMLS native engine boundary, RN avatars`
- `feat(mobile): scaffold Expo Router + NativeWind app that exports for iOS and Android`
- `feat(mobile): connect, native auth, chat UI, notifications and uploads`
