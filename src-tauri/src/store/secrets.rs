use crate::store::SecretError;

const SERVICE: &str = "com.power-term.app";

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
    //! Master-key + encrypted-file backend.
    //!
    //! Background: macOS Keychain ACL trusts a calling app by code signature.
    //! adhoc-signed builds change signature on every release, so the trust
    //! is forgotten and the OS prompts the user for every keychain item on
    //! every launch. Multiplied across saved hosts, DB connections, sync
    //! tokens, and SSH passphrases that's painful enough that users stop
    //! saving credentials.
    //!
    //! This backend keeps a single AES-256 master key in the OS Keychain
    //! and stores every other secret in `~/Library/Application Support/
    //! power-term/secrets.bin` encrypted with that key. The user clicks
    //! "Always Allow" on the master-key prompt exactly once and is never
    //! prompted again — even after rebuilds — because Keychain ACL flips
    //! to "any app" once the user grants persistent trust.
    //!
    //! On the first read of a missing key we fall back to the legacy
    //! per-secret keychain entries so existing installs migrate
    //! transparently. Each migration is one prompt; after the migration
    //! the value lives in the file and the legacy keychain row is
    //! removed.
    use super::SecretError;
    use crate::sync::encrypt::{decrypt, encrypt, generate_key, key_from_base58, key_to_base58};
    use keyring::Entry;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::OnceLock;

const SERVICE: &str = "com.power-term.app";
    const MASTER_KEY_ACCOUNT: &str = "master-key";
    const FILE_NAME: &str = "secrets.bin";
    /// Distinguishes the secrets-file ciphertext from any other use of the
    /// shared encrypt() helper. AAD is fixed because the file is a single
    /// blob with no row identity.
    const FILE_AAD: &[u8] = b"power-term:secrets";

    fn cache() -> &'static OnceLock<Mutex<HashMap<String, String>>> {
        static C: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        if C.get().is_none() {
            // Initialize lazily on first call from load_all().
        }
        &C
    }

    fn master() -> Result<[u8; 32], SecretError> {
        static M: OnceLock<[u8; 32]> = OnceLock::new();
        if let Some(k) = M.get() { return Ok(*k); }
        let entry = Entry::new(SERVICE, MASTER_KEY_ACCOUNT)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        let key = match entry.get_password() {
            Ok(s) => key_from_base58(&s).ok_or_else(|| SecretError::Keyring("master key corrupt".into()))?,
            Err(keyring::Error::NoEntry) => {
                let fresh = generate_key();
                entry
                    .set_password(&key_to_base58(&fresh))
                    .map_err(|e| SecretError::Keyring(e.to_string()))?;
                fresh
            }
            Err(e) => return Err(SecretError::Keyring(e.to_string())),
        };
        let _ = M.set(key);
        Ok(key)
    }

    fn file_path() -> PathBuf {
        let dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("power-term");
        let _ = std::fs::create_dir_all(&dir);
        dir.join(FILE_NAME)
    }

    fn read_file(key: &[u8; 32]) -> HashMap<String, String> {
        let path = file_path();
        let bytes = match std::fs::read(&path) {
            Ok(b) if !b.is_empty() => b,
            _ => return HashMap::new(),
        };
        // The file format is whatever encrypt() produces — the helper takes
        // a &str, so we go through utf8 / from_utf8_lossy. Bytes written
        // by this module are always valid UTF-8 (encrypt's base64 output).
        let envelope = match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => return HashMap::new(),
        };
        let plain = match decrypt(&envelope, key, FILE_AAD) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(error = %e, "secrets file decrypt failed — discarding (master key changed?)");
                return HashMap::new();
            }
        };
        serde_json::from_str(&plain).unwrap_or_default()
    }

    fn write_file(key: &[u8; 32], data: &HashMap<String, String>) -> Result<(), SecretError> {
        let json = serde_json::to_string(data).map_err(|e| SecretError::Keyring(e.to_string()))?;
        let envelope = encrypt(&json, key, FILE_AAD).map_err(|e| SecretError::Keyring(format!("encrypt: {e}")))?;
        let path = file_path();
        let tmp = path.with_extension("bin.tmp");
        std::fs::write(&tmp, envelope.as_bytes()).map_err(|e| SecretError::Keyring(e.to_string()))?;
        std::fs::rename(&tmp, &path).map_err(|e| SecretError::Keyring(e.to_string()))?;
        Ok(())
    }

    fn load_all() -> Result<(HashMap<String, String>, [u8; 32]), SecretError> {
        let key = master()?;
        let c = cache().get_or_init(|| Mutex::new(read_file(&key)));
        Ok((c.lock().clone(), key))
    }

    fn item_key(service: &str, account: &str) -> String {
        format!("{service}|{account}")
    }

    /// Write to the encrypted file AND best-effort remove any legacy
    /// per-secret keychain row so the user isn't haunted by stale prompts.
    pub fn set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
        let (_, key) = load_all()?;
        let mut guard = cache().get().expect("cache initialized").lock();
        guard.insert(item_key(service, account), secret.to_string());
        write_file(&key, &guard)?;
        let _ = legacy_delete(service, account);
        Ok(())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        let (_, key) = load_all()?;
        let k = item_key(service, account);
        if let Some(v) = cache().get().expect("cache initialized").lock().get(&k).cloned() {
            return Ok(Some(v));
        }
        // Lazy migration: pull from legacy keychain on miss. This is the
        // ONLY remaining keychain prompt path; once the value is migrated
        // future reads stay in-memory + file.
        if let Some(legacy) = legacy_get(service, account)? {
            // Cache + persist + cleanup the legacy row.
            cache().get().expect("cache initialized").lock().insert(k, legacy.clone());
            let snapshot = cache().get().expect("cache initialized").lock().clone();
            write_file(&key, &snapshot)?;
            let _ = legacy_delete(service, account);
            return Ok(Some(legacy));
        }
        Ok(None)
    }

    pub fn delete(service: &str, account: &str) -> Result<(), SecretError> {
        let (_, key) = load_all()?;
        let k = item_key(service, account);
        let mut guard = cache().get().expect("cache initialized").lock();
        let was_present = guard.remove(&k).is_some();
        if was_present {
            write_file(&key, &guard)?;
        }
        // Always try legacy too in case the value never migrated.
        let _ = legacy_delete(service, account);
        Ok(())
    }

    // ─── legacy fallback (the per-secret entries from previous versions) ────

    fn legacy_get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        let entry = Entry::new(service, account)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }

    fn legacy_delete(service: &str, account: &str) -> Result<(), SecretError> {
        let entry = Entry::new(service, account)
            .map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
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
