//! Screen and window capture for Aulora's own share picker.
//!
//! A webview cannot replace its `getDisplayMedia` picker, so the shell bypasses
//! it: it enumerates the screens and windows the person can share, and the web
//! client draws the chosen one into a canvas it captures. Frames are pulled one
//! per request, which keeps the cost of a share proportional to the frame rate
//! the client asks for and stops the work the moment the client stops polling.
//!
//! Frames travel as raw JPEG bytes behind a 16-byte header, returned as a Tauri
//! raw IPC response. Base64 would inflate every frame by a third, allocate a
//! string per frame, and cost the webview an `atob` pass and a byte-by-byte copy
//! before it could even decode the image; the raw body goes straight into a
//! `Blob` and `createImageBitmap`.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, ImageEncoder, RgbaImage};
use serde::Serialize;
use xcap::{Monitor, Window};

/// Tile box for the picker, and the quality a tile is encoded at.
const THUMBNAIL_WIDTH: u32 = 320;
const THUMBNAIL_HEIGHT: u32 = 180;
const THUMBNAIL_QUALITY: u8 = 60;

/// Frame quality: sharp enough for text, small enough to cross the IPC bridge.
const FRAME_QUALITY: u8 = 72;

/// Magic, version, format byte and two sizes: the raw frame prefix. The
/// web client validates these before handing the rest to the image decoder.
pub const FRAME_MAGIC: [u8; 4] = *b"AULF";
pub const FRAME_VERSION: u8 = 1;
pub const FRAME_FORMAT_JPEG: u8 = 1;
pub const FRAME_HEADER_BYTES: usize = 16;

/// The header a frame body starts with. Sizes are little endian so the webview
/// reads them with `DataView.getUint32(offset, true)`.
fn frame_header(width: u32, height: u32) -> [u8; FRAME_HEADER_BYTES] {
    let mut header = [0u8; FRAME_HEADER_BYTES];
    header[..4].copy_from_slice(&FRAME_MAGIC);
    header[4] = FRAME_VERSION;
    header[5] = FRAME_FORMAT_JPEG;
    header[8..12].copy_from_slice(&width.to_le_bytes());
    header[12..16].copy_from_slice(&height.to_le_bytes());
    header
}

/// Windows offered in the picker. Every entry costs a full capture for its
/// tile, so a long window list would make the picker slow to open.
const MAX_WINDOWS: usize = 48;

/// Windows smaller than this are helper and message windows (another app's
/// hidden single-instance window, tray hosts, IME windows), not something a
/// person would pick to share.
const MIN_WINDOW_WIDTH: u32 = 100;
const MIN_WINDOW_HEIGHT: u32 = 60;

/// One surface the person can share.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    /// Opaque id handed back to [`capture_frame`]: `screen:<id>` or
    /// `window:<id>`.
    pub id: String,
    pub name: String,
    pub kind: SourceKind,
    /// `data:image/jpeg;base64,…` tile image, absent when the capture failed.
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Screen,
    Window,
}

/// One captured frame, already scaled down to fit the requested box.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFrame {
    pub mime: &'static str,
    /// Base64 JPEG bytes (no data-URL prefix).
    pub data: String,
    pub width: u32,
    pub height: u32,
}

/// What a picker id names, resolved against the platform's live sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceTarget {
    Screen(u32),
    Window(u32),
}

fn source_id(prefix: &str, id: u32) -> String {
    format!("{prefix}:{id}")
}

fn parse_source_id(raw: &str) -> Result<SourceTarget, String> {
    let unknown = || format!("Unknown capture source \"{raw}\"");
    let (prefix, rest) = raw.split_once(':').ok_or_else(unknown)?;
    let id = rest.parse::<u32>().map_err(|_| unknown())?;
    match prefix {
        "screen" => Ok(SourceTarget::Screen(id)),
        "window" => Ok(SourceTarget::Window(id)),
        _ => Err(unknown()),
    }
}

