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
mod tray;
mod updater;
mod window;

use tauri::Manager;

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
        .manage(deep_link::DeepLinkState::default())
        .manage(updater::AppUpdateState::default())
        .invoke_handler(tauri::generate_handler![
            commands::set_always_on_top,
            commands::set_unread_badge,
            commands::show_notification,
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
            // desktop; quitting goes through the app/tray Quit items.
            if let tauri::RunEvent::WindowEvent { label, event, .. } = event {
                if label == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
            }
        });
}
