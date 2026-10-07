# Offline review demo

Aulora connects to a server the user supplies. There is no official hosted service or shared reviewer account, so a fresh iOS or Android installation can open a self-contained demo workspace without a backend.

Enter `demo.aulora.example` as the server address and tap **Connect**. No account or password is needed. The Connect screen shows no demo button; the address is the only entry, and it is given to reviewers in the store review notes. `.example` is a reserved domain ([RFC 2606](https://www.rfc-editor.org/rfc/rfc2606)), so the address cannot belong to a real server and the app never contacts it. The sample Acme Studio workspace runs in memory and does not create a server profile, authenticate, register for push, or connect to a backend. The address stops opening the demo once any server profile is saved, as does the direct route, so a live workspace cannot remain connected behind the demo.

Reviewers can browse channels, direct and group messages, send messages and local files, add reactions, open and reply to threads, search sample messages, and view sample members. These use the native chat controls and the shared chat session. Presence is simulated. Voice/video, server administration, authentication, and push delivery require a real server and are not verified by the offline demo.

Tap **Exit demo** to return to Connect. Entering again creates a fresh sample workspace. Messages and files created in the demo are discarded rather than sent or saved to a real workspace.

## Review instructions

Use this text for store review. It applies to both the iOS and Android builds:

> Aulora is a self-hosted team communication client. Users supply their own Aulora server address and authenticate using that server's configuration. There is no official hosted service or shared reviewer account.
>
> On a fresh installation, type demo.aulora.example into the Server address field and tap Connect. This opens a visibly labeled offline Acme Studio workspace without login. Channels, direct/group messages, local messages/files, reactions, threads, search, and sample members can be explored. Tap Exit demo to return to normal server connection. Re-entering resets the sample data.
>
> The demo does not connect to any server. Presence is simulated; voice/video, authentication, administration, and push require a real deployment. We are disclosing these limits rather than presenting simulated operations as production verification.

For Google Play, place the same steps in the **App access** instructions (Policy > App content > App access). Google Play has no field for a server address, so the address belongs in the "any other information required to access your app" box.

## Apple considerations

Do not mark Apple approval complete based on these notes. [Guideline 2.1(a)](https://developer.apple.com/app-store/review/guidelines/#app-completeness) requires prior approval when a built-in demo replaces a reviewer account because of legal or security obligations, and requires full feature coverage. The current offline demo does not cover every server-dependent feature. Resolve reviewer access with Apple before external Beta App Review or App Store submission. Internal TestFlight preparation does not establish that approval. Keep a reachable server and reviewer credentials ready if Apple asks for them; see [App Store review notes](app-review-notes.md).

## Google Play considerations

The demo now runs on Android as well as iOS, so a Play reviewer can reach the workspace from the submitted AAB. It still does not exercise authentication, calls, or push. If Play questions app completeness, provide a reachable demo server and one seeded account rather than relying on the built-in workspace alone.
