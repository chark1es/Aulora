//! Aulora desktop shell.
//!
//! A thin Tauri 2 host around the web client. It owns the native surface
//! (menus, tray, notifications, unread badge, deep links and macOS vibrancy)
//! while the webview stays the single React app.
//!
//! Security posture: the webview loads only bundled assets, the CSP forbids
//! remote code, and every native capability is a narrowly-scoped command.

mod commands;
mod deep_link;
mod menu;
mod mini_window;
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
        .manage(mini_window::MiniWindowState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_always_on_top,
            commands::enter_mini_window,
            commands::exit_mini_window,
            commands::is_mini_window,
            commands::toggle_fullscreen,
            commands::set_unread_badge,
            commands::show_notification,
            commands::open_external,
            commands::take_deep_links,
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
            // desktop; quitting goes through the app/tray Quit items. The same
            // path runs while the window is a call PiP window: hiding it leaves
            // the call (and its audio) running. The shell never resizes the
            // window back on hide, so reopening shows the same PiP window.
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
                // A Dock click on macOS reopens the app; restore whatever the
                // window was (normal or call PiP) and focus it.
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
