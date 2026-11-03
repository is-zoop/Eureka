//! Account metadata and browser-owned profiles, local to this Windows user.
//! Never exports cookies, tokens, passwords or profile paths to JS/model APIs.
use serde::{Deserialize, Serialize};
use std::{fs::{self, File, OpenOptions}, io::Write, os::windows::fs::OpenOptionsExt, path::{Path, PathBuf}};
use tauri::Manager;

pub const DEFAULT_ID: &str = "00000000000000000000000000000000";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub origin: String,
    pub status: String,
    pub generation: u64,
    pub created_at: u64,
    pub confirmed_at: Option<u64>,
    pub last_used_at: Option<u64>,
    pub deleted: bool,
    pub retired: Vec<u64>,
    #[serde(default)]
    pub password_autosave: bool,
}
pub fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn hex(value: &str, len: usize) -> bool { value.len() == len && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }
pub fn owner_root(app: &tauri::AppHandle, owner: &str) -> Result<PathBuf, String> {
    if !hex(owner, 64) { return Err("accountInvalid".into()); }
    Ok(app.path().app_local_data_dir().map_err(|_| "accountStorageFailed")?.join("website-accounts").join(owner))
}
pub fn directory(app: &tauri::AppHandle, owner: &str, id: &str) -> Result<PathBuf, String> {
    if !hex(id, 32) { return Err("accountInvalid".into()); }
    Ok(owner_root(app, owner)?.join(id))
}
pub fn lease(dir: &Path) -> Result<File, String> {
    // share_mode(0) is an OS-enforced, process-lifetime exclusive lease. Crash
    // release is automatic; the mere presence of the file does not mean busy.
    OpenOptions::new().read(true).write(true).create(true).truncate(false).share_mode(0).open(dir.join("use.lock"))
        .map_err(|error| match error.raw_os_error() {
            Some(32 | 33) => "accountBusy".into(),
            _ => "accountStorageFailed".into(),
        })
}
pub fn read(dir: &Path) -> Result<Account, String> {
    let path = dir.join("account.json");
    if fs::metadata(&path).map_err(|_| "accountMissing")?.len() > 32_000 { return Err("accountStorageFailed".into()); }
    let account: Account = serde_json::from_slice(&fs::read(path).map_err(|_| "accountStorageFailed")?).map_err(|_| "accountStorageFailed")?;
    let valid_origin = tauri::Url::parse(&account.origin).is_ok_and(|url|
        matches!(url.scheme(), "http" | "https") && url.username().is_empty() && url.password().is_none() && url.origin().ascii_serialization() == account.origin);
    if !valid_origin || account.name.trim().is_empty() || account.name.chars().count() > 80 || account.name.chars().any(|c| c.is_control())
        || account.schema_version != 1 || !hex(&account.id, 32) || dir.file_name().and_then(|n| n.to_str()) != Some(account.id.as_str()) || account.generation == 0
        || account.retired.iter().any(|n| *n == 0 || *n >= account.generation) || account.retired.len() > 100
        || !matches!(account.status.as_str(), "unverified" | "confirmed" | "needs_login") {
        return Err("accountStorageFailed".into());
    }
    Ok(account)
}
pub fn write(dir: &Path, account: &Account) -> Result<(), String> {
    let temp = dir.join(format!("account-{}-{}.tmp", std::process::id(), now()));
    let result = (|| {
        let mut file = OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|_| "accountStorageFailed")?;
        file.write_all(&serde_json::to_vec(account).map_err(|_| "accountStorageFailed")?).map_err(|_| "accountStorageFailed")?;
        file.sync_all().map_err(|_| "accountStorageFailed")?;
        drop(file);
        fs::rename(&temp, dir.join("account.json")).map_err(|_| "accountStorageFailed")
    })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result.map_err(String::from)
}
pub fn profile(dir: &Path, generation: u64) -> PathBuf { dir.join("profiles").join(generation.to_string()) }
pub fn active(app: &tauri::AppHandle, owner: &str, id: &str) -> Result<(PathBuf, Account), String> {
    let dir = directory(app, owner, id)?;
    let account = read(&dir)?;
    if account.deleted { return Err("accountMissing".into()); }
    Ok((dir, account))
}
pub fn public(account: &Account, in_use: bool) -> serde_json::Value {
    serde_json::json!({ "id": account.id, "name": account.name, "origin": account.origin, "status": account.status,
        "createdAt": account.created_at, "confirmedAt": account.confirmed_at, "lastUsedAt": account.last_used_at,
        "deleted": account.deleted, "cleanupPending": !account.retired.is_empty(), "inUse": in_use, "passwordAutosave": account.password_autosave })
}
pub fn ensure_default(app: &tauri::AppHandle, owner: &str) -> Result<(PathBuf, Account), String> {
    let dir = directory(app, owner, DEFAULT_ID)?;
    fs::create_dir_all(&dir).map_err(|_| "accountStorageFailed")?;
    if !dir.join("account.json").exists() {
        let _lease = lease(&dir)?;
        if !dir.join("account.json").exists() {
            write(&dir, &Account { schema_version: 1, id: DEFAULT_ID.into(), name: "Default browser".into(), origin: "https://browser.eureka.invalid".into(),
                status: "unverified".into(), generation: 1, created_at: now(), confirmed_at: None, last_used_at: None,
                deleted: false, retired: vec![], password_autosave: false })?;
        }
    }
    active(app, owner, DEFAULT_ID)
}
pub fn list(app: &tauri::AppHandle, owner: &str) -> Result<Vec<serde_json::Value>, String> {
    ensure_default(app, owner)?;
    let root = owner_root(app, owner)?;
    if !root.exists() { return Ok(Vec::new()); }
    let mut items = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| "accountStorageFailed")? {
        let entry = entry.map_err(|_| "accountStorageFailed")?;
        if !entry.file_type().map_err(|_| "accountStorageFailed")?.is_dir() { continue; }
        let id = entry.file_name().to_string_lossy().to_string();
        if !hex(&id, 32) { continue; }
        let dir = directory(app, owner, &id)?;
        // A failed/interrupted create may leave an empty directory, never a usable account.
        if !dir.join("account.json").exists() { continue; }
        let account = read(&dir)?;
        if !account.deleted || !account.retired.is_empty() {
            let in_use = match lease(&dir) { Ok(_) => false, Err(error) if error == "accountBusy" => true, Err(error) => return Err(error) };
            items.push(public(&account, in_use));
        }
    }
    Ok(items)
}
fn validate_metadata(name: &str, origin: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(|c| c.is_control()) { return Err("accountInvalid".into()); }
    let url = tauri::Url::parse(origin).map_err(|_| "accountInvalid")?;
    if !matches!(url.scheme(), "https" | "http") || !url.username().is_empty() || url.password().is_some() || url.origin().ascii_serialization() != origin { return Err("accountInvalid".into()); }
    Ok(())
}
pub fn create(app: &tauri::AppHandle, owner: &str, id: &str, name: &str, origin: &str) -> Result<(), String> {
    if id == DEFAULT_ID { return Err("accountInvalid".into()); }
    let dir = directory(app, owner, id)?;
    validate_metadata(name, origin)?;
    fs::create_dir_all(owner_root(app, owner)?).map_err(|_| "accountStorageFailed")?;
    fs::create_dir(&dir).map_err(|error| if error.kind() == std::io::ErrorKind::AlreadyExists { "accountAlreadyExists" } else { "accountStorageFailed" })?;
    let _lease = lease(&dir)?;
    write(&dir, &Account { schema_version: 1, id: id.into(), name: name.trim().into(), origin: origin.into(), status: "unverified".into(), generation: 1,
        created_at: now(), confirmed_at: None, last_used_at: None, deleted: false, retired: vec![], password_autosave: false })
}

