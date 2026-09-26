# Mobile MLS decision (recorded, not built)

Status: decided in Phase 0 (Spike B); this package ships the web engine only.
Source of truth: `spikes/mls-demo/REPORT.md` and `spikes/PHASE-0-REPORT.md`.

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

## Decision

Keep the swap point: every caller depends on `MlsEngine` (`src/engine.ts`), never
on ts-mls.

| Platform | Engine |
| --- | --- |
| Web (Vite SPA) | `createWebMlsEngine()` — `ts-mls@1.6.4` (this package) |
| Tauri desktop | same web engine in the webview; optionally OpenMLS in the Rust core later |
| iOS / Android | OpenMLS (Rust) behind the same `MlsEngine` interface |

## Phase 4 / 5 plan (to implement and verify on the macOS host)

1. Phase 4: build OpenMLS for the native targets (UniFFI/WASM) and implement
   `MlsEngine` on top of it. Verify with the **same two-device conformance
   scenario** used by this package's tests (create → KeyPackage → add+welcome →
   join → bidirectional messages → epoch advance → remove → removed decrypt
   fails), plus interop against a `ts-mls` web peer.
2. Phase 4: `tauriKeychainKeyStore()` over the OS keychain is implemented in
   `src/native-keystores.ts`. It stores each record as its own macOS Keychain /
   Windows Credential Manager / Linux Secret Service entry through the Tauri
   shell's `keychain_*` commands. The contract is unit-tested with an injected
   transport; on-device keychain behaviour is verified by the desktop CI build.
3. Phase 5: implement `expoSecureStoreKeyStore()` over `expo-secure-store`
   (iOS Keychain / Android Keystore) (stub in `src/native-keystores.ts`).

## Not now

No React Native / OpenMLS dependencies are added to this package in Phase 2.
The mobile engine is a deliberate, separate implementation behind the stable
interface.
