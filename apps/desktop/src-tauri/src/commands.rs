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
