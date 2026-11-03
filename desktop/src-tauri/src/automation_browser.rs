//! A real child WebView: the OS renders and delivers input directly. No frames,
//! input events travel through Eureka's Node server. Explicit observation uses
//! a fixed read-only collector, and only sends its preview to a model on request.
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::{atomic::{AtomicU64, Ordering}, Mutex}, time::{Duration, Instant}};
use tauri::{webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder}, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl};
use crate::automation_accounts as accounts;
use crate::browser_overlay::Overlay;

#[derive(Default)]
pub struct BrowserState {
    operation: tauri::async_runtime::Mutex<()>,
    session: Mutex<Option<Session>>,
    // Browser-owned session cookies survive between runs. Parked views have
    // no task identity or control token and cannot be used by IPC commands.
    parked: Mutex<Vec<Session>>,
    next: AtomicU64,
}
struct Session {
    account_id: Option<String>,
    account_generation: u64,
    _account_lease: Option<std::fs::File>,
    control_token: Option<String>,
    control_sequence: u64,
    revision: u64,
    owner: String,
    id: String,
    label: String,
    initial_url: String,
    profile: PathBuf,
    touched: Instant,
    snapshot: Snapshot,
    ui_blocked: bool,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    controlled: bool,
    opened: bool,
    title: String,
    url: String,
    loading: bool,
    notice: Option<String>,
    zoom_percent: u16,
}
async fn sync_browser_zoom(view: &tauri::Webview, percent: Option<u16>) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        let result = (|| -> windows::core::Result<u16> {
            let controller = platform.controller();
            if let Some(percent) = percent { controller.SetZoomFactor(f64::from(percent) / 100.0)?; }
            let mut factor = 1.0; controller.ZoomFactor(&mut factor)?;
            Ok((factor * 100.0).round() as u16)
        })();
        let _ = tx.send(result.map_err(|_| ()));
    }).map_err(|_| "无法调整网页缩放")?;
    let actual = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(3))).await
        .map_err(|_| "无法读取网页缩放")?.map_err(|_| "读取网页缩放超时")?.map_err(|_| "无法调整网页缩放")?;
    let state = view.app_handle().state::<BrowserState>();
    let mut guard = state.session.lock().unwrap();
    if let Some(session) = guard.as_mut().filter(|s| s.label == view.label()) {
        if session.snapshot.zoom_percent != actual { session.revision += 1; }
        session.snapshot.zoom_percent = actual;
    }
    Ok(())
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64, y: f64, width: f64, height: f64,
    viewport_width: f64, viewport_height: f64,
}

