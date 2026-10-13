#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod browser_opener;
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
    path: PathBuf,
}

#[derive(Clone, Serialize)]
struct FrameSnapshot {
    maximized: bool,
    focused: bool,
    theme: String,
}

fn frame_snapshot(window: &tauri::Window) -> FrameSnapshot {
    FrameSnapshot {
        maximized: window.is_maximized().unwrap_or(false),
        focused: window.is_focused().unwrap_or(true),
        theme: window
            .app_handle()
            .state::<DesktopState>()
            .preferences
            .lock()
            .unwrap()
            .theme
            .clone(),
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
        _ => return Err("Unknown window caption action.".into()),
    }
    .map_err(|error| error.to_string())?;
    Ok(frame_snapshot(&window))
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
        WindowEvent::CloseRequested { .. } => {
            record_window_size(&event_window);
            save_window_preferences(event_window.app_handle());
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
            set_desktop_theme
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("window-state.json");
            let preferences = WindowPreferences::read(&path);
            app.manage(DesktopState {
                preferences: Mutex::new(preferences),
                path,
            });
            create_window(app.handle()).map_err(std::io::Error::other)?;
            let handle = app.handle().clone();
            thread::spawn(move || start_eureka(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Eureka")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                save_window_preferences(app);
                stop_sidecar(app);
            }
        });
}
