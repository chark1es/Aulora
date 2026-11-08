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
mod pip_geometry;
mod pip_window;
mod tray;
mod updater;
mod window;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::Manager;

/// Auto-allows the media and notification prompts the bundled client asks for
/// in its own main webview. The OS-level prompt (the macOS microphone/camera
/// TCC dialog) is the native one and is untouched; anything else keeps the
/// webview's default prompt.
fn permission_response<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    if webview.label() != "main" {
        return PermissionResponse::Default;
    }
    match kind {
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::Notifications => {
            PermissionResponse::Allow
        }
        _ => PermissionResponse::Default,
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
        .manage(pip_window::PipFrameState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_always_on_top,
            commands::open_pip_window,
            commands::pip_window_mode,
            commands::close_pip_window,
            commands::is_pip_window_open,
            commands::snap_pip_window,
            commands::set_pip_size,
            commands::register_pip_frames,
            commands::unregister_pip_frames,
            commands::push_pip_frame,
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
                    // No webview is left to receive frames; the main window's
                    // next push is a silent no-op until a new window registers.
                    app.state::<pip_window::PipFrameState>().clear();
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
