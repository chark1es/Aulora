# User guide

## Connect and sign in

Your administrator supplies the server's web URL, such as `https://chat.example.com`. Open it in your browser or enter it on the app's connect screen. Use the web URL, not the Convex dashboard or a database address.

The server advertises its available sign-in methods. Use email/password, a configured OAuth provider, or your organization's SSO. An invitation may be required. If sign-in is unavailable, contact the administrator of that server.

Accounts belong to each server. Joining another server can require another account. Use the workspace switcher to move between connected servers.

If a server does not answer, the app stops waiting silently. After about ten seconds it offers **Try again**, **Use a different server**, and, for a saved server, **Remove this server**. Removal asks for confirmation and only forgets the server on this device, so you can add it again later.

## Install a desktop or mobile client

This installs a client, not a workspace. To run a server, follow [getting started](getting-started.md#install-a-workspace).

Desktop installers are listed in [GitHub Releases](https://github.com/chark1es/Aulora/releases). iOS and Android are in beta and do not install from a released file; join the beta and install through TestFlight or Google Play. Check the version and choose your platform:

| Platform | File and installation |
| --- | --- |
| macOS Apple Silicon | ARM64 DMG; open it and move Aulora to Applications |
| macOS Intel | x86_64 DMG; open it and move Aulora to Applications |
| Windows x64 | `_x64-setup.exe`; run the installer |
| Linux x64 | AppImage for in-app updates, or a Debian package for manual installation |
| Android | Join the testers group, then install from the Play Store; there is no APK to sideload |
| iOS | Join the TestFlight beta from the invitation; there is no IPA to install |
| Browser | Open your server's web URL |

- **iOS beta:** open the [TestFlight invitation](https://testflight.apple.com/join/YUp4ugyv), install TestFlight if you have not already, and accept the Aulora build. Builds come through TestFlight, not as a downloadable file.
- **Android beta:** join the [Aulora testing Google group](https://groups.google.com/g/aulora-testing) with the Google account you use on the Play Store, then install Aulora from its [Play Store listing](https://play.google.com/store/apps/details?id=dev.spwnd.aulora) or the opt-in link Play sends. Google Play handles installation and updates.

For an AppImage, grant execute permission before opening it, for example `chmod +x Aulora*.AppImage`. Linux desktop integration and system dependencies vary by distribution.

Windows downloads are currently unsigned, so Windows may show an unknown-publisher warning. Verify that a download came from this repository. Release assets include `SHA256SUMS`; use `sha256sum`, macOS `shasum -a 256`, or PowerShell `Get-FileHash -Algorithm SHA256` to compare the downloaded file with its listed hash. Hashes verify file integrity; they are not a substitute for a trusted download source.

## Messages and conversations

Choose a channel in the sidebar to read or send messages. Start a direct conversation from the conversation controls and choose a member. Use a message's action menu for replies, reactions, editing, or other available actions.

Threads keep replies attached to a message. Under a thread's first message, a reply line shows the count, the people who replied and when the last reply arrived; select it to open the thread. The threads inbox helps you return to discussions. Drag a file into the web/desktop composer or use the attachment control; mobile offers the device's file and photo pickers. Upload limits depend on the server.

Pin a message in a channel or conversation if you have the Pin messages permission. Choose **Pin message** from the message's action menu, then open the channel's **Pinned messages** panel from the pin button in its header to read, un-pin or load more pins. Pinning also posts a quiet line in the timeline, such as *You pinned a message*; select the word **message** in it to jump to the pinned message and briefly highlight it. Pinning a message is separate from pinning a conversation: pin a direct message or group chat to keep it in a Pinned block at the top of your Direct messages list. That conversation pin is personal to you and does not affect the other people in the conversation.

Role permissions control who can create channels, upload, moderate, or manage a workspace. If an action is missing or denied, ask the workspace administrator.

In a channel's member list, roles an administrator has set to display separately get their own section above Online and Offline, titled in the role's colour. Only online members appear under a role; everyone offline is listed under Offline.

## Search

Press `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux, or choose the search button in a conversation header, to open search. Type part of a conversation name to jump to it, or a word to search message history. Search runs on your device over content the server decrypted for it and loads older history as needed, so what you type is not sent to the server. Results open the matching message and highlight it.

On iPhone and Android, open the **Search** tab in the hub. It searches messages, conversations and people, keeps recent searches on the device, and lets you narrow the results with the scope chips.

## Kanban

If your administrator enables Kanban and grants you View Kanban permission, open it from the sidebar. Plan work with cards, columns, labels, assignees, checklists, due dates, comments, attachments and work timers. You can browse GitHub repositories, issues and pull requests with your own connection. See [Kanban](kanban.md) for the full workflow.

## Notes

If your administrator enables Notes and grants you View Notes permission, open it from the sidebar. Write Markdown notes with a live preview, organize them in nested folders, label them with tags, search locally or on the server, and review each note's line-by-line history. See [Notes](notes.md) for the full workflow.

## Voice and video

Join a voice channel or start a call from a conversation. Allow microphone access, and camera access when using video. Use the call controls to mute, change devices, or leave.

A browser needs HTTPS or localhost for media permissions. Screen sharing depends on platform support. If a call connects but has no audio/video, try another network and ask the administrator whether TURN is configured.

### Sound and picture

Open **Settings → Voice & video** to choose how you sound and look. Changes apply to the current call straight away.

- **Noise suppression** has three levels. *Standard* uses your browser's built-in filter. *Enhanced* runs a small AI model on your device that removes keyboard clatter, fans and room noise while keeping your voice. It needs a little more processing power and is available in the web and desktop apps. Where it cannot run, Standard is used and the settings say so.
- **Background** blurs the room behind you or replaces it with a built-in image or a picture of your own. It runs entirely on your device, so your camera picture is not sent anywhere to do this. It is available in the web and desktop apps and needs WebGL 2.
- **Screen sharing quality** sets how sharp a shared screen is. *Smooth* is 1080p at 30 frames a second, *Balanced* is 1080p at 15 for sharp text, and *Data saver* is 720p at 15.

### Sharing a screen or window

Choose **Share** in a call, then pick a whole screen, one window or a browser tab. In the desktop and Chrome-based browsers you can also share the sound of that screen or window. Your workspace may run a streaming server, which lets one share reach a whole channel without slowing your connection; if it does not, people receive the share straight from you, which is fine for a handful of viewers.

### Picture in picture

Keep a call in view while you work in other apps.

- **Desktop app:** choose the **Picture in picture** button in the call window. The app shrinks to a small window in the corner of the screen. Choose **Keep on top of other windows** (the pin) to keep it above everything else, and the expand button to return to the full app.
- **Chrome and Edge:** the button opens a floating window that stays above other windows. Chrome can also open it for you when you switch to another tab during a call.
- **Safari and Firefox:** the button floats a video of whoever is sharing their screen or speaking.
- **iPhone and iPad:** leave the app during a video call and the other person's video keeps playing in a small window. You can also use the **Picture in picture** button.
- **Android:** leave the app (the home gesture or button) during a video call and the call shrinks into a floating window. The same button does it on demand. Needs Android 8 or later.

On Android an ongoing call also keeps your microphone and camera available while you use other apps, even without picture in picture, and an ongoing **Aulora call in progress** notification shows that it is still running. Android asks for that notification permission with the others; without it the call still runs while you are in the app.

## Notifications

Allow notifications when prompted and check channel mute and user notification settings. OS focus modes, battery restrictions, and denied permissions can suppress alerts.

The desktop process must remain running for local chat notifications. Closing its window can leave it in the tray; quitting stops that delivery path. Mobile background notifications require the server's relay and the publisher's APNs/FCM setup. The browser also needs permission for web push. Notifications are not evidence that messages are end-to-end encrypted.

## Updates

Desktop updates are in Your settings, Updates. Download the update, then restart to install it. AppImage supports the Linux updater; Debian packages require manual replacement. Mobile updates come through the distribution channel you installed from.

Server updates belong to the workspace owner. See [updates](updates.md). If the server is being restarted, reconnect after it returns.

## Get help

For account access or workspace rules, contact your server administrator. For a reproducible app bug, follow [troubleshooting](troubleshooting.md) and file a [GitHub issue](https://github.com/chark1es/Aulora/issues). Keep passwords, tokens, and private messages out of reports.