fn destination(raw: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "请输入完整的 HTTP/HTTPS 网页地址")?;
    if raw.len() > 16_384 || !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("仅支持不含用户名密码的 HTTP/HTTPS 网页地址".into());
    }
    Ok(url)
}
fn display_url(url: &tauri::Url) -> String {
    // This snapshot is only returned to the authenticated local address bar.
    // Query/hash routes must remain visible; model observations use their own
    // redacted URL collector and never consume this snapshot.
    url.to_string()
}
fn trusted_caller(view: &tauri::Webview) -> bool {
    view.url().is_ok_and(|url| caller_allowed(view.label(), &url))
}
fn caller_allowed(label: &str, url: &tauri::Url) -> bool {
    label == crate::CONTENT_LABEL && url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(8080)
}
fn rect(bounds: &Bounds, width: f64, height: f64) -> Result<Rect, String> {
    let b = bounds;
    if [b.x, b.y, b.width, b.height, b.viewport_width, b.viewport_height, width, height].iter().any(|v| !v.is_finite())
        || b.x < 0.0 || b.y < 0.0 || b.width < 1.0 || b.height < 1.0
        || b.viewport_width < 1.0 || b.viewport_height < 1.0
        || b.x + b.width > b.viewport_width + 1.0 || b.y + b.height > b.viewport_height + 1.0
        || width <= 0.0 || height <= crate::TITLEBAR_HEIGHT {
        return Err("浏览器显示区域无效".into());
    }
    let sx = width / b.viewport_width;
    let sy = (height - crate::TITLEBAR_HEIGHT) / b.viewport_height;
    Ok(Rect {
        position: LogicalPosition::new(b.x * sx, crate::TITLEBAR_HEIGHT + b.y * sy).into(),
        size: LogicalSize::new(b.width * sx, b.height * sy).into(),
    })
}
fn update(app: &tauri::AppHandle, label: &str, change: impl FnOnce(&mut Snapshot)) {
    let state = app.state::<BrowserState>();
    let mut guard = state.session.lock().unwrap();
    if let Some(session) = guard.as_mut().filter(|s| s.label == label) { session.revision += 1; change(&mut session.snapshot); }
}
fn dispose(app: &tauri::AppHandle, session: Session) {
    if let Some(view) = app.get_webview(&session.label) {
        let _ = view.hide();
        if session.account_id.is_none() { let _ = view.clear_all_browsing_data(); }
        let _ = view.close();
    }
    if session.account_id.is_some() { return; } // Persistent profile is browser-owned; closing is not logout.
    // The path is generated here, never supplied by the webpage or frontend.
    let Ok(root) = app.path().app_cache_dir().map(|p| p.join("automation-webviews")) else { return };
    if session.profile.parent() != Some(root.as_path()) { return; }
    std::thread::spawn(move || {
        for _ in 0..20 {
            if std::fs::remove_dir_all(&session.profile).is_ok() || !session.profile.exists() { break; }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}
pub fn close_all(app: &tauri::AppHandle) {
    let state = app.state::<BrowserState>();
    let old = state.session.lock().unwrap().take();
    if let Some(session) = old { dispose(app, session); }
    let parked = std::mem::take(&mut *state.parked.lock().unwrap());
    for session in parked { dispose(app, session); }
}
fn park(app: &tauri::AppHandle, mut session: Session) {
    session.control_token = None;
    session.control_sequence = 0;
    session.snapshot.controlled = false;
    session.ui_blocked = true;
    session.id.clear();
    session.revision += 1;
    if session.account_id.is_some() {
        if let Some(view) = app.get_webview(&session.label) {
            if view.hide().is_ok() {
                // Only the verified Wry child is disabled. A hidden view keeps
                // native cookies; it never keeps an automation's authority.
                let main = view.window().hwnd().ok().map(|h| h.0 as usize);
                let callback_app = app.clone(); let label = session.label.clone();
                let _ = view.with_webview(move |platform| unsafe {
                    if callback_app.state::<BrowserState>().session.lock().unwrap().as_ref().is_some_and(|s| s.label == label) { return; }
                    use windows_sys::Win32::UI::{Input::KeyboardAndMouse::EnableWindow, WindowsAndMessaging::IsChild};
                    let mut parent = windows::Win32::Foundation::HWND::default();
                    if let Some(main) = main {
                        if platform.controller().ParentWindow(&mut parent).is_ok() && !parent.0.is_null()
                            && parent.0 as usize != main && IsChild(main as _, parent.0) != 0 { EnableWindow(parent.0, 0); }
                    }
                });
                app.state::<BrowserState>().parked.lock().unwrap().push(session);
                return;
            }
        }
    }
    dispose(app, session); // Explicit temporary environments still close/clear.
}
pub fn release_current(app: &tauri::AppHandle) {
    let old = app.state::<BrowserState>().session.lock().unwrap().take();
    if let Some(session) = old { park(app, session); }
}
fn close_current(app: &tauri::AppHandle) {
    let old = app.state::<BrowserState>().session.lock().unwrap().take();
    if let Some(session) = old { dispose(app, session); }
}
fn discard_parked(app: &tauri::AppHandle, predicate: impl Fn(&Session) -> bool) {
    let state = app.state::<BrowserState>();
    let removed = {
        let mut parked = state.parked.lock().unwrap();
        let mut removed = Vec::new();
        let mut i = 0;
        while i < parked.len() {
            if predicate(&parked[i]) { removed.push(parked.remove(i)); } else { i += 1; }
        }
        removed
    };
    for session in removed { dispose(app, session); }
}
fn account_items(app: &tauri::AppHandle, owner: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut items = accounts::list(app, owner)?;
    let state = app.state::<BrowserState>();
    let parked = state.parked.lock().unwrap();
    // The profile lease remains held while its WebView exists. Our own dormant
    // profiles can be managed under the operation lock using our lease; another
    // process's lease must still be reported busy.
    for item in &mut items {
        if parked.iter().any(|s| s.owner == owner && s.account_id.as_deref() == item["id"].as_str()) {
            item["inUse"] = false.into();
        }
    }
    Ok(items)
}
pub fn start_expiry(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let state = app.state::<BrowserState>();
        let _operation = state.operation.blocking_lock();
        let stale = {
            let mut guard = state.session.lock().unwrap();
            if guard.as_ref().is_some_and(|s| s.touched.elapsed() > Duration::from_secs(30)) { guard.take() } else { None }
        };
        if let Some(session) = stale { park(&app, session); }
    });
}

#[tauri::command]
pub async fn desktop_automation_browser(
    webview: tauri::Webview, action: String, owner: String, session_id: String,
    url: Option<String>, bounds: Option<Bounds>, account_id: Option<String>, temporary: Option<bool>,
    zoom_percent: Option<u16>,
    overlay: Option<Overlay>,
) -> Result<Snapshot, String> {
    if !trusted_caller(&webview) { return Err("仅 Eureka 本机界面可管理网站视图".into()); }
    if owner.len() != 64 || !owner.bytes().all(|c| c.is_ascii_hexdigit()) || !session_id.starts_with("automation:") || session_id.len() > 100 {
        return Err("浏览器会话无效".into());
    }
    let app = webview.app_handle().clone();
    let state = app.state::<BrowserState>();
    if overlay.as_ref().is_some_and(|overlay| !overlay.valid()) { return Err("弹层显示区域无效".into()); }
    if matches!(action.as_str(), "open" | "bounds") {
        if let Some(overlay) = &overlay {
            let mut guard = state.session.lock().unwrap();
            if let Some(s) = guard.as_mut().filter(|s| s.owner == owner && s.id == session_id) {
                let blocked = overlay.blocks_input();
                if s.ui_blocked != blocked { s.revision += 1; }
                s.ui_blocked = blocked;
                // Stop pending steps before waiting for an in-flight operation.
                if s.ui_blocked { s.control_token = None; }
            }
        }
    }
    let _operation = state.operation.lock().await;
    if temporary.unwrap_or(false) && account_id.is_some() { return Err("accountInvalid".into()); }
    let account_id = if temporary.unwrap_or(false) { None } else { Some(account_id.unwrap_or_else(|| accounts::DEFAULT_ID.into())) };
    let window = webview.window();
    // Windows can report a zero/tiny client area during minimization. Retain
    // the last valid child rectangle instead of failing the frontend layout loop.
    if action == "bounds" && window.is_minimized().unwrap_or(false) {
        return Ok(state.session.lock().unwrap().as_ref()
            .filter(|s| s.owner == owner && s.id == session_id)
            .map(|s| s.snapshot.clone()).unwrap_or_default());
    }
    if zoom_percent.is_some_and(|percent| !(25..=200).contains(&percent)) { return Err("网页缩放需在 25% 到 200% 之间".into()); }
    let area = if let Some(bounds) = bounds.as_ref() {
        let size = window.inner_size().map_err(|_| "无法读取窗口大小")?.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
        Some(rect(bounds, size.width, size.height)?)
    } else { None };

    if action == "open" {
        let raw = url.clone().ok_or("缺少网站地址")?;
        let target = destination(&raw)?;
        let area = area.clone().ok_or("缺少浏览器显示区域")?;
        let account = if let Some(id) = account_id.as_deref() {
            let (dir, account) = if id == accounts::DEFAULT_ID { accounts::ensure_default(&app, &owner)? } else { accounts::active(&app, &owner, id)? };
            if id != accounts::DEFAULT_ID && account.origin != target.origin().ascii_serialization() { return Err("accountSiteMismatch".into()); }
            Some((dir, account))
        } else { None };
        let account_generation = account.as_ref().map(|(_, a)| a.generation).unwrap_or(0);
        if state.session.lock().unwrap().as_ref().is_some_and(|s| s.owner == owner && account_id.as_deref().is_some_and(|id| id != accounts::DEFAULT_ID) && s.account_id == account_id && s.id != session_id) {
            return Err("accountBusy".into());
        }
        let reuse = state.session.lock().unwrap().as_ref().is_some_and(|s| s.owner == owner && s.id == session_id && s.initial_url == raw && s.account_id == account_id && s.account_generation == account_generation && app.get_webview(&s.label).is_some());
        if !reuse {
            release_current(&app);
            // Never transfer a live profile to another signed-in Eureka user,
            // nor revive a generation retired by clear-login/delete.
            discard_parked(&app, |s| s.owner != owner || app.get_webview(&s.label).is_none()
                || s.account_id == account_id && s.account_generation != account_generation);
            let cached = {
                let mut parked = state.parked.lock().unwrap();
                parked.iter().position(|s| s.owner == owner && account_id.is_some() && s.account_id == account_id
                    && s.account_generation == account_generation && app.get_webview(&s.label).is_some()).map(|i| parked.remove(i))
            };
            if let Some(mut session) = cached {
                let (dir, _) = account.as_ref().ok_or("accountMissing")?;
                let mut latest = match accounts::read(dir) { Ok(account) => account, Err(error) => { dispose(&app, session); return Err(error); } };
                if latest.deleted || latest.generation != account_generation { dispose(&app, session); return Err("accountMissing".into()); }
                latest.last_used_at = Some(accounts::now());
                if let Err(error) = accounts::write(dir, &latest) { park(&app, session); return Err(error); }
                session.id = session_id.clone();
                session.initial_url = raw;
                session.touched = Instant::now();
                session.ui_blocked = overlay.as_ref().is_some_and(Overlay::blocks_input);
                session.snapshot.notice = None;
                session.snapshot.loading = true;
                session.snapshot.url = display_url(&target);
                let label = session.label.clone();
                *state.session.lock().unwrap() = Some(session);
                let view = app.get_webview(&label).ok_or("accountNotOpen")?;
                if view.navigate(target).is_err() { release_current(&app); return Err("无法打开网站入口，请重试".into()); }
            } else {
            let n = state.next.fetch_add(1, Ordering::Relaxed);
            let label = format!("automation-browser-{}-{n}", std::process::id());
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
            let (profile, account_lease) = if let Some((dir, mut account)) = account {
                let lease = accounts::lease(&dir)?;
                // Re-read under the cross-process lease: reset/delete may have won the race.
                let latest = accounts::read(&dir)?;
                if latest.deleted || latest.generation != account.generation { return Err("accountMissing".into()); }
                account = latest;
                account.last_used_at = Some(accounts::now()); accounts::write(&dir, &account)?;
                (accounts::profile(&dir, account.generation), Some(lease))
            } else {
                let root = app.path().app_cache_dir().map_err(|_| "无法创建临时网站环境")?.join("automation-webviews");
                (root.join(format!("{}-{stamp}-{n}", std::process::id())), None)
            };
            std::fs::create_dir_all(&profile).map_err(|_| "无法创建临时网站环境")?;
            *state.session.lock().unwrap() = Some(Session {
                account_id: account_id.clone(), account_generation, _account_lease: account_lease,
                control_token: None, control_sequence: 0,
                ui_blocked: overlay.as_ref().is_some_and(Overlay::blocks_input),
                revision: 0,
                owner: owner.clone(), id: session_id.clone(), label: label.clone(), initial_url: raw,
                profile: profile.clone(), touched: Instant::now(),
                snapshot: Snapshot { controlled: false, opened: true, title: "网页".into(), url: display_url(&target), loading: true, notice: None, zoom_percent: 100 },
            });
            let nav_app = app.clone(); let nav_label = label.clone();
            let popup_app = app.clone(); let popup_label = label.clone();
            let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
                .data_directory(profile).incognito(account_id.is_none()).focused(false)
                // Use browser defaults for site networking and verification.
                .additional_browser_args("")
                .zoom_hotkeys_enabled(false)
                .on_navigation(move |url| {
                    let external_while_controlled = nav_app.state::<BrowserState>().session.lock().unwrap().as_ref().is_some_and(|s|
                        s.label == nav_label && s.snapshot.controlled && tauri::Url::parse(&s.snapshot.url).is_ok_and(|current| current.origin() != url.origin()));
                    let allowed = !external_while_controlled && (url.as_str() == "about:blank" || destination(url.as_str()).is_ok());
                    if external_while_controlled { update(&nav_app, &nav_label, |s| s.notice = Some("跨站跳转需要暂停 AI 后由你操作".into())); }
                    if allowed { update(&nav_app, &nav_label, |s| { s.url = display_url(url); s.loading = true; }); }
                    allowed
                })
                .on_page_load(|view, payload| update(view.app_handle(), view.label(), |s| { s.url = display_url(payload.url()); s.loading = payload.event() == PageLoadEvent::Started; }))
                .on_document_title_changed(|view, title| update(view.app_handle(), view.label(), |s| s.title = title.chars().take(200).collect()))
                .on_download(|view, _| { update(view.app_handle(), view.label(), |s| s.notice = Some("本阶段尚未开放网页文件下载".into())); false })
                .on_new_window(move |url, _| {
                    // First iteration keeps HTTP links in the same native view.
                    // No standalone Chrome and no privilege-bearing app WebView.
                    let current = popup_app.state::<BrowserState>().session.lock().unwrap().as_ref()
                        .filter(|s| s.label == popup_label).map(|s| (s.id.clone(), s.snapshot.controlled));
                    let Some((id, controlled)) = current else { return NewWindowResponse::Deny; };
                    if controlled { update(&popup_app, &popup_label, |s| s.notice = Some("弹出窗口需要暂停 AI 后由你操作".into())); }
                    else if destination(url.as_str()).is_ok() {
                        let app = popup_app.clone(); let label = popup_label.clone();
                        std::thread::spawn(move || {
                            if app.state::<BrowserState>().session.lock().unwrap().as_ref().is_some_and(|s| s.label == label && s.id == id && !s.snapshot.controlled) {
                                if let Some(view) = app.get_webview(&label) { let _ = view.navigate(url); }
                            }
                        });
                    } else { update(&popup_app, &popup_label, |s| s.notice = Some("该弹出页面暂不支持，请使用当前页完成操作".into())); }
                    NewWindowResponse::Deny
                });
            if window.add_child(builder, area.position, area.size).is_err() {
                close_all(&app); return Err("原生网站视图创建失败，请检查 WebView2 运行时".into());
            }
            }
            let enabled = account_id.as_deref().map(|id| accounts::active(&app, &owner, id).map(|(_, a)| a.password_autosave)).transpose()?.unwrap_or(false);
            let label = state.session.lock().unwrap().as_ref().ok_or("accountNotOpen")?.label.clone();
            let view = app.get_webview(&label).ok_or("accountNotOpen")?;
            if let Err(error) = set_password_autosave(&view, enabled).await { close_all(&app); return Err(error); }
        }
    }
    let label = {
        let mut guard = state.session.lock().unwrap();
        let Some(session) = guard.as_mut().filter(|s| s.owner == owner && s.id == session_id && s.account_id == account_id) else {
            return if matches!(action.as_str(), "close" | "hide" | "status") { Ok(Snapshot::default()) } else { Err("网站视图已关闭，请重新打开".into()) };
        };
        // Only authorization refreshes renew the lease; resize/status do not.
        if matches!(action.as_str(), "open" | "renew") { session.touched = Instant::now(); }
        if action == "open" && session.snapshot.controlled && zoom_percent.is_some_and(|percent| percent != session.snapshot.zoom_percent) { return Err("请先暂停 AI 再调整网页缩放".into()); }
        session.label.clone()
    };
    if action == "close" { release_current(&app); return Ok(Snapshot::default()); }
    if validate_account_session(&app, false).is_err() { close_all(&app); return Err("accountMissing".into()); }
    if matches!(action.as_str(), "navigate" | "back" | "forward" | "reload" | "zoom") && state.session.lock().unwrap().as_ref().is_some_and(|s| s.snapshot.controlled) {
        return Err("请先暂停 AI 并接管网页".into());
    }
    let view = app.get_webview(&label).ok_or("网站视图已关闭，请重新打开")?;
    let result = match action.as_str() {
        "open" | "bounds" => {
            if let Some(area) = area { view.set_bounds(area).map_err(|_| "无法调整网站显示区域")?; }
            if let (Some(overlay), Some(bounds)) = (overlay, bounds) {
                let controlled = state.session.lock().unwrap().as_ref().is_some_and(|s| s.label == label && s.snapshot.controlled);
                set_manual_input(&view, !controlled).await?;
                crate::browser_overlay::apply(&view, overlay, bounds.width, bounds.height).await?;
            }
            view.show()
        }
        "zoom" => { sync_browser_zoom(&view, Some(zoom_percent.ok_or("缺少缩放比例")?)).await?; Ok(()) }
        "hide" => view.hide(),
        "navigate" => view.navigate(destination(&url.ok_or("缺少网站地址")?)?),
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        "renew" | "status" => Ok(()),
        _ => return Err("不支持的浏览器操作".into()),
    };
    result.map_err(|_| "网站操作未完成，请重试")?;
    // History API and hash routing need not emit a full page-load event.
    // Read the committed top-level URL on the existing status/lease polls,
    // rather than returning only the last navigation callback's cached URL.
    if let Ok(current) = view.url() {
        let address = display_url(&current);
        let mut guard = state.session.lock().unwrap();
        if let Some(session) = guard.as_mut().filter(|s| s.label == label) {
            if session.snapshot.url != address {
                session.snapshot.url = address;
                session.revision += 1;
            }
        }
    }
    if matches!(action.as_str(), "open" | "status" | "renew") { sync_browser_zoom(&view, if action == "open" { zoom_percent } else { None }).await?; }
    let snapshot = state.session.lock().unwrap().as_ref().map(|s| s.snapshot.clone()).unwrap_or_default();
    Ok(snapshot)
}

fn observation_identity(app: &tauri::AppHandle, owner: &str, id: &str) -> Result<(tauri::Webview, String), String> {
    validate_account_session(app, false)?;
    use std::hash::{Hash, Hasher};
    let state = app.state::<BrowserState>();
    let (label, revision) = {
        let guard = state.session.lock().unwrap();
        let session = guard.as_ref().filter(|s| s.owner == owner && s.id == id && s.touched.elapsed() < Duration::from_secs(30))
            .ok_or("网站视图已关闭，请重新打开")?;
        if session.ui_blocked { return Err("请先关闭当前菜单或弹窗，再继续操作网页".into()); }
        if session.snapshot.loading { return Err("网页正在加载，请稍后重新读取".into()); }
        (session.label.clone(), session.revision)
    };
    let view = app.get_webview(&label).ok_or("网站视图已关闭，请重新打开")?;
    let url = view.url().map_err(|_| "无法读取页面身份")?;
    destination(url.as_str())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    url.as_str().hash(&mut hash);
    Ok((view, format!("{label}:{revision}:{:x}", hash.finish())))
}

async fn collect_page(view: &tauri::Webview) -> Result<serde_json::Value, String> {
    evaluate_page(view, include_str!("observe-page.js").into()).await
}

async fn evaluate_page(view: &tauri::Webview, script: String) -> Result<serde_json::Value, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    view.eval_with_callback(script, move |value| { let _ = tx.send(value); })
        .map_err(|_| "无法读取网页，请重新打开网站")?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(6))).await
        .map_err(|_| "读取网页失败")?.map_err(|_| "读取网页超时，请稍后重试")?;
    if raw.len() > 250_000 { return Err("页面内容过大，请缩小页面范围后重试".into()); }
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "页面未返回可读取内容")?;
    if !value.is_object() { return Err("页面未返回可读取内容".into()); }
    Ok(value)
}

