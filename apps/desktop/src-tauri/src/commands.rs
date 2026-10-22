//! Frontend-callable commands. These are the only ways the webview can reach
//! native state; each one is narrow and validates its arguments.

use tauri::{State, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

use crate::deep_link::DeepLinkState;
use crate::mini_window::{self, MiniWindowState};

/// Pins or unpins the calling window above every other window (call PiP).
#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_always_on_top(on)
        .map_err(|error| error.to_string())
}

/// Shrinks the main window into a small picture-in-picture window for a call.
#[tauri::command]
pub fn enter_mini_window(
    window: WebviewWindow,
    state: State<'_, MiniWindowState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    mini_window::enter(&window, &state, width, height).map_err(|error| error.to_string())
}

/// Restores the main window after picture-in-picture. A no-op when it is not one.
#[tauri::command]
pub fn exit_mini_window(
    window: WebviewWindow,
    state: State<'_, MiniWindowState>,
) -> Result<(), String> {
    mini_window::exit(&window, &state).map_err(|error| error.to_string())
}

/// Whether the main window is currently a picture-in-picture window.
#[tauri::command]
pub fn is_mini_window(state: State<'_, MiniWindowState>) -> bool {
    state.is_active()
}

/// Toggles the calling window between fullscreen and its restored size.
/// Bound to F11 on Windows and Linux, where the shell has no menu bar.
#[tauri::command]
pub fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(!fullscreen)
        .map_err(|error| error.to_string())?;
    Ok(!fullscreen)
}

/// Updates the Dock/taskbar unread badge for the calling window.
#[tauri::command]
pub fn set_unread_badge(window: WebviewWindow, count: i64) -> Result<(), String> {
    crate::window::set_unread_badge(&window, count).map_err(|error| error.to_string())
}

/// Shows a native notification. The title/body are computed on the device.
#[tauri::command]
pub fn show_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

/// Opens an http(s) URL in the machine's default browser. The webview swallows
/// a `target="_blank"` link, so external links hand the URL to the shell.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(String::from("Only http and https links can be opened."));
    }
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let opened = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url.as_str()])
        .spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let opened = std::process::Command::new("xdg-open").arg(&url).spawn();
    opened.map(|_| ()).map_err(|error| error.to_string())
}

/// Returns deep links received before the webview subscribed, then clears them.
#[tauri::command]
pub fn take_deep_links(state: State<'_, DeepLinkState>) -> Vec<String> {
    state.take()
}
