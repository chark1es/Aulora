# Android and iOS testing

Use the signed files from the same published release. The [Prepare mobile testing workflow](https://github.com/chark1es/Aulora/actions/workflows/mobile-testing.yml) downloads the APK, AAB, and IPA, verifies their published SHA-256 hashes, and keeps a testing artifact for 30 days. It can also upload the IPA to App Store Connect with the existing release API key. Run it on `main` with the published tag to test, for example `tag=v1.3.1`.

## Android

Testers supply their own server address. There is no official test server. Store reviewers on iOS and Android can open a separate [offline demo](review-demo.md) by entering a reserved server address before a server profile is saved.

### Google Play testing track

Testers install Aulora from Google Play through a testing track, so they receive updates automatically. There is no public production listing yet.

1. In [Play Console](https://play.google.com/console/), open Aulora and go to **Testing**. Use **Internal testing** for up to 100 testers who see new builds within minutes, or **Closed testing** (the `alpha` track) for a larger invited group. The package name is `dev.spwnd.aulora`; Play App Signing must be on.
2. Under the track's **Testers** tab, add the Google group `aulora-testing@googlegroups.com` as the tester list. Create the track's release if it has none.
3. Testers join the [Aulora testing Google group](https://groups.google.com/g/aulora-testing) with the Google account they use on the Play Store, then open the track's opt-in link. Play Console shows it under **Testers > Copy link**. After they accept, Aulora appears on its Play Store page and updates like any other app.
4. Upload a signed AAB to the track. The release workflow does this when its manual `play-track` input is set (`internal`, `alpha`, `beta`, or `production`), or on every push to `main` when the repository Actions variable `PLAY_TRACK` is set. This repository sets `PLAY_TRACK=alpha`, so each published release uploads its AAB to the closed testing track automatically. See [GitHub Actions](github-actions.md) and the [service account setup](release-credentials.md#optional-google-play-upload-automation). You can also upload `Aulora_<version>_android.aab` from the release by hand under **Create new release**. An AAB cannot be installed directly.

Play processes each upload before testers see it, and a new upload needs a higher version code than the last. The release workflow run number is the version code. Start a new workflow run if Play rejects a duplicate.

### Direct APK (fallback)

Use the APK for a device that is not in the tester group or for a quick check on a cable-attached phone. Download `Aulora_<version>_android.apk` from the [latest release](https://github.com/chark1es/Aulora/releases/latest). Permit installation from your browser or file manager when Android prompts, then open Aulora. For an attached device with Android platform tools, run:

```sh
adb install -r Aulora_<version>_android.apk
```

A directly installed APK and a Play install can only update each other if they are signed with the same key. Play App Signing re-signs Play installs, so uninstall one before installing the other. Preserve the release keystore so future APKs can update existing installations.

## TestFlight

The publisher created the [Aulora app record](https://appstoreconnect.apple.com/apps/6817986490/testflight/ios) on 2026-09-30. Its bundle ID is `dev.spwnd.aulora` and primary language is English U.S. The registered identifier and distribution profile use that bundle ID.

### Join the iOS beta

Testers open the public invitation on their iPhone or iPad: **<https://testflight.apple.com/join/YUp4ugyv>**.

1. Install [TestFlight](https://apps.apple.com/app/testflight/id899247664) from the App Store if it is not already installed.
2. Open the invitation link on the device, tap **Accept**, then tap **Install** (or **Update**) next to Aulora.
3. Open Aulora and enter your workspace URL. A server address from a team member is required; there is no official test server.

The public link works only while the external testing group is active and has a build that passed Beta App Review. A TestFlight build expires 90 days after it is uploaded, so upload a new build before then. Testers keep the build until it expires and receive each new build automatically. A public link is limited to 10,000 testers per group; you can also share it with a limit or disable it under the group's **Public Link** settings in App Store Connect.

### Upload a build

Run Prepare mobile testing with `upload-ios=true`. After Apple processes the upload, open the app's TestFlight tab. Resolve any export-compliance questions using the app's actual encryption behavior. The server encrypts messages; the mobile client uses HTTPS and native secure storage. The workflow does not make an export-law declaration on the publisher's behalf.

Create an internal testing group and assign the processed build to it. Internal testers must be eligible App Store Connect users. For external testing and the public link, supply beta app information, contact details, a reachable test server and review account, then submit the build for Beta App Review. Add the build to the external group that owns the public link once it is approved.

An upload success means Apple accepted the delivery. It does not mean processing, Beta App Review, or tester access has completed. A GitHub IPA cannot be installed on an arbitrary iPhone. Re-uploading the same version and build number is rejected; produce a new signed build with a higher build number for changes.

## Test pass

Use a server reachable over HTTPS from the phone's network. Record the release version, build number, phone model, OS version, server version, and results. Test on physical Android and iOS devices before claiming mobile readiness.

- Fresh install, server discovery, sign-in, sign-out, and reinstallation.
- Invitation and registration policy, a second account, and denied role actions.
- Channels, DMs, threads, reactions, message editing, search, and uploaded-file downloads.
- Camera, photos, microphone, and notification permissions, including denial.
- Local Network access when the server address is a LAN host: iOS asks on the first connect, and denying it blocks only that address (the app reports the server as unreachable). Plain `http://` is allowed for local servers on both platforms; public hosts must be HTTPS.
- Voice/video between separate devices, reconnect, and a restrictive network using TURN.
- Foreground, background, and locked-device notifications; taps must open the correct server, conversation and message. With two workspaces saved, a wake from the inactive one must badge it in the switcher and auto-switch; kill and relaunch the app and confirm the badge survives until that workspace is opened.
- Two workspaces sharing the same `AULORA_SERVER_ID` (or both left on the `aulora` fallback) cannot be told apart; give each deployment a distinct id when testing multi-workspace routing.
- Logout and workspace switching must stop delivery to the previous session.
- Deep links and returning from authentication.

Push requires the server's relay plus production APNs and Firebase configuration. Simulator launches do not verify push delivery. Store publication additionally needs hosted privacy/support pages, accurate data disclosures, screenshots, and the required account-deletion process. These are separate from preparing testing files.

Sources: [Apple build uploads](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [Apple beta export compliance](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/), [Android app signing](https://developer.android.com/studio/publish/app-signing), [Google Play testing tracks](https://support.google.com/googleplay/android-developer/answer/9845334), and [TestFlight public links](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).