/// The largest size that keeps `width`×`height`'s aspect ratio inside the box.
/// Sources are never scaled up, and a zero ceiling means no limit on that axis.
fn fit_within(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (width, height);
    }
    let limit_width = if max_width == 0 { width } else { max_width };
    let limit_height = if max_height == 0 { height } else { max_height };
    if width <= limit_width && height <= limit_height {
        return (width, height);
    }
    // Compare the box against the source with cross multiplication, so the
    // limiting axis is exact without floating point.
    let width_limited =
        u64::from(limit_width) * u64::from(height) <= u64::from(limit_height) * u64::from(width);
    if width_limited {
        let scaled = (u64::from(height) * u64::from(limit_width)) / u64::from(width);
        (limit_width, (scaled.max(1)) as u32)
    } else {
        let scaled = (u64::from(width) * u64::from(limit_height)) / u64::from(height);
        ((scaled.max(1)) as u32, limit_height)
    }
}

/// Encodes one captured image to JPEG at the requested size.
fn encode_jpeg(
    image: RgbaImage,
    max_width: u32,
    max_height: u32,
    quality: u8,
) -> Result<(Vec<u8>, u32, u32), String> {
    // Scale first, while the frame is the capture's own RGBA buffer, and only
    // then drop the alpha channel: a 4K screen is 8 million pixels, so doing
    // the conversion (or a slow filter) at full size dominated the frame time.
    // `thumbnail` is a box filter, which keeps text legible at a fraction of
    // the cost of a convolution filter.
    let (width, height) = fit_within(image.width(), image.height(), max_width, max_height);
    let image = if width == image.width() && height == image.height() {
        image
    } else {
        image::imageops::thumbnail(&image, width, height)
    };
    // Screen captures are opaque; dropping the alpha channel cuts the encode
    // and the JPEG size without losing anything.
    let scaled = image::DynamicImage::ImageRgba8(image).to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality)
        .write_image(scaled.as_raw(), width, height, ExtendedColorType::Rgb8)
        .map_err(|error| format!("Could not encode the captured frame: {error}"))?;
    Ok((bytes, width, height))
}

/// A base64 JPEG data URL, used only for the picker's one-off tiles.
fn encode_frame(
    image: RgbaImage,
    max_width: u32,
    max_height: u32,
    quality: u8,
) -> Result<CaptureFrame, String> {
    let (bytes, width, height) = encode_jpeg(image, max_width, max_height, quality)?;
    Ok(CaptureFrame {
        mime: "image/jpeg",
        data: BASE64.encode(&bytes),
        width,
        height,
    })
}

/// One frame as the raw IPC body: a [`FRAME_HEADER_BYTES`] header followed by
/// the JPEG. Exposed for the header test; [`capture_frame_bytes`] captures a
/// real source first.
pub fn frame_bytes(
    image: RgbaImage,
    max_width: u32,
    max_height: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let (jpeg, width, height) = encode_jpeg(image, max_width, max_height, quality)?;
    let mut body = Vec::with_capacity(FRAME_HEADER_BYTES + jpeg.len());
    body.extend_from_slice(&frame_header(width, height));
    body.extend_from_slice(&jpeg);
    Ok(body)
}

fn thumbnail(image: RgbaImage) -> Option<String> {
    let frame = encode_frame(image, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAIL_QUALITY).ok()?;
    Some(format!("data:{};base64,{}", frame.mime, frame.data))
}

