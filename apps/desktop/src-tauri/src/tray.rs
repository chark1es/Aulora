//! System tray / menu-bar item.
//!
//! Closing the window hides it here; the tray offers reopen, connect, the quick
//! switcher, the sidebar toggle, update and quit on every platform.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Emitter, Runtime};

fn build_menu<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "tray_open", "Open Aulora", true, None::<&str>)?;
    let connect = MenuItem::with_id(
        app,
        "tray_connect",
        "Connect to Server…",
        true,
        None::<&str>,
    )?;
    let quick_switcher = MenuItem::with_id(
        app,
        "tray_quick_switcher",
        "Quick Switcher",
        true,
        None::<&str>,
    )?;
    let toggle_sidebar = MenuItem::with_id(
        app,
        "tray_toggle_sidebar",
        "Toggle Sidebar",
        true,
        None::<&str>,
    )?;
    let updates = MenuItem::with_id(
        app,
        "tray_updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit Aulora", true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &open,
            &connect,
            &quick_switcher,
            &toggle_sidebar,
            &updates,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Aulora")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_open" => crate::deep_link::focus_main_window(app),
            "tray_connect" => {
                let _ = app.emit("aulora://deep-link", vec![String::from("aulora://connect")]);
            }
            "tray_quick_switcher" => {
                let _ = app.emit("aulora://quick-switcher", ());
            }
            "tray_toggle_sidebar" => {
                let _ = app.emit("aulora://toggle-sidebar", ());
            }
            "tray_updates" => crate::updater::spawn_menu_check(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::deep_link::focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}