fn consume_application_ticket(ticket: &str, payload: &str) -> Result<(), String> {
    use std::{io::{Read, Write}, net::{SocketAddr, TcpStream}};
    if ticket.len() != 64 || !ticket.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("网页派发凭证无效".into()); }
    let address: SocketAddr = "127.0.0.1:8080".parse().map_err(|_| "本机地址无效")?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|_| "本机网页授权服务未连接")?;
    stream.set_read_timeout(Some(Duration::from_secs(6))).map_err(|_| "网页授权读取失败")?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|_| "网页授权写入失败")?;
    let header = format!("POST /api/automation/browser-ticket HTTP/1.1\r\nHost: 127.0.0.1:8080\r\nContent-Type: application/json\r\nX-Eureka-Browser-Ticket: {ticket}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", payload.len());
    stream.write_all(header.as_bytes()).and_then(|_| stream.write_all(payload.as_bytes())).map_err(|_| "网页授权发送失败")?;
    let mut reply = Vec::new(); stream.take(4096).read_to_end(&mut reply).map_err(|_| "网页授权响应未知，本次不会重复派发")?;
    let text = String::from_utf8_lossy(&reply);
    if text.starts_with("HTTP/1.1 204 ") || text.starts_with("HTTP/1.0 204 ") { Ok(()) } else { Err("网页授权已撤销、过期或运行已停止".into()) }
}

