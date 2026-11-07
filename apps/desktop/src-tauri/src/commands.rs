//! Frontend-callable commands. These are the only ways the webview can reach
//! native state; each one is narrow and validates its arguments.

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{State, WebviewWindow};
use tauri_plugin_notification::NotificationExt;

use crate::capture;
use crate::capture_audio;
use crate::deep_link::DeepLinkState;
use crate::pip_window;

/// Pins or unpins the calling window above every other window (call dock).
#[tauri::command]
pub fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_always_on_top(on)
        .map_err(|error| error.to_string())
}

/// Opens the separate always-on-top call window, or focuses it when it is
/// already open. The main window keeps the call and stays as it is.
///
/// Async because building a webview from a synchronous command deadlocks on
/// Windows.
#[tauri::command]
pub async fn open_pip_window(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    pip_window::open(&app, width, height).map_err(|error| error.to_string())
}

/// Closes the call window. The call itself keeps running.
#[tauri::command]
pub fn close_pip_window(app: tauri::AppHandle) -> Result<(), String> {
    pip_window::close(&app).map_err(|error| error.to_string())
}

/// Whether the separate call window is open.
#[tauri::command]
pub fn is_pip_window_open(app: tauri::AppHandle) -> bool {
    pip_window::is_open(&app)
}

/// Shows and focuses the main window, e.g. from the call window's close button.
#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::deep_link::focus_main_window(&app);
    Ok(())
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

/// Lists the screens and windows the in-app share picker offers, each with a
/// tile. Enumerating windows and rendering their tiles takes long enough to
/// block, so it runs on a worker thread.
#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<capture::CaptureSource>, String> {
    tauri::async_runtime::spawn_blocking(capture::list_sources)
        .await
        .map_err(|error| format!("Could not list screens and windows: {error}"))?
}

/// Captures one frame of the chosen source, scaled to fit the requested box
/// (zero means no limit on that axis). The web client polls this while sharing.
#[tauri::command]
pub async fn capture_source_frame(
    source_id: String,
    max_width: u32,
    max_height: u32,
) -> Result<capture::CaptureFrame, String> {
    tauri::async_runtime::spawn_blocking(move || {
        capture::capture_frame(&source_id, max_width, max_height)
    })
    .await
    .map_err(|error| format!("Could not capture that source: {error}"))?
}

/// Reports whether the OS lets the shell read the screen, so the share picker
/// can ask for the permission instead of showing black frames. `request` also
/// asks macOS for its own Screen Recording prompt, which is what puts Aulora in
/// that settings pane; it blocks on the system dialog, hence the worker thread.
#[tauri::command]
pub async fn screen_capture_permission(
    request: bool,
) -> Result<capture::ScreenCapturePermission, String> {
    tauri::async_runtime::spawn_blocking(move || capture::screen_capture_permission(request))
        .await
        .map_err(|error| format!("Could not read the screen sharing permission: {error}"))
}

/// Opens the OS pane where screen recording is granted (macOS only).
#[tauri::command]
pub async fn open_capture_permission_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(capture::open_permission_settings)
        .await
        .map_err(|error| format!("Could not open System Settings: {error}"))?
}

/// Reports whether this platform can capture system audio, so the share picker
/// can offer the toggle with the right caveat (or not at all).
#[tauri::command]
pub fn system_audio_support() -> capture_audio::SystemAudioSupport {
    capture_audio::system_audio_support()
}

/// Starts streaming the machine's audio to the webview as 20 ms chunks of
/// interleaved f32 over `channel`, and returns the stream header. A backend
/// failure is reported as an error, and the share itself carries on without
/// audio.
#[tauri::command]
pub fn start_audio_capture(
    state: State<'_, capture_audio::AudioCaptureState>,
    channel: Channel<InvokeResponseBody>,
    source_id: Option<String>,
) -> Result<capture_audio::AudioStreamHeader, String> {
    state.start(
        move |samples: &[f32]| {
            channel
                .send(InvokeResponseBody::Raw(capture_audio::encode_f32le(
                    samples,
                )))
                .is_ok()
        },
        source_id.as_deref(),
    )
}

/// Stops the system audio capture. Safe when nothing is running.
#[tauri::command]
pub fn stop_audio_capture(state: State<'_, capture_audio::AudioCaptureState>) {
    state.stop();
}
