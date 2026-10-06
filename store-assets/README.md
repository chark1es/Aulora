# Aulora store assets

English U.S. assets for App Store Connect and Google Play. Each screenshot folder contains five numbered PNGs. Upload them in filename order.

| Console field | Folder or file | Pixels | Format |
| --- | --- | --- | --- |
| Apple app icon | `app-store/icon/aulora-1024x1024.png` | 1024 × 1024 | RGB PNG, opaque |
| iPhone 6.9-inch screenshots | `app-store/iphone-6.9/` | 1320 × 2868 | RGB PNG, opaque |
| iPad 13-inch screenshots | `app-store/ipad-13/` | 2064 × 2752 | RGB PNG, opaque |
| Google Play app icon | `google-play/icon/aulora-512x512.png` | 512 × 512 | RGBA PNG, opaque pixels, under 1 MB |
| Google Play feature graphic | `google-play/feature-graphic-1024x500.png` | 1024 × 500 | RGB PNG, opaque |
| Google Play phone screenshots | `google-play/phone/` | 1080 × 1920 | RGB PNG, opaque |
| Google Play 7-inch tablet screenshots | `google-play/tablet-7/` | 1080 × 1920 | RGB PNG, opaque |
| Google Play 10-inch tablet screenshots | `google-play/tablet-10/` | 1440 × 2560 | RGB PNG, opaque |

The Android sets use 9:16 portrait captures and have at least four screenshots at 1080 pixels or higher. Tablet images were rendered at tablet display densities, separately from the phone. All screenshots retain their native capture dimensions. They have no device frames, marketing captions, or artificial interface artwork.

Apple's listing icon comes from the submitted app build. The Apple icon here exports the existing iOS app icon for reference and build preparation. Google Play's listing icon is uploaded separately from the Android launcher icon. Both exports use the existing Aulora mark, with square opaque backgrounds and no added rounding or shadow.

## Screenshot order and alt text

| Filename | Alt text |
| --- | --- |
| `01-channels.png` | Aulora general channel with team updates, a pinned message, and the message composer. |
| `02-design.png` | Aulora design channel with formatted text, a reaction, and links to other channels. |
| `03-direct-messages.png` | A direct conversation with Sam Chen about reviewing the launch notes. |
| `04-threads.png` | Aulora thread with the original message, replies, and a reply composer. |
| `05-group-conversations.png` | The Launch crew group conversation coordinating the team handoff. |

Feature graphic alt text: "Aulora, Your team. Your server. Self-hosted team chat, with two conversation bubbles."

`preview.jpg` is a contact sheet for reviewing all device sets. Upload the individual PNG files. `manifest.json` records dimensions, color mode, file size, and SHA-256 for all 28 upload images.

## Capture source

These are native renders of Aulora's shared message list, composer, rich text, avatars, reactions, and thread controls, using fictional Acme Studio conversations. The disposable capture workspace uses the existing offline review demo to supply local data. Its review instructions and call disclaimer are omitted from the capture shell. It makes no network connection to a real workspace and does not exercise calls, push, or authentication.

The capture shell is staged under `.cache/store-capture`, outside the shipping app sources. The production app and review demo entry rules are unchanged. Screen contents are sample data; these assets do not represent a production account or a live backend test.

## Regenerate

Use Node, Bun, Python 3 with Pillow, Xcode simulators, and the Android SDK. Install repository dependencies first. Build the current native debug clients, then install them on dedicated capture devices. Expo Go cannot run Aulora's native dependencies.

```sh
node scripts/store-assets/prepare-capture.mjs
cd .cache/store-capture/apps/mobile
bun run start -- --port 8081
```

Start Metro from the staged directory. It opens the capture screen as the initial route. Native builds must use the dependencies matching this repository revision. For Android, reverse device port 8081 to the host with `adb -s SERIAL reverse tcp:8081 tcp:8081`.

Use an iPhone 17 Pro Max and iPad Pro 13-inch simulator. For Android, configure the phone to 1080 × 1920 at 420 dpi, the 7-inch tablet to 1080 × 1920 at 240 dpi, and the 10-inch tablet to 1440 × 2560 at 240 dpi. Use light appearance and a clean status bar. Allow the first launch to finish before capturing. On machines with limited memory, run one device family at a time.

From the repository root:

```sh
python3 scripts/store-assets/capture.py --iphone IPHONE_UDID --ipad IPAD_UDID
python3 scripts/store-assets/capture.py --phone PHONE_SERIAL --adb /path/to/adb
python3 scripts/store-assets/capture.py --tablet-7 TABLET_7_SERIAL --adb /path/to/adb
python3 scripts/store-assets/capture.py --tablet-10 TABLET_10_SERIAL --adb /path/to/adb
```

The helper changes the staged sample view and saves native PNGs to `.cache/store-raw`. It waits again when it detects a blank screen or the development refresh banner. Inspect the captures for startup screens, dialogs, or other development overlays before exporting. Increase `--settle` if a device needs more startup time. Use `--views direct` to retake just the direct-message screen. Do not run capture commands concurrently because they share the staged view selection.

For the feature graphic, serve `scripts/store-assets/feature-graphic.html` locally and capture it in a browser with a 1024 × 500 CSS viewport. Save that screenshot as `.cache/store-raw/feature-graphic.png`. The exporter normalizes the browser's display scale to 1024 × 500.

```sh
python3 scripts/store-assets/export-assets.py
```

The exporter preserves native screenshot pixels, strips alpha channels from screenshots, creates both icons, validates the upload PNGs, and builds `.cache/aulora-store-assets.zip`.

## Store specifications

Dimensions and format rules checked on October 1, 2026 against [Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [Google Play's preview asset requirements](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en).
