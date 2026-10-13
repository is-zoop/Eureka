use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

fn wide(value: &str) -> Result<Vec<u16>, String> {
    if value.contains('\0') {
        return Err("网址包含无效字符。".into());
    }
    Ok(value.encode_utf16().chain(std::iter::once(0)).collect())
}

fn shell_result(code: usize) -> Result<(), String> {
    if code > 32 {
        return Ok(());
    }
    if code == 31 {
        return Err("未找到默认浏览器，请在 Windows 设置中配置 HTTP/HTTPS 的默认应用。".into());
    }
    Err(format!(
        "Windows 无法打开默认浏览器（错误代码 {code}），请检查默认浏览器设置后重试。"
    ))
}

/// Open the HTTP(S) protocol association directly, without Explorer or a shell
/// command line. The full URL (including query parameters) is a single string.
pub fn open(url: &str) -> Result<(), String> {
    let operation = wide("open")?;
    let target = wide(url)?;
    // Both UTF-16 buffers remain alive for the call; unused parameters are null.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    shell_result(result as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_url_survives_utf16_encoding_without_argument_splitting() {
        let url = "http://127.0.0.1:8080/api/marketplace-auth/start?desktopRequest=abc&returnTo=%2F%3Fx%3D1&label=授权";
        let encoded = wide(url).unwrap();
        assert_eq!(encoded.last(), Some(&0));
        assert_eq!(
            String::from_utf16(&encoded[..encoded.len() - 1]).unwrap(),
            url
        );
        assert!(wide("https://example.test/\0other").is_err());
    }

    #[test]
    fn shell_open_failure_is_not_reported_as_success() {
        for code in [0, 2, 5, 31, 32] {
            assert!(shell_result(code).is_err());
        }
        assert!(shell_result(31).unwrap_err().contains("默认浏览器"));
        assert!(shell_result(33).is_ok());
        assert!(shell_result(65536).is_ok());
    }
}
