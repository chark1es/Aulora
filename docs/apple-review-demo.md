# Offline Apple review demo

Android and TestFlight users connect to their own Aulora server. No official test server is provided.

On a fresh iOS installation, tap **Try App Review demo** below Connect. No server address, account, or password is needed. The sample Acme Studio workspace runs in memory and does not create a server profile, authenticate, register for push, or connect to a backend. The entry is unavailable once any server profile is saved, including through a direct link, so a live workspace cannot remain connected behind the demo.

Reviewers can browse channels, direct and group messages, send messages and local files, add reactions, open and reply to threads, search sample messages, and view sample members. These use the native chat controls and the shared chat session. Presence is simulated. Voice/video, server administration, authentication, and push delivery require a real server and are not verified by the offline demo.

Tap **Exit demo** to return to Connect. Entering again creates a fresh sample workspace. Messages and files created in the demo are discarded rather than sent or saved to a real workspace.

## Notes for Apple

Use this text as review instructions for the build containing the demo:

> Aulora is a self-hosted team communication client. Users supply their own Aulora server address and authenticate using that server's configuration. There is no official hosted service or shared reviewer account.
>
> On a fresh iOS installation, tap Try App Review demo beneath Connect. This opens a visibly labeled offline Acme Studio workspace without login or a server address. Channels, direct/group messages, local messages/files, reactions, threads, search, and sample members can be explored. Tap Exit demo to return to normal server connection. Re-entering resets the sample data.
>
> The demo does not connect to any server. Presence is simulated; voice/video, authentication, administration, and push require a real deployment. We are disclosing these limits rather than presenting simulated operations as production verification.

Do not mark Apple approval complete based on these notes. [Guideline 2.1(a)](https://developer.apple.com/app-store/review/guidelines/#app-completeness) requires prior approval when a built-in demo replaces a reviewer account because of legal or security obligations, and requires full feature coverage. The current offline demo does not cover every server-dependent feature. Resolve reviewer access with Apple before external Beta App Review or App Store submission. Internal TestFlight preparation does not establish that approval.
