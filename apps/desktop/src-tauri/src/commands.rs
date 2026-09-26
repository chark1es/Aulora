//! Frontend-callable commands. These are the only ways the webview can reach
//! native state; each one is narrow and validates its arguments.

use tauri::{State, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

use crate::deep_link::DeepLinkState;
use crate::keychain::KeychainState;

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

/// Reads a base64 record from the OS keychain, or `None` when absent.
#[tauri::command]
pub fn keychain_get(state: State<'_, KeychainState>, key: String) -> Result<Option<String>, String> {
    state.get(&key).map_err(|error| error.to_string())
}

/// Writes a base64 record to the OS keychain.
#[tauri::command]
pub fn keychain_set(
    state: State<'_, KeychainState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.set(&key, &value).map_err(|error| error.to_string())
}

/// Deletes a record from the OS keychain; a missing record is not an error.
#[tauri::command]
pub fn keychain_delete(state: State<'_, KeychainState>, key: String) -> Result<(), String> {
    state.delete(&key).map_err(|error| error.to_string())
}

/// Lists keychain keys, optionally filtered by prefix.
#[tauri::command]
pub fn keychain_list(
    state: State<'_, KeychainState>,
    prefix: Option<String>,
) -> Result<Vec<String>, String> {
    state
        .list(prefix.as_deref())
        .map_err(|error| error.to_string())
}