/// Generic applications use a fixed DOM adapter and a final one-use server gate.
/// No script, Cookie, CDP port or credential can be supplied by an application.
#[tauri::command]
pub async fn desktop_automation_app(webview: tauri::Webview, owner: String, session_id: String,
    token: String, payload: String, ticket: String) -> Result<serde_json::Value, String> {
    if !trusted_caller(&webview) || !session_id.starts_with("automation:app:") || payload.len() > 100000 { return Err("应用网页请求无效".into()); }
    let request: serde_json::Value = serde_json::from_str(&payload).map_err(|_| "应用网页请求格式无效")?;
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
    if !matches!(method, "probe" | "observe" | "read" | "locate" | "extract" | "operation" | "navigate") { return Err("应用网页方法不支持".into()); }
    let app = webview.app_handle().clone(); let state = app.state::<BrowserState>();
    let _operation = state.operation.lock().await;
    validate_account_session(&app, method != "probe")?;
    let (view, _) = observation_identity(&app, &owner, &session_id)?;
    let (sequence, environment) = {
        let guard = state.session.lock().unwrap();
        let s = guard.as_ref().filter(|s| s.owner == owner && s.id == session_id).ok_or("应用浏览器已关闭")?;
        if method != "probe" && s.control_token.as_deref() != Some(token.as_str()) { return Err("网页控制已暂停，未派发操作".into()); }
        (s.control_sequence, s.account_id.as_ref().map(|id| format!("account:{id}:{}", s.account_generation)).unwrap_or_else(|| format!("temporary:{}", s.label)))
    };
    if let Some(expected) = request.get("expected").and_then(|v| v.get("environment")).and_then(|v| v.as_str()) {
        if expected != environment { return Err("浏览环境已重置或切换，请重新授权".into()); }
    }
    let script = |phase: &str, key: &str, before: &serde_json::Value| format!("{}({},{},{},{});", include_str!("app-browser.js"), request, serde_json::json!(phase), serde_json::json!(key), before);
    let before = evaluate_page(&view, script("preflight", "", &serde_json::Value::Null)).await?;
    if let Some(error) = before.get("error").and_then(|v| v.as_str()) { return Err(error.into()); }
    let gate_ticket = ticket.clone(); let gate_payload = payload.clone();
    tauri::async_runtime::spawn_blocking(move || consume_application_ticket(&gate_ticket, &gate_payload)).await.map_err(|_| "网页授权核对失败")??;
    {
        let guard = state.session.lock().unwrap(); let s = guard.as_ref().filter(|s| s.owner == owner && s.id == session_id && s.control_sequence == sequence).ok_or("网页控制已变化")?;
        if method != "probe" && s.control_token.as_deref() != Some(token.as_str()) { return Err("网页控制已暂停，结果未重复派发".into()); }
    }
    let mut result = if matches!(method, "operation" | "navigate") {
        let key = before.get("key").and_then(|v| v.as_str()).ok_or("网页预检查缺少引用")?;
        let baseline = before.get("before").cloned().unwrap_or(serde_json::Value::Null);
        let mut value = evaluate_page(&view, script("execute", key, &baseline)).await.map_err(|_| "网页操作结果未知，不会自动重试")?;
        if method == "operation" {
            let operation_id = request.pointer("/args/operationId").and_then(|v| v.as_str()).unwrap_or("");
            let verified = request.pointer("/site/operations").and_then(|v| v.as_array()).and_then(|ops| ops.iter().find(|o| o.get("id").and_then(|v| v.as_str()) == Some(operation_id))).is_some_and(|o| o.get("verify").is_some());
            if verified && value.get("error").is_none() {
                for _ in 0..25 {
                    if value.get("verified").and_then(|v| v.as_bool()) == Some(true) { break; }
                    if !state.session.lock().unwrap().as_ref().is_some_and(|s| s.owner == owner && s.id == session_id && s.control_sequence == sequence && s.control_token.as_deref() == Some(token.as_str())) { return Err("网页变更已派发，但核对被暂停；结果未知，不重复提交".into()); }
                    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(200))).await.map_err(|_| "网页校验等待失败")?;
                    value = evaluate_page(&view, script("verify", key, &baseline)).await.map_err(|_| "网页变更校验结果未知，不重复提交")?;
                }
            }
        }
        value
    } else { evaluate_page(&view, script("read", "", &serde_json::Value::Null)).await? };
    result["environment"] = serde_json::json!(environment);
    Ok(result)
}

