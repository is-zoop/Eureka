#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod browser_opener;
mod desktop_menu;
mod desktop_tray;
mod tray_dismissal;
mod clipboard_files;
mod attachment_dialog;
mod webview_layout;
mod window_preferences;

use std::{
    fs::{create_dir_all, File, OpenOptions},
    io::Write,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    window::WindowBuilder,
    Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Rect, RunEvent, WebviewUrl,
    WindowEvent,
};
use webview_layout::{content_size, TITLEBAR_HEIGHT};
use window_preferences::WindowPreferences;

const TITLEBAR_LABEL: &str = "eureka-titlebar";
const CONTENT_LABEL: &str = "eureka-content";

struct DesktopState {
    preferences: Mutex<WindowPreferences>,
    navigation: Mutex<(bool, bool)>,
    menu: Mutex<(bool, Vec<String>)>,
    zoom: Mutex<f64>,
    path: PathBuf,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameSnapshot {
    maximized: bool,
    fullscreen: bool,
    focused: bool,
    theme: String,
    can_go_back: bool,
    can_go_forward: bool,
    menu_ready: bool,
    menu_labels: Vec<String>,
}

fn frame_snapshot(window: &tauri::Window) -> FrameSnapshot {
    let state = window.app_handle().state::<DesktopState>();
    let (can_go_back, can_go_forward) = *state.navigation.lock().unwrap();
    let (menu_ready, menu_labels) = state.menu.lock().unwrap().clone();
    FrameSnapshot {
        maximized: window.is_maximized().unwrap_or(false),
        fullscreen: window.is_fullscreen().unwrap_or(false),
        focused: window.is_focused().unwrap_or(true),
        theme: window
            .app_handle()
            .state::<DesktopState>()
            .preferences
            .lock()
            .unwrap()
            .theme
            .clone(),
        can_go_back,
        can_go_forward,
        menu_ready,
        menu_labels,
    }
}

fn emit_frame_snapshot(window: &tauri::Window) {
    let _ = window.app_handle().emit_to(
        EventTarget::webview(TITLEBAR_LABEL),
        "desktop-frame-state",
        frame_snapshot(window),
    );
}

fn save_window_preferences(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    if let Err(error) = state.preferences.lock().unwrap().write(&state.path) {
        eprintln!("Could not save Eureka window preferences: {error}");
    };
}

#[cfg(windows)]
use std::{
    ffi::c_void,
    mem::{size_of, zeroed},
    os::windows::{io::AsRawHandle, process::CommandExt},
};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SidecarState {
    child: Mutex<Option<Child>>,
    // Closing a Windows Job Object terminates every process it owns. This
    // covers uninstaller-forced shutdowns, where Rust's normal exit handler
    // cannot run and an orphaned node.exe would otherwise lock resources/.
    #[cfg(windows)]
    job: Mutex<Option<JobObject>>,
}

#[cfg(windows)]
struct JobObject(HANDLE);

// A Windows kernel handle is process-wide and CloseHandle may be invoked from
// any thread. windows-sys represents HANDLE as a raw pointer, which does not
// carry that platform guarantee in Rust's auto traits.
#[cfg(windows)]
unsafe impl Send for JobObject {}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn is_service_ready(address: &str) -> bool {
    // Next starts listening only once its server is ready. Do not make a raw
    // HTTP/1.1 probe here: differences in Next's production response parsing
    // made that probe report a false negative despite a healthy local server.
    TcpStream::connect_timeout(&address.parse().unwrap(), Duration::from_millis(500)).is_ok()
}

#[cfg(windows)]
fn open_in_system_browser(url: &tauri::Url) -> Result<(), String> {
    browser_opener::open(url.as_str())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid external URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS links can be opened externally.".into());
    }
    #[cfg(windows)]
    return open_in_system_browser(&parsed);
    #[cfg(not(windows))]
    Err("Opening external links is currently supported on Windows only.".into())
}

