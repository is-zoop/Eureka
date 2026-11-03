use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};

// A stable per-installation secret, outside bundled resources and retained across updates.
pub fn load_or_create(directory: &Path) -> Result<String, String> {
    fs::create_dir_all(directory)
        .map_err(|_| "Could not create the local configuration directory.")?;
    let path = directory.join("session-secret");
    let file = match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let secret = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            file.write_all(secret.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| "Could not save the local session secret.")?;
            return Ok(secret);
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            fs::File::open(&path).map_err(|_| "Could not open the local session secret.")?
        }
        Err(_) => return Err("Could not create the local session secret.".into()),
    };
    let mut secret = String::new();
    file.take(1024)
        .read_to_string(&mut secret)
        .map_err(|_| "Could not read the local session secret.")?;
    if secret.len() != 64 || !secret.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(
            "The local session secret is invalid; restore it from backup instead of replacing it."
                .into(),
        );
    }
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installation_secrets_survive_updates_and_differ_between_installations() {
        let root =
            std::env::temp_dir().join(format!("eureka-session-secret-{}", uuid::Uuid::new_v4()));
        let first = load_or_create(&root.join("first")).unwrap();
        assert_eq!(load_or_create(&root.join("first")).unwrap(), first);
        assert_ne!(load_or_create(&root.join("second")).unwrap(), first);
        fs::write(root.join("first/session-secret"), "invalid").unwrap();
        assert!(load_or_create(&root.join("first")).is_err());
        assert_eq!(
            fs::read_to_string(root.join("first/session-secret")).unwrap(),
            "invalid"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
