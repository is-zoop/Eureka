use std::sync::{atomic::AtomicU64, Arc};

/// A tray popup may remain topmost without receiving focus from Windows.
/// Track actual new presses as well as deactivation, not mouse movement.
#[cfg(any(windows, test))]
struct Dismissal {
    buttons: u8,
    had_foreground: bool,
}

#[cfg(any(windows, test))]
impl Dismissal {
    fn new(buttons: u8, foreground: bool) -> Self {
        Self {
            buttons,
            had_foreground: foreground,
        }
    }

    fn update(&mut self, buttons: u8, pointer_inside: bool, foreground: bool) -> bool {
        let pressed = buttons & !self.buttons != 0;
        self.buttons = buttons;
        let deactivated = self.had_foreground && !foreground;
        self.had_foreground |= foreground;
        deactivated || (pressed && !pointer_inside)
    }
}

#[cfg(windows)]
pub fn watch(
    popup: &tauri::WebviewWindow,
    generation: Arc<AtomicU64>,
    opened: u64,
) -> tauri::Result<()> {
    use std::{sync::atomic::Ordering, thread, time::Duration};
    use windows_sys::Win32::{
        Foundation::{POINT, RECT},
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON},
            WindowsAndMessaging::{
                GetAncestor, GetCursorPos, GetForegroundWindow, GetWindowRect, IsWindowVisible,
                GA_ROOT,
            },
        },
    };

    let hwnd = popup.hwnd()?.0 as usize;
    let popup = popup.clone();
    let buttons = || unsafe {
        // Use only the current-down bit; Windows' "pressed since last call"
        // bit is shared with other applications and cannot be relied on.
        u8::from(GetAsyncKeyState(VK_LBUTTON as i32) < 0)
            | (u8::from(GetAsyncKeyState(VK_RBUTTON as i32) < 0) << 1)
            | (u8::from(GetAsyncKeyState(VK_MBUTTON as i32) < 0) << 2)
    };
    // Capture before spawning so a quick click after opening is not ignored.
    let mut dismissal = Dismissal::new(buttons(), unsafe {
        GetAncestor(GetForegroundWindow(), GA_ROOT) as usize == hwnd
    });
    thread::spawn(move || {
        // Only runs while this particular menu opening is visible. There is no
        // persistent global hook, and no click is intercepted or swallowed.
        while generation.load(Ordering::Acquire) == opened
            && unsafe { IsWindowVisible(hwnd as _) != 0 }
        {
            let mut rect = RECT::default();
            let mut point = POINT::default();
            if unsafe { GetWindowRect(hwnd as _, &mut rect) == 0 || GetCursorPos(&mut point) == 0 }
            {
                break;
            }
            let inside = point.x >= rect.left
                && point.x < rect.right
                && point.y >= rect.top
                && point.y < rect.bottom;
            let foreground =
                unsafe { GetAncestor(GetForegroundWindow(), GA_ROOT) as usize == hwnd };
            if dismissal.update(buttons(), inside, foreground) {
                let window = popup.clone();
                let current = generation.clone();
                let _ = popup.run_on_main_thread(move || {
                    // A queued dismissal from an old menu must not hide a new one.
                    if current
                        .compare_exchange(opened, opened + 1, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        let _ = window.hide();
                    }
                });
                break;
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
    Ok(())
}

#[cfg(not(windows))]
pub fn watch(_: &tauri::WebviewWindow, _: Arc<AtomicU64>, _: u64) -> tauri::Result<()> {
    // Other platforms use the existing native focus-loss and WebView blur paths.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_click_dismisses_even_when_windows_never_gave_the_popup_focus() {
        let mut state = Dismissal::new(0, false);
        assert!(
            !state.update(0, false, false),
            "moving outside alone keeps the menu open"
        );
        assert!(
            state.update(1, false, false),
            "a new outside press closes a never-focused popup"
        );
    }

    #[test]
    fn opening_click_and_menu_item_presses_are_not_treated_as_outside_clicks() {
        let mut state = Dismissal::new(2, false);
        assert!(
            !state.update(2, false, false),
            "ignore the already-held opening button"
        );
        assert!(!state.update(0, false, false));
        assert!(
            !state.update(1, true, true),
            "allow the menu item click to run"
        );
        assert!(!state.update(0, true, true));
        assert!(
            state.update(2, false, true),
            "right click outside also dismisses"
        );
    }

    #[test]
    fn switching_apps_dismisses_without_requiring_a_mouse_click() {
        let mut state = Dismissal::new(0, true);
        assert!(state.update(0, true, false));
    }
}
