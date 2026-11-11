# Development setup

This guide starts a real self-hosted backend and connects a development client to it. Unit tests do not need a running server.

## Tools

Use Bun 1.4.4 and Node.js 22.23.4, matching CI. Install Git and Docker with Compose v2.24 or newer. Native builds also need Rust/Tauri prerequisites for desktop, Xcode/CocoaPods on macOS for iOS, or JDK 17 and the Android SDK for Android.

```sh
git clone https://github.com/chark1es/Aulora.git
cd Aulora
bun install --frozen-lockfile
bun run check
```

All commands below start at the repository root unless stated otherwise. Use PowerShell's `Copy-Item` instead of `cp` if needed.

## Start the backend

Run `./install.sh`, or `pwsh ./install.ps1` on Windows, to start and provision the local stack. See [getting started](../apps/docs/content/getting-started.md). Development checkouts are on `main`, not the stable `release` branch, so the installer prints a branch warning; pass `--allow-any-branch` (or `-AllowAnyBranch`, or `AULORA_ALLOW_ANY_BRANCH=1`) to silence it. Use disposable owner credentials for development and keep the generated `infra/docker/.env` private.

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

### Android emulator testing on WSL

WSL2 usually has no `/dev/kvm`, so run the emulator from the Windows Android SDK and build the APK in Linux. Paths below assume the default Windows SDK at `C:\Users\<you>\AppData\Local\Android\Sdk`, an API 36 AVD such as `Pixel_9_Pro_XL`, and `WIN=/mnt/c/Users/<you>`.

```sh
# One-time Linux toolchain (no root): Temurin JDK 17 and the SDK packages CI uses.
mkdir -p ~/tools ~/Android/Sdk/cmdline-tools && cd ~/tools
curl -fsSLo jdk17.tar.gz https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse && tar xzf jdk17.tar.gz
curl -fsSLo cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q cmdline.zip -d ~/Android/Sdk/cmdline-tools && mv ~/Android/Sdk/cmdline-tools/cmdline-tools ~/Android/Sdk/cmdline-tools/latest
export JAVA_HOME=$(echo ~/tools/jdk-17*) ANDROID_HOME=~/Android/Sdk PATH=$(echo ~/tools/jdk-17*)/bin:$PATH
yes | sdkmanager --licenses >/dev/null
sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0" "ndk;27.1.12297006" "cmake;3.22.1"

# Start the Windows emulator (hardware accelerated through WHPX).
powershell.exe -NoProfile -Command "Start-Process '$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe' -ArgumentList '-avd','Pixel_9_Pro_XL','-no-snapshot-load'"
ADB="$WIN/AppData/Local/Android/Sdk/platform-tools/adb.exe"

# Debug APK for the emulator ABI only (about 6 minutes cold), installed from a Windows path.
(cd apps/mobile/android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64)
mkdir -p "$WIN/aulora-android" && cp apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk "$WIN/aulora-android/"
"$ADB" install -r 'C:\Users\<you>\aulora-android\app-debug.apk'
```

Metro runs in WSL, but WSL forwards only IPv6 `localhost` to Windows, and the app defaults to `10.0.2.2`. Expose Metro on IPv4, reverse the device port to it, and point the debug build at `localhost`:

```sh
bun run --cwd apps/mobile start   # Metro on :8081
node -e 'const n=require("net");n.createServer(c=>{const u=n.connect(8081,"::1");c.pipe(u).pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy())}).listen(8082,"0.0.0.0")' &
"$ADB" reverse tcp:8081 tcp:8082
"$ADB" shell "run-as dev.spwnd.aulora sh -c 'mkdir -p shared_prefs && echo \"<map><string name=\\\"debug_http_host\\\">localhost:8081</string></map>\" > shared_prefs/dev.spwnd.aulora_preferences.xml'"
"$ADB" shell am start -n dev.spwnd.aulora/.MainActivity
```

Enter `demo.aulora.example` on Connect to open the [offline review demo](review-demo.md) for chat, threads, sheets and settings without a server. Capture with `"$ADB" exec-out screencap -p > shot.png`, find tap targets with `uiautomator dump` (set the three `settings put global *_animation_scale 0` values first, or it cannot reach an idle state), and cover the layout matrix:

| Condition | Command |
| --- | --- |
| Small phone (360×640dp) | `wm size 720x1280` and `wm density 320` |
| Typical phone (411dp) | `wm size 1080x2400` and `wm density 420` |
| Landscape tablet, where Android 16 ignores the portrait lock | `wm size 2560x1600` and `wm density 320` |
| Largest text | `settings put system font_scale 2.0` |
| Dark mode | `cmd uimode night yes` |
| 3-button or gesture navigation | `cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton` (or `.gestural`) |

Check each screen with the keyboard open, including with animations on and off. Restore defaults with `wm size reset`, `wm density reset` and `font_scale 1.0`. Stop the emulator with `"$ADB" emu kill` and Gradle with `./gradlew --stop`. Build output stays in the ignored `android/build` and `android/app/build` folders.

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

For bounded local client diagnostics and a repeatable capture procedure, see
[Client debug logs](client-debug-logs.md).
