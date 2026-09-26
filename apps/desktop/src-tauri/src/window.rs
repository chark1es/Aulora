//! Window polish: macOS vibrancy and the unread badge.

use tauri::{App, Runtime};

#[cfg(target_os = "macos")]
use tauri::Manager;

/// Applies the macOS Sidebar vibrancy behind the translucent rails. A no-op on
/// other platforms (window transparency is enabled only in the macOS config).
#[cfg(target_os = "macos")]
pub fn configure<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    use tauri::window::{Effect, EffectState, EffectsBuilder};

    if let Some(window) = app.get_webview_window("main") {
        window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::Active)
                .radius(12.0)
                .build(),
        )?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure<R: Runtime>(_app: &App<R>) -> tauri::Result<()> {
    Ok(())
}

/// Sets the unread badge. Windows has no count badge, so it uses a small
/// overlay icon while any unread message exists; macOS and Linux show the count.
#[cfg(windows)]
pub fn set_unread_badge<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    count: i64,
) -> tauri::Result<()> {
    use tauri::image::Image;

    if count <= 0 {
        return window.set_overlay_icon(None);
    }
    let icon = Image::from_bytes(include_bytes!("../assets/badge.png"))?;
    window.set_overlay_icon(Some(icon))
}

#[cfg(not(windows))]
pub fn set_unread_badge<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    count: i64,
) -> tauri::Result<()> {
    if count <= 0 {
        window.set_badge_count(None)
    } else {
        window.set_badge_count(Some(count))
    }
}
