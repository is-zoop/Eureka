/// Read Explorer's file-drop list only, leaving text, image data and clipboard
/// ownership untouched. Called only for an explicit paste in the composer.
#[cfg(target_os = "windows")]
pub fn read_files() -> Result<Vec<String>, String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard};
    use windows_sys::Win32::UI::Shell::DragQueryFileW;
    const CF_HDROP: u32 = 15;
    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP) == 0 { return Ok(Vec::new()); }
        if OpenClipboard(std::ptr::null_mut()) == 0 { return Err("Clipboard is busy; try pasting again.".into()); }
        struct ClipboardGuard;
        impl Drop for ClipboardGuard { fn drop(&mut self) { unsafe { CloseClipboard(); } } }
        let _guard = ClipboardGuard;
        let drop = GetClipboardData(CF_HDROP);
        if drop.is_null() { return Ok(Vec::new()); }
        let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
        if count > 100 { return Err("Select at most 100 files or folders.".into()); }
        let mut paths = Vec::new();
        for index in 0..count {
            let length = DragQueryFileW(drop, index, std::ptr::null_mut(), 0);
            let mut buffer = vec![0u16; length as usize + 1];
            let copied = DragQueryFileW(drop, index, buffer.as_mut_ptr(), buffer.len() as u32);
            if copied > 0 { paths.push(String::from_utf16_lossy(&buffer[..copied as usize])); }
        }
        Ok(paths)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn read_files() -> Result<Vec<String>, String> { Ok(Vec::new()) }
