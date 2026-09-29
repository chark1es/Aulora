# Release credentials to obtain

Checked against official documentation on 2026-09-29. Dashboard links require your own account sign-in. Confirm these current identifiers before registering apps or creating credentials:

| App | Current identifier |
| --- | --- |
| macOS / Windows desktop | `dev.spwnd.aulora` |
| iOS | `dev.spwnd.aulora` |
| Android | `dev.spwnd.aulora` |

Keep private downloads under `.secrets/release/apple/`, `.secrets/release/android/`, or `.secrets/release/windows/`. Those local directories and `.secrets/release/credentials.env` have been created for supplied files and metadata. The worksheet does not automatically configure builds. Keep passwords in a password manager, Keychain or CI secret store; do not paste account passwords or private key contents into chat or documentation.

## Apple account and macOS signing

1. [Enroll in the Apple Developer Program](https://developer.apple.com/programs/enroll/). The same membership can cover macOS and iOS. Record your Team ID from [Apple Developer account membership](https://developer.apple.com/account/). Complete account verification yourself.
2. Open [Certificates](https://developer.apple.com/account/resources/certificates/list). For the current direct-download Mac app, create **Developer ID Application**, using a certificate signing request generated on your Mac. Install the downloaded `.cer` on that same Mac, where the matching private key exists. Developer ID creation normally requires the Account Holder. [Apple Developer ID instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates), [CSR instructions](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)
3. A downloaded `.cer` alone cannot sign an app. Use the certificate and its private key in Keychain, or export both as `macos-developer-id.p12` into `.secrets/release/apple/` for another build machine/CI. Keep its export password separately. Record the full signing identity such as `Developer ID Application: … (TEAMID)`. Tauri uses `APPLE_SIGNING_IDENTITY`; CI can use `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`. [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/)

For notarization, open [App Store Connect > Users and Access > Integrations > API](https://appstoreconnect.apple.com/access/integrations/api). Create a **team API key** with the access needed by the build, using Tauri's documented Developer-role setup. Download `AuthKey_<KEY_ID>.p8` into `.secrets/release/apple/` and record the **Key ID** and **Issuer ID**. Configure `APPLE_API_KEY_PATH`, `APPLE_API_KEY`, and `APPLE_API_ISSUER`. Apple only permits one download of the private key. This API key authenticates notarization; it does not replace the Developer ID signing certificate. [Tauri notarization](https://v2.tauri.app/distribute/sign/macos/), [Apple API keys](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)

The API key avoids supplying your Apple account password to build automation. Tauri also supports an app-specific password as an alternative; do not use the main account password.

## iOS signing and notification credentials

1. Open [Identifiers](https://developer.apple.com/account/resources/identifiers/list), register an explicit App ID matching `dev.spwnd.aulora`, and enable **Push Notifications**. Add the matching app record in [App Store Connect > Apps](https://appstoreconnect.apple.com/apps). [Apple App ID registration](https://developer.apple.com/help/account/identifiers/register-an-app-id)
2. For App Store/TestFlight distribution, obtain an **Apple Distribution** signing certificate with its private key. Xcode or EAS can manage this. For manual/CI transfer, export `ios-distribution.p12` to `.secrets/release/apple/` and save its password separately. Development device builds use Apple Development signing instead. [Expo signing credentials](https://docs.expo.dev/app-signing/managed-credentials/)
3. Xcode automatic signing or EAS can generate/manage the provisioning profile. For manual signing, create the appropriate profile at [Profiles](https://developer.apple.com/account/resources/profiles/list), matching the app ID, certificate and distribution type. Store a downloaded `.mobileprovision` under `.secrets/release/apple/`. Development/ad hoc profiles also require registered devices; TestFlight/App Store distribution uses its own profile. [Apple App Store profiles](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/)
4. Open [Keys](https://developer.apple.com/account/resources/authkeys/list), add a key and enable **Apple Push Notification service**. Choose its environment and Team Scoped/Topic Specific configuration to cover `dev.spwnd.aulora` and the builds you will test. Download the APNs `.p8` once and save as `.secrets/release/apple/apns_<KEY_ID>.p8`. Record the **APNs Key ID**, **Team ID**, topic and supported environment. New scoped keys must match their permitted environment/topics. [Apple private-key instructions](https://developer.apple.com/help/account/keys/create-a-private-key/)

Configure the relay using `APNS_KEY_PATH` or `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC=dev.spwnd.aulora` and `APNS_ENVIRONMENT`. A path must exist on the relay host/container. Match sandbox/production to the installed build's signed entitlement. The APNs `.p8` and App Store Connect API `.p8` are different credentials; retain distinct filenames. Aulora sends directly to APNs, so no Firebase iOS configuration or Expo Push Service credential upload is required. [Expo direct APNs setup](https://docs.expo.dev/push-notifications/sending-notifications-custom/)

## Android signing

Open [Google Play Console](https://play.google.com/console/) for Play distribution. Generate or reuse an Android release/upload keystore through Android Studio **Build > Generate Signed Bundle/APK**, or let EAS manage it. Save an exported keystore as `.secrets/release/android/aulora-upload.jks`. Keep the **key alias**, **keystore password** and **key password** separately. Replace the current Gradle release debug-key configuration before publishing.

With Play App Signing, Google signs installed releases using the **app signing key**; your **upload key** signs submissions. For directly distributed APKs, choose a stable release signing key and preserve it for future updates. If you want direct APKs and Play installs to update one another, decide their shared signing strategy before the first release. A public `.pem` signing certificate does not contain the private signing key. [Android signing and keystore instructions](https://developer.android.com/studio/publish/app-signing)

## Android notifications through Firebase

1. Open [Firebase Console](https://console.firebase.google.com/), select/create the project, then **Project settings > General > Your apps**. Register Android package `dev.spwnd.aulora` and download `google-services.json`. Store it at `.secrets/release/android/google-services.json` initially. This is **client configuration with public identifiers**, not a private service-account key; it is bundled in the Android app. We can still keep this supplied file out of Git. Configure its path and native Gradle integration when wiring builds. [Expo Firebase setup](https://docs.expo.dev/push-notifications/fcm-credentials/)
2. In **Project settings > Service accounts**, generate a private key for the intended sending service account, or create a dedicated service account through [Google Cloud IAM > Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts). Save its private JSON as `.secrets/release/android/fcm-service-account.json`. Confirm the FCM API is enabled and grant permission to send in the target project. [Firebase private service-account keys](https://firebase.google.com/docs/admin/setup), [FCM HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api)
3. Configure relay `FCM_PROJECT_ID` and `FCM_SERVICE_ACCOUNT_PATH` or `FCM_SERVICE_ACCOUNT_JSON`. The existing relay renews OAuth access tokens automatically. The private JSON belongs only on the relay/secret store, never in the mobile app. Firebase **project ID** is different from the numerical project/sender number. No Expo Push Service upload is required for this direct FCM relay.

## Windows signing

Windows releases will be unsigned for now. No Windows certificate, Azure
subscription or signing credentials are required for the current NSIS build.
Users may see an unknown-publisher or SmartScreen warning. The provider setup
below is optional future work.

The Windows distribution plan is GitHub Releases plus winget after this
repository becomes public for v1. Building the installer and manifests does not
require a signing credential. See the [winget release guide](windows-winget-release.md).

Choose a public-trust code-signing provider and its supported signing workflow. Current providers commonly use cloud signing or a hardware token/HSM, so there is no universal downloadable certificate file to request. Tauri's legacy `.pfx` tutorial explicitly applies only to OV certificates issued before June 2023. A website TLS certificate or self-signed certificate is unsuitable for a publicly trusted installer. [Tauri Windows signing and provider integration](https://v2.tauri.app/distribute/sign/windows/)

One option is [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), configured through [Azure Portal](https://portal.azure.com/). Check current geographic/account eligibility before choosing it. Supply the **Azure tenant/subscription**, **signing account**, **Public Trust certificate profile**, **service endpoint**, and a signing identity with the required access. Use local Azure login or CI federation when supported. Keep any service-specific secret/certificate under `.secrets/release/windows/` or in the CI secret store; cloud-managed signing keys stay with the service. [Microsoft signing integrations](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations)

For another provider, supply its signing client/instructions, certificate or key reference, timestamp endpoint and authentication method. A `.pfx` plus password is useful only if that provider actually permits an exportable private key. An HSM/token may instead require the device, certificate-store identity and PIN. Signing setup also needs a compatible runner; a cross-built Windows binary does not guarantee the signing service works on macOS.

## Local handling checklist

- Place private files in the designated `.secrets/release/` directories and keep an encrypted backup outside the repository. Keep IDs/file paths in local metadata and passwords in a secret store.
- Repository ignores, a local exclude rule and a local pre-commit check have been added for these secret files. Check new paths with `git check-ignore -v <path>` and ensure none appear in `git ls-files -- .secrets`. Git ignores do not protect already tracked files or files force-added with `git add -f`; local hooks can also be bypassed.
- Never copy these private keys into app assets, source code, tracked `.env` files, build logs or release artifacts. Supply them to CI through its secret store, and to the push relay through secret environment variables or mounted files.
- Platform account sign-in, enrollment and identity verification happen in your browser. Sharing the downloaded release credentials or installing a local signing identity is sufficient; sharing your account password is unnecessary.

Build wiring and delivery checks are covered in [platform build readiness](platform-build-readiness.md).
