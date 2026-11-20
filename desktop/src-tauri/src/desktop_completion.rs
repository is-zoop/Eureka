use std::{collections::VecDeque, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, Webview, WebviewUrl,
    WebviewWindowBuilder,
};
use tokio::sync::oneshot;
use uuid::Uuid;

const LABEL: &str = "eureka-completion-popup";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 188.0;
const MARGIN: f64 = 14.0;
const MAX_PENDING: usize = 8;
const MAX_REPLY_LENGTH: usize = 2_000;
const REPLY_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionNotification {
    #[serde(skip_serializing)]
    session_id: String,
    title: String,
    summary: String,
    close_label: String,
    reply_placeholder: String,
    send_label: String,
    sending_label: String,
    sent_label: String,
    failure_label: String,
    unconfirmed_label: String,
    locale: String,
}

impl CompletionNotification {
    fn bounded(mut self) -> Self {
        self.title = self.title.chars().take(100).collect();
        self.summary = self.summary.chars().take(200).collect();
        self.close_label = self.close_label.chars().take(40).collect();
        self.reply_placeholder = self.reply_placeholder.chars().take(80).collect();
        self.send_label = self.send_label.chars().take(40).collect();
        self.sending_label = self.sending_label.chars().take(80).collect();
        self.sent_label = self.sent_label.chars().take(80).collect();
        self.failure_label = self.failure_label.chars().take(100).collect();
        self.unconfirmed_label = self.unconfirmed_label.chars().take(100).collect();
        self.locale = if self.locale == "zh-CN" {
            "zh-CN"
        } else {
            "en"
        }
        .into();
        self
    }
}

#[derive(Clone, Serialize)]
struct CompletionCard {
    id: u32,
    dark: bool,
    notification: CompletionNotification,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplyRequest {
    request_id: String,
    session_id: String,
    message: String,
}

struct PendingReply {
    request_id: String,
    result: oneshot::Sender<Option<bool>>,
}

struct ActiveCard {
    id: u32,
    session_id: String,
    reply: Option<PendingReply>,
}

impl ActiveCard {
    fn take_reply(&mut self, request_id: &str) -> Option<PendingReply> {
        if self.reply.as_ref()?.request_id == request_id {
            self.reply.take()
        } else {
            None
        }
    }
}

#[derive(Default)]
struct Queue {
    ready: bool,
    active: Option<ActiveCard>,
    sequence: u32,
    pending: VecDeque<CompletionNotification>,
}

#[derive(Default)]
pub struct CompletionState(Mutex<Queue>);

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("completion.html".into()))
        .title("Eureka")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()?;
    Ok(())
}

pub fn dispose(app: &AppHandle) {
    if let Some(popup) = app.get_webview_window(LABEL) {
        let _ = popup.destroy();
    }
}

fn clear(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<CompletionState>();
    let mut queue = state.0.lock().unwrap();
    queue.active = None;
    queue.pending.clear();
    drop(queue);
    if let Some(popup) = app.get_webview_window(LABEL) {
        popup.hide()?;
    }
    Ok(())
}

fn minimized(window: &tauri::Window) -> tauri::Result<bool> {
    Ok(window.is_visible()? && window.is_minimized()?)
}

fn show_next(app: &AppHandle) -> tauri::Result<()> {
    let Some(main) = app.get_window("main") else {
        return clear(app);
    };
    let Some(popup) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    let state = app.state::<CompletionState>();
    let mut queue = state.0.lock().unwrap();
    if !queue.ready || queue.active.is_some() {
        return Ok(());
    }
    let Some(notification) = queue.pending.pop_front() else {
        drop(queue);
        return popup.hide();
    };
    queue.sequence = queue.sequence.wrapping_add(1);
    let id = queue.sequence;
    queue.active = Some(ActiveCard {
        id,
        session_id: notification.session_id.clone(),
        reply: None,
    });
    drop(queue);

    if let Err(error) = display_card(app, &main, &popup, id, notification) {
        if let Err(clear_error) = clear(app) {
            eprintln!("Could not clear desktop completion notifications: {clear_error}");
        }
        return Err(error);
    }

    Ok(())
}

