//! Native application menu.
//!
//! The macOS app submenu carries the standard entries; File/View expose the
//! two desktop-specific commands. Cmd+K is a real accelerator that emits a
//! shell event the webview turns into its quick switcher.

use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, Submenu, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Runtime};

fn build_app_submenu<R: Runtime>(app: &App<R>) -> tauri::Result<Submenu<R>> {
    let check_updates = MenuItem::with_id(
        app,
        "check_for_updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    SubmenuBuilder::new(app, "Aulora")
        .about(None)
        .separator()
        .item(&check_updates)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

fn build_file_submenu<R: Runtime>(app: &App<R>) -> tauri::Result<Submenu<R>> {
    let connect = MenuItem::with_id(
        app,
        "connect_server",
        "Connect to Server…",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    SubmenuBuilder::new(app, "File")
        .item(&connect)
        .separator()
        .close_window()
        .build()
}

fn build_view_submenu<R: Runtime>(app: &App<R>) -> tauri::Result<Submenu<R>> {
    let quick_switcher = MenuItem::with_id(
        app,
        "quick_switcher",
        "Quick Switcher",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    SubmenuBuilder::new(app, "View")
        .item(&quick_switcher)
        .text("toggle_sidebar", "Toggle Sidebar")
        .separator()
        .fullscreen()
        .build()
}

fn build_menu<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let about = build_app_submenu(app)?;
    let file = build_file_submenu(app)?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = build_view_submenu(app)?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&about, &file, &edit, &view, &window])
        .build()
}

fn dispatch_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().0.as_str() {
        "check_for_updates" => crate::updater::spawn_menu_check(app),
        "connect_server" => {
            let _ = app.emit("aulora://deep-link", vec![String::from("aulora://connect")]);
        }
        "quick_switcher" => {
            let _ = app.emit("aulora://quick-switcher", ());
        }
        "toggle_sidebar" => {
            let _ = app.emit("aulora://toggle-sidebar", ());
        }
        _ => {}
    }
}

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    app.set_menu(build_menu(app)?)?;

    app.on_menu_event(|app, event| dispatch_menu_event(app, event));

    Ok(())
}
