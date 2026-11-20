//! Session credentials stay in native memory. The application receives business data only.
use base64::Engine as _;
use std::{collections::BTreeMap, time::Duration};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{http::header, webview::cookie::Cookie, Url};

// Keep aligned with features/automation/shared/automation-data-limits.ts. Response envelopes have a
// separate 20 MiB budget on the web/worker side.
include!(concat!(env!("OUT_DIR"), "/automation-sdk-limits.rs"));

async fn read_response_body(response: reqwest::Response) -> Result<Vec<u8>, String> { read_response_limited(response,MAX_RESPONSE_BYTES).await }
async fn read_response_limited(mut response: reqwest::Response, limit:usize) -> Result<Vec<u8>, String> {
    let too_large = || format!("API 响应超过 {} MiB 宿主上限；请求已派发，不自动重试。请分页或减少返回字段",limit/1024/1024);
    if response.content_length().is_some_and(|length| length > limit as u64) { return Err(too_large()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "API 响应不完整，结果未知，不自动重试")? {
        if chunk.len() > limit - bytes.len() { return Err(too_large()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Declaration {
    url: String,
    method: String,
    #[serde(default)] credentials: Option<String>,
    #[serde(default)] headers: BTreeMap<String, String>,
    #[serde(default)] response: Option<String>,
    #[serde(default)] signature: Option<Signature>,
    #[serde(default, rename = "allowDynamicUrl")] allow_dynamic_url: bool,
    #[serde(default)] auth: Option<Auth>,
    #[serde(default)] multipart: Option<MultipartDeclaration>,
    #[serde(default, rename="responseHeaders")] response_headers: Vec<String>,
    #[serde(default)] redirects: u8,
    #[serde(default, rename="timeoutMs")] timeout_ms: Option<u64>,
}
#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Signature { kind: String, app_key: String }
#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct Auth {kind:String,credential_id:String,header:Option<String>}
#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct MultipartDeclaration { #[serde(default)]fields:Vec<String>,files:Vec<UploadField>,max_bytes:Option<u64> }
#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct UploadField { name:String, #[serde(default)]multiple:bool, content_types:Option<Vec<String>>, max_bytes:Option<u64> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MultipartInput {#[serde(default)]fields:BTreeMap<String,String>,files:Vec<UploadFile>}
#[derive(Deserialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
struct UploadFile {name:String,path:String,filename:String,content_type:String,size:u64,sha256:String}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(default)] url: Option<String>,
    #[serde(default)] query: BTreeMap<String, String>,
    #[serde(default)] form: Option<BTreeMap<String, String>>,
    #[serde(default)] json: Option<Value>,
    #[serde(default)] multipart: Option<MultipartInput>,
}
impl Declaration {
    pub fn url(&self) -> Result<Url, String> {
        let url = Url::parse(&self.url).map_err(|_| "API URL 无效")?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() { return Err("API 地址仅支持 HTTP 或 HTTPS 协议".into()); }
        if !url.username().is_empty() || url.password().is_some() { return Err("API 地址不能包含用户名或密码，请使用私有配置传入业务参数".into()); }
        if url.fragment().is_some() { return Err("API 地址不能包含 #fragment，片段不会发送给服务端".into()); }
        if !matches!(self.method.as_str(), "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE") || !matches!(self.response.as_deref(), None | Some("json" | "text" | "bytes")) { return Err("API 方法或响应类型无效".into()); }
        if !matches!(self.credentials.as_deref(), None | Some("browser" | "omit")) { return Err("API credentials 需要 browser 或 omit".into()); }
        if let Some(auth)=&self.auth {
            crate::automation_credentials::auth_header(&auth.kind,auth.header.as_deref())?;
            if auth.credential_id.is_empty()||auth.credential_id.len()>80||!auth.credential_id.as_bytes()[0].is_ascii_lowercase()||!auth.credential_id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_'||b==b'-')||url.scheme()!="https"||self.credentials.as_deref()!=Some("omit")||self.signature.is_some(){return Err("独立凭证只支持 HTTPS、omit 请求且不能混用签名".into());}
        }
        if self.redirects>3||self.redirects>0&&(!matches!(self.method.as_str(),"GET"|"HEAD")||self.signature.is_some()||self.multipart.is_some()||self.allow_dynamic_url){return Err("仅普通 GET/HEAD 可声明最多三次重定向".into());}
        if self.timeout_ms.is_some_and(|v|v<1000||v>1800000)||self.response_headers.iter().any(|v|!matches!(v.as_str(),"content-type"|"content-disposition"|"retry-after"|"etag"|"last-modified")){return Err("请求超时或响应头声明无效".into());}
        if self.multipart.is_some()&&(!matches!(self.method.as_str(),"POST"|"PUT"|"PATCH")||self.signature.is_some()||self.headers.keys().any(|v|v.eq_ignore_ascii_case("content-type"))){return Err("上传只支持无签名 POST/PUT/PATCH，Content-Type 由宿主生成".into());}
        if self.allow_dynamic_url && (self.method!="GET"||self.response.as_deref()!=Some("bytes")||url.query().is_some()||self.signature.is_some()) {return Err("动态下载地址仅支持无签名、无固定 query 的 GET bytes 声明".into());}
        if let Some(signature) = &self.signature {
            let host = url.host_str().unwrap_or("");
            if signature.kind != "taobao-mtop" || signature.app_key.is_empty() || signature.app_key.len() > 30 || !signature.app_key.bytes().all(|b| b.is_ascii_digit()) || url.scheme() != "https" || self.credentials.as_deref() == Some("omit") || !["taobao.com", "tmall.com"].iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}"))) { return Err("MTOP 签名需要淘宝/天猫 HTTPS 地址和浏览器登录态".into()); }
            if url.query_pairs().any(|(key, _)| matches!(key.as_ref(), "sign" | "t" | "appKey")) || url.query_pairs().filter(|(key, _)| key == "data").count() > 1 { return Err("MTOP URL 不能预置 sign、t、appKey 或重复的 data；签名参数由宿主生成".into()); }
        }
        Ok(url)
    }
    fn request_url(&self, dynamic:Option<&str>)->Result<Url,String>{
        let base=self.url()?;let Some(raw)=dynamic else{return Ok(base)};
        if !self.allow_dynamic_url||raw.len()>16000{return Err("未声明动态下载地址，或地址无效".into());}
        let target=Url::parse(raw).map_err(|_|"下载地址无效")?;let path=target.path().to_ascii_lowercase();
        if target.origin()!=base.origin()||!target.username().is_empty()||target.password().is_some()||target.fragment().is_some()||path.contains("%2f")||path.contains("%5c")||!(target.path()==base.path()||base.path().ends_with('/')&&target.path().starts_with(base.path())){return Err("下载地址超出声明的域名或路径范围".into());}
        Ok(target)
    }
}

fn client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() { let _ = rustls::crypto::ring::default_provider().install_default(); }
    reqwest::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(20))
        .build().map_err(|_| "API 本机请求服务不可用".into())
}

