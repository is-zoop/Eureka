use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, EventTarget, LogicalSize, Manager, PhysicalPosition, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

const TRAY_ID: &str = "eureka-tray";
pub const POPUP_LABEL: &str = "eureka-tray-popup";
const POPUP_WIDTH: f64 = 220.0;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RecentSession {
    pub id: String,
    pub title: String,
}

#[derive(Default, PartialEq, Eq)]
struct Snapshot {
    sessions: Vec<RecentSession>,
    ready: bool,
    can_create: bool,
}

#[derive(Default)]
pub struct TrayState(Mutex<Snapshot>, Arc<AtomicU64>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayAction<'a> {
    command: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
}

pub fn restore(app: &AppHandle) -> tauri::Result<()> {
    hide_popup(app)?;
    if let Some(window) = app.get_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        if let Some(content) = app.get_webview(crate::CONTENT_LABEL) {
            content.set_focus()?;
        }
    }
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_window("main") {
        crate::record_window_size(&window);
        crate::save_window_preferences(app);
        window.hide()?;
    }
    Ok(())
}

pub fn available(app: &AppHandle) -> bool {
    app.tray_by_id(TRAY_ID).is_some()
}

pub fn quit(app: &AppHandle) {
    if let Some(window) = app.get_window("main") {
        crate::record_window_size(&window);
    }
    // Exit directly: closing the window intentionally only hides it.
    // RunEvent::Exit owns sidecar cleanup for every real exit path.
    app.exit(0);
}

fn recent_label(title: &str) -> String {
    let clean = title.split_whitespace().collect::<Vec<_>>().join(" ");
    // CSS truncates the row; keep the complete title for its tooltip.
    let mut label: String = clean.chars().filter(|c| !c.is_control()).collect();
    if label.is_empty() {
        label = "未命名会话".into();
    }
    label
}

fn snapshot(sessions: Vec<RecentSession>, ready: bool, can_create: bool) -> Snapshot {
    let mut seen = std::collections::HashSet::new();
    let sessions = if ready {
        sessions
            .into_iter()
            .filter(|s| {
                !s.id.is_empty()
                    && s.id.len() <= 128
                    && !s.id.chars().any(char::is_control)
                    && seen.insert(s.id.clone())
            })
            .take(3)
            .map(|s| RecentSession {
                id: s.id,
                title: recent_label(&s.title),
            })
            .collect()
    } else {
        Vec::new()
    };
    Snapshot {
        sessions,
        ready,
        can_create: ready && can_create,
    }
}

pub fn popup_state(app: &AppHandle) -> serde_json::Value {
    let state = app.state::<TrayState>();
    let snapshot = state.0.lock().unwrap();
    serde_json::json!({
        "sessions": snapshot.sessions,
        "ready": snapshot.ready,
        "canCreate": snapshot.can_create,
        "theme": app.state::<crate::DesktopState>().preferences.lock().unwrap().theme,
    })
}

fn popup_height(count: usize) -> f64 {
    // Keep in sync with tray.css: padding, label, separators and 34px rows.
    210.0 + 34.0 * count.clamp(1, 3) as f64
}

pub fn sync_popup(app: &AppHandle) -> tauri::Result<()> {
    app.emit_to(
        EventTarget::webview(POPUP_LABEL),
        "desktop-tray-state",
        popup_state(app),
    )
}

fn hide_popup(app: &AppHandle) -> tauri::Result<()> {
    app.state::<TrayState>().1.fetch_add(1, Ordering::AcqRel);
    if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
        popup.hide()?;
    }
    Ok(())
}

fn popup_position(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    area: (f64, f64, f64, f64),
) -> PhysicalPosition<i32> {
    let (left, top, right, bottom) = area;
    let left = left + 8.0;
    let top = top + 8.0;
    let x = (x - width / 2.0).clamp(left, (right - width - 8.0).max(left));
    let preferred_y = if y - height - 8.0 >= top {
        y - height - 8.0
    } else {
        y + 8.0
    };
    let y = preferred_y.clamp(top, (bottom - height - 8.0).max(top));
    PhysicalPosition::new(x.round() as i32, y.round() as i32)
}

fn show_popup(app: &AppHandle, position: PhysicalPosition<f64>) -> tauri::Result<()> {
    let Some(popup) = app.get_webview_window(POPUP_LABEL) else {
        return Ok(());
    };
    let count = app.state::<TrayState>().0.lock().unwrap().sessions.len();
    let height = popup_height(count);
    popup.set_size(LogicalSize::new(POPUP_WIDTH, height))?;
    if let Some(monitor) = app.monitor_from_point(position.x, position.y)? {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let left = area.position.x as f64;
        let top = area.position.y as f64;
        popup.set_position(popup_position(
            position.x,
            position.y,
            POPUP_WIDTH * scale,
            height * scale,
            (
                left,
                top,
                left + area.size.width as f64,
                top + area.size.height as f64,
            ),
        ))?;
    }
    sync_popup(app)?;
    popup.show()?;
    popup.set_focus()?;
    let generation = app.state::<TrayState>().1.clone();
    let opened = generation.fetch_add(1, Ordering::AcqRel) + 1;
    crate::tray_dismissal::watch(&popup, generation, opened)?;
    app.emit_to(EventTarget::webview(POPUP_LABEL), "desktop-tray-open", ())?;
    Ok(())
}

