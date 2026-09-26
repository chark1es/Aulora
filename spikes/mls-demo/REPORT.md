# Spike B - Phase 0: MLS (RFC 9420) crypto library proof

**Date of checks:** 2026-09-25 / 2026-09-26
**Environment:** Windows 10/11, PowerShell 5.1, bun 1.4.0 (bundled Node compat 26.3.0), node v22.18.0 on PATH
**Scope:** prove or reject `ts-mls` as Aulora's MLS engine; two-device runnable demo; browser + React Native viability.
**Verdict:** **ts-mls is OK for the browser (Web Worker) and Node/Bun path.** It is **not usable in Expo/React Native without a full WebCrypto-`subtle` polyfill**; for an RN-first product, replace the crypto core with OpenMLS (Rust -> WASM / native bindings) behind the same interface.

---

## 1. Library vetting

### 1.1 `ts-mls` on npm - real, maintained, MIT

Command:

```powershell
npm view ts-mls version time.modified repository license
```

Observed:

```
version = '1.6.4'
time.modified = '2026-08-28T01:57:35.319Z'
repository = { url: 'git+https://github.com/LukaJCB/ts-mls.git', type: 'git' }
license = 'MIT'
```

Additional `npm view` facts:

- First publish `0.1.0` on **2025-06-18**; npm package created **2025-07-10**.
- Latest stable **1.6.4** published **2026-08-28T01:57:35.012Z**.
- `1.6.3` also on 2026-08-28; a parallel `2.0.0-rc.16` line published 2026-07-18 (release-candidate churn).
- Only runtime dependency: `@hpke/core@1.9.0`. Optional peers: `@noble/curves`, `@noble/ciphers`, `@noble/post-quantum`, `@hpke/chacha20poly1305`, `@hpke/hybridkem-x-wing`, `@hpke/ml-kem`, `@hpke/dhkem-x448`.
- ESM only (`"type": "module"`), Node.js 20+.
- npm weekly downloads ~12,677, 19 dependents (npm package page, 2026-09-26).
- URL: https://www.npmjs.com/package/ts-mls

### 1.2 GitHub repo activity

Command (GitHub REST):

```powershell
Invoke-RestMethod "https://api.github.com/repos/LukaJCB/ts-mls"
```

Observed (2026-09-25):

- `created_at`: **2025-04-19**
- `pushed_at`: **2026-09-25T17:54:43Z** (pushed the same day as this spike)
- `stargazers_count`: **109**, `forks_count`: **21**
- `open_issues_count`: 15, open PRs: 9
- 613 commits on `main`
- Language: TypeScript; `archived`: false
- URL: https://github.com/LukaJCB/ts-mls

No `CHANGELOG.md` exists in the repository (404 on `raw/main/CHANGELOG.md`); release notes live in GitHub releases/npm only. `SECURITY.md` explicitly states: *"This is a volunteer-maintained project... It has NOT undergone professional security audits."* Single maintainer, no formal audit.

### 1.3 RFC 9420 test-vector coverage

The repository ships the **official RFC 9420 / MLS WG test-vector JSON suite** under `test_vectors/` (checked via GitHub contents API on 2026-09-25):

```
crypto-basics.json (20 KB)          key-schedule.json (102 KB)
deserialization.json (0.8 KB)       message-protection.json (31 KB)
messages.json (2.7 MB)              passive-client-handling-commit.json (1.3 MB)
passive-client-random.json (1.9 MB) passive-client-welcome.json (0.7 MB)
psk_secret.json (155 KB)            secret-tree.json (211 KB)
transcript-hashes.json (7 KB)       tree-math.json (91 KB)
tree-operations.json (51 KB)        tree-validation.json (1.3 MB)
treekem.json (2.0 MB)               welcome.json (17 KB)
```