/// Every screen, then every shareable window, with picker tiles.
///
/// A source whose metadata or tile cannot be read is skipped rather than
/// failing the whole list: one inaccessible window must not break sharing.
pub fn list_sources() -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();

    let monitors = Monitor::all().map_err(|error| format!("Could not list screens: {error}"))?;
    for (index, monitor) in monitors.iter().enumerate() {
        let Ok(id) = monitor.id() else {
            continue;
        };
        let width = monitor.width().unwrap_or_default();
        let height = monitor.height().unwrap_or_default();
        let label = monitor.name().unwrap_or_default();
        let label = label.trim();
        let name = if label.is_empty() {
            format!("Screen {} ({}×{})", index + 1, width, height)
        } else {
            format!("{label} ({}×{})", width, height)
        };
        sources.push(CaptureSource {
            id: source_id("screen", id),
            name,
            kind: SourceKind::Screen,
            thumbnail: monitor.capture_image().ok().and_then(thumbnail),
        });
    }

    let own_pid = std::process::id();
    let windows = Window::all().map_err(|error| format!("Could not list windows: {error}"))?;
    let mut listed = 0;
    for window in windows {
        if listed >= MAX_WINDOWS {
            break;
        }
        // Sharing this very window would show the call inside the call.
        if window.pid().ok() == Some(own_pid) {
            continue;
        }
        if window.is_minimized().unwrap_or(false) {
            continue;
        }
        let Ok(id) = window.id() else {
            continue;
        };
        let width = window.width().unwrap_or_default();
        let height = window.height().unwrap_or_default();
        if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
            continue;
        }
        let title = window.title().unwrap_or_default();
        let title = title.trim();
        let app = window.app_name().unwrap_or_default();
        let app = app.trim();
        let name = match (title.is_empty(), app.is_empty()) {
            (false, true) => title.to_string(),
            (false, false) => format!("{title} — {app}"),
            (true, false) => app.to_string(),
            (true, true) => continue,
        };
        // A window that cannot be captured cannot be shared either, so it is
        // left out instead of offered as a tile that fails once picked.
        let Some(thumbnail) = window.capture_image().ok().and_then(thumbnail) else {
            continue;
        };
        listed += 1;
        sources.push(CaptureSource {
            id: source_id("window", id),
            name,
            kind: SourceKind::Window,
            thumbnail: Some(thumbnail),
        });
    }

    Ok(sources)
}

/// Captures one frame of `source_id` as raw header-plus-JPEG bytes, scaled to
/// fit `max_width`×`max_height` (either may be zero for no limit). Sources are
/// looked up again on every frame so a closed window reports a clear error
/// instead of a stale image.
pub fn capture_frame_bytes(
    source_id: &str,
    max_width: u32,
    max_height: u32,
) -> Result<Vec<u8>, String> {
    let image = match parse_source_id(source_id)? {
        SourceTarget::Screen(id) => Monitor::all()
            .map_err(|error| format!("Could not list screens: {error}"))?
            .into_iter()
            .find(|monitor| monitor.id().ok() == Some(id))
            .ok_or_else(|| String::from("That screen is no longer available."))?
            .capture_image(),
        SourceTarget::Window(id) => Window::all()
            .map_err(|error| format!("Could not list windows: {error}"))?
            .into_iter()
            .find(|window| window.id().ok() == Some(id))
            .ok_or_else(|| String::from("That window is no longer available."))?
            .capture_image(),
    }
    .map_err(|error| format!("Could not capture that source: {error}"))?;

    frame_bytes(image, max_width, max_height, FRAME_QUALITY)
}

/// Whether the OS lets Aulora read the screen, and how to grant it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCapturePermission {
    pub status: PermissionStatus,
    /// Whether the shell can open the OS pane where the permission is granted.
    pub can_open_settings: bool,
    /// What to tell the person when sharing cannot start.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    Granted,
    Denied,
    Unsupported,
}

/// Where the shell runs, as far as capture permissions go. Every arm exists on
/// every build: the matrix lives in one `match`, and the tests walk all of it.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CapturePlatform {
    MacOs,
    Windows,
    LinuxX11,
    LinuxWayland,
}

/// The macOS pane that lists apps allowed to read the screen.
#[cfg(target_os = "macos")]
const MACOS_SCREEN_RECORDING_PANE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[cfg(target_os = "macos")]
fn current_platform() -> CapturePlatform {
    CapturePlatform::MacOs
}

