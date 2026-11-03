use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, EventTarget, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const EVENT: &str = "desktop-update-state";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    enabled: bool,
    current_version: String,
    phase: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    ready_to_install: bool,
    error: Option<String>,
}

pub struct UpdaterState {
    operation: tauri::async_runtime::Mutex<()>,
    snapshot: Mutex<Snapshot>,
    pending: Mutex<Option<(Update, Option<Arc<Vec<u8>>>)>>,
    pub token: String,
    cleanup_started: AtomicBool,
}

impl UpdaterState {
    pub fn new(version: String) -> Self {
        let enabled = !cfg!(debug_assertions) && std::env::var_os("EUREKA_DEV_URL").is_none();
        Self {
            operation: tauri::async_runtime::Mutex::new(()),
            snapshot: Mutex::new(Snapshot {
                enabled,
                current_version: version,
                phase: if enabled { "idle" } else { "disabled" }.into(),
                version: None,
                notes: None,
                downloaded_bytes: 0,
                total_bytes: None,
                ready_to_install: false,
                error: None,
            }),
            pending: Mutex::new(None),
            token: uuid::Uuid::new_v4().simple().to_string(),
            cleanup_started: AtomicBool::new(false),
        }
    }
    fn publish(&self, app: &tauri::AppHandle, change: impl FnOnce(&mut Snapshot)) -> Snapshot {
        let snapshot = {
            let mut value = self.snapshot.lock().unwrap();
            change(&mut value);
            value.clone()
        };
        let _ = app.emit_to(
            EventTarget::webview(crate::CONTENT_LABEL),
            EVENT,
            snapshot.clone(),
        );
        snapshot
    }
    fn fail(&self, app: &tauri::AppHandle, error: impl ToString) -> String {
        let error = error.to_string();
        self.publish(app, |s| {
            s.phase = "error".into();
            s.error = Some(error.clone());
        });
        error
    }
}

fn caller(webview: &tauri::Webview) -> Result<tauri::AppHandle, String> {
    let url = webview.url().map_err(|e| e.to_string())?;
    if webview.label() != crate::CONTENT_LABEL
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(8080)
    {
        return Err("Updates require the bundled Eureka content view.".into());
    }
    Ok(webview.app_handle().clone())
}

