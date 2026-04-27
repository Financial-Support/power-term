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
}
