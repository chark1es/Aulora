//! Native application menu (macOS only).
//!
//! macOS expects a menu bar with the app submenu (About/Services/Hide/Quit),
//! and the File/View entries give the desktop commands real accelerators. On
//! Windows and Linux Aulora installs no menu bar at all, like Slack, Discord and
//! Teams: the same commands live in the tray menu and in the webview's keyboard
//! shortcuts (`apps/web/src/lib/use-desktop-shortcuts.ts`).

#[cfg(target_os = "macos")]
mod macos {
    use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, Submenu, SubmenuBuilder};
    use tauri::{App, AppHandle, Emitter, Runtime};

    /// The accelerator the webview binds for the same command on Windows/Linux.
    const TOGGLE_SIDEBAR_ACCELERATOR: &str = "CmdOrCtrl+Shift+D";

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
        let toggle_sidebar = MenuItem::with_id(
            app,
            "toggle_sidebar",
            "Toggle Sidebar",
            true,
            Some(TOGGLE_SIDEBAR_ACCELERATOR),
        )?;
        SubmenuBuilder::new(app, "View")
            .item(&quick_switcher)
            .item(&toggle_sidebar)
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

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_toggle_sidebar_accelerator_matches_the_web_shortcut() {
            // The webview binds Ctrl+Shift+D on Windows/Linux (Slack's binding);
            // on macOS the same combination is ⌘⇧D through `CmdOrCtrl`.
            assert_eq!(TOGGLE_SIDEBAR_ACCELERATOR, "CmdOrCtrl+Shift+D");
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

/// No window menu bar on Windows or Linux: modern desktop chat apps ship none,
/// and the commands stay reachable from the tray and the webview shortcuts.
#[cfg(not(target_os = "macos"))]
pub fn install<R: tauri::Runtime>(_app: &tauri::App<R>) -> tauri::Result<()> {
    Ok(())
}