// Browser-owned password storage and prompts only; no credentials cross IPC.
async fn set_password_autosave(view: &tauri::Webview, enabled: bool) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        use windows::core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings4;
        let result = (|| -> windows::core::Result<()> {
            let settings: ICoreWebView2Settings4 = platform.controller().CoreWebView2()?.Settings()?.cast()?;
            settings.SetIsPasswordAutosaveEnabled(enabled)
        })();
        let _ = tx.send(result.is_ok());
    }).map_err(|_| "accountPasswordUnavailable")?;
    let ok = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(6))).await
        .map_err(|_| "accountPasswordUnavailable")?.map_err(|_| "accountPasswordUnavailable")?;
    if ok { Ok(()) } else { Err("accountPasswordUnavailable".into()) }
}

async fn capture_viewport(view: &tauri::Webview) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        let completion = tx.clone();
        let callback = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
            let _ = completion.send(if status.is_ok() { Ok(result) } else { Err(()) });
            Ok(())
        }));
        let result = platform.controller().CoreWebView2().and_then(|core| core.CallDevToolsProtocolMethod(
            windows::core::w!("Page.captureScreenshot"),
            windows::core::w!("{\"format\":\"jpeg\",\"quality\":65,\"captureBeyondViewport\":false}"), &callback));
        if result.is_err() { let _ = tx.send(Err(())); }
    }).map_err(|_| "截图不可用")?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(6))).await
        .map_err(|_| "截图不可用")?.map_err(|_| "截图超时")?.map_err(|_| "截图不可用")?;
    if raw.len() > 4_000_000 { return Err("截图过大".into()); }
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "截图不可用")?;
    value.get("data").and_then(|v| v.as_str()).filter(|v| !v.is_empty()).map(String::from).ok_or("截图不可用".into())
}

