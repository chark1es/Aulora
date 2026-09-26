//! System tray / menu-bar item.
//!
//! Closing the window hides it here; the tray offers reopen, connect and quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, Emitter, Runtime};

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray_open", "Open Aulora", true, None::<&str>)?;
    let connect = MenuItem::with_id(
        app,
        "tray_connect",
        "Connect to Server…",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit Aulora", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &connect,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Aulora")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_open" => crate::deep_link::focus_main_window(app),
            "tray_connect" => {
                let _ = app.emit("aulora://deep-link", vec![String::from("aulora://connect")]);
            }
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
