//! Signed application updates.
//!
//! The shell asks the release feed configured in `tauri.conf.json` whether a
//! newer build exists, then downloads and installs it. The feed is a static
//! `latest.json` on GitHub Releases. Artifacts are minisign-verified by the
//! updater plugin; the private key never ships in the app.

use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::Update;
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    pub update_available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub notes: Option<String>,
    pub error: Option<String>,
    pub downloaded: bool,
}

#[derive(Default)]
pub struct AppUpdateState(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnouncedUpdate {
    #[serde(flatten)]
    status: AppUpdateStatus,
    source: &'static str,
}

pub async fn check_status<R: Runtime>(app: &AppHandle<R>) -> AppUpdateStatus {
    let current_version = app.package_info().version.to_string();
    if let Ok(pending) = app.state::<AppUpdateState>().0.try_lock() {
        if let Some((update, _)) = pending.as_ref() {
            return available(update, current_version, true);
        }
    }
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            return idle(current_version, Some(error.to_string()));
        }
    };
    match updater.check().await {
        Ok(Some(update)) => available(&update, current_version, false),
        Ok(None) => idle(current_version, None),
        Err(error) => idle(
            current_version,
            Some(friendly_check_error(&error.to_string())),
        ),
    }
}

pub fn spawn_menu_check<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let status = check_status(&app).await;
        let _ = app.emit(
            "aulora://app-update",
            AnnouncedUpdate {
                status,
                source: "menu",
            },
        );
    });
}

#[tauri::command]
pub async fn check_for_app_update(app: AppHandle) -> AppUpdateStatus {
    check_status(&app).await
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn download_app_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppUpdateState>();
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update is already in progress.")?;
    if pending.is_some() {
        return Ok(());
    }
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Err("Aulora is already up to date.".into());
    };
    let handle = app.clone();
    let mut downloaded: usize = 0;
    // download() verifies the signature before returning bytes. Installation
    // stays behind the explicit restart command, including on Windows.
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk;
                let _ = handle.emit(
                    "aulora://app-update-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "contentLength": total,
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    *pending = Some((update, bytes));
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppUpdateState>();
    let pending = state
        .0
        .try_lock()
        .map_err(|_| "An update is already in progress.")?;
    let Some((update, bytes)) = pending.as_ref() else {
        return Err("Download the update before restarting.".into());
    };
    // Windows launches its installer and exits here; its default restart
    // option reopens the app. macOS and Linux restart after installation.
    update.install(bytes).map_err(|error| error.to_string())?;
    app.restart();
}

fn available(update: &Update, current_version: String, downloaded: bool) -> AppUpdateStatus {
    AppUpdateStatus {
        update_available: true,
        version: Some(update.version.clone()),
        current_version,
        notes: update.body.clone(),
        error: None,
        downloaded,
    }
}

fn idle(current_version: String, error: Option<String>) -> AppUpdateStatus {
    AppUpdateStatus {
        update_available: false,
        version: None,
        current_version,
        notes: None,
        error,
        downloaded: false,
    }
}

fn friendly_check_error(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("target") && lower.contains("not found") {
        return "No update is published for this platform yet.".into();
    }
    if lower.contains("404") || lower.contains("no published") {
        return "No update has been published yet.".into();
    }
    message.to_string()
}
