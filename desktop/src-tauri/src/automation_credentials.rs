//! Application-scoped Windows-user DPAPI secrets. Plaintext never crosses back to JS.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, io::Write, path::{Path, PathBuf}, sync::{Arc, LazyLock, Mutex, atomic::{AtomicU64, Ordering}}};
use tauri::Manager;
use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN}};

static VERSIONS: LazyLock<Mutex<HashMap<String,Arc<AtomicU64>>>> = LazyLock::new(||Mutex::new(HashMap::new()));
static STORE_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone,Deserialize,Serialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct Scope { pub url:String, pub method:String }
#[derive(Clone,Deserialize,Serialize)]
#[serde(deny_unknown_fields,rename_all="camelCase")]
pub struct Spec { pub credential_id:String, pub kind:String, pub header:Option<String>, pub scopes:Vec<Scope> }
#[derive(Deserialize,Serialize)]
struct Stored { spec:Spec, value:String, #[serde(default)] revision:String }
pub struct Credential { pub value:String, pub revision:String, version:Arc<AtomicU64>, generation:u64, path:PathBuf }
impl Credential { pub fn check(&self)->Result<(),String>{if self.version.load(Ordering::SeqCst)!=self.generation || !self.path.is_file(){Err("应用凭证已修改或撤销，运行已停止，不自动重试".into())}else{Ok(())}} }
pub fn auth_header(kind:&str,header:Option<&str>)->Result<String,String>{
    let name=if kind=="bearer" {if header.is_some(){return Err("Bearer 请求头由宿主确定".into());}"Authorization"}else if kind=="api-key"{header.unwrap_or("X-API-Key")}else{return Err("凭证类型无效".into());};
    let lower=name.to_ascii_lowercase();
    if name.is_empty()||name.len()>80||!name.as_bytes()[0].is_ascii_alphabetic()||!name.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')||kind=="api-key"&&(matches!(lower.as_str(),"authorization"|"cookie"|"set-cookie"|"host"|"origin"|"referer"|"content-type"|"content-length"|"connection"|"transfer-encoding")||lower.starts_with("proxy-")||lower.starts_with("sec-")){return Err("凭证请求头不受支持".into());}Ok(name.into())
}
fn validate_spec(spec:&Spec)->Result<(),String>{
    if spec.credential_id.is_empty()||spec.credential_id.len()>80||!spec.credential_id.as_bytes()[0].is_ascii_lowercase()||!spec.credential_id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'_'||b==b'-')||spec.scopes.is_empty()||spec.scopes.len()>100{return Err("凭证声明无效".into());}
    auth_header(&spec.kind,spec.header.as_deref())?;
    for scope in &spec.scopes {let url=tauri::Url::parse(&scope.url).map_err(|_|"凭证目标无效")?;if url.scheme()!="https"||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||!matches!(scope.method.as_str(),"GET"|"HEAD"|"OPTIONS"|"POST"|"PUT"|"PATCH"|"DELETE"){return Err("凭证只允许明确的 HTTPS 目标".into());}}
    Ok(())
}
fn identity(owner:&str,app_id:&str)->Result<(),String>{if owner.len()!=64||!owner.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())||uuid::Uuid::parse_str(app_id).is_err(){return Err("应用凭证身份无效".into());}Ok(())}
fn checked(path:&Path)->Result<(),String>{for parent in path.ancestors(){match fs::symlink_metadata(parent){Ok(meta)=>{use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("凭证目录不能是链接".into());}},Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{},Err(_)=>return Err("凭证目录不可访问".into())}}Ok(())}
fn path(app:&tauri::AppHandle,owner:&str,app_id:&str,id:&str)->Result<PathBuf,String>{identity(owner,app_id)?;let root=app.path().app_local_data_dir().map_err(|_|"凭证目录不可访问")?.join("application-credentials").join(owner).join(app_id);let value=root.join(format!("{id}.bin"));checked(&value)?;Ok(value)}
fn version(owner:&str,app_id:&str,id:&str)->Arc<AtomicU64>{let mut versions=VERSIONS.lock().unwrap();versions.entry(format!("{owner}:{app_id}:{id}")).or_insert_with(||Arc::new(AtomicU64::new(0))).clone()}
fn entropy(owner:&str,app_id:&str,id:&str)->Vec<u8>{format!("eureka-application-credential-v1:{owner}:{app_id}:{id}").into_bytes()}
fn crypt(bytes:&[u8],entropy:&[u8],decrypt:bool)->Result<Vec<u8>,String>{
    let input=CRYPT_INTEGER_BLOB{cbData:bytes.len()as u32,pbData:bytes.as_ptr()as *mut u8};let entropy=CRYPT_INTEGER_BLOB{cbData:entropy.len()as u32,pbData:entropy.as_ptr()as *mut u8};let mut output=CRYPT_INTEGER_BLOB{cbData:0,pbData:std::ptr::null_mut()};
    unsafe {let ok=if decrypt{CryptUnprotectData(&input,std::ptr::null_mut(),&entropy,std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)}else{CryptProtectData(&input,std::ptr::null(),&entropy,std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output)};if ok==0{return Err("应用凭证加解密失败，请重新保存".into());}let result=std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec();std::ptr::write_bytes(output.pbData,0,output.cbData as usize);LocalFree(output.pbData as _);Ok(result)}
}
fn read(path:&Path,entropy:&[u8])->Result<Stored,String>{checked(path)?;let meta=fs::metadata(path).map_err(|_|"请在应用配置中保存接口凭证")?;if !meta.is_file()||meta.len()>1024*1024{return Err("凭证存储无效".into());}let mut bytes=crypt(&fs::read(path).map_err(|_|"凭证不可读取")?,entropy,true)?;let result=serde_json::from_slice(&bytes).map_err(|_|"凭证不可读取".to_string());bytes.fill(0);result}
fn write(path:&Path,stored:&Stored,entropy:&[u8])->Result<(),String>{
    checked(path)?;let parent=path.parent().ok_or("凭证目录无效")?;fs::create_dir_all(parent).map_err(|_|"凭证目录不可写")?;checked(path)?;let mut raw=serde_json::to_vec(stored).map_err(|_|"凭证存储失败")?;let encrypted=crypt(&raw,entropy,false);raw.fill(0);let encrypted=encrypted?;let temporary=parent.join(format!("{}.tmp",uuid::Uuid::new_v4()));
    let result=(||{let mut file=fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|_|"凭证存储失败")?;file.write_all(&encrypted).map_err(|_|"凭证存储失败")?;file.sync_all().map_err(|_|"凭证存储失败")?;drop(file);checked(path)?;fs::rename(&temporary,path).map_err(|_|"凭证存储失败".to_string())})();if result.is_err(){let _=fs::remove_file(temporary);}result
}
pub fn load(app:&tauri::AppHandle,owner:&str,app_id:&str,id:&str,kind:&str,header:Option<&str>,url:&tauri::Url,method:&str)->Result<Credential,String>{
    let _lock=STORE_LOCK.lock().map_err(|_|"凭证存储不可用")?;
    let probe=Spec{credential_id:id.into(),kind:kind.into(),header:header.map(String::from),scopes:vec![Scope{url:format!("{}{}",url.origin().ascii_serialization(),url.path()),method:method.into()}]};validate_spec(&probe)?;
    let path=path(app,owner,app_id,id)?;let stored=read(&path,&entropy(owner,app_id,id))?;validate_spec(&stored.spec)?;
    if stored.spec.credential_id!=id||stored.spec.kind!=kind||auth_header(kind,header)?.to_ascii_lowercase()!=auth_header(&stored.spec.kind,stored.spec.header.as_deref())?.to_ascii_lowercase()||!stored.spec.scopes.contains(&probe.scopes[0]){return Err("接口凭证未授权此应用、请求头或目标地址".into());}
    let version=version(owner,app_id,id);let generation=version.load(Ordering::SeqCst);Ok(Credential{value:stored.value,revision:stored.revision,version,generation,path})
}
#[tauri::command]
pub fn desktop_automation_credentials(webview:tauri::Webview,owner:String,app_id:String,action:String,spec:Option<Spec>,value:Option<String>)->Result<serde_json::Value,String>{
    if !crate::automation_browser::trusted_caller(&webview){return Err("仅本机应用界面可管理凭证".into());}
    if action=="clear" {
        identity(&owner,&app_id)?;
        let directory=path(webview.app_handle(),&owner,&app_id,"scope")?.parent().ok_or("凭证目录无效")?.to_path_buf();
        let _lock=STORE_LOCK.lock().map_err(|_|"凭证存储不可用")?;
        if directory.exists() { checked(&directory)?;for entry in fs::read_dir(&directory).map_err(|_|"凭证删除失败")? {let entry=entry.map_err(|_|"凭证删除失败")?;checked(&entry.path())?;if !entry.file_type().map_err(|_|"凭证删除失败")?.is_file(){return Err("凭证目录含未知内容".into());}fs::remove_file(entry.path()).map_err(|_|"凭证删除失败")?;}fs::remove_dir(&directory).map_err(|_|"凭证删除失败")?;}
        let prefix=format!("{owner}:{app_id}:");for (key,version) in VERSIONS.lock().map_err(|_|"凭证存储不可用")?.iter(){if key.starts_with(&prefix){version.fetch_add(1,Ordering::SeqCst);}}
        return Ok(serde_json::json!({"configured":false}));
    }
    let spec=spec.ok_or("凭证声明缺失")?;validate_spec(&spec)?;
    let app=webview.app_handle();let path=path(app,&owner,&app_id,&spec.credential_id)?;let entropy=entropy(&owner,&app_id,&spec.credential_id);let _lock=STORE_LOCK.lock().map_err(|_|"凭证存储不可用")?;
    match action.as_str(){
        "status"=>{let configured=read(&path,&entropy).is_ok_and(|stored|stored.spec.kind==spec.kind&&stored.spec.header==spec.header&&spec.scopes.iter().all(|scope|stored.spec.scopes.contains(scope)));Ok(serde_json::json!({"configured":configured}))},
        "set"=>{let value=value.ok_or("请输入接口凭证")?;if value.is_empty()||value.len()>16384||value.contains(['\r','\n','\0']){return Err("凭证为空、过长或包含非法字符".into());}write(&path,&Stored{spec:spec.clone(),value,revision:uuid::Uuid::new_v4().to_string()},&entropy)?;version(&owner,&app_id,&spec.credential_id).fetch_add(1,Ordering::SeqCst);Ok(serde_json::json!({"configured":true}))},
        "delete"=>{match fs::remove_file(path){Ok(())=>{},Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{},Err(_)=>return Err("凭证删除失败".into())}version(&owner,&app_id,&spec.credential_id).fetch_add(1,Ordering::SeqCst);Ok(serde_json::json!({"configured":false}))},
        _=>Err("凭证操作无效".into())
    }
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn dpapi_is_user_and_application_bound_and_contains_no_plaintext(){let value=b"private_api_credential_123456";let encrypted=crypt(value,b"owner:app-a",false).unwrap();assert!(!encrypted.windows(value.len()).any(|part|part==value));assert_eq!(crypt(&encrypted,b"owner:app-a",true).unwrap(),value);assert!(crypt(&encrypted,b"owner:app-b",true).is_err());}
    #[test]fn credential_headers_reject_privileged_overrides(){for header in ["Cookie","Host","Authorization","Content-Length","Proxy-Authorization","Sec-Fetch-Site"]{assert!(auth_header("api-key",Some(header)).is_err());}assert_eq!(auth_header("bearer",None).unwrap(),"Authorization");assert_eq!(auth_header("api-key",Some("X-Shop-Key")).unwrap(),"X-Shop-Key");}
}
