> **Historical note:** Aulora has since moved from client-side E2EE (MLS, RFC 9420) to server-side encryption backed by an external key manager (EKM).

# Phase 0 — Spikes: Findings

Date: 2026-09-26. Each spike was run in its own directory under `spikes/`, with a
runnable artifact and a `REPORT.md` of raw evidence. Nothing is faked: every claim
below is backed by a command that was actually run (see each `REPORT.md` and its
captured output files).

**Gate: all three spikes pass, one with a required architecture change (MLS core on
React Native). Awaiting approval before Phase 1.**

## Summary

| Spike | Verdict | What it means for the build |
| --- | --- | --- |
| A. Convex self-hosted + Postgres + Better Auth generic OIDC | **PROCEED** | Stack is real and healthy end-to-end. Pin versions; do not use `better-auth@1.7.x`. |
| B. `ts-mls` two-device MLS (RFC 9420) | **PROCEED for web/desktop; REPLACE ON MOBILE** | `ts-mls` works in Bun and in a real browser Worker, but needs `crypto.subtle` X25519/Ed25519 that Expo does not ship. Put MLS behind an `MlsEngine` interface and use OpenMLS (WASM/native) on device. |
| C. Blobatar in React Native | **PROCEED** | `blobatar` + `react-native-svg` `<SvgXml>` works exactly as the spec assumed. Pin versions. |

## Spike A — Backend and auth (`spikes/convex-selfhost/`)

Checked live (not from memory): Convex self-hosted README and `advanced/postgres_or_mysql.md`,
`@convex-dev/better-auth` npm + Convex Better Auth docs, better-auth issue #5314 and its
timeline, Keycloak 26.3.

- `docker compose up -d` brought up **`convex-backend` (healthy, 3210 API / 3211 HTTP actions),
  `convex-dashboard` (6791), `postgres:17` (healthy), `keycloak:26.3` (healthy)**.
  Backend log: `Connected to Postgres database: aulora-spike`; 5 Convex tables verified in
  Postgres with `psql \dt`.
- A real function deployed with `CONVEX_SELF_HOSTED_URL` + admin key; `convex run ping:ping`
  returned `pong-from-selfhosted-convex` and a `messages` mutation/query round-tripped.
- Better Auth mounted in Convex (`@convex-dev/better-auth@0.12.5`); `/api/auth/ok` → `{"ok":true}`.
- **Generic OIDC proven**: `genericOAuth` against Keycloak discovery produced a real
  `/sign-in/oauth2` authorize URL from inside Convex.

Versions: Convex backend commit `0cf49cbf` (built 2026-09-21), `convex` CLI 1.46.0,
`@convex-dev/better-auth` 0.12.5, `better-auth` **1.6.15** (npm latest 1.7.6 is outside the
component's peer range), Postgres 17, Keycloak 26.3.

Decisions this forces:
1. **Pin `better-auth@1.6.15`** (must satisfy `@convex-dev/better-auth`'s `>=1.6.11 <1.7.0`).
   Add a renovate/CI constraint so nobody bumps to 1.7.x by accident.
2. **Use `genericOAuth` for OIDC.** Do not plan on `oidcProvider` or `@better-auth/sso` inside
   Convex — both remain Node-only (issue #5314 was closed with no upstream fix). Aulora-as-IdP
   or SAML would need a separate Node service.
3. Pin Convex image tags (not `:latest`), keep `INSTANCE_SECRET` stable and secret-managed.
4. Track the `genericOAuth` discovery-fetch caveat (uncached, no timeout): add caching/health
   checks before production.

## Spike B — MLS (`spikes/mls-demo/`)

- `ts-mls@1.6.4` (MIT, published 2026-08-28, repo active the day of the spike) ships the
  official RFC 9420 test vectors and an OpenMLS gRPC interop harness.
- Full two-device demo passes under Bun: create group → KeyPackage → Add + Welcome → join
  (epoch 1) → both directions decrypt → Remove (epoch 2) → removed member's decrypt fails.
- A real Chromium **Web Worker** run decrypted successfully; no browser polyfills needed.
- **Measured failure on React Native**: with `crypto.subtle` removed (simulating Hermes/Expo),
  both `defaultCryptoProvider` and `nobleCryptoProvider` fail at X25519 keygen. Neither provider
  is WebCrypto-free; Expo ships no `subtle` implementation.

Decisions this forces:
1. Define an **`MlsEngine` interface** in `packages/crypto` from day one, so the core can swap.
   Web/desktop browser: `ts-mls`. Mobile: OpenMLS compiled to WASM (RN-Web) or native bindings.
2. Pin `@noble/hashes` and `@noble/curves` alongside `ts-mls` (a bare install breaks on an
   undeclared eager import: `Cannot find module '@noble/hashes/sha2.js'`).
3. Follow the installed 1.6.4 `.d.ts`, not the README: the published README API and the
   `decodeMlsMessage(bytes, offset) → [value, len]` contract have drifted.
4. Track: no security audit, single maintainer, 1.x → 2.0-rc churn. Require a crypto review
   before 1.0 and wrap every call behind our own tested wrapper.

## Spike C — Avatars (`spikes/blobatar-rn/`)

- `blobatar@2.7.0` + `@blobatar/react@2.7.0` are real: MIT, **zero runtime deps**, SLSA
  provenance, published 2026-08-29. Official `@blobatar/react-native@2.7.0` also exists.
- API confirmed: `blobatar(id) => "<svg …>"` raw string; `@blobatar/react` exports `Blobatar`
  (static `<img>` or inline `<svg>` when animated).
- Verified rendering: web via `renderToString`; native parser maps the SVG and `<SvgXml>` mounts
  a real `RNSVG*` element tree (`react-native-svg@15.15.5`); 5/5 distinct, repeatable per id.
  Native proof is parse + tree on a documented host-layer test double, not on-device pixels.

Decisions this forces:
1. Seed with the stable user id (`aulora:user:<uuid>`), never the display name; pin exact
   `blobatar`/`@blobatar/react` versions and keep a golden-SVG fixture.
2. Mobile uses the string API + `<SvgXml>`; add `@blobatar/react-native/animated` only when
   mobile animation is actually required.
3. Youth risk: ~6 weeks old, one maintainer. Vendor or pin defensively.

## What Phase 1 will pin

`@convex-dev/better-auth@0.12.5` + `better-auth@1.6.15`; Convex self-hosted image by commit
digest; `ts-mls@1.6.4` + `@noble/hashes` + `@noble/curves`; `blobatar@2.7.0` +
`@blobatar/react@2.7.0` + `react-native-svg@15.15.5`.

## Open questions for you before Phase 1

1. **Mobile MLS**: approve the `MlsEngine` abstraction with OpenMLS-on-device, or do you want a
   dedicated spike on `react-native-quick-crypto`'s Secure-Curves coverage first?
2. **Convex/Postgres sizing**: keep the managed-Postgres default for local dev, or add a
   Postgres-in-Compose profile only (current spike) — confirm the production data story.
3. **`genericOAuth` hostname**: the IdP must be reachable from *both* the Convex backend and the
   user's browser, so real deploys need a public IdP hostname. Any constraint on that from you?
