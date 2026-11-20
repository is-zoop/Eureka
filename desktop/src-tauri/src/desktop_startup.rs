use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, Url, Webview, Window};

const BUNDLED_ORIGIN: &str = "http://127.0.0.1:8080/";
const POLL: Duration = Duration::from_millis(200);
const PAGE_ATTEMPTS: usize = 2;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Pending,
    Starting,
    Ready,
    Failed,
}

struct Launch {
    id: String,
    started: Instant,
    phase: Phase,
    origin: Option<Url>,
    navigation_id: Option<u64>,
    navigation_loaded: bool,
}

impl Launch {
    fn new() -> Self {
        Self {
            id: uuid::Uuid::new_v4().simple().to_string(),
            started: Instant::now(),
            phase: Phase::Pending,
            origin: None,
            navigation_id: None,
            navigation_loaded: false,
        }
    }
}

pub struct StartupState {
    current: Mutex<Launch>,
    log_path: Option<PathBuf>,
}

impl StartupState {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            current: Mutex::new(Launch::new()),
            log_path: app
                .path()
                .app_log_dir()
                .ok()
                .map(|dir| dir.join("startup.log")),
        }
    }

    fn begin(&self, retry: bool) -> Option<String> {
        let mut run = self.current.lock().unwrap();
        if run.phase == Phase::Starting || (retry && run.phase != Phase::Failed) {
            return None;
        }
        if run.phase != Phase::Pending {
            *run = Launch::new();
        }
        run.phase = Phase::Starting;
        self.write(
            &run,
            if retry {
                "retry_started"
            } else {
                "startup_started"
            },
        );
        Some(run.id.clone())
    }

    fn write(&self, run: &Launch, event: &str) {
        let Some(path) = &self.log_path else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::metadata(path).is_ok_and(|file| file.len() >= 256 * 1024) {
            let previous = path.with_extension("previous.log");
            let _ = fs::remove_file(&previous);
            let _ = fs::rename(path, previous);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            let _ = writeln!(
                file,
                "{} startup={} host_pid={} elapsed_ms={} {event}",
                now.as_millis(),
                run.id,
                std::process::id(),
                run.started.elapsed().as_millis()
            );
        }
    }
}

pub fn record(app: &AppHandle, event: &str) {
    let state = app.state::<StartupState>();
    let run = state.current.lock().unwrap();
    state.write(&run, event);
}

pub fn current_id(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<StartupState>()?;
    let run = state.current.lock().unwrap();
    Some(run.id.clone())
}

pub fn record_surface(window: &Window, event: &str) {
    let bounds = window
        .app_handle()
        .get_webview(crate::CONTENT_LABEL)
        .and_then(|view| view.bounds().ok());
    record(
        window.app_handle(),
        &format!(
            "{event} visible={:?} minimized={:?} content_bounds={bounds:?}",
            window.is_visible().ok(),
            window.is_minimized().ok(),
        ),
    );
}

fn page_kind(url: &Url) -> &'static str {
    match url.path() {
        "/" => "workspace",
        "/login" => "login",
        "/startup.html" => "splash",
        "/error.html" => "error",
        _ => "other",
    }
}

pub fn page_load(view: &Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    let state = view.app_handle().state::<StartupState>();
    let run = state.current.lock().unwrap();
    if run.phase != Phase::Ready {
        state.write(
            &run,
            &format!(
                "page_load event={:?} page={}",
                payload.event(),
                page_kind(payload.url())
            ),
        );
    }
}

