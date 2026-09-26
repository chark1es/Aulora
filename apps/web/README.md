# @aulora/web

The Aulora web client: a Vite + React 19 SPA (also the Tauri frontend in Phase 4)
using TanStack Router, Tailwind v3.4 from the shared `@aulora/tokens` preset, and
Convex + Better Auth.

It is thin by design: the app asks for a server host on first launch, reads that
server's `/.well-known/aulora.json`, stores the profile, and signs in with only
the methods that document advertises. **No backend is baked into the bundle.**

## Scripts

```powershell
bun install            # from the repo root
bun run well-known     # write public/.well-known/aulora.json from env
bun run dev            # generate well-known, then start Vite on :5173
bun run build          # generate well-known, then vite build -> dist/
bun run typecheck
bun run lint
bun run test
```

`bun run dev` and `bun run build` call `well-known` first (Turbo does not run
npm `pre` scripts), so the document always matches the current env.

## Local development

Copy `.env.example` to `.env.local` and adjust. `.env.local` is gitignored.
`scripts/write-well-known.ts` reads it and writes
`public/.well-known/aulora.json`, which is also gitignored.

```ini
INSTANCE_NAME=Aulora
SITE_URL=http://localhost:5173
CONVEX_URL=http://127.0.0.1:3210
AULORA_AUTH_PROXY_TARGET=http://127.0.0.1:3211
AUTH_LOCAL_ENABLED=true
AUTH_LOCAL_SIGNUP=true
```

The generated document contains no secrets: built-in OAuth providers are listed
from the same `*_CLIENT_ID` / `*_CLIENT_SECRET` pairs the backend uses (only
presence is checked), and the generic OIDC entry carries issuer, discovery URL,
client id and scopes — never `*_CLIENT_SECRET`.

> **The generated file is dev-only.** The infra wave generates the real
> per-instance `/.well-known/aulora.json` and mounts it over this path in the web
> container; do not commit it.

## Auth wiring

`createAuthClient` follows the official Convex + Better Auth React (Vite SPA)
guide: <https://labs.convex.dev/better-auth/framework-guides/react>

```ts
// src/lib/auth-client.ts
createAuthClient({
  baseURL: profile.siteUrl, // the site origin the web app is served from
  plugins: [convexClient(), genericOAuthClient()],
  fetchOptions: { credentials: "include" },
});
```

- `convexClient()` (from `@convex-dev/better-auth/client/plugins`) exposes
  `authClient.convex.token()`, which `ConvexBetterAuthProvider` passes to
  `ConvexReactClient(profile.convexUrl)`.
- `genericOAuthClient()` (from `better-auth/client/plugins`) exposes
  `signIn.oauth2({ providerId })` for the server's OIDC providers;
  `signIn.social({ provider })` is used for built-in OAuth.
- Local email/password uses `signIn.email` / `signUp.email`.
- Callbacks redirect back to the app origin. Per the guide, the OAuth redirect
  URI is registered against the Convex **site** URL
  (`https://<convex-site>/api/auth/callback/<provider>`), because that is where
  Better Auth serves `/api/auth/*`.

## What the infra wave must provide

**1. Reverse proxy `/api/auth/*` to the Convex HTTP-actions port.**
The browser must see auth requests as same-origin (`https://site.<domain>/api/auth/*`)
so the Better Auth session cookie is first-party and `credentials: "include"`
works. In production Caddy must forward that path on the site origin to the
Convex HTTP-actions upstream (`convex-backend:3211`, not the API port `3210`).
Use HTTPS end to end and preserve `Set-Cookie`; do not strip the `Origin` header.
The Vite dev server does the same locally via `AULORA_AUTH_PROXY_TARGET`.

**2. Serve/generate `/.well-known/aulora.json`.**
Mount the generated per-instance document at
`https://site.<domain>/.well-known/aulora.json` with `Content-Type:
application/json`. It must contain `name`, `version`, `apiVersion`, `convexUrl`,
`siteUrl`, `iconSeed` and the public `auth` block, and never a secret. This app
writes a dev stand-in; infra replaces it for real deployments.

**3. Convex CORS / origin settings.**
- `registerRoutes(http, createAuth, { cors: true })` is already enabled in
  `@aulora/convex/convex/http.ts`.
- Better Auth `baseURL` must be the public site origin (`SITE_URL`), and
  `trustedOrigins` must include that origin plus any extra web origins
  (`SITE_URL` and `TRUSTED_ORIGINS` are read by `@aulora/convex`).
- Browser calls to `convexUrl` (WebSocket + HTTP) come from the site origin, so
  the Convex deployment must allow it; self-hosted Convex accepts the configured
  origins/CORS. Keep `convexUrl` and `siteUrl` on HTTPS in production.
