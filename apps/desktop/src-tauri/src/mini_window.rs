//! The call picture-in-picture window.
//!
//! The call lives in the main webview (its peer connections and media cannot be
//! handed to a second one), so picture-in-picture is the main window itself
//! shrunk to a small window in the corner of the screen. This module only
//! remembers and restores the window's geometry; what to draw inside it, and
//! whether it floats above other windows, is decided by the web client.

use std::sync::Mutex;

use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Must match `minWidth` / `minHeight` in `tauri.conf.json`: the main window's
/// minimum size is lowered while it is a PiP window and put back afterwards.
/// `bun run verify` in `apps/desktop` fails if they drift apart.
const MAIN_MIN_WIDTH: f64 = 900.0;
const MAIN_MIN_HEIGHT: f64 = 600.0;

/// The smallest a PiP window may be, and the range the web client may ask for.
const MINI_MIN_WIDTH: f64 = 240.0;
const MINI_MIN_HEIGHT: f64 = 160.0;
const MINI_MAX_WIDTH: f64 = 800.0;
const MINI_MAX_HEIGHT: f64 = 600.0;

/// Space kept between the PiP window and the screen edge, in logical pixels.
const SCREEN_MARGIN: f64 = 20.0;

#[derive(Clone, Copy)]
struct SavedGeometry {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    maximized: bool,
    fullscreen: bool,
}

/// The main window's geometry from before it became a PiP window.
#[derive(Default)]
pub struct MiniWindowState(Mutex<Option<SavedGeometry>>);

impl MiniWindowState {
    pub fn is_active(&self) -> bool {
        self.0.lock().map(|saved| saved.is_some()).unwrap_or(false)
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
        pick(width, MINI_MIN_WIDTH, MINI_MAX_WIDTH),
        pick(height, MINI_MIN_HEIGHT, MINI_MAX_HEIGHT),
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

/// Shrinks the window into the bottom-right corner of the screen it is on.
pub fn enter(
    window: &WebviewWindow,
    state: &MiniWindowState,
    width: f64,
    height: f64,
) -> tauri::Result<()> {
    let (width, height) = clamp_size(width, height);
    {
        let mut saved = state.0.lock().expect("mini window state poisoned");
        // Entering twice must not overwrite the real geometry with the small one.
        if saved.is_none() {
            *saved = Some(SavedGeometry {
                size: window.outer_size()?,
                position: window.outer_position()?,
                maximized: window.is_maximized()?,
                fullscreen: window.is_fullscreen()?,
            });
        }
    }
    if window.is_fullscreen()? {
        window.set_fullscreen(false)?;
    }
    if window.is_maximized()? {
        window.unmaximize()?;
    }
    window.set_min_size(Some(LogicalSize::new(MINI_MIN_WIDTH, MINI_MIN_HEIGHT)))?;
    window.set_size(LogicalSize::new(width, height))?;
    if let Some(monitor) = window.current_monitor()? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let size = window.outer_size()?;
        let target = corner_position(
            area.position,
            area.size,
            size,
            (SCREEN_MARGIN * scale).round() as i32,
        );
        window.set_position(target)?;
    }
    Ok(())
}

/// Puts the window back the way it was. A no-op when it is not a PiP window.
pub fn exit(window: &WebviewWindow, state: &MiniWindowState) -> tauri::Result<()> {
    let saved = state.0.lock().expect("mini window state poisoned").take();
    let Some(saved) = saved else {
        return Ok(());
    };
    window.set_min_size(Some(LogicalSize::new(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT)))?;
    window.set_size(saved.size)?;
    window.set_position(saved.position)?;
    if saved.maximized {
        window.maximize()?;
    }
    if saved.fullscreen {
        window.set_fullscreen(true)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_a_requested_size_into_range() {
        assert_eq!(clamp_size(10.0, 10.0), (MINI_MIN_WIDTH, MINI_MIN_HEIGHT));
        assert_eq!(
            clamp_size(5000.0, 5000.0),
            (MINI_MAX_WIDTH, MINI_MAX_HEIGHT)
        );
        assert_eq!(clamp_size(360.0, 240.0), (360.0, 240.0));
    }

    #[test]
    fn rejects_a_size_that_is_not_a_number() {
        assert_eq!(
            clamp_size(f64::NAN, f64::INFINITY),
            (MINI_MIN_WIDTH, MINI_MIN_HEIGHT)
        );
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
    fn a_fresh_state_is_not_a_pip_window() {
        assert!(!MiniWindowState::default().is_active());
    }
}
