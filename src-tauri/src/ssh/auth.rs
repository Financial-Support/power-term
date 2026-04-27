use crate::ssh::SshError;
use russh_keys::key::KeyPair;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum Auth {
    Password { password: String },
    KeyFile { path: PathBuf, passphrase: Option<String> },
    Agent,
}

impl Auth {
    pub fn tag(&self) -> &'static str {
        match self {
            Auth::Password { .. } => "password",
            Auth::KeyFile { .. } => "publickey",
            Auth::Agent => "agent",
        }
    }
}

pub fn load_key_from_file(path: &Path, passphrase: Option<&str>) -> Result<KeyPair, SshError> {
    let bytes = std::fs::read(path)
        .map_err(|e| SshError::Any(format!("read key file: {e}")))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| SshError::Any("key file is not valid UTF-8".into()))?;
    russh_keys::decode_secret_key(text, passphrase)
        .map_err(|e| SshError::Any(format!("decode key: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const PLAIN_KEY_PATH: &str = "tests/fixtures/id_ed25519_plain";

    #[test]
    fn auth_tag_matches_method() {
        assert_eq!(Auth::Agent.tag(), "agent");
        assert_eq!(Auth::Password { password: "x".into() }.tag(), "password");
        assert_eq!(Auth::KeyFile { path: PathBuf::from("/x"), passphrase: None }.tag(), "publickey");
    }

    #[test]
    fn load_plain_key_succeeds_when_fixture_present() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(PLAIN_KEY_PATH);
        if !path.exists() {
            eprintln!("skipping: fixture not yet generated");
            return;
        }
        let key = load_key_from_file(&path, None).expect("plain key should load");
        let _ = key.clone_public_key().map(|pk| pk.fingerprint());
    }

    #[test]
    fn load_missing_file_returns_err() {
        let err = load_key_from_file(Path::new("/nonexistent/key"), None).unwrap_err();
        let s = format!("{err}");
        assert!(s.contains("read key file"));
    }

    #[test]
    fn load_garbage_file_returns_err() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"not a key").unwrap();
        let err = load_key_from_file(f.path(), None).unwrap_err();
        let s = format!("{err}");
        assert!(s.contains("decode key"));
    }
}
