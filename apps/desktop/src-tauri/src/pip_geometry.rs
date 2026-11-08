//! Geometry of the call picture-in-picture window: where it may sit, where it
//! snaps to, and what it remembers between calls.
//!
//! All of the arithmetic here is pure, so the placement rules are unit-tested
//! without creating a window. The shell only does the file I/O and the window
//! calls around them. A saved position is always re-clamped into the work area
//! it will be restored onto: monitors get unplugged, resolutions change and a
//! window remembered at the bottom-right of a screen that no longer exists must
//! still be reachable.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize};

/// The file name under the app config directory.
pub const GEOMETRY_FILE: &str = "pip-window.json";

/// How close an edge has to be, in physical pixels, to snap to it.
pub const SNAP_THRESHOLD: i32 = 24;

/// A remembered window position (physical pixels) and size (logical pixels).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PipGeometry {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
}

/// The file a geometry is stored in, inside the app config directory.
pub fn geometry_path(config_dir: &Path) -> PathBuf {
    config_dir.join(GEOMETRY_FILE)
}

/// Reads the remembered geometry, or `None` when there is none or it is
/// unusable. A corrupt file must never stop the window from opening.
pub fn read_geometry(config_dir: &Path) -> Option<PipGeometry> {
    let raw = fs::read_to_string(geometry_path(config_dir)).ok()?;
    let geometry: PipGeometry = serde_json::from_str(&raw).ok()?;
    let usable = geometry.width.is_finite()
        && geometry.height.is_finite()
        && geometry.width > 0.0
        && geometry.height > 0.0
        && geometry.width < 10_000.0
        && geometry.height < 10_000.0;
    usable.then_some(geometry)
}

/// Writes the geometry, creating the config directory. The temporary file and
/// rename keep a half-written file from ever being read back.
pub fn write_geometry(config_dir: &Path, geometry: &PipGeometry) -> io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let path = geometry_path(config_dir);
    let temporary = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(geometry)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(&temporary, serialized)?;
    fs::rename(&temporary, &path)
}

/// Moves a wanted position inside a work area. A window larger than the area
/// starts at the area's origin instead of off-screen.
pub fn clamp_to_area(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    area_position: PhysicalPosition<i32>,
    area_size: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let max_x = area_position.x + area_size.width as i32 - size.width as i32;
    let max_y = area_position.y + area_size.height as i32 - size.height as i32;
    PhysicalPosition::new(
        position
            .x
            .clamp(area_position.x, max_x.max(area_position.x)),
        position
            .y
            .clamp(area_position.y, max_y.max(area_position.y)),
    )
}

/// Pulls a position to the nearest screen edge on each axis when it is within
/// `threshold` of it. Edges are matched independently, so an inner corner snaps
/// on both axes.
pub fn snap_to_edges(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    area_position: PhysicalPosition<i32>,
    area_size: PhysicalSize<u32>,
    threshold: i32,
) -> PhysicalPosition<i32> {
    let left = area_position.x;
    let right = (area_position.x + area_size.width as i32 - size.width as i32).max(left);
    let top = area_position.y;
    let bottom = (area_position.y + area_size.height as i32 - size.height as i32).max(top);
    let x = if (position.x - left).abs() <= threshold {
        left
    } else if (position.x - right).abs() <= threshold {
        right
    } else {
        position.x
    };
    let y = if (position.y - top).abs() <= threshold {
        top
    } else if (position.y - bottom).abs() <= threshold {
        bottom
    } else {
        position.y
    };
    PhysicalPosition::new(x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
        (PhysicalPosition::new(0, 25), PhysicalSize::new(1920, 1055))
    }

    fn size() -> PhysicalSize<u32> {
        PhysicalSize::new(360, 240)
    }

    #[test]
    fn clamps_a_restored_position_into_the_work_area() {
        let (origin, extent) = area();
        assert_eq!(
            clamp_to_area(PhysicalPosition::new(5000, -300), size(), origin, extent),
            PhysicalPosition::new(1560, 25)
        );
    }

    #[test]
    fn clamps_a_second_monitor_that_starts_left_of_the_origin() {
        assert_eq!(
            clamp_to_area(
                PhysicalPosition::new(-5000, 100),
                size(),
                PhysicalPosition::new(-1280, 0),
                PhysicalSize::new(1280, 800),
            ),
            PhysicalPosition::new(-1280, 100)
        );
    }

    #[test]
    fn a_window_larger_than_the_area_starts_at_its_origin() {
        assert_eq!(
            clamp_to_area(
                PhysicalPosition::new(900, 900),
                PhysicalSize::new(2000, 2000),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(800, 600),
            ),
            PhysicalPosition::new(0, 0)
        );
    }

    #[test]
    fn snaps_only_what_is_close_enough_on_each_axis() {
        let (origin, extent) = area();
        // 10px from the right edge and 300px from the bottom: just the x moves.
        assert_eq!(
            snap_to_edges(
                PhysicalPosition::new(1550, 500),
                size(),
                origin,
                extent,
                SNAP_THRESHOLD,
            ),
            PhysicalPosition::new(1560, 500)
        );
        // Far from every edge: unchanged.
        assert_eq!(
            snap_to_edges(
                PhysicalPosition::new(700, 500),
                size(),
                origin,
                extent,
                SNAP_THRESHOLD,
            ),
            PhysicalPosition::new(700, 500)
        );
    }

    #[test]
    fn snaps_the_top_left_corner_on_both_axes() {
        let (origin, extent) = area();
        assert_eq!(
            snap_to_edges(
                PhysicalPosition::new(8, 30),
                size(),
                origin,
                extent,
                SNAP_THRESHOLD,
            ),
            PhysicalPosition::new(0, 25)
        );
    }

    #[test]
    fn snaps_to_the_bottom_right_corner() {
        let (origin, extent) = area();
        assert_eq!(
            snap_to_edges(
                PhysicalPosition::new(1565, 835),
                size(),
                origin,
                extent,
                SNAP_THRESHOLD,
            ),
            PhysicalPosition::new(1560, 840)
        );
    }

    #[test]
    fn remembers_geometry_across_a_restart() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- unit test: writes a fixture directory it creates and removes, never a security decision
        let dir = std::env::temp_dir().join(format!("aulora-pip-geometry-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let geometry = PipGeometry {
            x: 120,
            y: 240,
            width: 380.0,
            height: 292.0,
        };
        write_geometry(&dir, &geometry).expect("write");
        assert_eq!(read_geometry(&dir), Some(geometry));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_a_missing_or_corrupt_file() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- unit test: writes a fixture directory it creates and removes, never a security decision
        let dir = std::env::temp_dir().join(format!("aulora-pip-bad-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(read_geometry(&dir), None);
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(geometry_path(&dir), b"not json").expect("write");
        assert_eq!(read_geometry(&dir), None);
        fs::write(
            geometry_path(&dir),
            br#"{"x":0,"y":0,"width":-2,"height":10}"#,
        )
        .expect("write");
        assert_eq!(read_geometry(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_geometry_without_finite_size() {
        // nosemgrep: rust.lang.security.temp-dir.temp-dir -- unit test: writes a fixture directory it creates and removes, never a security decision
        let dir = std::env::temp_dir().join(format!("aulora-pip-nan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(
            geometry_path(&dir),
            br#"{"x":0,"y":0,"width":1e300,"height":10}"#,
        )
        .expect("write");
        assert_eq!(read_geometry(&dir), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