#[cfg(target_os = "windows")]
fn current_platform() -> CapturePlatform {
    CapturePlatform::Windows
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn current_platform() -> CapturePlatform {
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    let display = std::env::var("WAYLAND_DISPLAY").unwrap_or_default();
    if is_wayland_session(&session, &display) {
        CapturePlatform::LinuxWayland
    } else {
        CapturePlatform::LinuxX11
    }
}

/// xcap picks its Wayland backend from these same two variables, so reading them
/// the same way keeps the report and the capture in agreement. Only the Linux
/// backend selection and the tests call it.
#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
fn is_wayland_session(session_type: &str, wayland_display: &str) -> bool {
    session_type.eq_ignore_ascii_case("wayland")
        || wayland_display.to_lowercase().contains("wayland")
}

fn granted() -> ScreenCapturePermission {
    ScreenCapturePermission {
        status: PermissionStatus::Granted,
        can_open_settings: false,
        detail: None,
    }
}

fn permission_for(
    platform: CapturePlatform,
    screen_recording_granted: bool,
) -> ScreenCapturePermission {
    match platform {
        CapturePlatform::MacOs if screen_recording_granted => granted(),
        CapturePlatform::MacOs => ScreenCapturePermission {
            status: PermissionStatus::Denied,
            can_open_settings: true,
            detail: Some(String::from(
                "Aulora needs Screen Recording access to share your screen. The same permission \
                 lets it share the system audio that goes with it. Allow Aulora in System Settings \
                 › Privacy & Security › Screen Recording, then check again. Quit and reopen Aulora \
                 if macOS still says no.",
            )),
        },
        CapturePlatform::Windows | CapturePlatform::LinuxX11 => granted(),
        // Wayland has no permission-free frame path: xcap has to ask the portal
        // (or the compositor) for a screenshot per frame, which is too slow and
        // can prompt again and again for a live share.
        CapturePlatform::LinuxWayland => ScreenCapturePermission {
            status: PermissionStatus::Unsupported,
            can_open_settings: false,
            detail: Some(String::from(
                "This Wayland session doesn't let apps read the screen continuously, so Aulora \
                 can't share it. Sign in with an X11 session to share your screen.",
            )),
        },
    }
}

/// The current verdict. `request` also asks macOS for its own Screen Recording
/// prompt, which is what registers Aulora in that settings pane; preflight alone
/// never prompts.
pub fn screen_capture_permission(request: bool) -> ScreenCapturePermission {
    permission_for(current_platform(), screen_recording_granted(request))
}

#[cfg(target_os = "macos")]
fn screen_recording_granted(request: bool) -> bool {
    use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};

    if CGPreflightScreenCaptureAccess() {
        return true;
    }
    request && CGRequestScreenCaptureAccess()
}

#[cfg(not(target_os = "macos"))]
fn screen_recording_granted(_request: bool) -> bool {
    true
}

