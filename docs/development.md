# Development setup

This guide starts a real self-hosted backend and connects a development client to it. Unit tests do not need a running server.

## Tools

Use Bun 1.4.0 and Node.js 22.18.0, matching CI. Install Git and Docker with Compose v2.24 or newer. Native builds also need Rust/Tauri prerequisites for desktop, Xcode/CocoaPods on macOS for iOS, or JDK 17 and the Android SDK for Android.

```sh
git clone https://github.com/chark1es/Aulora.git
cd Aulora
bun install --frozen-lockfile
bun run check
```

All commands below start at the repository root unless stated otherwise. Use PowerShell's `Copy-Item` instead of `cp` if needed.

## Start the backend

Run `./install.sh`, or `pwsh ./install.ps1` on Windows, to start and provision the local stack. See [getting started](../apps/docs/content/getting-started.md). Use disposable owner credentials for development and keep the generated `infra/docker/.env` private.

The default stack serves the web app at `http://localhost:8080`, Convex API/WebSocket at `http://localhost:3210`, and HTTP actions at `http://localhost:3211`.

## Run the web client

```sh
cp apps/web/.env.example apps/web/.env.local
bun run --cwd apps/web dev
```

Open `http://localhost:5173`. The template generates a development discovery document for this origin and proxies authentication to port 3211. For this client to sign in, the backend must accept the development origin. Set these values in `infra/docker/.env`, preserving any existing trusted origins:

```dotenv
SITE_URL=http://localhost:5173
TRUSTED_ORIGINS=http://localhost:5173,http://localhost:8080
```

Then apply them:

```sh
cd infra/docker
docker compose run --rm setup
```

The development frontend now owns the canonical site origin. To return to the bundled Docker web client, restore `SITE_URL=http://localhost:8080` and re-run setup.

If you use OAuth, register callbacks for the backend's configured site origin. Do not copy production OAuth secrets into frontend configuration just to develop local sign-in.

## Edit and deploy backend code

From the repository root:

```sh
cp packages/convex/.env.example packages/convex/.env.local
```

Set the self-hosted URL and admin key in that private file. You can obtain an admin key using the running backend's supported generator:

```sh
cd infra/docker
docker compose exec convex-backend ./generate_key
```

This command prints a privileged credential. Put it directly into the private CLI configuration; never share its output. From the repo root:

```sh
bun run --cwd packages/convex dev
```

The CLI deploys changes to the configured backend. Use a disposable local instance. Do not point a watch process at production.

For a full redeploy using Docker's setup image instead, run `infra/docker/deploy.sh`. Setup images embed source at build time, so running an old image after editing backend files will not deploy those edits.

## Desktop

Start with [the desktop guide](../apps/desktop/README.md). After installing Rust and platform prerequisites:

```sh
bun run --cwd apps/desktop icons
bun run --cwd apps/desktop verify
bun run --cwd apps/desktop tauri:dev
```

Tauri starts the web development server. Configure its backend as described above. A production desktop build needs generated icons; signed public builds also need release credentials.

## Mobile

See [the mobile guide](../apps/mobile/README.md). This app includes native WebRTC and requires a development/native build, rather than Expo Go.

```sh
bun run --cwd apps/mobile start
bun run --cwd apps/mobile ios
# Or, with an Android emulator/device:
bun run --cwd apps/mobile android
```

Enter a server URL reachable from the simulator or phone. A physical phone's `localhost` is not your computer. Use a valid HTTPS origin for realistic authentication, calls, and notification testing.

## Checks and focused commands

```sh
bun run check
bun run --cwd packages/convex test
bun run --cwd apps/web test
bun run --cwd apps/mobile typecheck
bun run docs:dev
```

`bun run build` builds web/docs. It does not produce desktop installers, APKs, or IPAs. `bun run dev` starts workspace development scripts but does not provision Docker, secrets, or owner accounts.

The browser E2E suite requires a running disposable stack. From `apps/web`, install the browser with `bunx playwright install chromium`. Set `AULORA_E2E_BASE_URL`, `AULORA_E2E_OWNER_EMAIL`, and `AULORA_E2E_OWNER_PASSWORD` for your test instance, then run `bun run --cwd apps/web test:e2e`. Do not use a real team's server.

## Project conventions

[CONTRIBUTING.md](../CONTRIBUTING.md) covers pull requests, the CLA, and secret handling. Current guides take precedence over historical phase reports. Release version changes use the process in [releasing.md](releasing.md).