fn enabled(state: &UpdaterState) -> Result<(), String> {
    if !state.snapshot.lock().unwrap().enabled {
        return Err("Updates are disabled in development builds.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_update_state(webview: tauri::Webview) -> Result<Snapshot, String> {
    let app = caller(&webview)?;
    let snapshot = app.state::<UpdaterState>().snapshot.lock().unwrap().clone();
    Ok(snapshot)
}

#[tauri::command]
pub async fn desktop_update_check(webview: tauri::Webview) -> Result<Snapshot, String> {
    let app = caller(&webview)?;
    let state = app.state::<UpdaterState>();
    enabled(&state)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    *state.pending.lock().unwrap() = None;
    state.publish(&app, |s| {
        s.phase = "checking".into();
        s.error = None;
        s.version = None;
        s.notes = None;
        s.downloaded_bytes = 0;
        s.total_bytes = None;
        s.ready_to_install = false;
    });
    let before_exit = app.clone();
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(20))
            .restart_after_install(true)
            .on_before_exit(move || {
                before_exit
                    .state::<UpdaterState>()
                    .cleanup_started
                    .store(true, Ordering::SeqCst);
                crate::automation_browser::close_all(&before_exit);
                crate::save_window_preferences(&before_exit);
                crate::stop_sidecar(&before_exit);
            })
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    match result {
        Ok(Some(mut update)) => {
            // Check timeout is short; allow large complete installers time to download.
            update.timeout = Some(Duration::from_secs(30 * 60));
            if update.download_url.scheme() != "https" {
                return Err(state.fail(&app, "Update downloads must use HTTPS."));
            }
            let version = update.version.clone();
            let notes = update.body.clone();
            *state.pending.lock().unwrap() = Some((update, None));
            Ok(state.publish(&app, |s| {
                s.phase = "available".into();
                s.version = Some(version);
                s.notes = notes;
            }))
        }
        Ok(None) => Ok(state.publish(&app, |s| s.phase = "upToDate".into())),
        Err(error) => Err(state.fail(&app, error)),
    }
}

#[tauri::command]
pub async fn desktop_update_download(
    webview: tauri::Webview,
    version: String,
) -> Result<Snapshot, String> {
    let app = caller(&webview)?;
    let state = app.state::<UpdaterState>();
    enabled(&state)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let update = {
        let pending = state.pending.lock().unwrap();
        let (update, bytes) = pending.as_ref().ok_or("Check for an update first.")?;
        if update.version != version {
            return Err("The selected update is stale. Check again.".into());
        }
        if bytes.is_some() {
            return Ok(state.snapshot.lock().unwrap().clone());
        }
        update.clone()
    };
    state.publish(&app, |s| {
        s.phase = "downloading".into();
        s.error = None;
        s.downloaded_bytes = 0;
        s.total_bytes = None;
    });
    let mut downloaded = 0u64;
    let mut last = Instant::now();
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last.elapsed() >= Duration::from_millis(100) {
                    state.publish(&app, |s| {
                        s.downloaded_bytes = downloaded;
                        s.total_bytes = total;
                    });
                    last = Instant::now();
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            // download() verifies the signature before returning. Never mark unverified bytes ready.
            let size = bytes.len() as u64;
            *state.pending.lock().unwrap() = Some((update, Some(Arc::new(bytes))));
            Ok(state.publish(&app, |s| {
                s.phase = "downloaded".into();
                s.downloaded_bytes = size;
                s.total_bytes = Some(size);
                s.ready_to_install = true;
            }))
        }
        Err(error) => Err(state.fail(&app, error)),
    }
}

async fn drain(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post("http://127.0.0.1:8080/api/desktop-update")
        .header("x-eureka-update-token", &app.state::<UpdaterState>().token)
        .json(&serde_json::json!({ "action": action }))
        .send()
        .await
        .map_err(|_| "Could not verify that local tasks are idle. Installation was not started.")?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Invalid local update preparation response.")?;
    if !status.is_success() || body["ready"] != true {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Local update preparation failed.")
            .to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_install(
    webview: tauri::Webview,
    version: String,
) -> Result<Snapshot, String> {
    let app = caller(&webview)?;
    let state = app.state::<UpdaterState>();
    enabled(&state)?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let (update, bytes) = {
        let pending = state.pending.lock().unwrap();
        let (update, bytes) = pending.as_ref().ok_or("Download an update first.")?;
        if update.version != version {
            return Err("The selected update is stale. Check again.".into());
        }
        (
            update.clone(),
            bytes
                .clone()
                .ok_or("Download and verify the update first.")?,
        )
    };
    if let Err(error) = drain(&app, "prepare").await {
        let _ = drain(&app, "cancel").await;
        return Err(state.fail(&app, error));
    }
    state.cleanup_started.store(false, Ordering::SeqCst);
    state.publish(&app, |s| {
        s.phase = "installing".into();
        s.error = None;
    });
    // Windows exits on successful launch. Avoid blocking the UI thread during extraction.
    let result =
        tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_slice())).await;
    let error = match result {
        Ok(Ok(())) => return Ok(state.snapshot.lock().unwrap().clone()),
        Ok(Err(e)) => e.to_string(),
        Err(e) => e.to_string(),
    };
    if state.cleanup_started.load(Ordering::SeqCst) {
        let restore = app.clone();
        std::thread::spawn(move || crate::start_eureka(restore));
    } else {
        let _ = drain(&app, "cancel").await;
    }
    Err(state.fail(&app, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn development_build_cannot_install_updates() {
        let state = UpdaterState::new("0.8.8".into());
        assert!(enabled(&state).is_err());
        assert_eq!(state.snapshot.lock().unwrap().phase, "disabled");
        assert_eq!(state.token.len(), 32);
        assert!(state.pending.lock().unwrap().is_none());
    }
}
