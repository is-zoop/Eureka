#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod browser_opener;
mod desktop_menu;
mod desktop_completion;
mod desktop_startup;
mod desktop_tray;
mod tray_dismissal;
mod clipboard_files;
mod attachment_dialog;
mod save_file;
mod webview_layout;
mod window_preferences;
mod automation_browser;
mod automation_session_request;
mod automation_credentials;
mod browser_overlay;
mod automation_accounts;
mod app_updater;
mod updater_network;
mod session_secret;

use std::{
    fs::{create_dir_all, File},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
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
    child: Mutex<Option<BundledSidecar>>,
    // Closing a Windows Job Object terminates every process it owns. This
    // covers uninstaller-forced shutdowns, where Rust's normal exit handler
    // cannot run and an orphaned node.exe would otherwise lock resources/.
    #[cfg(windows)]
    job: Mutex<Option<JobObject>>,
}

struct BundledSidecar {
    process: Child,
    startup_id: String,
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
        "ready" => {
            let result = window.show();
            if result.is_ok() {
                desktop_startup::record_surface(&window, "window_shown");
            } else {
                desktop_startup::record(window.app_handle(), "window_show_failed");
            }
            result
        }
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
    let startup_dark = preferences.theme == "dark"
        || (preferences.theme == "auto" && matches!(window.theme(), Ok(tauri::Theme::Dark)));
    let startup_background = if startup_dark {
        tauri::webview::Color(26, 26, 26, 255)
    } else {
        tauri::webview::Color(246, 246, 246, 255)
    };
    let content = WebviewBuilder::new(CONTENT_LABEL, WebviewUrl::App("startup.html".into()))
        .background_color(startup_background)
        .zoom_hotkeys_enabled(false)
        // Injected before the Next page renders, including a full reload.
        .initialization_script(format!(
            "window.__EUREKA_DESKTOP_THEME__ = {};\n{}",
            serde_json::to_string(&preferences.theme).map_err(|error| error.to_string())?,
            "window.__EUREKA_NATIVE_TITLEBAR__ = true; document.addEventListener('DOMContentLoaded', function(){document.documentElement.classList.add('eureka-desktop','eureka-native-titlebar')}, {once:true});"
        ))
        .on_page_load(|view, payload| {
            desktop_startup::page_load(&view, &payload);
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                  automation_browser::release_current(view.app_handle());
            }
        })
        .on_navigation(allowed_navigation)
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = open_in_system_browser(&url);
            }
            NewWindowResponse::Deny
        });
    let content = window
        .add_child(
            content,
            LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
            LogicalSize::new(width, height - TITLEBAR_HEIGHT),
        )
        .map_err(|error| error.to_string())?;
    desktop_startup::observe(&content);
    desktop_startup::record(app, &format!("window_created content_width={width} content_height={}", height - TITLEBAR_HEIGHT));
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
                desktop_completion::dispose(app);
                record_window_size(&event_window);
                save_window_preferences(app);
            }
        }
        _ => {}
    });
    Ok(())
}

fn start_eureka(app: tauri::AppHandle) {
    desktop_startup::start(app, false);
}

fn spawn_bundled_sidecar(app: &tauri::AppHandle, startup_id: &str) -> Result<u32, String> {
    // Haze OAuth requires the exact 127.0.0.1:8080 callback.
    let session_secret = session_secret::load_or_create(&app.path().app_config_dir().map_err(|error| error.to_string())?)?;
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?.join("resources");
    let node = resources.join("node").join(if cfg!(windows) { "node.exe" } else { "node" });
    let log_dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    create_dir_all(&log_dir).map_err(|error| format!("Could not create service log directory: {error}"))?;
    let stdout = File::create(log_dir.join("eureka.log")).map_err(|error| format!("Could not open service log: {error}"))?;
    let stderr = stdout.try_clone().map_err(|error| format!("Could not attach service stderr: {error}"))?;
    let mut command = Command::new(node);
    command
        .arg("server.js")
        .current_dir(resources.join("app"))
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "8080")
        .env("PI_WEB_HOSTNAME", "127.0.0.1")
        .env("PI_WEB_NO_OPEN", "1")
        .env("EUREKA_AUTH_SESSION_SECRET", session_secret)
        .env("EUREKA_DESKTOP_UPDATE_TOKEN", &app.state::<app_updater::UpdaterState>().token)
        .env("EUREKA_DESKTOP_STARTUP_ID", startup_id)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let child = command.spawn().map_err(|error| format!("Could not start bundled Node service: {error}"))?;
    let pid = child.id();
    let state = app.state::<SidecarState>();
    #[cfg(windows)]
    {
        let job = match assign_sidecar_job(&child) {
            Ok(job) => job,
            Err(error) => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        *state.job.lock().unwrap() = Some(job);
    }
    *state.child.lock().unwrap() = Some(BundledSidecar { process: child, startup_id: startup_id.into() });
    Ok(pid)
}

fn running_sidecar(app: &tauri::AppHandle) -> Result<Option<(u32, String)>, String> {
    let state = app.state::<SidecarState>();
    let mut child = state.child.lock().unwrap();
    let Some(child) = child.as_mut() else { return Ok(None) };
    if let Some(status) = child.process.try_wait().map_err(|error| error.to_string())? {
        return Err(status.to_string());
    }
    Ok(Some((child.process.id(), child.startup_id.clone())))
}

fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(mut child) = app.state::<SidecarState>().child.lock().unwrap().take() {
        let _ = child.process.kill();
        let _ = child.process.wait();
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
            desktop_startup::desktop_startup_retry,
            app_updater::desktop_update_state,
            app_updater::desktop_update_check,
            app_updater::desktop_update_download,
            app_updater::desktop_update_install,
            open_external_url,
            automation_browser::desktop_automation_browser,
            automation_browser::desktop_automation_observe,
            automation_browser::desktop_automation_control,
            automation_browser::desktop_automation_app,
            automation_browser::desktop_automation_accounts,
            automation_credentials::desktop_automation_credentials,
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
            save_file::desktop_save_file,
            save_file::desktop_save_artifact,
            set_desktop_tray_state,
            desktop_tray_snapshot,
            desktop_tray_action,
            desktop_completion::desktop_task_completed,
            desktop_completion::desktop_completion_ready,
            desktop_completion::desktop_completion_dismiss,
            desktop_completion::desktop_completion_reply,
            desktop_completion::desktop_completion_reply_result,
            set_desktop_theme
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = desktop_tray::restore(app) {
                eprintln!("Could not restore the existing Eureka window: {error}");
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(desktop_startup::StartupState::new(app.handle()));
            app.manage(app_updater::UpdaterState::new(app.package_info().version.to_string()));
            let path = app.path().app_config_dir()?.join("window-state.json");
            let preferences = WindowPreferences::read(&path);
            app.manage(desktop_tray::TrayState::default());
            app.manage(desktop_completion::CompletionState::default());
            app.manage(automation_browser::BrowserState::default());
            automation_browser::start_expiry(app.handle().clone());
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
            if let Err(error) = desktop_completion::install(app.handle()) {
                eprintln!("Could not create the desktop completion notification view: {error}");
            }
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
                automation_browser::close_all(app);
                save_window_preferences(app);
                stop_sidecar(app);
            }
        });
}