These are the standard file names of the IETF MLS implementation test vectors
(https://github.com/mlswg/mls-implementations/tree/main/test-vectors). `test/test-vectors/` drives them from Vitest (`vitest.config.ts`, plus `vitest.browser.config.ts` for a real-browser run).

### 1.4 Interoperability harness (real interop, not just vectors)

`interop/` contains a gRPC service (`interop/proto`, Dockerfile, `pnpm start`) and its README documents running against **OpenMLS** through the official `mlswg/mls-implementations` Go test runner:

```
go run main.go -client localhost:50051 -client localhost:50053 -config ../configs/welcome_join.json
```

> "The runner permutes the configured actors across both backends, so a green run means every script passes in every (openmls, ts-mls) role assignment."

So ts-mls is exercised both against RFC 9420 vectors and cross-implementation against OpenMLS. This is strong evidence of RFC 9420 interoperability.

### 1.5 Crypto backend (measured from installed 1.6.4, not from docs)

`ts-mls` ships two providers:

- `defaultCryptoProvider` (default):
  - Hash/HMAC -> **WebCrypto `crypto.subtle`** (`makeHashImpl.js` uses `subtle.digest` / `subtle.sign("HMAC")`).
  - AEAD AES-GCM -> **WebCrypto `crypto.subtle`** (`default/makeAead.js` uses `subtle.importKey("raw", ..., "AES-GCM")`).
  - Signature Ed25519 -> **WebCrypto `crypto.subtle`** when available; otherwise dynamic fallback to `@noble/curves` (which is an *optional* peer).
  - X25519/KDF -> `@hpke/core@1.9.0`; X25519 **key generation and DH use WebCrypto `subtle`** (`@hpke/core/esm/src/kems/dhkemPrimitives/x25519.js` calls `this._api.generateKey`). A bundled pure-JS Montgomery ladder exists in `@hpke/common` but keygen still goes through `subtle`.
  - RNG -> `crypto.getRandomValues`.
- `nobleCryptoProvider` (opt-in):
  - Hash/HMAC -> `@noble/hashes` (pure JS), AEAD -> `@noble/ciphers` GCM (pure JS), signature -> noble fallback, **but X25519 keygen/DH and HKDF still go through `@hpke/core` -> `subtle`**, RNG still `crypto.getRandomValues`.

**Consequence:** neither provider is WebCrypto-free. `crypto.subtle` is mandatory.

### 1.6 Observed packaging defect (real, reproducible)

A bare `bun install` of `ts-mls@1.6.4` then `bun run`s any import fails:

```
error: Cannot find module '@noble/hashes/sha2.js' from
...\node_modules\ts-mls\dist\src\crypto\implementation\noble\makeHashImpl.js
```

Cause: `ts-mls`'s package entry (`dist/src/index.js`) **eagerly re-exports `nobleCryptoProvider`**, whose module graph imports `@noble/hashes`; `@noble/hashes` is neither a dependency nor a declared peer. Installing `@noble/hashes@2.3.0` fixes it. This is a supply-chain/UX risk for consumers.

### 1.7 API/doc drift (real, reproducible)

The current README "Basic Usage" does **not** match the published 1.6.4 API. In 1.6.4:

- Functions take positional args, not an options object: `createCommit({state, cipherSuite}, options)`, `createApplicationMessage(state, bytes, cs)`, `processPrivateMessage(state, pm, pskIndex, cs, cb)`, `generateKeyPackage(credential, capabilities, lifetime, extensions, cs)`, `createGroup(groupId, kp, priv, extensions, cs)`, `joinGroup(welcome, kp, priv, psk, cs, tree?, ...)`.
- Wire codecs differ: `encodeMlsMessage(msg)` returns bytes, but `decodeMlsMessage(bytes, offset)` **requires an explicit offset and returns `[value, bytesConsumed]`**, not a bare message. Calling `decodeMlsMessage(bytes)` silently returns `undefined`.
- `createCommit` defaults to a **private** commit message (`wireAsPublicMessage = false`); use `{ wireAsPublicMessage: true }` for a public commit.

### 1.8 Credible alternatives and their status (checked 2026-09-25/26)

| Option | Version / date | Status | Notes / URL |
| --- | --- | --- | --- |
| **OpenMLS** (Rust, reference impl) -> WASM | Rust repo active; docs current | Mature, RFC 9420. WASM requires `js` feature; needs JS runtime for randomness/time (`getrandom` `wasm_js`, `fluvio-wasm-timer`); `wasm-pack build --target web/nodejs/bundler`. | No official polished npm package; the in-repo `openmls-wasm` wrapper is described as **experimental**. https://openmls-openmls.mintlify.app/advanced/webassembly , https://github.com/openmls/openmls |
| `openmls-wasm` (npm) | **0.1.0**, 2025-10-10, MIT | Experimental, one release | https://www.npmjs.com/package/openmls-wasm |
| `ping-openmls-sdk` (OpenMLS WASM SDK) | **0.7.49**, 2026-09-21, Apache-2.0 | Actively maintained; browsers + React Native + RN-Web + Electron/Tauri; WASM runs in a Worker; RN uses native binaries (`ping-openmls-sdk-react-native-macos`). 3rd-party product SDK, not neutral. | https://www.npmjs.com/package/ping-openmls-sdk |
| `@vanishing.page/webcrypto-mls` | **0.0.11**, 2026-08-13 | Fork of ts-mls, **WebCrypto-only** (requires `subtle` X25519/Ed25519, no noble fallback). Good for modern browsers, strictly worse for RN. License "SEE LICENSE IN LICENSE" (non-standard). | https://github.com/vanishing-page/webcrypto-mls |
| `@absolutejs/e2ee-mls` | **0.5.0**, 2026-08-26, Apache-2.0 | Experimental adapter on `ts-mls@2.0.0-rc.16`; explicitly "not production-approved". | https://www.npmjs.com/package/@absolutejs/e2ee-mls |
| `@offline-protocol/mesh-sdk` | current | Rust MLS crate with React Native (UniFFI) bindings, native binaries. | https://docs.rs/crate/offline-protocol-mls |

No other *mature, audited, pure-JS* MLS library was found; ts-mls is currently the most complete and most active TypeScript implementation (its only realistic JS competitors are forks of itself or WASM wrappers of OpenMLS).

---

## 2. Runnable two-device demo (bun)

### Commands

```powershell
cd C:\Users\chark1es\Documents\Github\Aulora\spikes\mls-demo
bun install
bun run start
```

`bun install` result:

```
+ ts-mls@1.6.4
installed @noble/hashes@2.3.0
installed @noble/curves@2.0.1
```

`bun run start` full observed output (also saved as `demo-output.txt`, exit code 0):

```
==============================================================================
Aulora Spike B - ts-mls two-device MLS (RFC 9420) demo
==============================================================================
         runtime       : bun 1.4.0 / node 26.3.0
         crypto global : object  subtle=object
         ciphersuite   : MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
  [PROOF] ciphersuite impl loaded: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519

[STEP 01] Alice creates the MLS group with a Basic (self-asserted) credential identity
  [PROOF] group created by alice, epoch=0, members=[alice (leaf 0)]
  [PROOF] alice credential signature public key (ed25519, binds identity->key): db3c96f604a301e48140f7a109948060...

[STEP 02] Bob creates a KeyPackage
         wire mls_key_package: encoded 319 bytes, decoded 319 bytes  first16=000100050001000120497931c1a7bd6d
  [PROOF] bob KeyPackage generated and transmitted (1 member currently in group)

[STEP 03] Alice adds Bob (Add proposal + Commit) and produces a Welcome
  [PROOF] alice committed Add at epoch=1, members=[alice (leaf 0), bob (leaf 1)]
         wire mls_welcome: encoded 791 bytes, decoded 791 bytes  first16=000100030001407620a5eb71c1bdf85e

[STEP 04] Bob processes the Welcome and joins the group
  [PROOF] bob joined at epoch=1 (alice epoch=1), members=[alice (leaf 0), bob (leaf 1)]

[STEP 05] Alice encrypts an application message; Bob decrypts it
         wire mls_private_message: encoded 341 bytes, decoded 341 bytes  first16=000100021761756c6f72612d70686173
  [PROOF] bob decrypted plaintext: "hello bob, this is an MLS application message from alice"

[STEP 06] Bob encrypts a reply; Alice decrypts it
         wire mls_private_message: encoded 341 bytes, decoded 341 bytes  first16=000100021761756c6f72612d70686173
  [PROOF] alice decrypted plaintext: "hi alice, bob got it and replies over MLS"

[STEP 07] Alice removes Bob (Remove proposal + public Commit)
         bob is at leaf index 1
  [PROOF] alice committed Remove at epoch=2, members=[alice (leaf 0)]

[STEP 08] Bob processes the removal commit
         wire mls_public_message: encoded 387 bytes, decoded 387 bytes  first16=000100011761756c6f72612d70686173
  [PROOF] bob processed the removal commit; groupActiveState=removedFromGroup

[STEP 09] Alice sends a new application message; Bob's decrypt MUST fail
         wire mls_private_message: encoded 341 bytes, decoded 341 bytes  first16=000100021761756c6f72612d70686173
  [PROOF] bob's post-removal decrypt FAILED as expected: CryptoError: OperationError: The operation failed for an operation-specific reason
         bobRemovedFromGroup=true

==============================================================================
RESULT: all steps completed. Add/Welcome/messaging/Remove all verified.
==============================================================================
```

### What worked

- Basic (self-asserted) credentials with Ed25519 leaf signatures; identity is bound to the signature key.
- KeyPackage generation + wire round-trip.
- Add commit producing a Welcome with `ratchetTreeExtension: true` (Bob needs no out-of-band tree).
- Epoch agreement after join (Alice and Bob both epoch 1) and after Remove (epoch 2).
- Bidirectional application messaging, serialized over the wire each way.
- Remove commit and the expected decrypt failure for the removed member. ts-mls marks Bob `removedFromGroup`, and the AEAD open fails with a WebCrypto `OperationError` (the ciphertext is for an epoch Bob has no keys for).

### What failed / friction

- Bare `bun install` -> `Cannot find module '@noble/hashes/sha2.js'` (see 1.6). Needed `@noble/hashes` + `@noble/curves` pins.
- README examples do not compile against 1.6.4; discovered the real signatures by reading `node_modules/ts-mls/dist/src/*.d.ts` (see 1.7).
- `decodeMlsMessage(bytes)` returns `undefined`; the offset + tuple return contract is undocumented on the npm README.

---

## 3. Browser and React Native viability

### 3.1 What crypto ts-mls uses

WebCrypto `crypto.subtle` (AES-GCM, SHA-256, HMAC, Ed25519) + `crypto.getRandomValues`, plus `@hpke/core` X25519 which also calls `subtle`. Pure-JS `@noble/*` is used only for the optional `nobleCryptoProvider` hash/AEAD/signature pieces. No WASM. No Node `require("crypto")` in the ESM path (that is only in `@hpke`'s CommonJS build).

### 3.2 Browser Web Worker - WORKS (measured)

Bundled and run in a real Chromium browser via an in-app preview:

```powershell
bun run browser:build   # Bundled 160 modules in 41ms -> public/worker.js (1.35 MB unminified)
bun run browser:serve   # http://localhost:8787
```

Observed in the browser (module Web Worker):

```json
{
  "type": "result",
  "report": {
    "hasCrypto": "object",
    "hasSubtle": "object",
    "hasGetRandomValues": "function",
    "isWorker": true,
    "decrypted": "hello from inside a browser Worker",
    "epoch": "1",
    "ok": true
  }
}
```

So **no polyfill is needed in a modern browser** (secure context / localhost). Requirements/risks: the engine must implement the W3C **Secure Curves** algorithms (`X25519`, `Ed25519`) in `subtle`, otherwise `@hpke/core` X25519 keygen throws rather than falling back. Modern Chromium/Safari/Firefox and Node 20+ satisfy this; older engines do not. Bundle is 1.35 MB unminified (minify/tree-shake for production). The app's Worker/CSP must allow module Workers and `wasm-unsafe-eval` is **not** needed (no WASM).

### 3.3 React Native / Expo - does NOT run without heavy shims (measured)

`src/rn-probe.ts` removes `crypto.subtle` (keeping `getRandomValues`) before import to simulate Hermes/Expo. Results (`rn-probe-output.txt`):

```
mode=default-full  subtle=object    RESULT: WORKED
mode=noble-full    subtle=object    RESULT: WORKED
mode=default       subtle=undefined NotSupportedError: undefined is not an object (evaluating 'this._api.generateKey')
mode=noble         subtle=undefined NotSupportedError: undefined is not an object (evaluating 'this._api.generateKey')
```

Both providers fail at the very first operation (X25519 key generation for a KeyPackage). `nobleCryptoProvider` does **not** help, because `@hpke/core`'s X25519 implementation still calls `crypto.subtle.generateKey`.

**Required for Expo/RN:** a full WebCrypto-`subtle` polyfill providing at minimum `X25519.generateKey/deriveBits`, `Ed25519.generateKey/importKey/sign/verify`, `AES-GCM` import/encrypt/decrypt, `HMAC`, `digest`, and `getRandomValues`. `react-native-get-random-values` only fixes randomness; `expo-crypto` does not expose `subtle`; `react-native-quick-crypto` exposes a partial WebCrypto whose X25519/Ed25519 Secure-Curves coverage is not guaranteed. This is **heavy shims** territory, and the exact primitives ts-mls needs are the least commonly polyfilled ones.

### 3.4 Recommendation

- **Use `ts-mls@1.6.4` for the browser (Web Worker) and Node/server paths.** It is real, active, MIT, RFC 9420 vector-tested, and interoperates with OpenMLS. The spike's full scenario passes under bun and in a browser Worker.
- **Do not adopt `ts-mls` as the single crypto core if Expo/React Native is a first-class target.** Instead, put MLS behind a thin `MlsEngine` interface (KeyPackage, createGroup, add/remove, encrypt/decrypt, welcome) and:
  - browser/server -> `ts-mls`,
  - React Native -> **OpenMLS** (Rust) via WASM (RN-Web) or native bindings (e.g. `ping-openmls-sdk` native binaries, or build `openmls` + UniFFI/WASM yourself). OpenMLS is the reference Rust implementation and has explicit WASM/RN paths; do not depend on `openmls-wasm@0.1.0` (single experimental release) without vendoring.
- If RN must use one JS-only engine, budget a spike to evaluate `react-native-quick-crypto` Secure-Curves support before committing; if X25519/Ed25519 are not exposed, ts-mls is a non-starter on device.

---

## 4. Evidence index

| Evidence | Location |
| --- | --- |
| Full demo source | `src/demo.ts` |
| Captured demo run (exit 0) | `demo-output.txt` |
| RN/no-WebCrypto probe source + output | `src/rn-probe.ts`, `rn-probe-output.txt` |
| Browser Worker source + bundle | `src/browser-worker.ts`, `public/` |
| Pinned versions | `package.json`, `bun.lock` |
| Commands | `README.md` |

## 5. Top risks

1. **React Native/Expo incompatibility** (measured): both ts-mls providers require `crypto.subtle` X25519/Ed25519; a full Secure-Curves polyfill is required, which Expo does not ship. Mitigation: OpenMLS WASM/native behind the same interface.
2. **No security audit / low bus factor**: explicitly unaudited, single volunteer maintainer, 1.x -> 2.0 rc churn, no CHANGELOG. Mitigation: wrap it, pin exact versions, and require a review before production.
3. **Packaging + docs defects**: the eager `@noble/hashes` import breaks a clean install (`Cannot find module '@noble/hashes/sha2.js'`), and the README API no longer matches 1.6.4. Mitigation: pin `@noble/hashes`/`@noble/curves`, and follow the installed `.d.ts` rather than the README.