#[cfg(windows)]
pub fn observe(view: &Webview) {
    use webview2_com::{
        take_pwstr, DOMContentLoadedEventHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2_2,
        NavigationCompletedEventHandler, NavigationStartingEventHandler, ProcessFailedEventHandler,
    };
    use windows::core::Interface;

    let app = view.app_handle().clone();
    if view.with_webview(move |platform| unsafe {
        let install = || -> windows::core::Result<()> {
            let webview = platform.controller().CoreWebView2()?;
            let mut browser_pid = 0;
            if webview.BrowserProcessId(&mut browser_pid).is_ok() {
                record(&app, &format!("webview_attached browser_pid={browser_pid}"));
            }
            let started = app.clone();
            webview.add_NavigationStarting(&NavigationStartingEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut id = 0;
                    let mut uri = windows::core::PWSTR::null();
                    args.NavigationId(&mut id)?;
                    args.Uri(&mut uri)?;
                    let url = Url::parse(&take_pwstr(uri)).ok();
                    let state = started.state::<StartupState>();
                    let mut run = state.current.lock().unwrap();
                    if let Some(origin) = run.origin.as_ref().filter(|_| run.phase == Phase::Starting) {
                        run.navigation_id = url.as_ref().filter(|url| url.origin() == origin.origin()).map(|_| id);
                        run.navigation_loaded = false;
                        state.write(&run, &format!("navigation_started id={id} page={}", url.as_ref().map_or("unknown", page_kind)));
                    }
                }
                Ok(())
            })), &mut 0)?;
            let dom = app.clone();
            webview.cast::<ICoreWebView2_2>()?.add_DOMContentLoaded(&DOMContentLoadedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut id = 0;
                    args.NavigationId(&mut id)?;
                    let state = dom.state::<StartupState>();
                    let mut run = state.current.lock().unwrap();
                    if run.phase == Phase::Starting && run.navigation_id == Some(id) {
                        run.navigation_loaded = true;
                        state.write(&run, &format!("dom_loaded id={id}"));
                    }
                }
                Ok(())
            })), &mut 0)?;
            let completed = app.clone();
            webview.add_NavigationCompleted(&NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut id = 0;
                    let mut success = windows::core::BOOL(0);
                    let mut status = webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_WEB_ERROR_STATUS(0);
                    args.NavigationId(&mut id)?;
                    args.IsSuccess(&mut success)?;
                    args.WebErrorStatus(&mut status)?;
                    let state = completed.state::<StartupState>();
                    let mut run = state.current.lock().unwrap();
                    if matches!(run.phase, Phase::Starting | Phase::Ready) && run.navigation_id == Some(id) {
                        run.navigation_loaded = success.as_bool();
                        state.write(&run, &format!("navigation_completed id={id} success={} web_error={}", success.as_bool(), status.0));
                    }
                }
                Ok(())
            })), &mut 0)?;
            let failed = app.clone();
            webview.add_ProcessFailed(&ProcessFailedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut kind = webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                    args.ProcessFailedKind(&mut kind)?;
                    record(&failed, &format!("webview_process_failed kind={}", kind.0));
                }
                Ok(())
            })), &mut 0)?;
            Ok(())
        };
        if let Err(error) = install() {
            record(&app, &format!("webview_observer_setup_failed hresult={:#x}", error.code().0));
        }
    }).is_err() {
        record(view.app_handle(), "webview_observer_dispatch_failed");
    }
}

#[cfg(not(windows))]
pub fn observe(_view: &Webview) {}

#[cfg(windows)]
fn probe_page(
    view: &Webview,
    origin: &Url,
) -> tauri::Result<std::sync::mpsc::Receiver<Option<&'static str>>> {
    use webview2_com::{CoTaskMemPWSTR, ExecuteScriptCompletedHandler};

    let (sender, receiver) = std::sync::mpsc::channel();
    let origin = serde_json::to_string(&origin.origin().ascii_serialization()).unwrap();
    let script = format!(
        r#"(() => {{
        if (location.origin !== {origin}) return null;
        const page = document.documentElement?.dataset.eurekaStartupPage;
        if (location.pathname === "/" && page === "workspace") return page;
        if (location.pathname === "/login" && page === "login") return page;
        return null;
    }})()"#
    );
    view.with_webview(move |platform| unsafe {
        let Ok(webview) = platform.controller().CoreWebView2() else {
            return;
        };
        let script = CoTaskMemPWSTR::from(script.as_str());
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
            let page = match (result.is_ok(), value.as_str()) {
                (true, "\"workspace\"") => Some("workspace"),
                (true, "\"login\"") => Some("login"),
                _ => None,
            };
            let _ = sender.send(page);
            Ok(())
        }));
        let _ = webview.ExecuteScript(*script.as_ref().as_pcwstr(), &handler);
    })?;
    Ok(receiver)
}