/// Observation never exposes arbitrary JS, CDP methods, cookies or a debugging port.
/// The website itself still has no Tauri capability. No operation lock is held
/// while collecting: stop/close must remain responsive, and invalidate the reply.
#[tauri::command]
pub async fn desktop_automation_observe(webview: tauri::Webview, owner: String, session_id: String,
    screenshot: Option<bool>, expected_id: Option<String>) -> Result<serde_json::Value, String> {
    if !trusted_caller(&webview) { return Err("仅 Eureka 本机界面可读取网站视图".into()); }
    let app = webview.app_handle().clone();
    let (view, identity) = observation_identity(&app, &owner, &session_id)?;
    if let Some(expected) = expected_id {
        return if expected == identity { Ok(serde_json::json!({ "current": true })) } else { Err("页面已变化，请重新读取".into()) };
    }
    let mut value = collect_page(&view).await?;
    if screenshot.unwrap_or(false) {
        match capture_viewport(&view).await {
            Ok(data) => value["image"] = serde_json::json!({ "mimeType": "image/jpeg", "data": data }),
            Err(_) => { if let Some(items) = value["limitations"].as_array_mut() { items.push(serde_json::json!("screenshot-unavailable")); } }
        }
    }
    if observation_identity(&app, &owner, &session_id)?.1 != identity { return Err("页面已变化，请重新读取".into()); }
    value["id"] = identity.into();
    value["capturedAt"] = serde_json::json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64);
    Ok(value)
}

