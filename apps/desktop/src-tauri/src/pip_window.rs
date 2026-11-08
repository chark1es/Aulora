//! The call picture-in-picture window.
//!
//! The call lives in the main webview: its peer connections and media cannot be
//! handed to a second one, so picture-in-picture is a *separate* window that
//! shows the call — the picture over a loopback peer connection (or, where that
//! cannot work, as JPEG frames), the people, and the controls — while the main
//! window stays exactly where it is, usable. The two webviews talk over Tauri
//! events (`apps/web/src/lib/call-pip.ts`); this module owns the window itself:
//! a small, undecorated, always-on-top window with its own resize edges, a
//! remembered position, edge snapping, and the notice that it went away.
//!
//! The window loads the same bundled client as the main window, at the `#pip`
//! entry, so the CSP stays locked to bundled assets and there is no second
//! build. Nothing here needs an OS permission: always-on-top, dragging and
//! resizing are window-manager operations, and the PiP webview never asks for a
//! device. The frame fallback adds only a `Channel`, which is shell IPC.
//!
//! Wayland compositors do not let an app keep an undecorated, always-on-top
//! window where it asked; there the shell reports a `"dock"` surface instead and
//! the web client keeps its in-app dock.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::ipc::Channel;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::pip_geometry::{self, PipGeometry, SNAP_THRESHOLD};

/// The window's label. `capabilities/default.json` grants it IPC, dragging and
/// resizing, and the main webview addresses events to it by this name.
pub const LABEL: &str = "pip";

/// The app window's label. The call window addresses it and the frame fallback
/// accepts frames only from it.
pub const MAIN_LABEL: &str = "main";

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

/// How long the window has to sit still before it is snapped and its geometry
/// saved. Long enough that a drag does not write on every frame, short enough
/// that letting go looks like it snapped.
const SETTLE_MILLIS: u64 = 350;

/// The largest frame the shell forwards to the call window. A 480x270 JPEG is
/// tens of kilobytes; anything near this is a bug and must not be forwarded.
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

/// Which floating surface this desktop can offer for a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipSurface {
    /// A real, always-on-top OS window (the normal case).
    Window,
    /// No reliable OS window here; the in-app call dock stays as it is.
    Dock,
}

impl PipSurface {
    /// The string the web client reads from an `open_pip_window` call.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Window => "window",
            Self::Dock => "dock",
        }
    }
}

/// Whether the session runs on Wayland, where undecorated always-on-top
/// windows are not dependable. Reads the same variables the compositor sets.
pub fn is_wayland() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    match std::env::var("XDG_SESSION_TYPE") {
        Ok(value) if value.eq_ignore_ascii_case("wayland") => return true,
        _ => {}
    }
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// What the shell can float. A Wayland session keeps the in-app dock.
pub fn display_mode() -> PipSurface {
    if is_wayland() {
        PipSurface::Dock
    } else {
        PipSurface::Window
    }
}

/// The frame channel the call window registered, if any.
#[derive(Default)]
pub struct PipFrameState(Mutex<Option<PipFrameSink>>);

struct PipFrameSink {
    token: String,
    channel: Channel<Vec<u8>>,
}

impl PipFrameState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<PipFrameSink>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Points the shell at this webview's channel. A re-registration (reload,
    /// React re-mount) replaces the previous sink.
    pub fn register(&self, token: String, channel: Channel<Vec<u8>>) -> Result<(), String> {
        *self.lock() = Some(PipFrameSink { token, channel });
        Ok(())
    }

    /// Clears the sink only when it is still the one the caller registered, so
    /// a late unregister cannot unhook a newer registration.
    pub fn unregister(&self, token: &str) {
        let mut sink = self.lock();
        if sink.as_ref().is_some_and(|current| current.token == token) {
            *sink = None;
        }
    }

    /// Forwards one frame. A closed window drops the frame instead of failing
    /// the invoke that sent it.
    pub fn forward(&self, bytes: Vec<u8>) -> Result<(), String> {
        if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES {
            return Err("call-pip frame rejected: invalid size".to_string());
        }
        let sink = self.lock();
        let Some(sink) = sink.as_ref() else {
            // No window is listening: the main window will try again next tick.
            return Ok(());
        };
        sink.channel.send(bytes).map_err(|error| error.to_string())
    }

    /// Forgets the channel when the window goes away.
    pub fn clear(&self) {
        *self.lock() = None;
    }
}

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
///
/// Returns the surface the session got: `Dock` on Wayland, where no window is
/// created and the in-app dock stays the floating surface.
pub fn open(app: &AppHandle, width: f64, height: f64) -> tauri::Result<PipSurface> {
    if display_mode() == PipSurface::Dock {
        return Ok(PipSurface::Dock);
    }
    if let Some(existing) = app.get_webview_window(LABEL) {
        existing.show()?;
        existing.set_focus()?;
        return Ok(PipSurface::Window);
    }
    let config_dir = app.path().app_config_dir().ok();
    let saved = config_dir.as_deref().and_then(pip_geometry::read_geometry);
    let (width, height) = match saved {
        Some(geometry) => clamp_size(geometry.width, geometry.height),
        None => clamp_size(width, height),
    };
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(ENTRY.into()))
        .title("Aulora call")
        .inner_size(width, height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .max_inner_size(MAX_WIDTH, MAX_HEIGHT)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        // Opaque on purpose: a transparent window has to be click-through-free
        // only in its content, and a transparent margin would swallow clicks
        // meant for the app underneath. The rounded corner is CSS.
        .shadow(true)
        .focusable(true)
        .visible(false)
        // A small window that must keep painting while the app window has the
        // user's attention; throttling would freeze the picture.
        .background_throttling(BackgroundThrottlingPolicy::Disabled);
    // `skip_taskbar` has no macOS implementation; asking anyway is noise.
    if !cfg!(target_os = "macos") {
        builder = builder.skip_taskbar(true);
    }
    let window = builder.build()?;
    // Placement is cosmetic: a window the window manager put somewhere is still
    // usable, and on Wayland the compositor may ignore the request entirely.
    match saved {
        Some(geometry) => {
            let _ = restore_placement(&window, geometry);
        }
        None => {
            let _ = place(&window, width, height);
        }
    }
    install_hooks(app, &window);
    window.show()?;
    window.set_focus()?;
    Ok(PipSurface::Window)
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
    let _ = app.emit_to(MAIN_LABEL, CLOSED_EVENT, ());
}