// MTOP specifies MD5; use Windows' existing CNG provider without an extra runtime.
fn mtop_md5(input: &str) -> Result<String, String> {
    use windows_sys::Win32::Security::Cryptography::*;
    let mut algorithm = std::ptr::null_mut();
    let mut hash = std::ptr::null_mut();
    let mut digest = [0u8; 16];
    let ok = unsafe {
        let opened = BCryptOpenAlgorithmProvider(&mut algorithm, BCRYPT_MD5_ALGORITHM, std::ptr::null(), 0) >= 0;
        let created = opened && BCryptCreateHash(algorithm, &mut hash, std::ptr::null_mut(), 0, std::ptr::null(), 0, 0) >= 0;
        let hashed = created && BCryptHashData(hash, input.as_ptr(), input.len() as u32, 0) >= 0 && BCryptFinishHash(hash, digest.as_mut_ptr(), 16, 0) >= 0;
        if !hash.is_null() { BCryptDestroyHash(hash); }
        if !algorithm.is_null() { BCryptCloseAlgorithmProvider(algorithm, 0); }
        hashed
    };
    if !ok { return Err("本机 MTOP 签名服务不可用".into()); }
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn prepare(declaration: &Declaration, input: Value, cookies: &[Cookie<'static>], origin: &str, timestamp: &str) -> Result<(reqwest::Request, Vec<String>), String> {
    let has_json = input.get("json").is_some();
    let input: Input = serde_json::from_value(input).map_err(|_| "API 参数格式无效")?;
    let mut url = declaration.request_url(input.url.as_deref())?;
    if input.multipart.is_some() && (input.form.is_some() || has_json || declaration.multipart.is_none()) {return Err("multipart 与 form/json 冲突或未声明".into());}
    if input.form.is_some() && has_json || matches!(declaration.method.as_str(), "GET" | "HEAD") && (input.form.is_some() || has_json) { return Err("API 请求体格式冲突：form 与 json 二选一，GET/HEAD 不携带请求体".into()); }
    // Recheck Secure before constructing a manual Cookie header, even if the
    // platform's Cookie lookup already filtered it for the requested URL.
    let cookies: Vec<_> = cookies.iter().filter(|cookie| declaration.credentials.as_deref() != Some("omit") && (url.scheme() == "https" || cookie.secure() != Some(true))).collect();
    // Preserve fixed query pairs (including duplicates). Runtime values replace
    // every fixed value with the same key; they cannot change the endpoint.
    let rewrite_query = !input.query.is_empty() || declaration.signature.is_some();
    let mut query: Vec<(String, String)> = url.query_pairs().filter(|(key, _)| !input.query.contains_key(key.as_ref())).map(|(key, value)| (key.into_owned(), value.into_owned())).collect();
    query.extend(input.query.into_iter());
    let mut secrets: Vec<String> = cookies.iter().map(|c| c.value().to_string()).filter(|v| !v.is_empty()).collect();
    if let Some(signature) = &declaration.signature {
        if query.iter().filter(|(key, _)| key == "data").count() > 1 || input.form.as_ref().is_some_and(|form| form.contains_key("data")) && query.iter().any(|(key, _)| key == "data") { return Err("MTOP data 只能声明一次".into()); }
        if ["sign", "t", "appKey"].iter().any(|key| query.iter().any(|(name, _)| name == key) || input.form.as_ref().is_some_and(|form| form.contains_key(*key))) { return Err("MTOP 签名参数只能由宿主生成".into()); }
        let data = input.form.as_ref().and_then(|form| form.get("data")).or_else(|| query.iter().find(|(key, _)| key == "data").map(|(_, value)| value)).ok_or("MTOP 请求缺少原始 data 文本")?;
        let token = cookies.iter().find(|c| c.name() == "_m_h5_tk").and_then(|c| c.value().split('_').next()).filter(|token| !token.is_empty()).ok_or("MTOP 登录 token 已失效，请重新登录")?;
        let sign = mtop_md5(&format!("{token}&{timestamp}&{}&{data}", signature.app_key))?;
        secrets.extend([token.to_string(), sign.clone()]);
        query.extend([("t".into(), timestamp.into()), ("appKey".into(), signature.app_key.clone()), ("sign".into(), sign)]);
    }
    let method = reqwest::Method::from_bytes(declaration.method.as_bytes()).map_err(|_| "API 方法无效")?;
    if rewrite_query { url.set_query(None); if !query.is_empty() { url.query_pairs_mut().extend_pairs(&query); } }
    let mut request = client()?.request(method, url).header(header::ORIGIN, origin);
    for (key, value) in &declaration.headers {
        if !matches!(key.to_ascii_lowercase().as_str(), "accept" | "content-type" | "referer" | "x-requested-with" | "user-agent") || value.contains(['\r', '\n', '\0']) { return Err("API 请求头无效；Cookie 只能由宿主注入".into()); }
        request = request.header(key, value);
    }
    // cookies_for_url applies domain/path/secure/expiry rules, including HttpOnly cookies.
    if !cookies.is_empty() { request = request.header(header::COOKIE, cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ")); }
    if let Some(form) = input.form {
        let mut encoded = Url::parse("https://encoder.invalid").map_err(|_| "API 表单编码不可用")?;
        encoded.query_pairs_mut().extend_pairs(&form);
        request = request.header(header::CONTENT_TYPE, "application/x-www-form-urlencoded").body(encoded.query().unwrap_or("").to_string());
    }
    if has_json { request = request.json(&input.json.unwrap_or(Value::Null)); }
    Ok((request.build().map_err(|_| "API 请求参数无效")?, secrets))
}

fn redact(value: &mut Value, secrets: &[String]) {
    match value {
        // Small preference-cookie values such as "1" must not corrupt item IDs or dates.
        Value::String(text) => { for secret in secrets { if secret.len() >= 8 { *text = text.replace(secret, "[credential]"); } } },
        Value::Array(values) => { for value in values { redact(value, secrets); } },
        Value::Object(values) => { for (key, value) in values { let key = key.to_ascii_lowercase().replace(['-', '_'], ""); if ["cookie", "setcookie", "authorization", "token", "accesstoken", "refreshtoken", "password", "sessiontoken", "csrftoken", "xsrftoken", "tbtoken"].contains(&key.as_str()) { *value = json!("[credential]"); } else { redact(value, secrets); } } },
        _ => {},
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StreamDownload { path: String, max_bytes: u64, timeout_ms: u64 }
impl StreamDownload {
    fn validate(&self) -> Result<(), String> {
        let contract: Value = serde_json::from_str(include_str!("../../../features/automation/sdk/automation-sdk-contract.json")).map_err(|_| "SDK contract invalid")?;
        let path = std::path::Path::new(&self.path);
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let token = name.strip_prefix(".eureka-stream-").and_then(|s| s.strip_suffix(".part")).unwrap_or("");
        if !path.is_absolute() || token.len()!=32 || !token.bytes().all(|b|b.is_ascii_hexdigit()) || self.max_bytes==0 || self.max_bytes>contract["limits"]["downloadBytes"].as_u64().unwrap_or(0) || self.timeout_ms<1000 || self.timeout_ms>contract["limits"]["maxDownloadTimeoutMs"].as_u64().unwrap_or(0) { return Err("Invalid native stream destination".into()); }
        Ok(())
    }
}
struct PartialDownload { path: String, complete: bool }
impl Drop for PartialDownload { fn drop(&mut self) { if !self.complete { let _ = std::fs::remove_file(&self.path); } } }
async fn stream_to_file(mut response: reqwest::Response, sink: &StreamDownload, check: &impl Fn()->Result<(),String>) -> Result<u64,String> {
    use std::io::Write;
    sink.validate()?; check()?;
    if response.content_length().is_some_and(|size| size>sink.max_bytes) { return Err("Download exceeds configured byte limit".into()); }
    let expected = response.content_length();
    let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&sink.path).map_err(|_|"Cannot create private download staging file")?;
    let mut partial=PartialDownload{path:sink.path.clone(),complete:false};
    let mut bytes=0u64;
    let result: Result<(),String> = async {
        loop {
            check()?;
            let chunk=match tokio::time::timeout(Duration::from_millis(250),response.chunk()).await {Ok(value)=>value.map_err(|_|"Download incomplete; not retried")?,Err(_)=>continue};
            let Some(chunk)=chunk else {break};
            if chunk.len() as u64>sink.max_bytes-bytes {return Err("Download exceeds configured byte limit".into());}
            file.write_all(&chunk).map_err(|_|"Cannot write downloaded file")?; bytes+=chunk.len() as u64;
        }
        if expected.is_some_and(|size|size!=bytes){return Err("Download length mismatch".into());}
        check()?;file.sync_all().map_err(|_|"Cannot flush downloaded file")?;Ok(())
    }.await;
    drop(file); result?;partial.complete=true;Ok(bytes)
}
pub async fn execute_with_stream(view: &tauri::Webview, raw: Value, input: Value, origin: &str, sink:Option<StreamDownload>, credential_context:Option<(&tauri::AppHandle,&str,&str,Option<&str>)>, check:impl Fn()->Result<(),String>) -> Result<Value, String> {

    let mut raw=raw;let mut input=input;let mut hops=0u8;
    let original:Declaration=serde_json::from_value(raw.clone()).map_err(|_|"API 声明无效")?;
    let base=original.url()?;
    loop {
    let declaration: Declaration = serde_json::from_value(raw.clone()).map_err(|_| "API 声明无效")?;
    let parsed:Input=serde_json::from_value(input.clone()).map_err(|_|"API 输入无效")?;
    let url = declaration.request_url(parsed.url.as_deref())?;
    let cookies = if declaration.credentials.as_deref() == Some("omit") { vec![] } else { view.cookies_for_url(url.clone()).map_err(|_| "无法读取当前浏览环境的登录态")? };
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "本机时间无效")?.as_millis().to_string();
    if let Some(ref sink)=sink {sink.validate()?;if declaration.response.as_deref()!=Some("bytes"){return Err("Stream requires bytes response".into());}}
    let (mut request, mut secrets) = prepare(&declaration, input.clone(), &cookies, origin, &timestamp)?;
    let credential=if let Some(auth)=&declaration.auth {let (app,owner,app_id,expected)=credential_context.ok_or("凭证缺少应用身份")?;let credential=crate::automation_credentials::load(app,owner,app_id,&auth.credential_id,&auth.kind,auth.header.as_deref(),&url,&declaration.method)?;if expected.is_some_and(|value|value!=credential.revision){return Err("检查点的接口凭证已变化，未派发请求".into());}let value=if auth.kind=="bearer"{format!("Bearer {}",credential.value)}else{credential.value.clone()};let header=crate::automation_credentials::auth_header(&auth.kind,auth.header.as_deref())?;request.headers_mut().insert(reqwest::header::HeaderName::from_bytes(header.as_bytes()).map_err(|_|"凭证请求头无效")?,reqwest::header::HeaderValue::from_str(&value).map_err(|_|"凭证格式无效")?);Some(credential)}else{None};
    if let Some(upload)=parsed.multipart {request=attach_multipart(&declaration,request,upload)?;}
    if let Some(ms)=declaration.timeout_ms.or_else(||declaration.multipart.as_ref().map(|_|180000)){*request.timeout_mut()=Some(Duration::from_millis(ms));}
    let alive=||{check()?;if let Some(credential)=&credential{credential.check()?;}Ok(())};
    if let Some(ref sink)=sink {*request.timeout_mut()=Some(Duration::from_millis(sink.timeout_ms));}
    check()?;
    let response = send_checked(request,&alive).await?;
    check()?;
    let status = response.status().as_u16();
    // Update the SAME browser environment; neither Set-Cookie nor Location crosses IPC.
    if declaration.credentials.as_deref() != Some("omit") { for raw in response.headers().get_all(header::SET_COOKIE) {
        let raw = raw.to_str().map_err(|_| "API 会话更新格式无效")?;
        let mut cookie = Cookie::parse(raw.to_string()).map_err(|_| "API 会话更新格式无效")?.into_owned();
        if url.scheme() == "http" && cookie.secure() == Some(true) { continue; }
        let host = url.host_str().ok_or("API 域名无效")?;
        if let Some(domain) = cookie.domain() {
            let domain = domain.trim_start_matches('.');
            if host != domain && !host.ends_with(&format!(".{domain}")) { return Err("API 返回了不属于目标域名的 Cookie".into()); }
        } else { cookie.set_domain(host.to_string()); }
        if cookie.path().is_none() { cookie.set_path(url.path().rsplit_once('/').map(|(path, _)| if path.is_empty() { "/" } else { path }).unwrap_or("/").to_string()); }
        if !cookie.value().is_empty() { secrets.push(cookie.value().to_string()); }
        if cookie.name() == "_m_h5_tk" { if let Some(token) = cookie.value().split('_').next().filter(|value| !value.is_empty()) { secrets.push(token.to_string()); } }
        if let Some(age) = cookie.max_age() {
            if age.whole_seconds() <= 0 { view.delete_cookie(cookie).map_err(|_| "API 登录态更新失败")?; continue; }
            cookie.set_expires(tauri::webview::cookie::time::OffsetDateTime::now_utc().saturating_add(age));
        }
        view.set_cookie(cookie).map_err(|_| "API 登录态更新失败，请核对登录后继续")?;
    } }
    if matches!(status, 401 | 403) { return Err(if declaration.credentials.as_deref() == Some("omit") { "API 返回 401/403，请核对该接口的鉴权参数；当前请求未使用浏览器 Cookie" } else { "API 登录已失效或需要人工验证，请在侧栏完成登录后继续" }.into()); }
    if (300..400).contains(&status) {
        if hops>=declaration.redirects||!matches!(status,301|302|303|307|308){return Err("API 返回跳转，未启用或已超过受控重定向次数".into());}
        let target=controlled_redirect(&base,&url,response.headers().get(header::LOCATION).and_then(|v|v.to_str().ok()).ok_or("跳转缺少有效地址")?)?;
        hops+=1;raw["url"]=json!(target.as_str());input=json!({});alive()?;continue;
    }
    let mut safe_headers=serde_json::Map::new();for key in &declaration.response_headers{if let Some(value)=response.headers().get(key).and_then(|v|v.to_str().ok()){safe_headers.insert(key.clone(),json!(value.chars().take(4000).collect::<String>()));}}
    for value in safe_headers.values_mut(){redact(value,&secrets);if let Some(credential)=&credential{redact_auth(value,&credential.value);}}
    let content_type=response.headers().get(header::CONTENT_TYPE).and_then(|value|value.to_str().ok()).unwrap_or("application/octet-stream").chars().take(200).collect::<String>();
    if declaration.response.as_deref()==Some("bytes"){
        if !(200..300).contains(&status){return Err(format!("下载返回 HTTP {status}，未保存文件"));}
        if let Some(sink)=sink {let bytes=stream_to_file(response,&sink,&alive).await?;return Ok(credential_receipt(json!({"status":status,"data":{"encoding":"file","bytes":bytes,"contentType":content_type},"dispatched":true}),&credential));}
        let bytes=read_response_limited(response,MAX_DOWNLOAD_BYTES).await?;
        return Ok(credential_receipt(binary_response(status,&content_type,&bytes),&credential));
    }
    let bytes = read_response_body(response).await?;
    let mut data = if declaration.response.as_deref() == Some("text") { json!(String::from_utf8(bytes).map_err(|_| "API 文本不是 UTF-8")?) }
        else { serde_json::from_slice(&bytes).map_err(|_| "API 未返回 JSON，可能需要重新登录或人工验证")? };
    if data.get("ret").and_then(Value::as_array).is_some_and(|items| items.iter().filter_map(Value::as_str).any(|value| ["FAIL_SYS_TOKEN_EXOIRED", "FAIL_SYS_TOKEN_EMPTY", "FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_USER_VALIDATE"].iter().any(|code| value.starts_with(code)))) { return Err("MTOP 登录已失效或需要人工验证，请在侧栏完成登录后继续".into()); }
    alive()?;redact(&mut data, &secrets);if let Some(credential)=&credential{redact_auth(&mut data,&credential.value);}
    let mut result=json!({ "status": status, "data": data, "dispatched": true });
    if !declaration.response_headers.is_empty(){result["headers"]=Value::Object(safe_headers);}
    return Ok(credential_receipt(result,&credential));
    }
}
fn credential_receipt(mut value:Value,credential:&Option<crate::automation_credentials::Credential>)->Value{if let Some(credential)=credential{value["credentialRevision"]=json!(credential.revision);}value}

fn binary_response(status:u16,content_type:&str,bytes:&[u8])->Value{
    json!({"status":status,"data":{"encoding":"base64","base64":base64::engine::general_purpose::STANDARD.encode(bytes),"bytes":bytes.len(),"contentType":content_type},"dispatched":true})
}

fn redact_auth(value:&mut Value,secret:&str){
    if secret.is_empty(){return;}
    match value {Value::String(text)=>*text=text.replace(secret,"[credential]"),Value::Array(items)=>for item in items{redact_auth(item,secret);},Value::Object(items)=>for item in items.values_mut(){redact_auth(item,secret);},_=>{}}
}
async fn send_checked(request:reqwest::Request,check:&impl Fn()->Result<(),String>)->Result<reqwest::Response,String>{
    check()?;let client=client()?;let mut pending=Box::pin(client.execute(request));
    loop {match tokio::time::timeout(Duration::from_millis(250),&mut pending).await {Ok(response)=>{check()?;return response.map_err(|_|"API 请求结果未知，不自动重试".into());},Err(_)=>check()?}}
}
fn controlled_redirect(base:&Url,current:&Url,location:&str)->Result<Url,String>{
    let target=current.join(location).map_err(|_|"重定向地址无效")?;
    let directory=base.path().rsplit_once('/').map(|(value,_)|format!("{value}/")).unwrap_or("/".into());
    let path=target.path().to_ascii_lowercase();
    if target.origin()!=base.origin()||!target.username().is_empty()||target.password().is_some()||target.fragment().is_some()||path.contains("%2f")||path.contains("%5c")||!(target.path()==base.path()||target.path().starts_with(&directory)){return Err("重定向超出同源路径范围".into());}Ok(target)
}
fn attach_multipart(declaration:&Declaration,request:reqwest::Request,input:MultipartInput)->Result<reqwest::Request,String>{
    use std::os::windows::fs::{OpenOptionsExt,MetadataExt};
    let spec=declaration.multipart.as_ref().ok_or("未声明上传")?;
    let limits:Value=serde_json::from_str(include_str!("../../../features/automation/sdk/automation-sdk-contract.json")).map_err(|_|"SDK contract invalid")?;
    let maximum=limits["limits"]["uploadBytes"].as_u64().unwrap_or(0);let max_bytes=spec.max_bytes.unwrap_or(maximum);
    if spec.files.is_empty()||spec.files.len()>16||max_bytes==0||max_bytes>maximum||input.files.is_empty()||input.files.len()>16||input.fields.len()>100{return Err("上传声明或大小限制无效".into());}
    let mut form=reqwest::multipart::Form::new();let mut fields_size=0;
    for (name,value) in input.fields {fields_size+=name.len()+value.len();if !spec.fields.contains(&name)||fields_size>64000{return Err("上传表单字段未声明或过大".into());}form=form.text(name,value);}
    let mut total=0;let mut counts=BTreeMap::new();
    for value in input.files {
        let field=spec.files.iter().find(|field|field.name==value.name).ok_or("上传文件字段未声明")?;
        let count=counts.entry(value.name.clone()).or_insert(0);*count+=1;
        let path=std::path::Path::new(&value.path);let token=path.file_name().and_then(|v|v.to_str()).and_then(|v|v.strip_prefix(".eureka-upload-")).and_then(|v|v.strip_suffix(".part")).unwrap_or("");
        if !path.is_absolute()||token.len()!=32||!token.bytes().all(|v|v.is_ascii_hexdigit())||*count>1&&!field.multiple||value.filename.is_empty()||value.filename.len()>600||value.filename.chars().any(|c|c.is_control()||matches!(c,'/'|'\\'|'"'))||value.sha256.len()!=64||!value.sha256.bytes().all(|v|v.is_ascii_hexdigit())||field.content_types.as_ref().is_some_and(|types|!types.contains(&value.content_type)){return Err("上传快照、名称或类型无效".into());}
        let meta=std::fs::symlink_metadata(path).map_err(|_|"上传快照不可读取")?;
        if !meta.is_file()||meta.file_attributes()&0x400!=0||meta.len()!=value.size||value.size>field.max_bytes.unwrap_or(max_bytes)||value.size>max_bytes-total{return Err("上传快照大小或类型已变化".into());}total+=value.size;
        let file=std::fs::OpenOptions::new().read(true).share_mode(0x1|0x4).open(path).map_err(|_|"上传快照不可读取")?;
        if file.metadata().map_err(|_|"上传快照不可读取")?.len()!=value.size{return Err("上传快照已变化".into());}
        let file=tokio::fs::File::from_std(file);
        let part=reqwest::multipart::Part::stream_with_length(file,value.size).file_name(value.filename).mime_str(&value.content_type).map_err(|_|"上传内容类型无效")?;
        form=form.part(value.name,part);
    }
    client()?.request(request.method().clone(),request.url().clone()).headers(request.headers().clone()).multipart(form).build().map_err(|_|"上传请求构造失败".into())
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener, sync::atomic::{AtomicUsize, Ordering}};
    #[test] fn controlled_redirects_and_short_secret_redaction_are_restricted() {
        let base=Url::parse("https://api.example/reports/start").unwrap();
        assert!(controlled_redirect(&base,&base,"next?page=2").is_ok());
        for target in ["https://other.example/reports/next","http://api.example/reports/next","/outside","/reports/a%2fb","https://user@api.example/reports/next"] {assert!(controlled_redirect(&base,&base,target).is_err());}
        let mut value=json!({"data":["prefix xyz suffix",{"key":"xyz"}]});redact_auth(&mut value,"xyz");assert_eq!(value,json!({"data":["prefix [credential] suffix",{"key":"[credential]"}]}));
    }
    #[test] fn multipart_streams_exact_binary_bytes_and_cancels_without_replay() {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let path=std::env::temp_dir().join(format!(".eureka-upload-{}.part",uuid::Uuid::new_v4().simple()));
        let bytes=vec![0x81u8;17*1024*1024];std::fs::write(&path,&bytes).unwrap();
        let server=std::thread::spawn(move||{let(mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();let mut header=Vec::new();let mut byte=[0u8;1];while !header.ends_with(b"\r\n\r\n"){stream.read_exact(&mut byte).unwrap();header.push(byte[0]);}let text=String::from_utf8(header).unwrap();let length=text.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|v|v.trim().parse::<usize>().unwrap())).unwrap();assert!(text.contains("multipart/form-data; boundary="));let mut body=vec![0u8;length];stream.read_exact(&mut body).unwrap();assert!(body.windows(26).any(|v|v==b"filename=\"report.csv\"\r\nCon"));assert_eq!(body.iter().filter(|v|**v==0x81).count(),17*1024*1024);stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();});
        let declaration:Declaration=serde_json::from_value(json!({"url":format!("http://{address}/upload"),"method":"POST","credentials":"omit","multipart":{"fields":["shop"],"files":[{"name":"report","contentTypes":["text/csv"]}]}})).unwrap();
        let input=MultipartInput{fields:BTreeMap::from([("shop".into(),"fixture".into())]),files:vec![UploadFile{name:"report".into(),path:path.to_string_lossy().into_owned(),filename:"report.csv".into(),content_type:"text/csv".into(),size:bytes.len()as u64,sha256:"a".repeat(64)}]};
        tauri::async_runtime::block_on(async {let(request,_)=prepare(&declaration,json!({}),&[],"http://seller.example","0").unwrap();let request=attach_multipart(&declaration,request,input).unwrap();assert_eq!(send_checked(request,&||Ok(())).await.unwrap().status(),200);});server.join().unwrap();std::fs::remove_file(path).unwrap();
        let calls=AtomicUsize::new(0);tauri::async_runtime::block_on(async{let request=client().unwrap().get("http://127.0.0.1:1/never").build().unwrap();assert!(send_checked(request,&||{calls.fetch_add(1,Ordering::SeqCst);Err("cancelled".into())}).await.is_err());});assert_eq!(calls.load(Ordering::SeqCst),1);
    }
    #[test] fn native_request_fields_match_the_shared_cloud_and_model_fixtures() {
        let fixtures: Vec<Value> = serde_json::from_str(include_str!("../../../features/automation/sdk/automation-sdk-contract-fixtures.json")).unwrap();
        for fixture in fixtures {
            if fixture[0].as_str()!=Some("request"){continue;}
            let valid=serde_json::from_value::<Declaration>(fixture[1].clone()).and_then(|value|prepare(&value,json!({}),&[],"https://seller.example","1000").map(|_|()).map_err(serde::de::Error::custom)).is_ok();
            assert_eq!(valid,fixture[2].as_bool().unwrap(),"{}",fixture[1]);
        }
    }
    fn download(size: usize, cancel: bool) -> (Result<u64,String>, std::path::PathBuf) {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{
            let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut header=Vec::new();let mut byte=[0u8;1];while !header.ends_with(b"\r\n\r\n"){if stream.read(&mut byte).unwrap_or(0)==0{return;}header.push(byte[0]);}
            if write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n").is_err(){return;}
            let chunk=[0x61u8;65536];let mut written=0;while written<size {let n=(size-written).min(chunk.len());if stream.write_all(&chunk[..n]).is_err(){return;}written+=n;}
        });
        let path=std::env::temp_dir().join(format!(".eureka-stream-{}.part",uuid::Uuid::new_v4().simple()));
        let sink=StreamDownload{path:path.to_string_lossy().into_owned(),max_bytes:64*1024*1024,timeout_ms:180000};let calls=AtomicUsize::new(0);
        let result=tauri::async_runtime::block_on(async{let response=client()?.get(format!("http://{address}/file")).send().await.map_err(|e|e.to_string())?;stream_to_file(response,&sink,&||{if cancel && calls.fetch_add(1,Ordering::SeqCst)>3 {Err("cancelled".into())}else{Ok(())}}).await});
        server.join().unwrap();(result,path)
    }
    #[test] fn downloads_beyond_legacy_ipc_limit_stream_to_disk() {
        let (result,path)=download(20*1024*1024,false);assert_eq!(result.unwrap(),20*1024*1024);assert_eq!(std::fs::metadata(&path).unwrap().len(),20*1024*1024);std::fs::remove_file(path).unwrap();
    }
    #[test] fn cancelled_stream_removes_partial_file() {let (result,path)=download(20*1024*1024,true);assert!(result.is_err());assert!(!path.exists());}
    #[test] fn native_stream_validates_private_staging_path_and_contract_limits() {
        assert!(StreamDownload{path:"relative.txt".into(),max_bytes:1,timeout_ms:1000}.validate().is_err());
        let path=std::env::temp_dir().join(format!(".eureka-stream-{}.part",uuid::Uuid::new_v4().simple())).to_string_lossy().into_owned();
        assert!(StreamDownload{path,max_bytes:2*1024*1024*1024,timeout_ms:1000}.validate().is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn dynamic_downloads_are_scoped_and_keep_signed_query_bytes() {
        let d:Declaration=serde_json::from_value(json!({"url":"https://download.example/reports/","method":"GET","response":"bytes","allowDynamicUrl":true})).unwrap();
        let signed="https://download.example/reports/a.zip?sign=a%2Bb&expires=123";
        let (request,_)=prepare(&d,json!({"url":signed}),&[],"https://seller.example","1").unwrap();assert_eq!(request.url().as_str(),signed);
        for url in ["https://evil.example/reports/a.zip","http://download.example/reports/a.zip","https://download.example/reports/../secret","https://download.example/reports/%2fsecret","https://u:p@download.example/reports/a.zip"] {assert!(prepare(&d,json!({"url":url}),&[],"https://seller.example","1").is_err());}
        let fixed:Declaration=serde_json::from_value(json!({"url":"https://download.example/reports/a.zip","method":"GET","response":"bytes"})).unwrap();assert!(prepare(&fixed,json!({"url":signed}),&[],"https://seller.example","1").is_err());
    }
    #[test] fn binary_payload_preserves_non_utf8_bytes_and_download_size_is_bounded(){
        let result=binary_response(200,"application/zip",&[0,128,255]);assert_eq!(result["data"]["base64"],"AID/");assert_eq!(result["data"]["bytes"],3);
        assert!(local_response_limit(MAX_DOWNLOAD_BYTES+1,false,true,MAX_DOWNLOAD_BYTES).unwrap_err().contains("12 MiB"));
    }
    fn local_response(size: usize, chunked: bool, advertise_only: bool) -> Result<Vec<u8>, String> {local_response_limit(size,chunked,advertise_only,MAX_RESPONSE_BYTES)}
    fn local_response_limit(size: usize, chunked: bool, advertise_only: bool,limit:usize) -> Result<Vec<u8>, String> {
        use std::{io::{Read, Write}, net::TcpListener, time::Instant};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop { match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
                Err(error) => panic!("local response fixture: {error}"),
            }};
            // Windows accepted sockets inherit the listener's nonblocking mode.
            // Large write_all calls must wait for the client to drain the body.
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            stream.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new(); let mut chunk = [0u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap(); assert!(count > 0 && request.len() < 8192);
                request.extend_from_slice(&chunk[..count]);
            }
            let header = if chunked { "Transfer-Encoding: chunked".to_string() } else { format!("Content-Length: {size}") };
            write!(stream, "HTTP/1.1 200 OK\r\n{header}\r\nConnection: close\r\n\r\n").unwrap();
            if advertise_only { return; }
            let bytes = vec![b'x'; 64 * 1024]; let mut remaining = size;
            while remaining > 0 {
                let count = remaining.min(bytes.len());
                if chunked && write!(stream, "{count:x}\r\n").is_err() { return; }
                if stream.write_all(&bytes[..count]).is_err() { return; }
                if chunked && stream.write_all(b"\r\n").is_err() { return; }
                remaining -= count;
            }
            if chunked { let _ = stream.write_all(b"0\r\n\r\n"); }
        });
        let result = tauri::async_runtime::block_on(async {
            let response = client()?.get(format!("http://{address}/response")).send().await.map_err(|e| e.to_string())?;
            read_response_limited(response,limit).await
        });
        server.join().unwrap(); result
    }
    #[test] fn responses_above_one_megabyte_and_at_the_new_boundary_are_complete() {
        for (size, chunked) in [(1_500_000, false), (MAX_RESPONSE_BYTES, true)] {
            let bytes = local_response(size, chunked, false).unwrap();
            assert_eq!(bytes.len(), size); assert!(bytes.iter().all(|byte| *byte == b'x'));
        }
    }
    #[test] fn advertised_and_chunked_oversize_responses_fail_at_the_actual_limit() {
        for (chunked, advertise_only) in [(false, true), (true, false)] {
            let error = local_response(MAX_RESPONSE_BYTES + 1, chunked, advertise_only).unwrap_err();
            assert!(error.contains("16 MiB")); assert!(error.contains("不自动重试"));
        }
    }
    #[test] fn incomplete_responses_never_become_successful_partial_results() {
        let error = local_response(100, false, true).unwrap_err();
        assert!(error.contains("响应不完整"));
    }
    fn declaration() -> Declaration { serde_json::from_value(json!({"url":"https://acs.m.taobao.com/h5/example/1.0/","method":"POST","signature":{"kind":"taobao-mtop","appKey":"123"}})).unwrap() }
    #[test] fn mtop_preserves_original_data_and_keeps_credentials_native() {
        let cookies = vec![Cookie::new("_m_h5_tk", "local_secret_999"), Cookie::new("sid", "session_secret")];
        let data = r#"{"itemId":"00123"}"#;
        let (request, secrets) = prepare(&declaration(), json!({"form":{"data":data}}), &cookies, "https://myseller.taobao.com", "1000").unwrap();
        let query: BTreeMap<_, _> = request.url().query_pairs().map(|(k,v)| (k.to_string(),v.to_string())).collect();
        assert_eq!(query["sign"], mtop_md5(&format!("local&1000&123&{data}")).unwrap());
        assert_eq!(request.headers()[header::COOKIE], "_m_h5_tk=local_secret_999; sid=session_secret");
        assert!(String::from_utf8_lossy(request.body().unwrap().as_bytes().unwrap()).contains("00123"));
        let mut output = json!({"Cookie":"session_secret","result":"session_secret","sign":query["sign"],"itemId":"00123"}); redact(&mut output, &secrets);
        assert!(!output.to_string().contains("session_secret")); assert!(!output.to_string().contains(&query["sign"])); assert_eq!(output["itemId"], "00123");
    }
    #[test] fn rejects_unscoped_urls_headers_and_script_supplied_signatures() {
        let cookies = vec![Cookie::new("sid", "secret")];
        for url in ["file:///etc/passwd", "ftp://example.com/", "https://user@example.com/", "https://example.com/#fragment", "https://acs.m.taobao.com/?sign=stale", "https://acs.m.taobao.com/?data=a&data=b"] { let mut d = declaration(); d.url=url.into(); assert!(d.url().is_err()); }
        let mut d = declaration(); d.headers.insert("Cookie".into(),"stolen".into()); assert!(prepare(&d,json!({"form":{"data":"{}"}}),&cookies,"https://myseller.taobao.com","1").is_err());
        assert!(prepare(&declaration(),json!({"query":{"sign":"x"}}),&cookies,"https://myseller.taobao.com","1").is_err());
        assert!(prepare(&declaration(),json!({}),&[],"https://myseller.taobao.com","1").is_err());
    }
    #[test] fn md5_matches_standard_vector() { assert_eq!(mtop_md5("abc").unwrap(), "900150983cd24fb0d6963f7d28e17f72"); }
    #[test] fn json_null_is_a_body_and_not_an_absent_parameter() {
        let mut d = declaration(); d.signature = None;
        let cookies = vec![Cookie::new("sid", "secret")];
        let (request, _) = prepare(&d, json!({"json":null}), &cookies, "https://myseller.taobao.com", "1").unwrap();
        assert_eq!(request.body().unwrap().as_bytes().unwrap(), b"null");
        d.method="GET".into(); assert!(prepare(&d,json!({"json":null}),&cookies,"https://myseller.taobao.com","1").is_err());
    }
    #[test] fn preference_cookies_do_not_corrupt_business_values() {
        let mut data=json!({"itemId":"00123","label":"true result","token":"short"});
        redact(&mut data,&["1".into(),"true".into()]);
        assert_eq!(data["itemId"],"00123"); assert_eq!(data["label"],"true result"); assert_eq!(data["token"],"[credential]");
    }
    #[test] fn http_custom_ports_and_fixed_queries_support_cookie_free_apis() {
        for url in ["http://example.com:8088/api?mode=legacy&item=old&item=older&tag=a&tag=b", "https://example.com:8443/api?mode=legacy&item=old&item=older&tag=a&tag=b"] {
            let d: Declaration = serde_json::from_value(json!({"url":url,"method":"POST","credentials":"omit"})).unwrap();
            let (request, secrets) = prepare(&d, json!({"query":{"item":"00123","enabled":"0"},"form":{"quantity":"0"}}), &[Cookie::new("sid", "private_fixture_cookie")], "https://seller.example", "1").unwrap();
            let pairs: Vec<_> = request.url().query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
            assert_eq!(request.url().scheme(), if url.starts_with("http:") {"http"} else {"https"});
            assert_eq!(request.url().port(), if url.starts_with("http:") {Some(8088)} else {Some(8443)});
            assert_eq!(pairs.iter().filter(|(k,_)|k=="item").map(|(_,v)|v.as_str()).collect::<Vec<_>>(), vec!["00123"]);
            assert_eq!(pairs.iter().filter(|(k,_)|k=="tag").count(),2);
            assert!(pairs.contains(&("mode".into(),"legacy".into())));
            assert!(pairs.contains(&("enabled".into(),"0".into())));
            assert_eq!(request.body().unwrap().as_bytes().unwrap(),b"quantity=0");
            assert!(!request.headers().contains_key(header::COOKIE));assert!(secrets.is_empty());
        }
    }
    #[test] fn unchanged_fixed_query_encoding_and_default_browser_credentials_are_preserved() {
        let d: Declaration = serde_json::from_value(json!({"url":"http://example.com/api?q=a%20b&flag&tag=a&tag=b","method":"GET"})).unwrap();
        let (request, _) = prepare(&d,json!({}),&[],"https://seller.example","1").unwrap();
        assert_eq!(request.url().as_str(),d.url);assert!(!request.headers().contains_key(header::COOKIE));
        let (request, secrets) = prepare(&d,json!({}),&[Cookie::new("sid","fixture_cookie")],"https://seller.example","1").unwrap();
        assert_eq!(request.headers()[header::COOKIE],"sid=fixture_cookie");assert_eq!(secrets,vec!["fixture_cookie"]);
        for method in ["HEAD","OPTIONS"] { let variant:Declaration=serde_json::from_value(json!({"url":d.url.clone(),"method":method})).unwrap();assert!(prepare(&variant,json!({}),&[],"https://seller.example","1").is_ok());if method=="HEAD" {assert!(prepare(&variant,json!({"json":null}),&[],"https://seller.example","1").is_err());} }
    }
    #[test] fn fixed_mtop_data_is_signed_and_cannot_conflict_with_a_form() {
        let mut d=declaration();let data=r#"{ "itemId": "00123" }"#;
        let mut url=d.url().unwrap();url.query_pairs_mut().append_pair("data",data);d.url=url.to_string();
        let cookies=[Cookie::new("_m_h5_tk","fixture_999")];
        let (request, _) = prepare(&d,json!({}),&cookies,"https://myseller.taobao.com","1000").unwrap();
        let query:BTreeMap<_,_>=request.url().query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
        assert_eq!(query["data"],data);assert_eq!(query["sign"],mtop_md5(&format!("fixture&1000&123&{data}")).unwrap());
        assert!(prepare(&d,json!({"form":{"data":data}}),&cookies,"https://myseller.taobao.com","1000").is_err());
        for url in ["http://acs.m.taobao.com/api","https://acs.m.taobao.com/api?appKey=123"]{d.url=url.into();assert!(d.url().is_err());}
        d.url="https://acs.m.taobao.com/api".into();d.credentials=Some("omit".into());assert!(d.url().is_err());
    }
    #[test] fn http_never_receives_secure_browser_cookies() {
        let mut secure=Cookie::new("secure_sid","fixture_secure_cookie");secure.set_secure(true);
        let cookies=[Cookie::new("sid","fixture_plain_cookie"),secure];
        let mut d:Declaration=serde_json::from_value(json!({"url":"http://example.com:8080/api","method":"GET"})).unwrap();
        let (request,secrets)=prepare(&d,json!({}),&cookies,"https://seller.example","1").unwrap();
        assert_eq!(request.headers()[header::COOKIE],"sid=fixture_plain_cookie");assert_eq!(secrets,vec!["fixture_plain_cookie"]);
        d.url="https://example.com:8443/api".into();
        let (request,_)=prepare(&d,json!({}),&cookies,"https://seller.example","1").unwrap();
        assert_eq!(request.headers()[header::COOKIE],"sid=fixture_plain_cookie; secure_sid=fixture_secure_cookie");
    }
    #[test] fn http_transport_uses_the_declared_endpoint_without_cookie_or_redirect_replay() {
        use std::{io::{Read,Write},net::TcpListener,time::Instant};
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();listener.set_nonblocking(true).unwrap();
        let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{
            let deadline=Instant::now()+Duration::from_secs(5);
            let mut stream=loop {match listener.accept(){Ok((stream,_))=>break stream,Err(error) if error.kind()==std::io::ErrorKind::WouldBlock&&Instant::now()<deadline=>std::thread::sleep(Duration::from_millis(5)),Err(error)=>panic!("local HTTP fixture: {error}")}};
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes=Vec::new();let mut chunk=[0;1024];
            while !bytes.windows(4).any(|window|window==b"\r\n\r\n") {let count=stream.read(&mut chunk).unwrap();assert!(count>0&&bytes.len()<8192);bytes.extend_from_slice(&chunk[..count]);}
            let request=String::from_utf8(bytes).unwrap();
            assert!(request.starts_with("GET /api?mode=legacy&id=00123 HTTP/1.1\r\n"));
            assert!(!request.to_ascii_lowercase().contains("\r\ncookie:"));
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: /must-not-be-replayed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let d:Declaration=serde_json::from_value(json!({"url":format!("http://{address}/api?mode=legacy&id=old"),"method":"GET","credentials":"omit"})).unwrap();
        let (request,_)=prepare(&d,json!({"query":{"id":"00123"}}),&[Cookie::new("sid","fixture_cookie")],"https://seller.example","1").unwrap();
        let status=tauri::async_runtime::block_on(async{client().unwrap().execute(request).await.unwrap().status()});
        server.join().unwrap();assert_eq!(status.as_u16(),302);
    }
}
