//! Signed application updates.
//!
//! The shell asks the release feed configured in `tauri.conf.json` whether a
//! newer build exists, then downloads and installs it. The feed is a static
//! `latest.json` on GitHub Releases. Artifacts are minisign-verified by the
//! updater plugin; the private key never ships in the app.
//!
//! The static feed cannot be gated by a server, so rollout is a client-side
//! decision: an optional top-level `rollout` percentage in the same manifest
//! (default 100) hashes a persisted installation id into a stable bucket. A
//! device outside the percentage is told it is up to date. GitHub still serves
//! the artifacts to anyone who asks; this is staged delivery, not access
//! control.

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::Update;
use tauri_plugin_updater::UpdaterExt;

/// Percentage of devices allowed to see an update when the feed omits it.
const DEFAULT_ROLLOUT_PERCENT: u8 = 100;
const ROLLOUT_FULL_PERCENT: u8 = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    pub update_available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub notes: Option<String>,
    pub error: Option<String>,
    pub downloaded: bool,
    /// Release publish time as Unix seconds, when the feed provides one.
    pub pub_date: Option<i64>,
}

#[derive(Default)]
pub struct AppUpdateState(Mutex<Option<(Update, Vec<u8>)>>);

/// Reads the optional top-level `rollout` percentage from the release
/// manifest. Missing, malformed or non-finite values mean 100%, preserving the
/// current behavior for feeds that never set it.
fn rollout_percentage(raw: &serde_json::Value) -> u8 {
    raw.get("rollout")
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(0.0, f64::from(ROLLOUT_FULL_PERCENT)).round() as u8)
        .unwrap_or(DEFAULT_ROLLOUT_PERCENT)
}

/// FNV-1a over the stable installation id, mapped into 0..99. Kept local and
/// explicit so the bucket does not change with a Rust or crate upgrade.
fn rollout_bucket(client_id: &str) -> u8 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in client_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (hash % u64::from(ROLLOUT_FULL_PERCENT)) as u8
}

fn rollout_allows(percent: u8, client_id: &str) -> bool {
    percent >= ROLLOUT_FULL_PERCENT || rollout_bucket(client_id) < percent
}

fn generate_client_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{:x}", std::process::id())
}

/// A stable per-installation id used only for rollout bucketing. Persisted in
/// the app config directory; an unwritable directory falls back to a fresh
/// in-memory id rather than failing the update check.
fn update_client_id<R: Runtime>(app: &AppHandle<R>) -> String {
    let Ok(directory) = app.path().app_config_dir() else {
        return generate_client_id();
    };
    let path = directory.join("update-client-id");
    if let Ok(value) = std::fs::read_to_string(&path) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let id = generate_client_id();
    let _ = std::fs::create_dir_all(&directory);
    let _ = std::fs::write(&path, &id);
    id
}

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
        Ok(Some(update)) => {
            if rollout_allows(rollout_percentage(&update.raw_json), &update_client_id(app)) {
                available(&update, current_version, false)
            } else {
                // Staged rollout: this device's bucket is outside the release's
                // percentage, so it keeps reporting that it is current.
                idle(current_version, None)
            }
        }
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
    if !rollout_allows(
        rollout_percentage(&update.raw_json),
        &update_client_id(&app),
    ) {
        return Err("This update is still rolling out to other devices. Try again later.".into());
    }
    let handle = app.clone();
    let mut downloaded: usize = 0;
    // Emit progress coarsely instead of once per network chunk: the first
    // chunk always goes out, then at most every ~100 ms, plus the final one.
    // The download itself and the signature check are unchanged.
    let mut last_emit: Option<Instant> = None;
    // download() verifies the signature before returning bytes. Installation
    // stays behind the explicit restart command, including on Windows.
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk;
                let complete = matches!(total, Some(size) if downloaded as u64 >= size);
                let due = match last_emit {
                    None => true,
                    Some(at) => at.elapsed() >= Duration::from_millis(100),
                };
                if due || complete {
                    last_emit = Some(Instant::now());
                    let _ = handle.emit(
                        "aulora://app-update-progress",
                        serde_json::json!({
                            "downloaded": downloaded,
                            "contentLength": total,
                        }),
                    );
                }
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
        pub_date: update.date.map(|date| date.unix_timestamp()),
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
        pub_date: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollout_defaults_to_full_for_missing_or_malformed_values() {
        assert_eq!(rollout_percentage(&serde_json::json!({})), 100);
        assert_eq!(
            rollout_percentage(&serde_json::json!({ "rollout": "half" })),
            100
        );
        assert_eq!(
            rollout_percentage(&serde_json::json!({ "rollout": null })),
            100
        );
    }

    #[test]
    fn rollout_is_clamped_and_rounded() {
        assert_eq!(
            rollout_percentage(&serde_json::json!({ "rollout": 25 })),
            25
        );
        assert_eq!(
            rollout_percentage(&serde_json::json!({ "rollout": 12.6 })),
            13
        );
        assert_eq!(rollout_percentage(&serde_json::json!({ "rollout": -5 })), 0);
        assert_eq!(
            rollout_percentage(&serde_json::json!({ "rollout": 500 })),
            100
        );
    }

    #[test]
    fn buckets_are_deterministic_and_in_range() {
        for id in ["install-a", "install-b", "ünïcode", ""] {
            let bucket = rollout_bucket(id);
            assert!(bucket < 100);
            assert_eq!(bucket, rollout_bucket(id));
        }
        assert_ne!(rollout_bucket("install-a"), rollout_bucket("install-b"));
    }

    #[test]
    fn rollout_allows_everyone_at_full_and_nobody_at_zero() {
        for id in ["install-a", "install-b", "install-c", "install-d"] {
            assert!(rollout_allows(100, id));
            assert!(!rollout_allows(0, id));
        }
    }

    #[test]
    fn generated_client_ids_are_distinct() {
        assert_ne!(generate_client_id(), generate_client_id());
    }
}
