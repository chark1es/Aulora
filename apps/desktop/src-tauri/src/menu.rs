//! Native application menu.
//!
//! The macOS app submenu carries the standard entries; File/View expose the
//! two desktop-specific commands. Cmd+K is a real accelerator that emits a
//! shell event the webview turns into its quick switcher.

use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{App, Emitter, Runtime};

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let about = SubmenuBuilder::new(app, "Aulora")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let connect = MenuItem::with_id(
        app,
        "connect_server",
        "Connect to Server…",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&connect)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let quick_switcher = MenuItem::with_id(
        app,
        "quick_switcher",
        "Quick Switcher",
        true,
        Some("CmdOrCtrl+K"),
    )?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&quick_switcher)
        .text("toggle_sidebar", "Toggle Sidebar")
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&about, &file, &edit, &view, &window])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| match event.id().0.as_str() {
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
    });

    Ok(())
}
