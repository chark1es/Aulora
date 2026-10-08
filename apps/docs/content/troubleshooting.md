# Troubleshooting

Run server commands from `infra/docker` unless a section says otherwise. Start with:

```sh
docker compose ps
docker compose logs --tail=100 setup convex-backend web
```

Redact logs before sharing them. Never post `.env`, admin keys, passwords, or chat exports.

## Docker is missing or not running

Check `docker info` and `docker compose version`. The installer needs Compose v2.24 or newer. On Windows, use Docker Desktop with Linux containers and PowerShell 7. If a command is not on PATH, restart the shell after installing it.

## Setup fails or sign-in has no methods

Read the setup logs and confirm the backend is healthy. Check owner credentials and public origins in `.env`. The owner password must have at least 16 characters for the installer.

After a configuration-only change:

```sh
docker compose run --rm setup
```

After a source-code change, rebuild the images that contain the code:

```sh
./deploy.sh
```

Re-running setup does not reset the existing owner's password or create another workspace.

## Discovery fails

Open `https://your-host/.well-known/aulora.json`. It should return JSON, not an HTML login page or proxy error. The web container forwards this path to Convex HTTP actions on port 3211. Rebuild `web` and `setup` and verify the backend functions were deployed. If your edge serves a static document instead, check setup's well-known volume. The advertised `convexUrl` must work from the client's network, not just inside Docker.

If setup reports `Permission denied` for `/web-well-known` or `/host/.env`, rebuild the setup image and use the updated Compose configuration. A short root bootstrap prepares output ownership, then drops to the `aulora` user without capabilities before deploying functions or initializing the workspace. Confirm its logs reach `[setup] done`.

A phone's `localhost` refers to the phone. Docker service names are also unavailable outside the Compose network. Use reachable public URLs.

## Workspace stays on the loading screen

Check the discovery document's `convexUrl` and the client's network requests.
The loading screen waits for workspace subscriptions over the Convex WebSocket.
If that origin returns an HTTP error or cannot connect, workspace data will not load.

The shipped web gateway serves the API and WebSocket at the main workspace URL.
Its discovery document advertises `SITE_URL` for those connections. Rebuild
`web` and `setup` to deploy the gateway discovery behavior, then reconnect to
replace a client's previously saved API URL. If you serve discovery directly
from the backend, check that `CONVEX_CLOUD_ORIGIN` matches the domain assigned
to `convex-backend` in Coolify, with container port 3210.

## Sign-in loops or OAuth callback errors

Check that `SITE_URL` matches the browser origin, including scheme and port. Add extra web origins to `TRUSTED_ORIGINS` when appropriate and re-run setup. Keep `/api/auth/*` on the web origin and forward it to Convex's HTTP-actions port 3211.

Register the callback URL used by your configured provider exactly. The backend must be able to reach its configured HTTP-actions/JWKS origin. Check DNS, TLS, forwarded protocol headers, and WebSocket proxy support.

## Uploads fail

Check the per-file and total quotas in Instance admin and the reverse proxy's upload-body limit. Verify MinIO/object-storage health and bucket credentials. The bundled nginx limit is 25 MB; align it with application quotas if changing the maximum.

If encrypted files or messages stop decrypting, restore the correct master key and key version from your secure backup. Do not generate a replacement key and expect old data to recover.

## Voice connects without media

Allow microphone/camera access in the app and OS. Use HTTPS for remote clients. Test another network. Restrictive NAT or firewalls can require a TURN server; configure `AULORA_ICE_SERVERS` in `.env` and re-run setup.

## Notifications do not arrive

Check permissions, focus mode, channel mutes, and whether the desktop process is still running. Mobile background delivery requires a correctly configured relay and APNs/FCM credentials for the installed app. Device push is not validated by a simulator build. See the [user guide](user-guide.md).

## Updates are unavailable

Public GitHub release feeds require published assets and an accessible repository. Workspace download/restart controls require the host watcher. A dirty checkout prevents server updates. Follow [updates](updates.md) and inspect watcher logs.

## Before opening an issue

Include the version or commit, platform, deployment method, reproduction steps, expected behavior, actual behavior, and redacted logs. Distinguish browser, desktop, mobile, and server failures. Report security issues privately to [cnguyen@spwnd.dev](mailto:cnguyen@spwnd.dev).
