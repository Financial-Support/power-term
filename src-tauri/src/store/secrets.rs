use crate::store::SecretError;

const SERVICE: &str = "com.band.power-term";

/// Set the secret for `host_id`. Replaces any prior secret.
pub fn set(host_id: &str, secret: &str) -> Result<(), SecretError> {
    let account = format!("host:{host_id}");
    backend::set(SERVICE, &account, secret)
}

/// Read the secret for `host_id`. Returns `Ok(None)` if not present.
pub fn get(host_id: &str) -> Result<Option<String>, SecretError> {
    let account = format!("host:{host_id}");
    backend::get(SERVICE, &account)
}

/// Delete the secret for `host_id`. Returns Ok(()) even if there was nothing to delete.
pub fn delete(host_id: &str) -> Result<(), SecretError> {
    let account = format!("host:{host_id}");
    backend::delete(SERVICE, &account)
}

pub fn backend_set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
    backend::set(service, account, secret)
}

pub fn backend_get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
    backend::get(service, account)
}

pub fn backend_delete(service: &str, account: &str) -> Result<(), SecretError> {
    backend::delete(service, account)
}

#[cfg(not(feature = "mock-keychain"))]
mod backend {
    use super::SecretError;
    use keyring::Entry;

    pub fn set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        entry.set_password(secret).map_err(|e| SecretError::Keyring(e.to_string()))
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }

    // keyring 3.x renamed delete_password -> delete_credential
    pub fn delete(service: &str, account: &str) -> Result<(), SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }
}

#[cfg(feature = "mock-keychain")]
mod backend {
    use super::SecretError;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::OnceLock;

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static S: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        S.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn key(service: &str, account: &str) -> String {
        format!("{service}|{account}")
    }

    pub fn set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
        store().lock().insert(key(service, account), secret.to_string());
        Ok(())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        Ok(store().lock().get(&key(service, account)).cloned())
    }

    pub fn delete(service: &str, account: &str) -> Result<(), SecretError> {
        store().lock().remove(&key(service, account));
        Ok(())
    }
}

#[cfg(test)]
#[cfg(feature = "mock-keychain")]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        assert_eq!(get(&id).unwrap(), None);
        set(&id, "s3cret").unwrap();
        assert_eq!(get(&id).unwrap(), Some("s3cret".to_string()));
        delete(&id).unwrap();
        assert_eq!(get(&id).unwrap(), None);
    }

    #[test]
    fn set_overwrites() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set(&id, "first").unwrap();
        set(&id, "second").unwrap();
        assert_eq!(get(&id).unwrap(), Some("second".to_string()));
        delete(&id).unwrap();
    }

    #[test]
    fn delete_missing_is_ok() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        delete(&id).unwrap();
    }

    /// Models the `hosts_delete` cascade in `commands.rs`: HostStore.delete + secrets::delete.
    /// We don't have a Tauri State here so we compose them directly.
    #[test]
    fn host_delete_cascade_clears_keychain_entry() {
        use crate::store::host::{HostInput, HostStore};

        let store = HostStore::open_in_memory().unwrap();
        let input = HostInput {
            name: "casc".into(),
            hostname: "h".into(),
            port: 22,
            username: "u".into(),
            group_name: None,
            tags: vec![],
            auth_method: "password".into(),
            key_path: None,
            notes: None,
        };
        let host = store.create(&input).unwrap();
        set(&host.id, "stored-pw").unwrap();
        assert_eq!(get(&host.id).unwrap(), Some("stored-pw".to_string()));

        // Cascade: delete the host row, then the secret.
        store.delete(&host.id).unwrap();
        delete(&host.id).unwrap();

        assert_eq!(get(&host.id).unwrap(), None);
        assert!(store.list().unwrap().is_empty());
    }
}
