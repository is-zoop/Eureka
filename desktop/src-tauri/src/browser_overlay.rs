//! Leave holes in Wry's native child window for host HTML overlays. The rest
//! of the live website keeps painting, while popup input reaches Eureka.
use serde::Deserialize;
use tauri::Webview;

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay { #[serde(default)] pub block_input: bool, #[serde(default)] pub dim_alpha: u8, #[serde(default)] pub cutouts: Vec<Cutout> }
#[derive(Clone, Deserialize)]
pub struct Cutout { pub x: f64, pub y: f64, pub width: f64, pub height: f64, #[serde(default)] pub radius: f64 }
impl Overlay {
    pub fn blocks_input(&self) -> bool { self.block_input || self.dim_alpha > 0 || !self.cutouts.is_empty() }
    pub fn valid(&self) -> bool {
        self.cutouts.len() <= 64 && self.cutouts.iter().all(|r|
            [r.x, r.y].iter().all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
            && [r.width, r.height, r.radius].iter().all(|v| v.is_finite() && *v >= 0.0 && *v <= 1_000_000.0)
            && r.width > 0.0 && r.height > 0.0 && r.radius <= r.width.min(r.height) / 2.0)
    }
}

// A black, alpha-blended child covers only the native website. It inherits the
// parent's popup cutouts, so the host dialog stays undimmed and clickable.
// Windows destroys this child when its browser parent closes; no global HWND
// registry or screenshot of the website is needed.
#[cfg(windows)]
unsafe fn sync_dimmer(hwnd: windows_sys::Win32::Foundation::HWND, size: &windows_sys::Win32::Foundation::RECT, alpha: u8) -> Result<(), ()> {
    use windows_sys::Win32::Graphics::Gdi::{RedrawWindow, RDW_ALLCHILDREN, RDW_ERASE, RDW_FRAME, RDW_INVALIDATE, RDW_UPDATENOW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, GetParent, GetPropW, RemovePropW, SetLayeredWindowAttributes, SetPropW, SetWindowPos, HWND_TOP, LWA_ALPHA, SWP_NOACTIVATE, SWP_SHOWWINDOW, WS_CHILD, WS_DISABLED, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT};
    let key = windows::core::w!("Eureka.NativeBrowserDimmer.v1").as_ptr();
    let mut veil = GetPropW(hwnd, key);
    if !veil.is_null() && GetParent(veil) != hwnd { RemovePropW(hwnd, key); veil = std::ptr::null_mut(); }
    if alpha == 0 {
        if !veil.is_null() {
            if DestroyWindow(veil) == 0 { return Err(()); }
            RemovePropW(hwnd, key);
            RedrawWindow(hwnd, std::ptr::null(), std::ptr::null_mut(), RDW_ERASE | RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN);
        }
        return Ok(());
    }
    if veil.is_null() {
        // SS_BLACKRECT (0x4) is a built-in STATIC style. No custom class or
        // brush allocation; WS_EX_TRANSPARENT prevents intercepting input.
        veil = CreateWindowExW(WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT,
            windows::core::w!("STATIC").as_ptr(), std::ptr::null(), WS_CHILD | WS_DISABLED | 0x4,
            0, 0, size.right, size.bottom, hwnd, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
        if veil.is_null() { return Err(()); }
        if SetPropW(hwnd, key, veil) == 0 { DestroyWindow(veil); return Err(()); }
    }
    if SetLayeredWindowAttributes(veil, 0, alpha, LWA_ALPHA) == 0
        || SetWindowPos(veil, HWND_TOP, 0, 0, size.right, size.bottom, SWP_NOACTIVATE | SWP_SHOWWINDOW) == 0 {
        DestroyWindow(veil);
        RemovePropW(hwnd, key);
        return Err(());
    }
    RedrawWindow(veil, std::ptr::null(), std::ptr::null_mut(), RDW_ERASE | RDW_INVALIDATE | RDW_UPDATENOW);
    Ok(())
}

#[cfg(windows)]
pub async fn apply(view: &Webview, overlay: Overlay, css_width: f64, css_height: f64) -> Result<(), String> {
    if !overlay.valid() || !css_width.is_finite() || !css_height.is_finite() || css_width < 1.0 || css_height < 1.0 { return Err("弹层显示区域无效".into()); }
    let main = view.window().hwnd().map_err(|_| "无法读取主窗口")?.0 as usize;
    let (tx, rx) = std::sync::mpsc::channel();
    view.with_webview(move |platform| unsafe {
        use windows_sys::Win32::{Foundation::RECT, Graphics::Gdi::{CombineRgn, CreateRectRgn, CreateRoundRectRgn, DeleteObject, RedrawWindow, SetWindowRgn, HRGN, RGN_DIFF, RDW_ALLCHILDREN, RDW_ERASE, RDW_FRAME, RDW_INVALIDATE}, UI::WindowsAndMessaging::{GetClientRect, GetPropW, IsChild, RemovePropW, SetPropW}};
        struct Region(HRGN);
        impl Drop for Region { fn drop(&mut self) { unsafe { DeleteObject(self.0); } } }
        let result = (|| -> Result<(), ()> {
            let mut parent = windows::Win32::Foundation::HWND::default();
            platform.controller().ParentWindow(&mut parent).map_err(|_| ())?;
            let hwnd = parent.0;
            if hwnd.is_null() || hwnd as usize == main || IsChild(main as _, hwnd) == 0 { return Err(()); }
            let mut size = RECT::default();
            if GetClientRect(hwnd, &mut size) == 0 || size.right <= 0 || size.bottom <= 0 { return Err(()); }
            let cutout_key = windows::core::w!("Eureka.NativeBrowserCutouts.v1").as_ptr();
            let was_clipped = !GetPropW(hwnd, cutout_key).is_null();
            // Restore an explicit full client region when the last popup closes.
            // A null region alone can leave WebView2's composited pixels stale.
            let raw = CreateRectRgn(0, 0, size.right, size.bottom);
            if raw.is_null() { return Err(()); }
            let region = Region(raw);
            // These ratios include both Windows DPI and Eureka's own UI zoom.
            let sx = f64::from(size.right) / css_width;
            let sy = f64::from(size.bottom) / css_height;
            for r in &overlay.cutouts {
                // Retain off-slot coordinates so a popup crossing the website's
                // edge keeps its real corners instead of acquiring new ones.
                // The base region bounds the final subtraction to this HWND.
                let left = (r.x * sx).floor().clamp(-1_000_000_000.0, 1_000_000_000.0) as i32;
                let top = (r.y * sy).floor().clamp(-1_000_000_000.0, 1_000_000_000.0) as i32;
                let right = ((r.x + r.width) * sx).ceil().clamp(-1_000_000_000.0, 1_000_000_000.0) as i32;
                let bottom = ((r.y + r.height) * sy).ceil().clamp(-1_000_000_000.0, 1_000_000_000.0) as i32;
                if right <= left || bottom <= top { continue; }
                let raw_hole = if r.radius > 0.0 {
                    let diameter_x = (r.radius * 2.0 * sx).round().clamp(1.0, f64::from(right - left)) as i32;
                    let diameter_y = (r.radius * 2.0 * sy).round().clamp(1.0, f64::from(bottom - top)) as i32;
                    CreateRoundRectRgn(left, top, right, bottom, diameter_x, diameter_y)
                } else { CreateRectRgn(left, top, right, bottom) };
                if raw_hole.is_null() { return Err(()); }
                let hole = Region(raw_hole);
                if CombineRgn(region.0, region.0, hole.0, RGN_DIFF) == 0 { return Err(()); }
            }
            if SetWindowRgn(hwnd, region.0, 1) == 0 { return Err(()); }
            // Windows owns the region only after SetWindowRgn succeeds.
            std::mem::forget(region);
            if !overlay.cutouts.is_empty() && SetPropW(hwnd, cutout_key, 1usize as _) == 0 { return Err(()); }
            sync_dimmer(hwnd, &size, overlay.dim_alpha)?;
            let controller = platform.controller();
            if was_clipped && overlay.cutouts.is_empty() {
                // Re-present the same composition surface, without navigating,
                // reloading, replacing the profile or replaying website actions.
                let mut visible = windows::core::BOOL::default();
                controller.IsVisible(&mut visible).map_err(|_| ())?;
                if visible.as_bool() {
                    controller.SetIsVisible(false).map_err(|_| ())?;
                    controller.SetIsVisible(true).map_err(|_| ())?;
                }
            }
            if overlay.cutouts.is_empty() { RemovePropW(hwnd, cutout_key); }
            let _ = controller.NotifyParentWindowPositionChanged();
            RedrawWindow(hwnd, std::ptr::null(), std::ptr::null_mut(), RDW_ERASE | RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN);
            Ok(())
        })();
        let _ = tx.send(result.is_ok());
    }).map_err(|_| "无法调整网页与弹层层级")?;
    let ok = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(3))).await
        .map_err(|_| "无法调整网页与弹层层级")?.map_err(|_| "调整网页与弹层层级超时")?;
    if ok { Ok(()) } else { Err("无法调整网页与弹层层级".into()) }
}

#[cfg(not(windows))]
pub async fn apply(_view: &Webview, overlay: Overlay, _width: f64, _height: f64) -> Result<(), String> {
    if overlay.cutouts.is_empty() && overlay.dim_alpha == 0 { Ok(()) } else { Err("当前系统尚不支持原生网页上的弹层".into()) }
}