fn display_card(
    app: &AppHandle,
    main: &tauri::Window,
    popup: &tauri::WebviewWindow,
    id: u32,
    notification: CompletionNotification,
) -> tauri::Result<()> {
    let Some(monitor) = main.current_monitor()?.or(main.primary_monitor()?) else {
        return clear(app);
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let left = f64::from(area.position.x);
    let top = f64::from(area.position.y);
    let x = left + (f64::from(area.size.width) - (WIDTH + MARGIN) * scale).max(0.0);
    let y = top + (f64::from(area.size.height) - (HEIGHT + MARGIN) * scale).max(0.0);
    popup.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    let dark = matches!(main.theme(), Ok(tauri::Theme::Dark));
    app.emit_to(
        EventTarget::webview(LABEL),
        "desktop-completion-card",
        CompletionCard {
            id,
            dark,
            notification,
        },
    )?;
    if !popup.is_visible()? {
        // Showing a notification leaves the user's current window focused.
        popup.set_focusable(false)?;
        let shown = popup.show();
        popup.set_focusable(true)?;
        shown?;
    }
    Ok(())
}

fn dismiss(app: &AppHandle, id: u32) -> tauri::Result<()> {
    let state = app.state::<CompletionState>();
    let mut queue = state.0.lock().unwrap();
    if queue.active.as_ref().map(|card| card.id) != Some(id) {
        return Ok(());
    }
    queue.active = None;
    drop(queue);
    show_next(app)
}

#[tauri::command]
pub fn desktop_task_completed(
    webview: Webview,
    notification: CompletionNotification,
) -> Result<(), String> {
    if webview.label() != crate::CONTENT_LABEL {
        return Err("Completion notifications require the Eureka content view.".into());
    }
    let app = webview.app_handle();
    let Some(main) = app.get_window("main") else {
        return Ok(());
    };
    if !minimized(&main).map_err(|error| error.to_string())?
        || app.get_webview_window(LABEL).is_none()
    {
        return Ok(());
    }
    if notification.session_id.is_empty() || notification.session_id.len() > 256 {
        return Err("Invalid completion session ID.".into());
    }
    let state = app.state::<CompletionState>();
    let mut queue = state.0.lock().unwrap();
    if queue.pending.len() == MAX_PENDING {
        queue.pending.pop_front();
    }
    queue.pending.push_back(notification.bounded());
    drop(queue);
    show_next(app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn desktop_completion_ready(webview: Webview) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("Completion readiness requires the local notification view.".into());
    }
    let app = webview.app_handle();
    app.state::<CompletionState>().0.lock().unwrap().ready = true;
    show_next(app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn desktop_completion_dismiss(webview: Webview, id: u32) -> Result<(), String> {
    if webview.label() != LABEL {
        return Err("Completion dismissal requires the local notification view.".into());
    }
    dismiss(webview.app_handle(), id).map_err(|error| error.to_string())
}

fn take_pending_reply(app: &AppHandle, request_id: &str) -> Option<PendingReply> {
    app.state::<CompletionState>()
        .0
        .lock()
        .unwrap()
        .active
        .as_mut()?
        .take_reply(request_id)
}

#[tauri::command]
pub async fn desktop_completion_reply(
    webview: Webview,
    id: u32,
    message: String,
) -> Result<Option<bool>, String> {
    if webview.label() != LABEL {
        return Err("Completion replies require the local notification view.".into());
    }
    let message = message.trim();
    if message.is_empty() || message.chars().count() > MAX_REPLY_LENGTH {
        return Err("Invalid completion reply.".into());
    }

    let app = webview.app_handle();
    let state = app.state::<CompletionState>();
    let request_id = Uuid::new_v4().to_string();
    let (result, response) = oneshot::channel();
    let session_id = {
        let mut queue = state.0.lock().unwrap();
        let card = queue
            .active
            .as_mut()
            .filter(|card| card.id == id)
            .ok_or("The completion card is no longer active.")?;
        if card.reply.is_some() {
            return Err("A reply is already being sent.".into());
        }
        card.reply = Some(PendingReply {
            request_id: request_id.clone(),
            result,
        });
        card.session_id.clone()
    };

    let request = ReplyRequest {
        request_id: request_id.clone(),
        session_id,
        message: message.into(),
    };
    if let Err(error) = app.emit_to(
        EventTarget::webview(crate::CONTENT_LABEL),
        "desktop-completion-reply",
        request,
    ) {
        take_pending_reply(app, &request_id);
        return Err(error.to_string());
    }
    let outcome = tokio::time::timeout(REPLY_TIMEOUT, response).await;
    match outcome {
        Ok(Ok(accepted)) => Ok(accepted),
        _ => {
            take_pending_reply(app, &request_id);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn desktop_completion_reply_result(
    webview: Webview,
    request_id: String,
    ok: Option<bool>,
) -> Result<(), String> {
    if webview.label() != crate::CONTENT_LABEL {
        return Err("Completion reply results require the Eureka content view.".into());
    }
    if let Some(reply) = take_pending_reply(webview.app_handle(), &request_id) {
        let _ = reply.result.send(ok);
    }
    Ok(())
}