#[cfg(windows)]
fn open_application(
    view: &Webview,
    origin: &Url,
    bundled_id: Option<&str>,
) -> Result<(), &'static str> {
    let app = view.app_handle();
    let state = app.state::<StartupState>();
    let timeout = Duration::from_secs(if bundled_id.is_none() { 25 } else { 12 });
    for attempt in 1..=PAGE_ATTEMPTS {
        {
            let mut run = state.current.lock().unwrap();
            run.origin = Some(origin.clone());
            run.navigation_id = None;
            run.navigation_loaded = false;
            state.write(&run, &format!("navigation_requested attempt={attempt}"));
        }
        if let Err(error) = view.navigate(origin.clone()) {
            record(
                app,
                &format!("navigation_dispatch_failed attempt={attempt} error={error}"),
            );
            continue;
        }
        let deadline = Instant::now() + timeout;
        let mut probe = None;
        while Instant::now() < deadline && app.get_webview(crate::CONTENT_LABEL).is_some() {
            check_sidecar(app, bundled_id)?;
            let loaded_id = {
                let run = state.current.lock().unwrap();
                run.navigation_id.filter(|_| run.navigation_loaded)
            };
            if let (Some(id), None) = (loaded_id, &probe) {
                match probe_page(view, origin) {
                    Ok(receiver) => probe = Some((id, receiver)),
                    Err(_) => break,
                }
            }
            if let Some((id, receiver)) = &probe {
                if Some(*id) != loaded_id {
                    probe = None;
                } else {
                    match receiver.try_recv() {
                        Ok(Some(page)) => {
                            let run = state.current.lock().unwrap();
                            if run.navigation_loaded && run.navigation_id == Some(*id) {
                                state.write(&run, &format!("page_ready page={page} navigation_id={id} attempt={attempt}"));
                                return Ok(());
                            }
                            probe = None;
                        }
                        Ok(None) | Err(std::sync::mpsc::TryRecvError::Disconnected) => probe = None,
                        Err(std::sync::mpsc::TryRecvError::Empty) => {}
                    }
                }
            }
            thread::sleep(POLL);
        }
        record(app, &format!("page_not_ready attempt={attempt}"));
    }
    Err("page")
}

#[cfg(not(windows))]
fn open_application(
    view: &Webview,
    origin: &Url,
    _bundled_id: Option<&str>,
) -> Result<(), &'static str> {
    view.navigate(origin.clone()).map_err(|_| "page")
}

fn client() -> Result<reqwest::Client, reqwest::Error> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_millis(500))
        .timeout(Duration::from_secs(3))
        .build()
}

fn check_sidecar(app: &AppHandle, bundled_id: Option<&str>) -> Result<(), &'static str> {
    let Some(expected) = bundled_id else {
        return Ok(());
    };
    match crate::running_sidecar(app) {
        Ok(Some((_, id))) if id == expected => return Ok(()),
        Err(status) => record(app, &format!("sidecar_exited status={status}")),
        _ => record(app, "sidecar_missing"),
    }
    Err("service")
}

fn wait_for_service(
    app: &AppHandle,
    base: &Url,
    bundled_id: Option<&str>,
) -> Result<(), &'static str> {
    let url = base
        .join(if bundled_id.is_some() {
            "api/desktop-startup"
        } else {
            "login"
        })
        .unwrap();
    let client = client().map_err(|_| "service")?;
    let deadline = Instant::now() + Duration::from_secs(if bundled_id.is_some() { 30 } else { 60 });
    let mut last_status = None;
    while Instant::now() < deadline && app.get_webview(crate::CONTENT_LABEL).is_some() {
        check_sidecar(app, bundled_id)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let request = client
            .get(url.clone())
            .timeout(remaining.min(Duration::from_secs(3)));
        if let Ok(response) = tauri::async_runtime::block_on(request.send()) {
            let status = response.status();
            let ready = match bundled_id {
                Some(expected) => {
                    status == reqwest::StatusCode::NO_CONTENT
                        && response
                            .headers()
                            .get("x-eureka-startup-id")
                            .and_then(|id| id.to_str().ok())
                            == Some(expected)
                }
                None => status == reqwest::StatusCode::OK,
            };
            if ready {
                check_sidecar(app, bundled_id)?;
                record(app, "http_ready");
                return Ok(());
            }
            let identity_mismatch =
                bundled_id.is_some() && status == reqwest::StatusCode::NO_CONTENT;
            if last_status != Some(status) {
                record(
                    app,
                    &format!(
                        "http_probe_not_ready status={} identity_mismatch={identity_mismatch}",
                        status.as_u16()
                    ),
                );
                last_status = Some(status);
            }
        }
        thread::sleep(POLL);
    }
    record(app, "http_ready_timeout");
    Err("service")
}

