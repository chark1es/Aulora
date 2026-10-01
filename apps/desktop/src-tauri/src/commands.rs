//! Frontend-callable commands. These are the only ways the webview can reach
//! native state; each one is narrow and validates its arguments.

use tauri::{State, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

use crate::deep_link::DeepLinkState;

/// Pins or unpins the calling window above every other window (call PiP).
#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_always_on_top(on)
        .map_err(|error| error.to_string())
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

/// Returns deep links received before the webview subscribed, then clears them.
#[tauri::command]
pub fn take_deep_links(state: State<'_, DeepLinkState>) -> Vec<String> {
    state.take()
}