// Disable only Wry's child container, never the main Eureka window. This gates
// physical mouse/keyboard input without intercepting site events or forwarding video.
async fn set_manual_input(view: &tauri::Webview, enabled: bool) -> Result<(), String> {
    let main = view.window().hwnd().map_err(|_| "inputLockFailed")?.0 as usize;
    let app = view.app_handle().clone(); let label = view.label().to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        use windows_sys::Win32::UI::{Input::KeyboardAndMouse::{EnableWindow, IsWindowEnabled}, WindowsAndMessaging::IsChild};
        let mut child = windows::Win32::Foundation::HWND::default();
        let result = platform.controller().ParentWindow(&mut child);
        let hwnd = child.0;
        let valid = result.is_ok() && !hwnd.is_null() && hwnd as usize != main && IsChild(main as _, hwnd) != 0;
        let enabled = enabled && app.state::<BrowserState>().session.lock().unwrap().as_ref().is_some_and(|s| s.label == label && !s.ui_blocked);
        if valid { EnableWindow(hwnd, if enabled { 1 } else { 0 }); }
        let ok = valid && (IsWindowEnabled(hwnd) != 0) == enabled;
        let _ = tx.send(ok);
    }).map_err(|_| "inputLockFailed")?;
    let ok = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(6))).await
        .map_err(|_| "inputLockFailed")?.map_err(|_| "inputLockFailed")?;
    if ok { Ok(()) } else { Err("inputLockFailed".into()) }
}

#[tauri::command]
pub async fn desktop_automation_control(webview: tauri::Webview, owner: String, session_id: String,
    mode: String, token: String, sequence: u64, expected_id: Option<String>) -> Result<(), String> {
    if !trusted_caller(&webview) || token.len() > 100 || token.is_empty() || !matches!(mode.as_str(), "claim" | "pause") { return Err("invalidControl".into()); }
    let app = webview.app_handle().clone();
    let state = app.state::<BrowserState>();
    // Record newer intent before waiting for a dispatched step. Late claims and
    // queued steps can no longer regain ownership after pause.
    {
        let mut guard = state.session.lock().unwrap();
        let s = guard.as_mut().filter(|s| s.owner == owner && s.id == session_id).ok_or("browserClosed")?;
        if sequence <= s.control_sequence { return Err("staleControl".into()); }
        s.control_sequence = sequence;
        s.control_token = None;
    }
    let _operation = state.operation.lock().await;
    if mode == "claim" { validate_account_session(&app, true)?; }
    if mode == "claim" && expected_id.as_deref() != Some(observation_identity(&app, &owner, &session_id)?.1.as_str()) {
        return Err("staleObservation".into());
    }
    let label = {
        let guard = state.session.lock().unwrap();
        let s = guard.as_ref().filter(|s| s.owner == owner && s.id == session_id && s.control_sequence == sequence && s.touched.elapsed() < Duration::from_secs(30)).ok_or("staleControl")?;
        s.label.clone()
    };
    let view = app.get_webview(&label).ok_or("browserClosed")?;
    if set_manual_input(&view, mode == "pause").await.is_err() {
        close_all(&app); return Err("inputLockFailed".into());
    }
    let mut guard = state.session.lock().unwrap();
    let s = guard.as_mut().filter(|s| s.label == label && s.control_sequence == sequence).ok_or("staleControl")?;
    s.control_token = if mode == "claim" { Some(token) } else { None };
    s.snapshot.controlled = mode == "claim";
    drop(guard);
    if mode == "claim" { let _ = webview.set_focus(); }
    Ok(())
}