fn local_page(app: &AppHandle, name: &str) -> Result<Url, String> {
    app.get_webview(crate::TITLEBAR_LABEL)
        .ok_or_else(|| "Titlebar was closed.".to_string())?
        .url()
        .map_err(|error| error.to_string())?
        .join(name)
        .map_err(|error| error.to_string())
}

fn start_application(app: &AppHandle, view: &Webview, launch_id: &str) -> Result<(), &'static str> {
    let dev_url = std::env::var_os("EUREKA_DEV_URL");
    let (base, sidecar_id) = if let Some(dev_url) = dev_url {
        record(app, "mode=developer");
        let url = Url::parse(&dev_url.to_string_lossy()).map_err(|_| "service")?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.path() != "/"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            record(app, "invalid_development_url");
            return Err("service");
        }
        (url, None)
    } else {
        record(app, "mode=bundled");
        let id = match crate::running_sidecar(app) {
            Ok(Some((pid, id))) => {
                record(app, &format!("sidecar_reused node_pid={pid}"));
                id
            }
            _ => {
                crate::stop_sidecar(app);
                let pid = crate::spawn_bundled_sidecar(app, launch_id).map_err(|error| {
                    record(app, &format!("sidecar_spawn_failed error={error}"));
                    "service"
                })?;
                record(app, &format!("sidecar_spawned node_pid={pid}"));
                launch_id.to_owned()
            }
        };
        (Url::parse(BUNDLED_ORIGIN).unwrap(), Some(id))
    };
    let result = wait_for_service(app, &base, sidecar_id.as_deref())
        .and_then(|()| open_application(view, &base, sidecar_id.as_deref()));
    if result == Err("service") && sidecar_id.is_some() {
        crate::stop_sidecar(app);
    }
    result
}

pub fn start(app: AppHandle, retry: bool) {
    let state = app.state::<StartupState>();
    let Some(launch_id) = state.begin(retry) else {
        return;
    };
    let Some(view) = app.get_webview(crate::CONTENT_LABEL) else {
        return;
    };
    if retry {
        let _ = view.window().set_title("Eureka");
        record_surface(&view.window(), "retry_window");
        let splash = local_page(&app, "startup.html")
            .and_then(|url| view.navigate(url).map_err(|error| error.to_string()));
        if let Err(error) = splash {
            record(&app, &format!("retry_splash_dispatch_failed error={error}"));
        }
    }
    let result = start_application(&app, &view, &launch_id);
    {
        let mut run = state.current.lock().unwrap();
        run.phase = if result.is_ok() {
            Phase::Ready
        } else {
            Phase::Failed
        };
    }
    match result {
        Ok(()) => record_surface(&view.window(), "startup_ready"),
        Err(stage) => {
            record(&app, &format!("startup_failed stage={stage}"));
            if app.get_webview(crate::CONTENT_LABEL).is_none() {
                return;
            }
            let _ = view.window().set_title("Eureka 无法启动");
            let error_page = local_page(&app, "error.html").and_then(|mut url| {
                url.query_pairs_mut().append_pair("stage", stage);
                view.navigate(url).map_err(|error| error.to_string())
            });
            if let Err(error) = error_page {
                record(&app, &format!("error_page_dispatch_failed error={error}"));
            }
        }
    }
}

#[tauri::command]
pub async fn desktop_startup_retry(webview: Webview) -> Result<(), String> {
    let app = webview.app_handle().clone();
    let mut current = webview.url().map_err(|error| error.to_string())?;
    current.set_query(None);
    current.set_fragment(None);
    let allowed = local_page(&app, "error.html")?;
    if webview.label() != crate::CONTENT_LABEL || current != allowed {
        return Err("Only the packaged startup error page can retry.".into());
    }
    if app.state::<StartupState>().current.lock().unwrap().phase != Phase::Failed {
        return Err("Eureka startup is already in progress.".into());
    }
    thread::spawn(move || start(app, true));
    Ok(())
}
