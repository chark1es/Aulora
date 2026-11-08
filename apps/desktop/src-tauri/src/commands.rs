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
/// Resolves `"window"` when an OS window is floating the call, and `"dock"` on
/// Wayland, where the in-app call dock stays the floating surface. Async
/// because building a webview from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn open_pip_window(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<&'static str, String> {
    pip_window::open(&app, width, height)
        .map(pip_window::PipSurface::as_str)
        .map_err(|error| error.to_string())
}

/// Which floating surface this desktop offers for a call.
#[tauri::command]
pub fn pip_window_mode() -> &'static str {
    pip_window::display_mode().as_str()
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

/// Remembers the call window's place when the user lets go, and snaps it to a
/// screen edge when it is close to one.
#[tauri::command]
pub fn snap_pip_window(window: WebviewWindow) -> Result<(), String> {
    if window.label() != pip_window::LABEL {
        return Err("snap_pip_window is only for the call window".to_string());
    }
    pip_window::snap_now(&window);
    Ok(())
}

/// Resizes the call window from the web client's own resize handles. The shell
/// clamps the size; a window manager may still refuse on a given compositor.
#[tauri::command]
pub fn set_pip_size(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if window.label() != pip_window::LABEL {
        return Err("set_pip_size is only for the call window".to_string());
    }
    pip_window::resize(&window, width, height).map_err(|error| error.to_string())
}

/// Points the shell at the call window's frame channel (the fallback transport
/// for webviews without a working loopback peer connection).
#[tauri::command]
pub fn register_pip_frames(
    webview: tauri::Webview,
    state: State<'_, pip_window::PipFrameState>,
    channel: Channel<Vec<u8>>,
    token: String,
) -> Result<(), String> {
    if webview.label() != pip_window::LABEL {
        return Err("register_pip_frames is only for the call window".to_string());
    }
    state.register(token, channel)
}

/// Forgets the frame channel again when the call window goes away or re-mounts.
#[tauri::command]
pub fn unregister_pip_frames(
    webview: tauri::Webview,
    state: State<'_, pip_window::PipFrameState>,
    token: String,
) -> Result<(), String> {
    if webview.label() != pip_window::LABEL {
        return Err("unregister_pip_frames is only for the call window".to_string());
    }
    state.unregister(&token);
    Ok(())
}

/// Forwards one raw JPEG frame from the main window to the call window. The
/// payload is the `InvokeBody::Raw` bytes, never base64 or JSON.
#[tauri::command]
pub fn push_pip_frame(
    webview: tauri::Webview,
    state: State<'_, pip_window::PipFrameState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if webview.label() != pip_window::MAIN_LABEL {
        return Err("push_pip_frame is only for the app window".to_string());
    }
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => state.forward(bytes.clone()),
        tauri::ipc::InvokeBody::Json(_) => {
            Err("push_pip_frame expects raw frame bytes".to_string())
        }
    }
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
///
/// The reply is a raw IPC body (a 16-byte header plus JPEG), so no base64 string
/// is built or parsed per frame.
#[tauri::command]
pub async fn capture_source_frame(
    source_id: String,
    max_width: u32,
    max_height: u32,
) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        capture::capture_frame_bytes(&source_id, max_width, max_height)
    })
    .await
    .map_err(|error| format!("Could not capture that source: {error}"))??;
    Ok(tauri::ipc::Response::new(bytes))
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
