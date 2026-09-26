//! `aulora://` deep-link handling.
//!
//! On macOS the OS delivers URLs to the running app; on Windows and Linux a
//! second process is spawned with the URL as an argument, and the single
//! instance plugin forwards it to `on_open_url`. URLs that arrive before the
//! webview subscribes are buffered for the `take_deep_links` command so no
//! launch link is lost to a race.

use std::sync::Mutex;

use tauri::{App, AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Default)]
pub struct DeepLinkState {
    pending: Mutex<Vec<String>>,
}

impl DeepLinkState {
    pub fn push(&self, urls: Vec<String>) {
        let mut pending = self.pending.lock().unwrap_or_else(|poison| poison.into_inner());
        for url in urls {
            if !pending.contains(&url) {
                pending.push(url);
            }
        }
    }

    pub fn take(&self) -> Vec<String> {
        let mut pending = self.pending.lock().unwrap_or_else(|poison| poison.into_inner());
        std::mem::take(&mut *pending)
    }
}

pub fn register<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // The installer registers the scheme in release builds; in Windows debug
    // builds and on Linux it must be registered at runtime.
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    {
        if let Err(error) = app.deep_link().register_all() {
            eprintln!("aulora: deep-link scheme registration skipped: {error}");
        }
    }

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls: Vec<String> = event.urls().iter().map(|url| url.to_string()).collect();
        if let Some(state) = handle.try_state::<DeepLinkState>() {
            state.push(urls.clone());
        }
        focus_main_window(&handle);
        let _ = handle.emit("aulora://deep-link", urls);
    });

    // A launch that started on a deep link is buffered for the frontend to pull.
    if let Some(urls) = app.deep_link().get_current().ok().flatten() {
        let strings: Vec<String> = urls.iter().map(|url| url.to_string()).collect();
        if let Some(state) = app.try_state::<DeepLinkState>() {
            state.push(strings);
        }
    }

    Ok(())
}

/// Focuses (and restores) the main window, e.g. when a deep link or tray click
/// should surface the app.
pub fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
