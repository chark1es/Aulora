# User guide

## Connect and sign in

Your administrator supplies the server's web URL, such as `https://chat.example.com`. Open it in your browser or enter it on the app's connect screen. Use the web URL, not the Convex dashboard or a database address.

The server advertises its available sign-in methods. Use email/password, a configured OAuth provider, or your organization's SSO. An invitation may be required. If sign-in is unavailable, contact the administrator of that server.

Accounts belong to each server. Joining another server can require another account. Use the workspace switcher to move between connected servers.

## Install a desktop or mobile client

Published files are listed in [GitHub Releases](https://github.com/chark1es/Aulora/releases). Check the version and choose your platform:

| Platform | File and installation |
| --- | --- |
| macOS Apple Silicon | ARM64 DMG; open it and move Aulora to Applications |
| macOS Intel | x86_64 DMG; open it and move Aulora to Applications |
| Windows x64 | `_x64-setup.exe`; run the installer |
| Linux x64 | AppImage for in-app updates, or a Debian package for manual installation |
| Android | APK for direct installation; AAB is for Google Play submission |
| iOS | Use a published App Store or TestFlight invitation; an IPA download is not a general installer |
| Browser | Open your server's web URL |

For an AppImage, grant execute permission before opening it, for example `chmod +x Aulora*.AppImage`. Linux desktop integration and system dependencies vary by distribution.

Windows downloads are currently unsigned, so Windows may show an unknown-publisher warning. Verify that a download came from this repository. Release assets include `SHA256SUMS`; use `sha256sum`, macOS `shasum -a 256`, or PowerShell `Get-FileHash -Algorithm SHA256` to compare the downloaded file with its listed hash. Hashes verify file integrity; they are not a substitute for a trusted download source.

## Messages and conversations

Choose a channel in the sidebar to read or send messages. Start a direct conversation from the conversation controls and choose a member. Use a message's action menu for replies, reactions, editing, or other available actions.

Threads keep replies attached to a message. The threads inbox helps you return to discussions. Drag a file into the web/desktop composer or use the attachment control; mobile offers the device's file and photo pickers. Upload limits depend on the server.

Role permissions control who can create channels, upload, moderate, or manage a workspace. If an action is missing or denied, ask the workspace administrator.

## Voice and video

Join a voice channel or start a call from a conversation. Allow microphone access, and camera access when using video. Use the call controls to mute, change devices, or leave.

A browser needs HTTPS or localhost for media permissions. Screen sharing depends on platform support. If a call connects but has no audio/video, try another network and ask the administrator whether TURN is configured.

## Notifications

Allow notifications when prompted and check channel mute and user notification settings. OS focus modes, battery restrictions, and denied permissions can suppress alerts.

The desktop process must remain running for local chat notifications. Closing its window can leave it in the tray; quitting stops that delivery path. Mobile background notifications require the server's relay and the publisher's APNs/FCM setup. The browser also needs permission for web push. Notifications are not evidence that messages are end-to-end encrypted.

## Updates

Desktop updates are in Your settings, Updates. Download the update, then restart to install it. AppImage supports the Linux updater; Debian packages require manual replacement. Mobile updates come through the distribution channel you installed from.

Server updates belong to the workspace owner. See [updates](updates.md). If the server is being restarted, reconnect after it returns.

## Get help

For account access or workspace rules, contact your server administrator. For a reproducible app bug, follow [troubleshooting](troubleshooting.md) and file a [GitHub issue](https://github.com/chark1es/Aulora/issues). Keep passwords, tokens, and private messages out of reports.
