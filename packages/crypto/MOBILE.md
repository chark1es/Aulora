# Mobile MLS decision (Phase 4 boundary built)

Status: the ts-mls limitation was decided in Phase 0 (Spike B); this package
ships the web engine plus the Phase 4 native boundary and the Expo key store.
Source of truth: `spikes/mls-demo/REPORT.md` and `spikes/PHASE-0-REPORT.md`.
See `docs/PHASE-4-MOBILE-REPORT.md` for what is built vs. still needs the Mac.

## Finding: `ts-mls` cannot run on Expo / React Native as-is

`ts-mls@1.6.4` ships two crypto providers, and **both require
`crypto.subtle` X25519/Ed25519 support that Expo does not provide**:

- `defaultCryptoProvider` uses WebCrypto `subtle` for hash/HMAC, AES-GCM and
  Ed25519, and `@hpke/core` for X25519 — whose key generation still calls
  `subtle.generateKey`.
- `nobleCryptoProvider` moves hash/HMAC/AEAD/signature to pure-JS
  `@noble/*`, **but X25519 keygen/DH and HKDF still go through
  `@hpke/core`, which still calls `crypto.subtle`.** Noble does not help.

The Phase 0 probe (`spikes/mls-demo/src/rn-probe.ts`, output in
`rn-probe-output.txt`) deleted `globalThis.crypto.subtle` (keeping
`getRandomValues`) to simulate Hermes/Expo:

```
mode=default-full  subtle=object    RESULT: WORKED
mode=noble-full    subtle=object    RESULT: WORKED
mode=default       subtle=undefined NotSupportedError: ... this._api.generateKey
mode=noble         subtle=undefined NotSupportedError: ... this._api.generateKey
```

Both providers fail at the first X25519 key generation. `react-native-get-random-values`
only fixes randomness, `expo-crypto` does not expose `subtle`, and
`react-native-quick-crypto`'s Secure-Curves coverage is not guaranteed. This is
heavy shims territory for the exact primitives ts-mls needs.

**The gap, precisely:** Hermes/Expo gives `crypto.getRandomValues` but no
`crypto.subtle`, so there is no X25519 keygen/DH, Ed25519 signing or HKDF.
Any MLS stack on mobile must supply those itself. That is why the mobile engine
is OpenMLS (Rust) rather than ts-mls plus shims.

## Decision

Keep the swap point: every caller depends on `MlsEngine` (`src/engine.ts`), never
on ts-mls.

| Platform | Engine |
| --- | --- |
| Web (Vite SPA) | `createWebMlsEngine()` — `ts-mls@1.6.4` (this package) |
| Tauri desktop | same web engine in the webview; optionally OpenMLS in the Rust core later |
| iOS / Android | OpenMLS (Rust) behind `createNativeMlsEngine()` (`src/native-engine.ts`) |

## Phase 4 status

1. **Native boundary — built.** `createNativeMlsEngine({ bridge })` implements
   the full `MlsEngine` interface over an injected `NativeMlsBridge`; without a
   bridge it throws a typed `not-implemented` error instead of pretending a
   channel is encrypted. The twelve bridge operations mirror the engine and use
   the same MLS TLS wire format as the web engine.
2. **OpenMLS itself — TODO (macOS host).** Build OpenMLS for iOS/Android,
   UniFFI-wrap `MlsGroup`, and provide the bridge. Verify with the two-device
   conformance scenario in `test/scenario.ts` plus a `ts-mls` web-peer interop
   run. `NATIVE_MLS_TODO` in `src/native-engine.ts` is the exact checklist.
3. **`expoSecureStoreKeyStore()` — built** (`src/native-keystores.ts`). Each
   record is base64-encoded, chunked under the SecureStore value cap, and
   indexed in a dedicated record (SecureStore has no enumeration API). The
   `expo-secure-store` module is injected by the app, so this package stays
   Expo-free and the adapter is unit-tested with a fake store.
4. **`tauriKeychainKeyStore()` — built** (Phase 4.1) over the desktop shell's
   `keychain_*` commands, with an injected transport.

## Not now

No React Native / OpenMLS dependencies are added to this package. The mobile
engine is a deliberate, separate implementation behind the stable interface.