#[tauri::command]
async fn desktop_window_action(
    webview: tauri::Webview,
    action: String,
) -> Result<FrameSnapshot, String> {
    if webview.label() != TITLEBAR_LABEL {
        return Err("Window caption actions require the local titlebar.".into());
    }
    let window = webview.window();
    match action.as_str() {
        "ready" => window.show(),
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        "drag" => window.start_dragging(),
        "back" | "forward" => {
            let (can_go_back, can_go_forward) = *webview
                .app_handle()
                .state::<DesktopState>()
                .navigation
                .lock()
                .unwrap();
            let allowed = if action == "back" {
                can_go_back
            } else {
                can_go_forward
            };
            if allowed {
                let content = webview
                    .app_handle()
                    .get_webview(CONTENT_LABEL)
                    .ok_or_else(|| "The Eureka content view was closed.".to_string())?;
                content.eval(if action == "back" {
                    "window.dispatchEvent(new CustomEvent('eureka:navigate-history',{detail:-1}))"
                } else {
                    "window.dispatchEvent(new CustomEvent('eureka:navigate-history',{detail:1}))"
                }).map_err(|error| error.to_string())?;
                content.set_focus().map_err(|error| error.to_string())?;
            }
            return Ok(frame_snapshot(&window));
        }
        _ => return Err("Unknown window caption action.".into()),
    }
    .map_err(|error| error.to_string())?;
    Ok(frame_snapshot(&window))
}

#[tauri::command]
fn set_desktop_navigation_state(
    webview: tauri::Webview,
    can_go_back: bool,
    can_go_forward: bool,
) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL {
        return Err("Navigation state requires the Eureka content view.".into());
    }
    *webview
        .app_handle()
        .state::<DesktopState>()
        .navigation
        .lock()
        .unwrap() = (can_go_back, can_go_forward);
    emit_frame_snapshot(&webview.window());
    Ok(())
}

#[tauri::command]
fn set_desktop_menu_state(
    webview: tauri::Webview,
    ready: bool,
    labels: Vec<String>,
) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL {
        return Err("Menu state requires the content view.".into());
    }
    let state = webview.app_handle().state::<DesktopState>();
    {
        let mut menu = state.menu.lock().unwrap();
        menu.0 = ready;
        if labels.len() == 4 && labels.iter().all(|label| label.chars().count() <= 40) {
            menu.1 = labels;
        }
    }
    emit_frame_snapshot(&webview.window());
    Ok(())
}

