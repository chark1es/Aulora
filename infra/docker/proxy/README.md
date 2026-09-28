# Reverse proxy and TLS

The compose stack in `../docker-compose.yml` has **no TLS terminator on
purpose** — it is proxy-agnostic so it can sit behind Coolify, Traefik, Caddy,
nginx, or a cloud load balancer. This directory holds ready-made examples and
the routing contract every edge must honor.

## The contract

Three things must be true at the public edge:

1. **The web origin serves the SPA, with history fallback.**
   Any unknown path returns `index.html` (HTTP 200), not a 404. The app uses a
   client-side router, so deep links like `/connect` must work.

2. **`<web origin>/.well-known/aulora.json` is served as
   `Content-Type: application/json`.**
   This is the public, secret-free document clients read to discover the
   workspace name, API version, Convex URL and enabled auth providers. In this
   stack it is written by the `setup` container into the `web-well-known`
   volume and served by the `web` container at `/.well-known/`.

3. **`<web origin>/api/auth/*` is forwarded to the Convex HTTP-actions origin
   (`convex-backend:3211`), on the *same* origin as the web app.**
   This is what makes the Better Auth session cookie first-party, so the SPA's
   `fetch` with `credentials: "include"` works. Do not strip the `Origin`
   header, do not rewrite `Set-Cookie`, and keep HTTPS end to end.

   > It is fine to **move** this route to the edge proxy instead of letting the
   > `web` container proxy it (see `Caddyfile.example` and
   > `traefik.labels.yml`). Either way the upstream is `3211`, never `3210`.

### Origin reference

| Public host              | Upstream                 | Port  | Notes |
| ------------------------ | ------------------------ | ----- | ----- |
| `chat.example.com`       | `web`                    | `80`  | SPA + `/.well-known` |
| `chat.example.com/api/auth/*` | `convex-backend`   | `3211`| First-party auth |
| `convex.example.com`     | `convex-backend`         | `3210`| Convex API + WebSocket |
| `dashboard.example.com`  | `convex-dashboard`       | `6791`| Keep private or behind auth |

Set `SITE_URL=https://chat.example.com`,
`CONVEX_CLOUD_ORIGIN=https://convex.example.com` and
`CONVEX_SITE_ORIGIN=https://chat.example.com` in `.env`, then re-run `setup`
so the deployment and the well-known document pick up the public origins.

> Why is `CONVEX_SITE_ORIGIN` the *web* host and not the Convex host? The
> Convex auth config issues tokens from `CONVEX_SITE_URL` and points the JWKS
> URI at `<origin>/api/auth/convex/jwks`. Because `/api/auth/*` is proxied from
> the web origin to the Convex HTTP actions, that document is reachable at the
> web origin, and the backend validates its own tokens because it makes the
> JWKS request to `CONVEX_SITE_ORIGIN`. The backend must therefore be able to
> resolve the public web host (public DNS, or a `extra_hosts`/DNS entry).

## Coolify

Coolify already terminates TLS and sets `X-Forwarded-*`. The ready-made
`../docker-compose.coolify.yml` is the file to point Coolify at: it publishes no
host ports, keeps generated secrets in a named volume, and marks the one-shot
services so they do not fail Coolify's health check. The full operator guide is
in [Deploy on Coolify](../../../apps/docs/content/coolify.md).

1. Create a **Docker Compose** resource pointing at this repository, with Base
   Directory `infra/docker` and Compose Location
   `docker-compose.coolify.yml`. Turn on **Preserve Repository During
   Deployment**, which the repo-relative bind mounts require.
2. Set the environment variables from `.env.example` in Coolify's UI; do not
   commit a real `.env`.
3. Add two domains: the web host -> service `web`, container port `80`, and the
   Convex API/WS host -> service `convex-backend`, container port `3210`.
   Postgres, MinIO, the dashboard and the push relay stay internal.
4. Keep `/api/auth/*` on the web origin: the `web` nginx container proxies it to
   `convex-backend:3211`, so the Better Auth cookie stays first-party. Do not
   route `/api/auth` on the Convex domain.
5. Coolify runs the one-shot `setup` service on each deploy; re-run it with
   `docker compose -f docker-compose.coolify.yml run --rm setup` after changing
   origins or auth settings, then point clients at the web domain.

Coolify sets `X-Forwarded-Proto`; the shipped nginx config already passes it to
the auth upstream.

## TLS and HSTS

- Terminate TLS with **TLS 1.2+ (prefer 1.3)** and a valid certificate
  (Let's Encrypt or your own).
- Send `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  only once you are certain every subdomain is HTTPS. HSTS is a one-way door.
- Redirect all plain HTTP to HTTPS.
- WebSocket traffic (Convex subscriptions) must go over `wss://` — the same
  certificate on `convex.example.com` covers it.

## Security headers

Apply on the HTML/SPA responses:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Content-Security-Policy needs care because the SPA talks to Convex over HTTPS
and WebSocket:

```
Content-Security-Policy:
  default-src 'self';
  base-uri 'self';
  frame-ancestors 'none';
  object-src 'none';
  img-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline';
  script-src 'self';
  connect-src 'self' https://convex.example.com wss://convex.example.com
```

`style-src` needs `'unsafe-inline'` for the Tailwind runtime-injected theme
variables; `script-src` is `'self'` only. The theme bootstrap in `index.html`
is an inline script — either hash it, serve it as a file, or add a nonce before
locking `script-src` down to `'self'` (see `Caddyfile.example` for the note).
Tighten `connect-src` to exactly your Convex origins.

The `web` container already sets `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and `Permissions-Policy` as a safe baseline; the edge should
add HSTS and CSP.

## Rate limits

The backend has no built-in rate limiting, so put it at the edge:

- Auth (`/api/auth/*`): a strict per-IP limit, e.g. **20 requests / minute**
  with a small burst. This is the credential-stuffing surface.
- Well-known (`/.well-known`): generous, it is cacheable and static.
- Message/upload traffic does not flow through the web origin; it goes to the
  Convex origin. If you expose that publicly, apply a per-IP connection limit.

Traefik example middleware (attach to the auth router):

```yaml
traefik.http.middlewares.aulora-auth-ratelimit.ratelimit.average: "20"
traefik.http.middlewares.aulora-auth-ratelimit.ratelimit.burst: "10"
```

Caddy example (attach with `rate_limit` from the `caddyserver/rate-limit`
plugin):

```
rate_limit {
  zone auth {
    key {remote_host}
    events 20
    window 1m
  }
}
```

## Dashboard access

`convex-dashboard:6791` lets anyone who has the admin key read and mutate the
deployment. Keep it off the public internet (bind it to localhost, a VPN, or an
internal network) or put it behind strong auth. The compose file publishes it
on `DASHBOARD_PORT`; remove that `ports:` entry for a hardened deployment.

## Files here

- `Caddyfile.example` — a complete single-host Caddy v2 config.
- `traefik.labels.yml` — Traefik v3 labels to merge into the compose services.
