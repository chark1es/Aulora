# Spike B - MLS (RFC 9420) library proof: `ts-mls`

Two-device MLS demo (Alice + Bob) using **`ts-mls@1.6.4`**, run with **bun 1.4.0**.
Everything here is executed locally; see `REPORT.md` for the full vetting and results.

## Requirements

- bun 1.4.0 (tested); Node.js 20+ also works
- Windows / macOS / Linux

## Install

```powershell
bun install
```

> `ts-mls@1.6.4` re-exports `nobleCryptoProvider` from its package entry point, which
> eagerly imports `@noble/hashes`. That package is **not declared** by ts-mls, so a
> bare `bun install` fails at import with `Cannot find module '@noble/hashes/sha2.js'`.
> This spike therefore pins `@noble/hashes@2.3.0` and `@noble/curves@2.0.1` explicitly
> (both are optional peers of ts-mls).

## Run the demo

```powershell
bun run start
# or
bun run src/demo.ts
```

The script prints, step by step:

1. Alice creates a group with a Basic (self-asserted) credential identity (epoch 0).
2. Bob generates a KeyPackage and it is serialized/deserialized.
3. Alice sends an Add proposal + Commit, producing a Welcome (epoch 1, alice+bob).
4. Bob processes the Welcome and joins (epoch 1, matches Alice).
5. Alice encrypts an application message; Bob decrypts and prints the plaintext.
6. Bob encrypts a reply; Alice decrypts and prints it.
7. Alice sends a Remove commit (public); group drops to epoch 2, only Alice.
8. Bob processes his own removal (`groupActiveState=removedFromGroup`).
9. Alice sends a new application message; **Bob's decrypt fails** and the error is printed.

A captured run is in `demo-output.txt`.

## React Native / no-WebCrypto probe

```powershell
bun run src/rn-probe.ts default-full   # default provider, real WebCrypto   -> WORKS
bun run src/rn-probe.ts noble-full     # noble provider,   real WebCrypto   -> WORKS
bun run src/rn-probe.ts default        # default provider, no crypto.subtle -> FAILS
bun run src/rn-probe.ts noble          # noble provider,   no crypto.subtle -> FAILS
```

`rn-probe.ts` deletes `globalThis.crypto.subtle` (keeping only `getRandomValues`)
before importing ts-mls, simulating Hermes/Expo. Captured output: `rn-probe-output.txt`.

## Browser Web Worker probe

```powershell
bun run browser:build   # bundles src/browser-worker.ts -> public/worker.js
bun run browser:serve   # serves ./public on http://localhost:8787
```

Open `http://localhost:8787/`. The page spawns a module Web Worker which runs the
Alice/Bob group + message flow inside the Worker and posts the result.
Result observed in the in-app Chromium browser: `ok: true`,
`decrypted: "hello from inside a browser Worker"`.

## Files

| File | Purpose |
| --- | --- |
| `src/demo.ts` | Full Alice/Bob scenario (the deliverable) |
| `src/rn-probe.ts` | No-WebCrypto / provider-backend probe |
| `src/browser-worker.ts` | Minimal flow executed inside a browser Web Worker |
| `src/serve.ts` | Tiny static server for the browser probe |
| `public/index.html`, `public/worker.js` | Browser probe harness + bundled worker |
| `demo-output.txt`, `rn-probe-output.txt` | Captured evidence |
| `REPORT.md` | Vetting, versions/dates/URLs, results, recommendation |