#[tauri::command]
async fn desktop_open_menu(
    webview: tauri::Webview,
    menu: Option<String>,
    x: f64,
) -> Result<(), String> {
    if webview.label() != TITLEBAR_LABEL
        || !x.is_finite()
        || !(0.0..=30000.0).contains(&x)
        || menu
            .as_ref()
            .is_some_and(|id| !desktop_menu::MENU_IDS.contains(&id.as_str()))
    {
        return Err("Invalid desktop menu request.".into());
    }
    if !webview
        .app_handle()
        .state::<DesktopState>()
        .menu
        .lock()
        .unwrap()
        .0
    {
        return Ok(());
    }
    let content = webview
        .app_handle()
        .get_webview(CONTENT_LABEL)
        .ok_or("The content view was closed.")?;
    let detail = serde_json::json!({ "menu": menu, "x": x });
    content
        .eval(format!(
            "window.dispatchEvent(new CustomEvent('eureka:desktop-menu-open',{{detail:{detail}}}))"
        ))
        .map_err(|error| error.to_string())?;
    content.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_dispatch_menu_action(
    webview: tauri::Webview,
    command: String,
) -> Result<(), String> {
    if webview.label() != TITLEBAR_LABEL || !desktop_menu::is_command(&command) {
        return Err("Invalid desktop menu command.".into());
    }
    let content = webview
        .app_handle()
        .get_webview(CONTENT_LABEL)
        .ok_or("The content view was closed.")?;
    let detail = serde_json::json!({ "command": command });
    content.eval(format!("window.dispatchEvent(new CustomEvent('eureka:desktop-menu-action',{{detail:{detail}}}))")).map_err(|error| error.to_string())?;
    content.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_close_menu(webview: tauri::Webview, menu: String) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL || !desktop_menu::MENU_IDS.contains(&menu.as_str()) {
        return Err("Invalid menu close request.".into());
    }
    webview
        .app_handle()
        .emit_to(
            EventTarget::webview(TITLEBAR_LABEL),
            "desktop-menu-closed",
            menu,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_cycle_menu(webview: tauri::Webview, direction: i8) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL || !(-1..=1).contains(&direction) {
        return Err("Invalid menu direction.".into());
    }
    webview
        .app_handle()
        .emit_to(
            EventTarget::webview(TITLEBAR_LABEL),
            "desktop-menu-cycle",
            direction,
        )
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct DesktopViewState {
    zoom: f64,
    fullscreen: bool,
}

#[tauri::command]
fn desktop_clipboard_files(webview: tauri::Webview) -> Result<Vec<String>, String> {
    if webview.label() != CONTENT_LABEL { return Err("Clipboard files require the content view.".into()); }
    clipboard_files::read_files()
}

#[tauri::command]
async fn desktop_select_attachments(webview: tauri::Webview, cwd: Option<String>) -> Result<Vec<String>, String> {
    if webview.label() != CONTENT_LABEL { return Err("Attachment selection requires the content view.".into()); }
    #[cfg(windows)]
    let owner = webview.window().hwnd().map_err(|error| error.to_string())?.0 as usize;
    #[cfg(not(windows))]
    let owner = 0usize;
    tauri::async_runtime::spawn_blocking(move || attachment_dialog::open(owner, cwd)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_select_directory(webview: tauri::Webview, cwd: Option<String>) -> Result<Option<String>, String> {
    if webview.label() != CONTENT_LABEL { return Err("Directory selection requires the content view.".into()); }
    #[cfg(windows)]
    let owner = webview.window().hwnd().map_err(|error| error.to_string())?.0 as usize;
    #[cfg(not(windows))]
    let owner = 0usize;
    tauri::async_runtime::spawn_blocking(move || attachment_dialog::open_directory(owner, cwd)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn desktop_view_action(
    webview: tauri::Webview,
    action: String,
) -> Result<DesktopViewState, String> {
    if webview.label() != CONTENT_LABEL {
        return Err("View actions require the content view.".into());
    }
    let window = webview.window();
    let state = webview.app_handle().state::<DesktopState>();
    match action.as_str() {
        "state" => {}
        "zoom-in" | "zoom-out" | "zoom-reset" => {
            let current = *state.zoom.lock().unwrap();
            let next = desktop_menu::next_zoom(current, &action);
            webview.set_zoom(next).map_err(|error| error.to_string())?;
            *state.zoom.lock().unwrap() = next;
        }
        "fullscreen" => window
            .set_fullscreen(!window.is_fullscreen().map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?,
        "quit" => desktop_tray::quit(webview.app_handle()),
        _ => return Err("Unknown desktop view action.".into()),
    }
    let zoom = *state.zoom.lock().unwrap();
    emit_frame_snapshot(&window);
    Ok(DesktopViewState {
        zoom,
        fullscreen: window.is_fullscreen().unwrap_or(false),
    })
}

#[tauri::command]
fn desktop_tray_snapshot(webview: tauri::Webview) -> Result<serde_json::Value, String> {
    if webview.label() != desktop_tray::POPUP_LABEL {
        return Err("Tray snapshot requires the local tray popup.".into());
    }
    Ok(desktop_tray::popup_state(webview.app_handle()))
}

#[tauri::command]
fn desktop_tray_action(webview: tauri::Webview, command: String, session_id: Option<String>) -> Result<(), String> {
    if webview.label() != desktop_tray::POPUP_LABEL {
        return Err("Tray actions require the local tray popup.".into());
    }
    desktop_tray::action(webview.app_handle(), &command, session_id.as_deref())
}

#[tauri::command]
fn set_desktop_tray_state(
    webview: tauri::Webview,
    recent_sessions: Vec<desktop_tray::RecentSession>,
    ready: bool,
    can_create: bool,
) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL {
        return Err("Tray state requires the Eureka content view.".into());
    }
    desktop_tray::update(webview.app_handle(), recent_sessions, ready, can_create)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn set_desktop_theme(webview: tauri::Webview, preference: String) -> Result<(), String> {
    if webview.label() != CONTENT_LABEL || !matches!(preference.as_str(), "auto" | "light" | "dark")
    {
        return Err("Invalid desktop theme request.".into());
    }
    let window = webview.window();
    let theme = match preference.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    window.set_theme(theme).map_err(|error| error.to_string())?;
    window
        .app_handle()
        .state::<DesktopState>()
        .preferences
        .lock()
        .unwrap()
        .theme = preference;
    emit_frame_snapshot(&window);
    save_window_preferences(window.app_handle());
    desktop_tray::sync_popup(webview.app_handle()).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn assign_sidecar_job(child: &Child) -> Result<JobObject, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("Could not create the Eureka sidecar job object.".into());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return Err("Could not configure the Eureka sidecar job object.".into());
        }
        if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
            CloseHandle(job);
            return Err("Could not attach the Eureka service to its job object.".into());
        }
        Ok(JobObject(job))
    }
}

fn append_log(log_path: &PathBuf, message: &str) {
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(log, "{message}");
    }
}

fn layout_webviews(window: &tauri::Window) {
    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = size.to_logical::<f64>(scale);
    let Some((width, content_height)) = content_size(
        size.width,
        size.height,
        window.is_minimized().unwrap_or(false),
    ) else {
        return;
    };
    for (label, y, height) in [
        (TITLEBAR_LABEL, 0.0, TITLEBAR_HEIGHT),
        (CONTENT_LABEL, TITLEBAR_HEIGHT, content_height),
    ] {
        if let Some(webview) = window.app_handle().get_webview(label) {
            let _ = webview.set_bounds(Rect {
                position: LogicalPosition::new(0.0, y).into(),
                size: LogicalSize::new(width, height).into(),
            });
        }
    }
}

fn record_window_size(window: &tauri::Window) {
    let Ok(size) = window.inner_size() else {
        return;
    };
    let size = size.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
    window
        .app_handle()
        .state::<DesktopState>()
        .preferences
        .lock()
        .unwrap()
        .record_size(
            size.width,
            size.height,
            window.is_maximized().unwrap_or(false),
            window.is_minimized().unwrap_or(false),
        );
}

fn create_window(app: &tauri::AppHandle) -> Result<(), String> {
    let preferences = app
        .state::<DesktopState>()
        .preferences
        .lock()
        .unwrap()
        .clone();
    let theme = match preferences.theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        _ => None,
    };
    // Fit a remembered normal size to today's monitor while keeping its logical
    // dimensions independent of DPI. Position is intentionally left to the OS.
    let monitor_size = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.size().to_logical::<f64>(monitor.scale_factor()));
    let width = monitor_size.map_or(preferences.width, |size| {
        preferences.width.min(size.width.max(960.0))
    });
    let height = monitor_size.map_or(preferences.height, |size| {
        preferences.height.min((size.height - 48.0).max(640.0))
    });
    let window = WindowBuilder::new(app, "main")
        .title("Eureka")
        .decorations(false)
        .visible(false)
        .theme(theme)
        .inner_size(width, height)
        .min_inner_size(960.0, 640.0)
        .center()
        .build()
        .map_err(|error| error.to_string())?;

    let titlebar = WebviewBuilder::new(TITLEBAR_LABEL, WebviewUrl::App("titlebar.html".into()));
    window
        .add_child(
            titlebar,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(width, TITLEBAR_HEIGHT),
        )
        .map_err(|error| error.to_string())?;

    let allowed_navigation = |url: &tauri::Url| {
        let local = url.scheme() == "tauri"
            || url.host_str() == Some("tauri.localhost")
            || url.host_str() == Some("127.0.0.1");
        if !local && matches!(url.scheme(), "http" | "https") {
            let _ = open_in_system_browser(url);
        }
        local
    };
    let content = WebviewBuilder::new(CONTENT_LABEL, WebviewUrl::App("startup.html".into()))
        .zoom_hotkeys_enabled(false)
        // Injected before the Next page renders, including a full reload.
        .initialization_script(
            "window.__EUREKA_NATIVE_TITLEBAR__ = true; document.addEventListener('DOMContentLoaded', function(){document.documentElement.classList.add('eureka-desktop','eureka-native-titlebar')}, {once:true});"
        )
        .on_navigation(allowed_navigation)
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = open_in_system_browser(&url);
            }
            NewWindowResponse::Deny
        });
    window
        .add_child(
            content,
            LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
            LogicalSize::new(width, height - TITLEBAR_HEIGHT),
        )
        .map_err(|error| error.to_string())?;
    if preferences.maximized {
        window.maximize().map_err(|error| error.to_string())?;
    }
    layout_webviews(&window);
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            layout_webviews(&event_window);
            record_window_size(&event_window);
            emit_frame_snapshot(&event_window);
        }
        WindowEvent::Focused(focused) => {
            if *focused {
                // Restoring may retain the same normal size, so reconcile the
                // child bounds even if Windows sends no subsequent resize.
                layout_webviews(&event_window);
            }
            emit_frame_snapshot(&event_window)
        }
        WindowEvent::ThemeChanged(_) => emit_frame_snapshot(&event_window),
        WindowEvent::CloseRequested { api, .. } => {
            let app = event_window.app_handle();
            if desktop_tray::available(app) {
                api.prevent_close();
                if let Err(error) = desktop_tray::hide(app) {
                    eprintln!("Could not hide Eureka to the tray: {error}");
                }
            } else {
                // If the OS could not create a tray, keep normal close usable.
                record_window_size(&event_window);
                save_window_preferences(app);
            }
        }
        _ => {}
    });
    Ok(())
}