/// Snaps the window to the nearest edge and saves where it ended up. Called by
/// the debounced drag handler and by the web client's `snap_pip_window`.
pub fn snap_now(window: &WebviewWindow) {
    let config_dir = window.app_handle().path().app_config_dir().ok();
    let _ = snap_and_save(window, config_dir.as_deref());
}

/// Resizes the window from the web client, clamped by the shell.
pub fn resize(window: &WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    let (width, height) = clamp_size(width, height);
    window.set_size(tauri::LogicalSize::new(width, height))
}

/// Watches the window's movement and closing: the geometry is saved after the
/// user stops dragging (debounced) and again when the window is closed.
fn install_hooks(app: &AppHandle, window: &WebviewWindow) {
    let config_dir = app.path().app_config_dir().ok();
    let generation = Arc::new(AtomicU64::new(0));
    let target = window.clone();
    let settle = Arc::clone(&generation);
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_settle(&target, Arc::clone(&settle), config_dir.clone());
        }
        WindowEvent::CloseRequested { .. } => {
            let _ = save_geometry(&target, config_dir.as_deref());
        }
        _ => {}
    });
}

/// Runs the snap-and-save once the window has been still for a moment. The
/// generation counter makes the last event win without timers piling up.
fn schedule_settle(
    window: &WebviewWindow,
    generation: Arc<AtomicU64>,
    config_dir: Option<PathBuf>,
) {
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(SETTLE_MILLIS));
        if generation.load(Ordering::SeqCst) != mine {
            return;
        }
        let app = window.app_handle().clone();
        let _ = app.run_on_main_thread(move || {
            let _ = snap_and_save(&window, config_dir.as_deref());
        });
    });
}

/// Snaps the window when it is near an edge and always saves its geometry.
fn snap_and_save(window: &WebviewWindow, config_dir: Option<&Path>) -> Option<PipGeometry> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let monitor = window.current_monitor().ok().flatten()?;
    let area = monitor.work_area();
    let snapped =
        pip_geometry::snap_to_edges(position, size, area.position, area.size, SNAP_THRESHOLD);
    if snapped != position {
        let _ = window.set_position(snapped);
    }
    let scale = monitor.scale_factor();
    let logical = size.to_logical::<f64>(scale);
    let geometry = PipGeometry {
        x: snapped.x,
        y: snapped.y,
        width: logical.width,
        height: logical.height,
    };
    if let Some(dir) = config_dir {
        let _ = pip_geometry::write_geometry(dir, &geometry);
    }
    Some(geometry)
}

/// Saves the current geometry without snapping.
fn save_geometry(window: &WebviewWindow, config_dir: Option<&Path>) -> Option<PipGeometry> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let logical = size.to_logical::<f64>(scale);
    let geometry = PipGeometry {
        x: position.x,
        y: position.y,
        width: logical.width,
        height: logical.height,
    };
    if let Some(dir) = config_dir {
        let _ = pip_geometry::write_geometry(dir, &geometry);
    }
    Some(geometry)
}

/// Restores a remembered position into the work area that is there now. The
/// remembered point picks the monitor, so a window on a second screen comes
/// back to that screen unless the screen is gone.
fn restore_placement(window: &WebviewWindow, geometry: PipGeometry) -> tauri::Result<()> {
    let monitor = window
        .monitor_from_point(geometry.x as f64, geometry.y as f64)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return place(window, geometry.width, geometry.height);
    };
    let scale = monitor.scale_factor();
    let size = PhysicalSize::new(
        (geometry.width * scale).round() as u32,
        (geometry.height * scale).round() as u32,
    );
    let area = monitor.work_area();
    window.set_position(pip_geometry::clamp_to_area(
        PhysicalPosition::new(geometry.x, geometry.y),
        size,
        area.position,
        area.size,
    ))
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
    let main = window.app_handle().get_webview_window(MAIN_LABEL);
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

    #[test]
    fn reports_a_dock_only_on_wayland() {
        // The environment of a test runner is not a Wayland session, and the
        // detection must not invent one.
        if !is_wayland() {
            assert_eq!(display_mode(), PipSurface::Window);
        } else {
            assert_eq!(display_mode(), PipSurface::Dock);
        }
        assert!(matches!(display_mode().as_str(), "window" | "dock"));
    }

    #[test]
    fn frame_state_rejects_an_empty_or_oversized_frame() {
        let state = PipFrameState::default();
        assert!(state.forward(Vec::new()).is_err());
        assert!(state.forward(vec![0u8; MAX_FRAME_BYTES + 1]).is_err());
    }

    #[test]
    fn frame_state_accepts_a_frame_with_no_listener() {
        // The call window may not have registered yet; the main window's next
        // tick retries instead of failing loudly.
        let state = PipFrameState::default();
        assert!(state.forward(vec![1, 2, 3]).is_ok());
    }
}
