//! Aulora desktop shell.
//!
//! A thin Tauri 2 host around the web client. It owns the native surface
//! (menus, tray, notifications, unread badge, deep links and macOS vibrancy)
//! while the React app in the main webview stays the single client. The call
//! picture-in-picture window is a second webview loading the same bundle at a
//! dedicated entry; see `pip_window`.
//!
//! Security posture: the webview loads only bundled assets, the CSP forbids
//! remote code, and every native capability is a narrowly-scoped command.

mod capture;
mod capture_audio;
mod commands;
mod deep_link;
mod menu;
mod pip_window;
mod tray;
mod updater;
mod window;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::Manager;

/// Auto-answers the permission requests the bundled client makes in its own
/// main webview. Answering `Default` hands the request to the web engine, which
/// draws a prompt naming the bundle's internal origin (`tauri://localhost` on
/// macOS/Linux, `http://tauri.localhost` on Windows). That origin is an
/// implementation detail the person never sees anywhere else, so every kind the
/// client actually uses is answered here instead: capture (microphone, camera,
/// screen), notification display, clipboard reads (the connect screen's paste
/// button), autoplay for call and notification audio, and repeated attachment
/// downloads.
///
/// Every other kind is denied rather than deferred: the client does not use
/// those APIs, and a dialog would only leak the origin. The OS-level prompt (the
/// macOS microphone/camera TCC dialog) is the native one and is untouched.
///
/// The call picture-in-picture webview plays what the main webview captured and
/// asks for nothing, so it keeps the engine's default answer.
fn permission_response<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    if webview.label() != "main" {
        return PermissionResponse::Default;
    }
    match kind {
        PermissionKind::Microphone
        | PermissionKind::Camera
        | PermissionKind::DisplayCapture
        | PermissionKind::Notifications
        | PermissionKind::ClipboardRead
        | PermissionKind::Autoplay
        | PermissionKind::AutomaticDownloads => PermissionResponse::Allow,
        _ => PermissionResponse::Deny,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered before every other plugin. With the
    // `deep-link` feature, `aulora://` launches from a second process are
    // forwarded to the running instance's `on_open_url` handler.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            deep_link::focus_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .on_permission_request(|webview, kind| permission_response(&webview, kind))
        .manage(deep_link::DeepLinkState::default())
        .manage(updater::AppUpdateState::default())
        .manage(capture_audio::AudioCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_always_on_top,
            commands::open_pip_window,
            commands::close_pip_window,
            commands::is_pip_window_open,
            commands::focus_main_window,
            commands::toggle_fullscreen,
            commands::set_unread_badge,
            commands::show_notification,
            commands::open_external,
            commands::take_deep_links,
            commands::list_capture_sources,
            commands::capture_source_frame,
            commands::screen_capture_permission,
            commands::open_capture_permission_settings,
            commands::system_audio_support,
            commands::start_audio_capture,
            commands::stop_audio_capture,
            updater::app_version,
            updater::check_for_app_update,
            updater::download_app_update,
            updater::install_app_update,
        ])
        .setup(|app| {
            // The updater plugin reads the pubkey and endpoints from the
            // Tauri context, which is only available once the app is built.
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            menu::install(app)?;
            tray::install(app)?;
            window::configure(app)?;
            deep_link::register(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Aulora desktop shell")
        .run(|app, event| {
            // Closing the last window keeps the app in the tray/menu bar on
            // desktop; quitting goes through the app/tray Quit items.
            match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                // The call window closing never ends the call: the main window
                // keeps the peer connections and the media, and only needs to
                // stop claiming the call is floating. A control inside the PiP
                // window, the main window's own call UI and this event all end
                // up in the same place.
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Destroyed,
                    ..
                } if label == pip_window::LABEL => {
                    pip_window::emit_closed(app);
                }
                // A Dock click on macOS reopens the app and focuses the window.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                } => {
                    deep_link::focus_main_window(app);
                }
                _ => {}
            }
        });
}