/// Opens the pane where screen recording is granted. macOS is the only platform
/// with one, because the others need no grant to read the screen.
pub fn open_permission_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(MACOS_SCREEN_RECORDING_PANE)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Could not open System Settings: {error}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(String::from(
            "This platform has no screen sharing permission to grant.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ids_round_trip() {
        assert_eq!(source_id("screen", 7), "screen:7");
        assert_eq!(parse_source_id("screen:7"), Ok(SourceTarget::Screen(7)));
        assert_eq!(source_id("window", 42), "window:42");
        assert_eq!(parse_source_id("window:42"), Ok(SourceTarget::Window(42)));
    }

    #[test]
    fn unknown_source_ids_are_rejected() {
        for raw in [
            "",
            "screen",
            "screen:",
            "screen:abc",
            "tab:3",
            "screen:-1",
            ":4",
        ] {
            assert!(parse_source_id(raw).is_err(), "{raw} should not parse");
        }
    }

    #[test]
    fn fit_within_never_scales_up() {
        assert_eq!(fit_within(1280, 720, 1920, 1080), (1280, 720));
        assert_eq!(fit_within(640, 360, 1920, 1080), (640, 360));
    }

    #[test]
    fn fit_within_keeps_the_aspect_ratio() {
        assert_eq!(fit_within(1920, 1080, 1280, 720), (1280, 720));
        assert_eq!(fit_within(3840, 2160, 1920, 1080), (1920, 1080));
        assert_eq!(fit_within(1000, 1000, 100, 100), (100, 100));
        // Ultrawide: the width ceiling decides, the height follows it down.
        assert_eq!(fit_within(3440, 1440, 1920, 1080), (1920, 803));
        // Portrait: the height ceiling decides instead.
        assert_eq!(fit_within(1080, 1920, 1920, 1080), (607, 1080));
    }

    #[test]
    fn fit_within_treats_a_zero_ceiling_as_unlimited() {
        assert_eq!(fit_within(1920, 1080, 1280, 0), (1280, 720));
        assert_eq!(fit_within(1920, 1080, 0, 540), (960, 540));
        assert_eq!(fit_within(1920, 1080, 0, 0), (1920, 1080));
    }

    #[test]
    fn fit_within_survives_empty_images() {
        assert_eq!(fit_within(0, 0, 1920, 1080), (0, 0));
        assert_eq!(fit_within(1920, 0, 1280, 720), (1920, 0));
    }

    #[test]
    fn frames_are_jpeg_with_the_reported_size() {
        let source = RgbaImage::from_pixel(400, 200, image::Rgba([10, 20, 30, 255]));
        let frame = encode_frame(source, 200, 100, FRAME_QUALITY).expect("frame");
        assert_eq!(frame.mime, "image/jpeg");
        assert_eq!((frame.width, frame.height), (200, 100));
        let bytes = BASE64.decode(frame.data).expect("base64");
        assert_eq!(&bytes[..2], &[0xFF, 0xD8], "JPEG start of image");
    }

    #[test]
    fn raw_frames_carry_a_parsable_header_and_jpeg_body() {
        let source = RgbaImage::from_pixel(400, 200, image::Rgba([10, 20, 30, 255]));
        let frame = frame_bytes(source, 200, 100, FRAME_QUALITY).expect("frame");
        assert_eq!(&frame[..4], &FRAME_MAGIC);
        assert_eq!(frame[4], FRAME_VERSION);
        assert_eq!(frame[5], FRAME_FORMAT_JPEG);
        let width = u32::from_le_bytes(frame[8..12].try_into().expect("width"));
        let height = u32::from_le_bytes(frame[12..16].try_into().expect("height"));
        assert_eq!((width, height), (200, 100));
        assert_eq!(&frame[FRAME_HEADER_BYTES..FRAME_HEADER_BYTES + 2], &[0xFF, 0xD8]);
        assert!(frame.len() > FRAME_HEADER_BYTES + 2, "header plus JPEG body");
    }

    #[test]
    fn macos_denies_screen_recording_with_a_settings_hint() {
        let permission = permission_for(CapturePlatform::MacOs, false);
        assert_eq!(permission.status, PermissionStatus::Denied);
        assert!(permission.can_open_settings);
        let detail = permission.detail.unwrap_or_default();
        assert!(detail.contains("Screen Recording"), "{detail}");
        assert!(detail.contains("System Settings"), "{detail}");
    }

    #[test]
    fn macos_grants_screen_recording() {
        let permission = permission_for(CapturePlatform::MacOs, true);
        assert_eq!(permission.status, PermissionStatus::Granted);
        assert!(!permission.can_open_settings);
        assert!(permission.detail.is_none());
    }

    #[test]
    fn windows_and_x11_need_no_grant() {
        for platform in [CapturePlatform::Windows, CapturePlatform::LinuxX11] {
            let permission = permission_for(platform, false);
            assert_eq!(permission.status, PermissionStatus::Granted, "{platform:?}");
            assert!(!permission.can_open_settings);
            assert!(permission.detail.is_none());
        }
    }

    #[test]
    fn wayland_is_reported_as_unsupported() {
        let permission = permission_for(CapturePlatform::LinuxWayland, true);
        assert_eq!(permission.status, PermissionStatus::Unsupported);
        assert!(!permission.can_open_settings);
        assert!(permission.detail.unwrap_or_default().contains("X11"));
    }

    #[test]
    fn wayland_sessions_are_detected_like_xcap_does() {
        assert!(is_wayland_session("wayland", ""));
        assert!(is_wayland_session("", "wayland-0"));
        assert!(!is_wayland_session("x11", ""));
        assert!(!is_wayland_session("", ""));
    }
}
