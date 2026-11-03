use std::{fs::{self, OpenOptions}, io::{self, Write}, path::Path, sync::atomic::{AtomicU64, Ordering}};

const MAX_BYTES: usize = 32 * 1024 * 1024;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn parse_payload(raw: &[u8]) -> Result<(String, Vec<u8>), String> {
    if raw.len() < 4 || raw.len() > MAX_BYTES + 1028 { return Err("保存内容无效或超过大小限制。".into()); }
    let length = u32::from_be_bytes(raw[..4].try_into().unwrap()) as usize;
    if length == 0 || length > 1024 || length > raw.len() - 4 { return Err("保存文件名无效。".into()); }
    let name = std::str::from_utf8(&raw[4..4 + length]).map_err(|_| "保存文件名无效。")?;
    if name.trim().is_empty() || name == "." || name == ".." || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) || raw.len() - 4 - length > MAX_BYTES {
        return Err("保存文件名或内容无效。".into());
    }
    Ok((name.to_string(), raw[4 + length..].to_vec()))
}

fn write_chosen_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "保存路径无效"))?;
    // Create only a fresh sibling of the exact path chosen in the OS dialog.
    for _ in 0..16 {
        let temp = parent.join(format!(".eureka-save-{}-{}.tmp", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let result = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp, path)
        })();
        if result.is_err() { let _ = fs::remove_file(&temp); }
        return result;
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "无法创建临时保存文件"))
}

#[tauri::command]
pub async fn desktop_save_file(webview: tauri::Webview, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    if webview.label() != crate::CONTENT_LABEL || !webview.url().is_ok_and(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(8080)) {
        return Err("仅 Eureka 本机界面可保存文件。".into());
    }
    let tauri::ipc::InvokeBody::Raw(raw) = request.body() else { return Err("保存内容格式无效。".into()); };
    let (filename, bytes) = parse_payload(raw)?;
    #[cfg(windows)]
    let owner = webview.window().hwnd().map_err(|error| error.to_string())?.0 as usize;
    #[cfg(not(windows))]
    let owner = 0usize;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = crate::attachment_dialog::save(owner, &filename)? else { return Ok(false); };
        write_chosen_file(Path::new(&path), &bytes).map_err(|error| format!("文件保存失败：{error}"))?;
        Ok(true)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload(name: &str, data: &[u8]) -> Vec<u8> { let mut raw = (name.len() as u32).to_be_bytes().to_vec(); raw.extend(name.as_bytes()); raw.extend(data); raw }
    #[test]
    fn unicode_filename_and_binary_content_are_preserved() {
        let (name, bytes) = parse_payload(&payload("商品报表.csv", &[0, 255, 10])).unwrap();
        assert_eq!(name, "商品报表.csv"); assert_eq!(bytes, [0, 255, 10]);
    }
    #[test]
    fn payload_cannot_supply_a_path_or_truncated_header() {
        for name in ["../private.json", "C:\\private.json", "foo/bar.zip", "", "..", "bad\nname"] { assert!(parse_payload(&payload(name, &[])).is_err()); }
        assert!(parse_payload(&[0, 0, 4, 0, 1]).is_err());
        assert!(parse_payload(&[0, 0]).is_err());
    }
}
