# Aulora mobile

Expo/React Native client for iOS and Android. It connects to an Aulora server, uses native WebRTC for calls, and can register for direct APNs/FCM notifications through a configured relay.

## Local development

Install workspace dependencies at the repository root with `bun install --frozen-lockfile`. Use Bun 1.4.0 and Node.js 22.18.0. For Android install JDK 17 and the Android SDK; for iOS use macOS with Xcode and CocoaPods.

Start a backend using the [development guide](../../docs/development.md), then run:

```sh
bun run --cwd apps/mobile start
bun run --cwd apps/mobile ios
# Or:
bun run --cwd apps/mobile android
```

These commands compile the native client. Expo Go cannot provide this app's native WebRTC dependency. The checked-in `ios/` and `android/` projects are part of the app; review native changes before regenerating them with Expo prebuild.

Connect to a server URL reachable from the device. On a physical phone, `localhost` points to the phone. The optional `.env.example` can prefill a development server address; values prefixed `EXPO_PUBLIC_` are public and must never contain secrets.

## Checks

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile test
bun run --cwd apps/mobile export:ios
bun run --cwd apps/mobile export:android
```

Exports are JavaScript/assets, not signed installers. CI also compiles Android debug and an unsigned iOS simulator app.

## Release builds

The [release workflow](../../docs/github-actions.md) produces a signed Android APK/AAB and an App Store IPA. It supplies release version/build numbers and private signing inputs. Android release signing never falls back to the public debug keystore.

Use a published APK for direct Android installation or submit the AAB to Google Play. Submit the IPA through App Store Connect/TestFlight; it cannot be installed on arbitrary iPhones.

The Firebase Android client configuration is copied to `android/app/google-services.json` during release. Private FCM service-account and APNs keys belong on the relay, not in the app or Git. See [release credentials](../../docs/release-credentials.md) and [push relay](../../infra/push-relay/README.md).

Before distributing, verify fresh install, sign-in, invitations, media permissions, calls, deep links, and notifications on physical devices. A successful simulator compile does not verify push delivery. Public distribution also needs store metadata, a hosted privacy policy, and accurate data disclosures; see the [release checklist](../../docs/releasing.md).