fn load_main_page(app: &tauri::AppHandle, url: WebviewUrl) -> Result<(), String> {
    // Never reopen a startup window that the user has already closed.
    let webview = app
        .get_webview(CONTENT_LABEL)
        .ok_or_else(|| "The Eureka window was closed.".to_string())?;
    let destination = match url {
        WebviewUrl::External(url) => url,
        WebviewUrl::App(path) if path == std::path::Path::new("error.html") => {
            webview
                .window()
                .set_title("Eureka 无法启动")
                .map_err(|error| error.to_string())?;
            // The caption always remains on the packaged local origin.
            app.get_webview(TITLEBAR_LABEL)
                .ok_or_else(|| "The titlebar was closed.".to_string())?
                .url()
                .map_err(|error| error.to_string())?
                .join("error.html")
                .map_err(|error| error.to_string())?
        }
        _ => return Err("Unsupported Eureka startup destination.".into()),
    };
    webview
        .navigate(destination)
        .map_err(|error| error.to_string())
}

fn start_eureka(app: tauri::AppHandle) {
    let log_dir = match app.path().app_log_dir() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Could not resolve Eureka log directory: {error}");
            let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
            return;
        }
    };
    if let Err(error) = create_dir_all(&log_dir) {
        eprintln!("Could not create Eureka log directory: {error}");
        let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
        return;
    }
    let log_path = log_dir.join("eureka.log");

    if let Ok(dev_url) = std::env::var("EUREKA_DEV_URL") {
        let address = dev_url.trim_start_matches("http://").trim_end_matches('/');
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if is_service_ready(address) {
                let _ = load_main_page(&app, WebviewUrl::External(dev_url.parse().unwrap()));
                return;
            }
            thread::sleep(Duration::from_millis(150));
        }
        append_log(
            &log_path,
            "Development server is not reachable at EUREKA_DEV_URL.",
        );
        let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
        return;
    }

    // The provider callback is registered as http://127.0.0.1:8080/… . OAuth
    // requires an exact redirect URI, so the desktop server cannot use a
    // random port while Haze authentication is enabled.
    let port = 8080_u16;
    let resources = match app.path().resource_dir() {
        Ok(path) => path.join("resources"),
        Err(error) => {
            append_log(
                &log_path,
                &format!("Could not resolve bundled resources: {error}"),
            );
            let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
            return;
        }
    };
    let node = resources
        .join("node")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let app_dir = resources.join("app");
    let stdout = match File::create(&log_path) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("Could not create Eureka log: {error}");
            let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
            return;
        }
    };
    let stderr = match stdout.try_clone() {
        Ok(file) => file,
        Err(error) => {
            append_log(
                &log_path,
                &format!("Could not attach service stderr: {error}"),
            );
            let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
            return;
        }
    };
    let mut command = Command::new(&node);
    command
        .arg("server.js")
        .current_dir(&app_dir)
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("PI_WEB_HOSTNAME", "127.0.0.1")
        .env("PI_WEB_NO_OPEN", "1")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let child = command.spawn();
    let child = match child {
        Ok(child) => child,
        Err(error) => {
            append_log(
                &log_path,
                &format!("Could not start bundled Node service: {error}"),
            );
            let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
            return;
        }
    };
    #[cfg(windows)]
    {
        let job = match assign_sidecar_job(&child) {
            Ok(job) => job,
            Err(error) => {
                append_log(&log_path, &error);
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
                return;
            }
        };
        *app.state::<SidecarState>().job.lock().unwrap() = Some(job);
    }
    *app.state::<SidecarState>().child.lock().unwrap() = Some(child);

    let address = format!("127.0.0.1:{port}");
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if is_service_ready(&address) {
            let url = format!("http://{address}");
            let _ = load_main_page(&app, WebviewUrl::External(url.parse().unwrap()));
            return;
        }
        thread::sleep(Duration::from_millis(150));
    }
    append_log(
        &log_path,
        "Timed out waiting for the bundled Eureka service.",
    );
    if let Some(mut child) = app.state::<SidecarState>().child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = load_main_page(&app, WebviewUrl::App("error.html".into()));
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<SidecarState>().child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(windows)]
    app.state::<SidecarState>().job.lock().unwrap().take();
}