pub fn update(app: &tauri::AppHandle, owner: &str, id: &str, name: &str, origin: &str) -> Result<(), String> {
    // Metadata changes keep the same browser profile and saved app references.
    // The default environment has a fixed identity; an active profile is leased.
    if id == DEFAULT_ID { return Err("accountInvalid".into()); }
    validate_metadata(name, origin)?;
    let dir = directory(app, owner, id)?;
    let _lease = lease(&dir)?;
    update_leased(&dir, id, name, origin)
}
// Only the native browser manager calls this while retaining its profile lease.
pub(super) fn update_leased(dir: &Path, id: &str, name: &str, origin: &str) -> Result<(), String> {
    if id == DEFAULT_ID { return Err("accountInvalid".into()); }
    validate_metadata(name, origin)?;
    let mut account = read(dir)?;
    if account.id != id { return Err("accountInvalid".into()); }
    if account.deleted { return Err("accountMissing".into()); }
    if account.origin != origin {
        account.status = "unverified".into();
        account.confirmed_at = None;
    }
    account.name = name.trim().into();
    account.origin = origin.into();
    write(dir, &account)
}

fn remove_generation(dir: &Path, generation: u64) -> bool {
    let root = dir.join("profiles");
    let target = profile(dir, generation);
    if !target.exists() { return true; }
    // Resolve before recursive removal; do not follow a profile redirected outside
    // the explicitly generated account profiles directory.
    let (Ok(account_dir), Ok(root), Ok(target)) = (dir.canonicalize(), root.canonicalize(), target.canonicalize()) else { return false };
    if root.parent() != Some(account_dir.as_path()) || target.parent() != Some(root.as_path()) { return false; }
    fs::remove_dir_all(target).is_ok()
}
pub fn cleanup(dir: &Path) -> Result<(), String> {
    let _lease = lease(dir)?;
    cleanup_leased(dir)
}
pub(super) fn cleanup_leased(dir: &Path) -> Result<(), String> {
    let mut account = read(dir)?;
    account.retired.retain(|generation| !remove_generation(dir, *generation));
    write(dir, &account)
}
pub fn schedule_cleanup(dir: PathBuf) {
    std::thread::spawn(move || {
        for _ in 0..8 {
            let _ = cleanup(&dir);
            if read(&dir).is_ok_and(|a| a.retired.is_empty()) { break; }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_metadata_defaults_password_saving_to_off() {
        let source = serde_json::json!({ "schemaVersion": 1, "id": "a".repeat(32), "name": "Old environment", "origin": "https://example.com",
            "status": "confirmed", "generation": 1, "createdAt": 1, "confirmedAt": 1, "lastUsedAt": null, "deleted": false, "retired": [] });
        let account: Account = serde_json::from_value(source).unwrap();
        assert!(!account.password_autosave);
        assert!(!public(&account, false)["passwordAutosave"].as_bool().unwrap());
    }
    #[test]
    fn ids_cannot_supply_paths() {
        assert!(hex(&"a".repeat(32), 32));
        for id in ["../other", "C:\\private", "A000", "", "ab/cd"] { assert!(!hex(id, 32)); }
    }
    #[test]
    fn account_lease_blocks_a_second_user_and_releases_on_drop() {
        let dir = std::env::temp_dir().join(format!("eureka-account-lease-{}-{}", std::process::id(), now()));
        fs::create_dir(&dir).unwrap();
        let first = lease(&dir).unwrap();
        assert!(lease(&dir).is_err());
        drop(first);
        drop(lease(&dir).unwrap());
        fs::remove_file(dir.join("use.lock")).unwrap();
        fs::remove_dir(dir).unwrap();
    }
}
