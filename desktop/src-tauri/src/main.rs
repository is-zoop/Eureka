#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

use tauri::{webview::NewWindowResponse, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::{
    ffi::c_void,
    mem::{size_of, zeroed},
    os::windows::{io::AsRawHandle, process::CommandExt},
};
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Windows 10 builds differ on which immersive-dark-mode attribute they
// understand. Keep these raw compatibility IDs rather than depending on an
// SDK enum that only represents one of the historical values.
#[cfg(windows)]
const DWMWA_USE_IMMERSIVE_DARK_MODE_NEW: u32 = 20;
#[cfg(windows)]
const DWMWA_USE_IMMERSIVE_DARK_MODE_OLD: u32 = 19;

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
    Command::new("explorer.exe")
        .arg(url.as_str())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the system browser: {error}"))
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

/// Keep Windows' own caption buttons and non-client behavior. Tauri selects
/// the native light/dark caption on every Windows version; DWM enhances that
/// behavior where individual Windows releases support its attributes.
fn apply_native_titlebar(window: &tauri::WebviewWindow, dark: bool) -> Result<(), String> {
    window
        .set_theme(Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }))
        .map_err(|error| format!("Could not set Eureka window theme: {error}"))?;

    #[cfg(windows)]
    {
        // COLORREF stores bytes as 0x00BBGGRR.
        let caption_color: u32 = if dark { 0x0024_2424 } else { 0x00F5_F5F5 };
        let text_color: u32 = if dark { 0x00E8_E8E8 } else { 0x002E_3030 };
        let immersive_dark_mode: i32 = i32::from(dark);
        // Immersive dark mode gives Windows 10 and 11 a best-effort native
        // light/dark caption. CAPTION_COLOR and TEXT_COLOR provide exact
        // Eureka sidebar colors on Windows 11. Every DWM call is cosmetic:
        // unsupported versions keep their system caption and never affect
        // Eureka window creation.
        if let Ok(hwnd) = window.hwnd() {
            let set_attribute = |attribute: u32, value: *const c_void, value_size: u32| {
                let result =
                    unsafe { DwmSetWindowAttribute(hwnd.0 as _, attribute, value, value_size) };
                #[cfg(debug_assertions)]
                eprintln!("Eureka DwmSetWindowAttribute({attribute}) HRESULT: 0x{result:08X}");
                result
            };

            for (attribute, value) in [
                (
                    DWMWA_CAPTION_COLOR as u32,
                    &caption_color as *const u32 as *const c_void,
                ),
                (
                    DWMWA_TEXT_COLOR as u32,
                    &text_color as *const u32 as *const c_void,
                ),
            ] {
                let _ = set_attribute(attribute, value, size_of::<u32>() as u32);
            }

            let dark_result = set_attribute(
                DWMWA_USE_IMMERSIVE_DARK_MODE_NEW,
                &immersive_dark_mode as *const i32 as *const c_void,
                size_of::<i32>() as u32,
            );
            if dark_result < 0 {
                let _ = set_attribute(
                    DWMWA_USE_IMMERSIVE_DARK_MODE_OLD,
                    &immersive_dark_mode as *const i32 as *const c_void,
                    size_of::<i32>() as u32,
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn sync_native_titlebar(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    let dark = match theme.as_str() {
        "light" => false,
        "dark" => true,
        _ => return Err("Unsupported Eureka theme.".into()),
    };
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Eureka main window is not available.".to_string())?;
    apply_native_titlebar(&window, dark)
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

fn create_window(
    app: &tauri::AppHandle,
    label: &str,
    url: WebviewUrl,
    title: &str,
) -> Result<(), String> {
    let allowed_navigation = |url: &tauri::Url| {
        // Haze OAuth must stay in this WebView so its callback writes the
        // session cookie into Eureka's own WebView2 cookie store.
        url.scheme() == "tauri" || url.host_str() == Some("127.0.0.1") || url.scheme() == "https"
    };
    let window = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        // Retain standard Windows non-client behavior: dragging, snapping,
        // caption buttons, double-click maximize, DPI, and multi-monitor
        // handling are all owned by the operating system.
        .decorations(true)
        .inner_size(1440.0, 960.0)
        .min_inner_size(960.0, 640.0)
        .on_navigation(allowed_navigation)
        .on_new_window(|url, _| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = open_in_system_browser(&url);
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| error.to_string())?;
    if label == "main" {
        // A light fallback avoids an unstyled caption before the frontend has
        // resolved its persisted theme and calls sync_native_titlebar.
        apply_native_titlebar(&window, false)?;
    }
    Ok(())
}

fn start_eureka(app: tauri::AppHandle) {
    let log_dir = match app.path().app_log_dir() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Could not resolve Eureka log directory: {error}");
            return;
        }
    };
    if let Err(error) = create_dir_all(&log_dir) {
        eprintln!("Could not create Eureka log directory: {error}");
        return;
    }
    let log_path = log_dir.join("eureka.log");

    if let Ok(dev_url) = std::env::var("EUREKA_DEV_URL") {
        let address = dev_url.trim_start_matches("http://").trim_end_matches('/');
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if is_service_ready(address) {
                let _ = create_window(
                    &app,
                    "main",
                    WebviewUrl::External(dev_url.parse().unwrap()),
                    "Eureka",
                );
                return;
            }
            thread::sleep(Duration::from_millis(150));
        }
        append_log(
            &log_path,
            "Development server is not reachable at EUREKA_DEV_URL.",
        );
        let _ = create_window(
            &app,
            "startup-error",
            WebviewUrl::App("error.html".into()),
            "Eureka 无法启动",
        );
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
            let _ = create_window(
                &app,
                "startup-error",
                WebviewUrl::App("error.html".into()),
                "Eureka 无法启动",
            );
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
            let _ = create_window(
                &app,
                "startup-error",
                WebviewUrl::App("error.html".into()),
                "Eureka 无法启动",
            );
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
                let _ = create_window(
                    &app,
                    "startup-error",
                    WebviewUrl::App("error.html".into()),
                    "Eureka 无法启动",
                );
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
            let _ = create_window(
                &app,
                "main",
                WebviewUrl::External(url.parse().unwrap()),
                "Eureka",
            );
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
    let _ = create_window(
        &app,
        "startup-error",
        WebviewUrl::App("error.html".into()),
        "Eureka 无法启动",
    );
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
            sync_native_titlebar
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            thread::spawn(move || start_eureka(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Eureka")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                stop_sidecar(app);
            }
        });
}
