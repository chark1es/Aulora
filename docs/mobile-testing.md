# Android and iOS testing

Use the signed files from the same published release. The [Prepare mobile testing workflow](https://github.com/chark1es/Aulora/actions/workflows/mobile-testing.yml) downloads the APK, AAB, and IPA, verifies their published SHA-256 hashes, and keeps a testing artifact for 30 days. It can also upload the IPA to App Store Connect with the existing release API key. Run it on `main` with `tag=v1.0.0`.

## Android

Testers supply their own server address. There is no official test server. Apple reviewers have a separate [offline iOS demo](apple-review-demo.md), opened by entering a reserved server address before a server profile is saved.

Download `Aulora_1.0.0_android.apk` from [v1.0.0](https://github.com/chark1es/Aulora/releases/tag/v1.0.0). Permit installation from your browser or file manager when Android prompts, then open Aulora. For an attached device with Android platform tools, run:

```sh
adb install -r Aulora_1.0.0_android.apk
```

Use `Aulora_1.0.0_android.aab` for a Google Play internal testing track after creating the app in Play Console and configuring Play App Signing. An AAB cannot be installed directly. Preserve the release keystore so future APKs can update existing installations.

## TestFlight

The publisher created the [Aulora app record](https://appstoreconnect.apple.com/apps/6817986490/testflight/ios) on 2026-09-30. Its bundle ID is `dev.spwnd.aulora` and primary language is English U.S. The registered identifier and distribution profile use that bundle ID.

Run Prepare mobile testing with `upload-ios=true`. After Apple processes the upload, open the app's TestFlight tab. Resolve any export-compliance questions using the app's actual encryption behavior. The server encrypts messages; the mobile client uses HTTPS and native secure storage. The workflow does not make an export-law declaration on the publisher's behalf.

Create an internal testing group and assign the processed build to it. Internal testers must be eligible App Store Connect users. For external testing, supply beta app information, contact details, a reachable test server and review account, then submit the build for Beta App Review. A public invitation link becomes available only after the appropriate external group and review are ready.

An upload success means Apple accepted the delivery. It does not mean processing, Beta App Review, or tester access has completed. A GitHub IPA cannot be installed on an arbitrary iPhone. Re-uploading the same version and build number is rejected; produce a new signed build with a higher build number for changes.

## Test pass

Use a server reachable over HTTPS from the phone's network. Record the release version, build number, phone model, OS version, server version, and results. Test on physical Android and iOS devices before claiming mobile readiness.

- Fresh install, server discovery, sign-in, sign-out, and reinstallation.
- Invitation and registration policy, a second account, and denied role actions.
- Channels, DMs, threads, reactions, message editing, search, and uploaded-file downloads.
- Camera, photos, microphone, and notification permissions, including denial.
- Voice/video between separate devices, reconnect, and a restrictive network using TURN.
- Foreground, background, and locked-device notifications; taps must open the correct server and conversation.
- Logout and workspace switching must stop delivery to the previous session.
- Deep links and returning from authentication.

Push requires the server's relay plus production APNs and Firebase configuration. Simulator launches do not verify push delivery. Store publication additionally needs hosted privacy/support pages, accurate data disclosures, screenshots, and the required account-deletion process. These are separate from preparing testing files.

Sources: [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [Apple beta export compliance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/), and [Android app signing](https://developer.android.com/studio/publish/app-signing).
