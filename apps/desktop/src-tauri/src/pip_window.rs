//! The call picture-in-picture window.
//!
//! The call lives in the main webview: its peer connections and media cannot be
//! handed to a second one, so picture-in-picture is a *separate* window that
//! draws a light view of the call — participants, speaking state and the call
//! controls — while the main window stays exactly where it is, usable. The two
//! webviews talk over Tauri events (`apps/web/src/lib/call-pip.ts`); this module
//! only owns the window itself: a small, undecorated, always-on-top window the
//! user can drag anywhere on any screen, and the notice that it went away.
//!
//! The window loads the same bundled client as the main window, at the `#pip`
//! entry, so the CSP stays locked to bundled assets and there is no second
//! build. Nothing here needs an OS permission: always-on-top and start-dragging
//! are window-manager operations, and the PiP webview never asks for a device.

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// The window's label. `capabilities/default.json` grants it IPC and dragging,
/// and the main webview addresses events to it by this name.
pub const LABEL: &str = "pip";

/// The bundled entry the window loads. `apps/web/src/main.tsx` renders the PiP
/// view for this hash, and `bun run verify` fails if the two drift apart.
pub const ENTRY: &str = "index.html#pip";

/// Event raised on the main window when the PiP window is destroyed — by its own
/// button, the window manager or the app — so the call stops claiming to float.
pub const CLOSED_EVENT: &str = "aulora://call-pip-closed";

/// The smallest a call window may be, and the range it may be resized into.
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 160.0;
const MAX_WIDTH: f64 = 800.0;
const MAX_HEIGHT: f64 = 600.0;

/// Space kept between the new window and the screen edge, in logical pixels.
const SCREEN_MARGIN: f64 = 20.0;

/// Clamps a size the web client asked for into the supported range.
pub fn clamp_size(width: f64, height: f64) -> (f64, f64) {
    let pick = |value: f64, min: f64, max: f64| {
        if value.is_finite() {
            value.clamp(min, max)
        } else {
            min
        }
    };
    (
        pick(width, MIN_WIDTH, MAX_WIDTH),
        pick(height, MIN_HEIGHT, MAX_HEIGHT),
    )
}

/// Where the top-left corner goes to put a window of `size` in the bottom-right
/// corner of `area` (position and size in physical pixels), inset by `margin`.
pub fn corner_position(
    area_position: PhysicalPosition<i32>,
    area_size: PhysicalSize<u32>,
    size: PhysicalSize<u32>,
    margin: i32,
) -> PhysicalPosition<i32> {
    let right = area_position.x + area_size.width as i32;
    let bottom = area_position.y + area_size.height as i32;
    PhysicalPosition::new(
        (right - size.width as i32 - margin).max(area_position.x),
        (bottom - size.height as i32 - margin).max(area_position.y),
    )
}

/// Opens the call window, or shows and focuses the one that is already open.
///
/// Creation must not run on the main thread: on Windows building a webview from
/// a synchronous command deadlocks, which is why the command that calls this is
/// async. The window is built hidden and shown after it has been placed, so it
/// never flashes at the window manager's default position.
pub fn open(app: &AppHandle, width: f64, height: f64) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(LABEL) {
        existing.show()?;
        existing.set_focus()?;
        return Ok(());
    }
    let (width, height) = clamp_size(width, height);
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(ENTRY.into()))
        .title("Aulora call")
        .inner_size(width, height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .max_inner_size(MAX_WIDTH, MAX_HEIGHT)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    // Placement is cosmetic: a window the window manager put somewhere is still
    // usable, and on Wayland the compositor may ignore the request entirely.
    let _ = place(&window, width, height);
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Closes the call window. The call keeps running in the main window.
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.close()?;
    }
    Ok(())
}

/// Whether the call window is open.
pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

/// Tells the main window the call window is gone.
pub fn emit_closed(app: &AppHandle) {
    let _ = app.emit_to("main", CLOSED_EVENT, ());
}

/// Puts the new window in the bottom-right corner of the screen the app is on.
fn place(window: &WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    // Use the size that was asked for, not `inner_size()`: the window manager
    // applies it asynchronously, so reading it back can still be the old size.
    let size = PhysicalSize::new(
        (width * scale).round() as u32,
        (height * scale).round() as u32,
    );
    let margin = (SCREEN_MARGIN * scale).round() as i32;
    match work_area(window) {
        Some((position, area)) => {
            window.set_position(corner_position(position, area, size, margin))
        }
        None => Ok(()),
    }
}

/// The work area of the screen the main window is on, so the call window opens
/// beside the app rather than on whichever screen the window manager picks.
/// Falls back to the new window's own screen, then to the primary one.
fn work_area(window: &WebviewWindow) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let main = window.app_handle().get_webview_window("main");
    let monitor = main
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some((area.position, area.size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_a_requested_size_into_range() {
        assert_eq!(clamp_size(10.0, 10.0), (MIN_WIDTH, MIN_HEIGHT));
        assert_eq!(clamp_size(5000.0, 5000.0), (MAX_WIDTH, MAX_HEIGHT));
        assert_eq!(clamp_size(360.0, 240.0), (360.0, 240.0));
    }

    #[test]
    fn rejects_a_size_that_is_not_a_number() {
        assert_eq!(clamp_size(f64::NAN, f64::INFINITY), (MIN_WIDTH, MIN_HEIGHT));
    }

    #[test]
    fn places_the_window_in_the_bottom_right_corner_of_the_work_area() {
        let position = corner_position(
            PhysicalPosition::new(0, 25),
            PhysicalSize::new(1920, 1055),
            PhysicalSize::new(360, 240),
            20,
        );
        assert_eq!((position.x, position.y), (1540, 820));
    }

    #[test]
    fn respects_a_screen_that_does_not_start_at_the_origin() {
        let position = corner_position(
            PhysicalPosition::new(-1280, 0),
            PhysicalSize::new(1280, 800),
            PhysicalSize::new(400, 300),
            10,
        );
        assert_eq!((position.x, position.y), (-410, 490));
    }

    #[test]
    fn never_places_the_window_off_a_screen_smaller_than_itself() {
        let position = corner_position(
            PhysicalPosition::new(100, 50),
            PhysicalSize::new(200, 100),
            PhysicalSize::new(360, 240),
            20,
        );
        assert_eq!((position.x, position.y), (100, 50));
    }
}
