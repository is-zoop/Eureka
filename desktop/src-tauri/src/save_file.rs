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

fn artifact_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "产物地址无效")?;
    let parts: Vec<_> = url.path().split('/').collect();
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port() != Some(8080) || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some()
        || parts.len() != 6 || parts[1..4] != ["api", "automation", "apps"] || uuid::Uuid::parse_str(parts[4]).is_err() || parts[5] != "runtime" { return Err("仅支持当前 Eureka 本机文件产物地址。".into()); }
    let query: std::collections::HashMap<_,_> = url.query_pairs().collect();
    if query.len() != url.query_pairs().count() || query.iter().any(|(key,_)| !["mode","runId","artifactId","ownerKey","runtimeId","version","taskId"].contains(&key.as_ref()))
        || query.get("mode").map(|s| s.as_ref()) != Some("artifact") || ["runId","artifactId"].iter().any(|key| query.get(*key).is_none_or(|id| uuid::Uuid::parse_str(id).is_err())) { return Err("产物请求参数无效。".into()); }
    Ok(url)
}

#[tauri::command]
pub async fn desktop_save_artifact(webview: tauri::Webview, filename: String, url: String) -> Result<bool, String> {
    if webview.label() != crate::CONTENT_LABEL || !webview.url().is_ok_and(|u|u.scheme()=="http" && u.host_str()==Some("127.0.0.1") && u.port()==Some(8080)) { return Err("仅 Eureka 本机界面可保存文件。".into()); }
    if filename.is_empty() || filename.len()>1024 || filename=="." || filename==".." || filename.chars().any(|c|c.is_control() || "<>:\"/\\|?*".contains(c)) {return Err("产物文件名无效。".into());}
    let url = artifact_url(&url)?;
    #[cfg(windows)]
    let owner=webview.window().hwnd().map_err(|_|"窗口不可用")?.0 as usize;
    #[cfg(not(windows))]
    let owner=0usize;
    let chosen=tauri::async_runtime::spawn_blocking(move||crate::attachment_dialog::save(owner,&filename)).await.map_err(|_|"保存对话框失败")??;
    let Some(chosen)=chosen else{return Ok(false)};
    let path=std::path::PathBuf::from(chosen);
    download_artifact(url, &path).await?;
    Ok(true)
}

async fn download_artifact(url:tauri::Url, path:&Path)->Result<(),String>{
    use tokio::io::AsyncWriteExt;
    if rustls::crypto::CryptoProvider::get_default().is_none() { let _=rustls::crypto::ring::default_provider().install_default(); }
    let parent=path.parent().ok_or("保存路径无效")?;
    let temp=parent.join(format!(".eureka-save-{}.tmp",uuid::Uuid::new_v4()));
    let mut created=false;
    let result:Result<(),String>=async{
        let mut response=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(std::time::Duration::from_secs(8)).timeout(std::time::Duration::from_secs(1800)).build().map_err(|_|"本地下载初始化失败")?.get(url).send().await.map_err(|_|"产物读取失败")?;
        if !response.status().is_success(){return Err("产物不可用，请刷新运行记录后重试。".into())}
        let max=serde_json::from_str::<serde_json::Value>(include_str!("../../../features/automation/sdk/automation-sdk-contract.json")).map_err(|_|"SDK 配置无效")?["limits"]["artifactBytes"].as_u64().ok_or("产物上限无效")?;
        let expected=response.content_length().filter(|v|*v<=max).ok_or("产物长度无效或超过上限")?;
        let mut file=tokio::fs::OpenOptions::new().write(true).create_new(true).open(&temp).await.map_err(|_|"无法创建保存文件")?;created=true;let mut size=0u64;
        while let Some(bytes)=response.chunk().await.map_err(|_|"文件传输未完成")?{size+=bytes.len() as u64;if size>expected{return Err("产物大小已变化".into())}file.write_all(&bytes).await.map_err(|_|"磁盘写入失败")?;}
        if size!=expected{return Err("文件传输不完整".into())}file.sync_all().await.map_err(|_|"保存文件失败")?;drop(file);
        tokio::fs::rename(&temp,path).await.map_err(|_|"无法替换目标文件，请检查是否被占用")?;Ok(())
    }.await;
    if result.is_err() && created {let _=tokio::fs::remove_file(&temp).await;}result
}

#[cfg(test)]
mod artifact_tests {
    use super::*;
    #[test] fn artifact_download_is_local_and_cannot_fetch_other_routes(){
        let id="00000000-0000-4000-8000-000000000001";
        let valid=format!("http://127.0.0.1:8080/api/automation/apps/{id}/runtime?mode=artifact&runId={id}&artifactId={id}");
        assert!(artifact_url(&valid).is_ok());
        for value in [valid.replace("127.0.0.1","example.com"),valid.replace("8080","30141"),valid.replace("mode=artifact","mode=value"),format!("{valid}&url=https://example.com"),format!("{valid}&mode=artifact")]{assert!(artifact_url(&value).is_err());}
    }
    #[test] fn native_artifact_stream_saves_large_bytes_and_preserves_existing_file_on_incomplete_transfer(){
        use std::io::{Read,Write};
        let root=std::env::temp_dir().join(format!("eureka-native-artifact-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&root).unwrap();
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{for index in 0..2{let(mut connection,_)=listener.accept().unwrap();let mut request=[0u8;4096];let _=connection.read(&mut request);let size=if index==0{33*1024*1024}else{16};write!(connection,"HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n").unwrap();if index==0{let block=[0xa7u8;65536];for _ in 0..528{connection.write_all(&block).unwrap();}}else{connection.write_all(b"short").unwrap();}}});
        let runtime=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();let url=tauri::Url::parse(&format!("http://{address}/fixture")).unwrap();let path=root.join("report.zip");
        runtime.block_on(download_artifact(url.clone(),&path)).unwrap();assert_eq!(std::fs::metadata(&path).unwrap().len(),33*1024*1024);
        let mut file=std::fs::File::open(&path).unwrap();let mut byte=[0u8;1];file.read_exact(&mut byte).unwrap();assert_eq!(byte,[0xa7]);drop(file);
        std::fs::write(&path,b"old report").unwrap();assert!(runtime.block_on(download_artifact(url,&path)).is_err());assert_eq!(std::fs::read(&path).unwrap(),b"old report");server.join().unwrap();assert_eq!(std::fs::read_dir(&root).unwrap().count(),1);std::fs::remove_dir_all(root).unwrap();
    }
}
