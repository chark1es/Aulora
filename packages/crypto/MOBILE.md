# Mobile MLS on Hermes: ts-mls over `react-native-quick-crypto`

Status: **implemented and unit-verified; device verification pending.**
Source of truth for the Phase 0 limitation: `spikes/mls-demo/REPORT.md` and
`spikes/PHASE-0-REPORT.md`. History: `docs/PHASE-4-MOBILE-REPORT.md`.

## Finding (Phase 0): `ts-mls` alone cannot run on Expo / Hermes

`ts-mls@1.6.4` needs WebCrypto `subtle` for X25519 keygen/DH (through
`@hpke/core`) and, depending on the provider, AES-GCM, HKDF, HMAC and digest.
Hermes/Expo exposes `crypto.getRandomValues` but no `crypto.subtle`, so both
providers fail at the first X25519 key generation. The Phase 0 probe
(`spikes/mls-demo/src/rn-probe.ts`) proved this.

## Decision (revised): shim `subtle`, reuse the web engine

`react-native-quick-crypto` 1.x (current 1.1.7, 2026-08-15) ships a native
OpenSSL-backed `crypto.subtle` that covers every primitive ts-mls and
`@hpke/core` call — verified against the current package docs
(`.docs/implementation-coverage.md`) and the exact library calls, not memory:

| Primitive (exact call) | quick-crypto 1.x |
| --- | --- |
| `subtle.generateKey` X25519 / Ed25519 | yes |
| `subtle.deriveBits` X25519, HKDF | yes |
| `subtle.sign` / `verify` Ed25519, HMAC | yes |
| `subtle.encrypt` / `decrypt` AES-GCM | yes |
| `subtle.importKey` / `exportKey` X25519 `raw`/`jwk`/`pkcs8`, Ed25519, HMAC, HKDF, AES-GCM | yes |
| `subtle.digest` SHA-256 | yes |
| `getRandomValues` (and `install()` patching `globalThis.crypto`) | yes |

So the cheapest working path is **not** OpenMLS: it is installing that polyfill
and reusing `createWebMlsEngine()` unchanged. `@hpke/core` reads
`globalThis.crypto.subtle` directly, so `install()` must patch the global.

| Platform | Engine |
| --- | --- |
| Web (Vite SPA) | `createWebMlsEngine()` — `ts-mls@1.6.4` |
| Tauri desktop | same web engine in the webview |
| iOS / Android | `createReactNativeMlsEngine()` — quick-crypto + the same ts-mls engine |

## What is built

1. **`createReactNativeMlsEngine()`** (`src/react-native-engine.ts`) installs the
   injected `react-native-quick-crypto` module, fails with a typed
   `not-implemented` error if `crypto.subtle` is absent, then delegates to
   `createWebMlsEngine()` behind the same `MlsEngine` interface.
2. **`probeReactNativeCrypto()`** checks the exact primitives on-device and
   returns a per-primitive report; `isReactNativeCryptoSufficient()` gates it.
3. **`expoSecureStoreKeyStore()`** (`src/native-keystores.ts`) remains the mobile
   key store (iOS Keychain / Android Keystore, chunked with a JSON key index).
4. **OpenMLS boundary retained as an alternative** (`src/native-engine.ts`):
   `createNativeMlsEngine({ bridge })` is still the typed drop-in for a future
   Rust core, but it is no longer the default mobile path.
5. **App wiring** (`apps/mobile/src/lib/mls-engine.ts`,
   `src/lib/chat-runtime.ts`): install once at startup, probe, persist the
   device identity with `ensureDeviceIdentity()`, then run the same
   `ChatSession` as web. `react-native-quick-crypto`,
   `react-native-nitro-modules` and `react-native-quick-base64` are declared in
   `apps/mobile/package.json`.

## Tests (Windows)

`packages/crypto/test/react-native-engine.test.ts` simulates Hermes (a `crypto`
with `getRandomValues` but no `subtle`), runs the installer, and then executes
the full two-device scenario through `createReactNativeMlsEngine`. It also
asserts the typed failure when the module is absent and the full primitive
report. `apps/mobile/test/mls-engine.test.ts` covers the app wiring with the
native module mocked. Run `bun run typecheck && bun run test` in either package.

## Still needs device verification (not provable on Windows)

`expo export` only bundles JS; quick-crypto is native code, so these must run on
a real dev build (`expo prebuild` + `expo run:ios|android`), **not Expo Go**:

1. `install()` and `probeReactNativeCrypto()` on device: every primitive `true`
   on a Hermes build (this is the one assumption still resting on docs).
2. Two-device conformance: the scenario in `packages/crypto/test/scenario.ts`
   between two physical devices.
3. Interop: a mobile device and the `ts-mls` web peer exchange messages in one
   channel (same TLS wire format).
4. Identity/KeyPackage persistence across app restarts in SecureStore, and
   attachment AES-GCM (`@aulora/crypto/attachment`) on-device.

## Not now

No OpenMLS/Rust build is required for E2EE on mobile. It stays a possible
optimization (smaller state, Rust-side key custody), not a blocker.