fn main() {
    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            #[cfg(windows)]
            job: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            desktop_window_action,
            set_desktop_navigation_state,
            set_desktop_menu_state,
            desktop_open_menu,
            desktop_dispatch_menu_action,
            desktop_close_menu,
            desktop_cycle_menu,
            desktop_view_action,
            desktop_clipboard_files,
            desktop_select_attachments,
            desktop_select_directory,
            set_desktop_tray_state,
            desktop_tray_snapshot,
            desktop_tray_action,
            set_desktop_theme
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = desktop_tray::restore(app) {
                eprintln!("Could not restore the existing Eureka window: {error}");
            }
        }))
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("window-state.json");
            let preferences = WindowPreferences::read(&path);
            app.manage(desktop_tray::TrayState::default());
            app.manage(DesktopState {
                preferences: Mutex::new(preferences),
                navigation: Mutex::new((false, false)),
                menu: Mutex::new((
                    false,
                    vec!["文件".into(), "编辑".into(), "视图".into(), "帮助".into()],
                )),
                zoom: Mutex::new(1.0),
                path,
            });
            create_window(app.handle()).map_err(std::io::Error::other)?;
            if let Err(error) = desktop_tray::install(app.handle()) {
                eprintln!("Could not create the Eureka system tray: {error}");
            }
            let handle = app.handle().clone();
            thread::spawn(move || start_eureka(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Eureka")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                save_window_preferences(app);
                stop_sidecar(app);
            }
        });
}