fn validate_account_session(app: &tauri::AppHandle, require_site: bool) -> Result<(), String> {
    let account = app.state::<BrowserState>().session.lock().unwrap().as_ref().and_then(|s|
        s.account_id.as_ref().map(|id| (s.owner.clone(), id.clone(), s.account_generation, s.label.clone())));
    if let Some((owner, id, generation, label)) = account {
        let (_, account) = accounts::active(app, &owner, &id)?;
        if account.generation != generation { return Err("accountMissing".into()); }
        if require_site && id != accounts::DEFAULT_ID && app.get_webview(&label).ok_or("accountNotOpen")?.url().map_err(|_| "accountNotOpen")?.origin().ascii_serialization() != account.origin {
            return Err("accountSiteMismatch".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_automation_accounts(webview: tauri::Webview, owner: String, action: String,
    id: Option<String>, name: Option<String>, origin: Option<String>, enabled: Option<bool>) -> Result<serde_json::Value, String> {
    if !trusted_caller(&webview) { return Err("accountInvalid".into()); }
    let app = webview.app_handle().clone();
    accounts::owner_root(&app, &owner)?;
    let state = app.state::<BrowserState>();
    if matches!(action.as_str(), "reset" | "delete") {
        if let Some(s) = state.session.lock().unwrap().as_mut().filter(|s| s.owner == owner && s.account_id.as_ref() == id.as_ref()) { s.control_token = None; }
    }
    let _operation = state.operation.lock().await;
    if action == "list" { return Ok(serde_json::json!({ "accounts": account_items(&app, &owner)? })); }
    let id = id.ok_or("accountInvalid")?;
    let dir = accounts::directory(&app, &owner, &id)?;
    // Only explicit logout/delete retires a dormant browser. Metadata/password
    // changes and old-generation cleanup retain the current live login.
    if matches!(action.as_str(), "reset" | "delete") {
        discard_parked(&app, |s| s.owner == owner && s.account_id.as_deref() == Some(id.as_str()));
    }
    if action == "create" {
        accounts::create(&app, &owner, &id, &name.ok_or("accountInvalid")?, &origin.ok_or("accountInvalid")?)?;
    } else {
        let current_label = state.session.lock().unwrap().as_ref().filter(|s| s.owner == owner && s.account_id.as_deref() == Some(id.as_str())).map(|s| s.label.clone());
        let parked_label = state.parked.lock().unwrap().iter().find(|s| s.owner == owner && s.account_id.as_deref() == Some(id.as_str())).map(|s| s.label.clone());
        if action == "update" {
            if current_label.is_some() { return Err("accountBusy".into()); }
            let name = name.ok_or("accountInvalid")?; let origin = origin.ok_or("accountInvalid")?;
            if parked_label.is_some() { accounts::update_leased(&dir, &id, &name, &origin)?; }
            else { accounts::update(&app, &owner, &id, &name, &origin)?; }
        } else if action == "passwords" {
            let enabled = enabled.ok_or("accountInvalid")?;
            let _lease = if current_label.is_some() || parked_label.is_some() { None } else { Some(accounts::lease(&dir)?) };
            let mut account = accounts::read(&dir)?;
            if account.deleted { return Err("accountMissing".into()); }
            let view = current_label.as_ref().or(parked_label.as_ref()).and_then(|label| app.get_webview(label));
            if let Some(view) = &view {
                if state.session.lock().unwrap().as_ref().is_some_and(|s| s.snapshot.controlled) { return Err("accountBusy".into()); }
                set_password_autosave(view, enabled).await?;
            }
            let previous = account.password_autosave;
            account.password_autosave = enabled;
            if let Err(error) = accounts::write(&dir, &account) {
                if let Some(view) = &view { let _ = set_password_autosave(view, previous).await; }
                return Err(error);
            }
        } else if matches!(action.as_str(), "reset" | "delete") {
            if id == accounts::DEFAULT_ID && action == "delete" { return Err("accountInvalid".into()); }
            // The operation lock waits for an in-flight step before invalidation.
            // Close the old view before changing its generation. Browser process
            // teardown can lag; retired profile cleanup therefore retries separately.
            if current_label.is_some() { close_current(&app); }
            let lease = accounts::lease(&dir)?;
            let mut account = accounts::read(&dir)?;
            if account.deleted { return Err("accountMissing".into()); }
            if account.retired.len() >= 100 { return Err("accountCleanupRequired".into()); }
            account.retired.push(account.generation);
            account.generation = account.generation.checked_add(1).ok_or("accountStorageFailed")?;
            account.status = "needs_login".into(); account.confirmed_at = None;
            account.deleted = action == "delete";
            accounts::write(&dir, &account)?;
            drop(lease);
            accounts::schedule_cleanup(dir);
        } else if action == "cleanup" {
            if current_label.is_some() { return Err("accountBusy".into()); }
            if parked_label.is_some() { accounts::cleanup_leased(&dir)?; } else { accounts::cleanup(&dir)?; }
        } else { return Err("accountInvalid".into()); }
    }
    Ok(serde_json::json!({ "accounts": account_items(&app, &owner)? }))
}


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn urls_do_not_allow_files_credentials_or_script() {
        for raw in ["file:///C:/secret", "javascript:alert(1)", "https://a:b@example.com", "not a URL"] { assert!(destination(raw).is_err()); }
        assert!(destination("https://myseller.taobao.com/home.htm?q=1").is_ok());
        assert_eq!(display_url(&destination("https://example.com/a?page=2#/refunds").unwrap()), "https://example.com/a?page=2#/refunds");
    }
    #[test]
    fn website_views_never_receive_host_command_access() {
        let local = tauri::Url::parse("http://127.0.0.1:8080/").unwrap();
        assert!(caller_allowed(crate::CONTENT_LABEL, &local));
        assert!(!caller_allowed("automation-browser-1", &local));
        assert!(!caller_allowed(crate::CONTENT_LABEL, &tauri::Url::parse("https://example.com/").unwrap()));
        assert!(!caller_allowed(crate::CONTENT_LABEL, &tauri::Url::parse("http://127.0.0.1:9999/").unwrap()));
    }
    #[test]
    fn native_bounds_account_for_zoom_and_titlebar_and_reject_overflow() {
        let mut b = Bounds { x: 500.0, y: 80.0, width: 300.0, height: 400.0, viewport_width: 800.0, viewport_height: 600.0 };
        let r = rect(&b, 1200.0, 932.0).unwrap();
        assert_eq!(r.position, LogicalPosition::new(750.0, 152.0).into());
        assert_eq!(r.size, LogicalSize::new(450.0, 600.0).into());
        b.x = -1.0; assert!(rect(&b, 1200.0, 932.0).is_err());
        b.x = 501.1; assert!(rect(&b, 1200.0, 932.0).is_err());
        b.x = f64::NAN; assert!(rect(&b, 1200.0, 932.0).is_err());
    }
}