fn create_popup(app: &AppHandle) -> tauri::Result<()> {
    let popup = WebviewWindowBuilder::new(app, POPUP_LABEL, WebviewUrl::App("tray.html".into()))
        .title("Eureka 托盘菜单")
        .inner_size(POPUP_WIDTH, popup_height(3))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()?;
    let window = popup.clone();
    popup.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            let _ = window.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        _ => {}
    });
    Ok(())
}

pub fn update(
    app: &AppHandle,
    sessions: Vec<RecentSession>,
    ready: bool,
    can_create: bool,
) -> tauri::Result<()> {
    let next = snapshot(sessions, ready, can_create);
    let state = app.state::<TrayState>();
    if *state.0.lock().unwrap() == next {
        return Ok(());
    }
    *state.0.lock().unwrap() = next;
    sync_popup(app)
}

pub fn action(app: &AppHandle, command: &str, session_id: Option<&str>) -> Result<(), String> {
    hide_popup(app).map_err(|e| e.to_string())?;
    match command {
        "close" => Ok(()),
        "open" => restore(app).map_err(|e| e.to_string()),
        "quit" => {
            quit(app);
            Ok(())
        }
        "new-task" | "settings" | "select-session" => {
            dispatch(app, command, session_id).map_err(|e| e.to_string())
        }
        _ => Err("Unknown Eureka tray action.".into()),
    }
}

fn dispatch(app: &AppHandle, command: &str, session_id: Option<&str>) -> tauri::Result<()> {
    {
        let state = app.state::<TrayState>();
        let snapshot = state.0.lock().unwrap();
        // A stale click must never open a different session after a menu update.
        if !snapshot.ready
            || (command == "new-task" && !snapshot.can_create)
            || (command == "select-session"
                && !snapshot
                    .sessions
                    .iter()
                    .any(|s| Some(s.id.as_str()) == session_id))
        {
            return Ok(());
        }
    }
    restore(app)?;
    app.emit_to(
        EventTarget::webview(crate::CONTENT_LABEL),
        "desktop-tray-action",
        TrayAction {
            command,
            session_id,
        },
    )
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| std::io::Error::other("The Eureka tray icon is missing."))?;

    create_popup(app)?;
    let result = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Eureka · 关闭窗口后继续在后台运行")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let result = match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => restore(tray.app_handle()),
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => show_popup(tray.app_handle(), position),
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("Could not perform Eureka tray action: {error}");
            }
        })
        .build(app);
    if let Err(error) = result {
        if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
            let _ = popup.destroy();
        }
        return Err(error);
    }
    // Tauri's manager retains the tray after this local handle is dropped.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_entries_are_bounded_deduplicated_and_cleared_on_logout() {
        let sessions: Vec<_> = ["a", "a", "", "b", "c", "d"]
            .into_iter()
            .map(|id| RecentSession {
                id: id.into(),
                title: "标题".into(),
            })
            .collect();
        let ready = snapshot(sessions.clone(), true, true);
        assert_eq!(
            ready
                .sessions
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
        assert!(ready.can_create);
        let logged_out = snapshot(sessions, false, true);
        assert!(logged_out.sessions.is_empty());
        assert!(!logged_out.can_create);
    }

    #[test]
    fn complete_unicode_titles_are_retained_for_tooltips() {
        assert_eq!(
            recent_label(&"会".repeat(40)),
            "会".repeat(40)
        );
        assert_eq!(recent_label(" \r\n\t "), "未命名会话");
        assert_eq!(recent_label("标题\n下一行"), "标题 下一行");
        assert_eq!(recent_label("A & B"), "A & B");
    }

    #[test]
    fn popup_stays_in_the_work_area_on_scaled_and_negative_coordinate_monitors() {
        assert_eq!(
            popup_position(
                1910.0,
                1040.0,
                POPUP_WIDTH,
                312.0,
                (0.0, 0.0, 1920.0, 1040.0)
            ),
            PhysicalPosition::new(1692, 720)
        );
        let pos = popup_position(-1900.0, 0.0, 480.0, 468.0, (-1920.0, 0.0, 0.0, 1080.0));
        assert_eq!(pos, PhysicalPosition::new(-1912, 8));
        assert_eq!(popup_height(0), popup_height(1));
        assert_eq!(popup_height(10), popup_height(3));
    }
}
