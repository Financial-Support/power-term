use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownEntry {
    pub key_type: String,
    pub key_b64: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostVerdict {
    Match,
    Mismatch { expected: KnownEntry },
    Unknown,
}

pub struct KnownHosts {
    path: PathBuf,
}

impl KnownHosts {
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_user_path() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
    }

    pub fn append(&self, host: &str, port: u16, key_type: &str, key_b64: &str) -> std::io::Result<()> {
        use std::io::Write;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let line = format!("{} {} {}\n", canonical_host(host, port), key_type, key_b64);
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        f.write_all(line.as_bytes())?;
        Ok(())
    }

    pub fn verify(&self, host: &str, port: u16, offered_type: &str, offered_b64: &str) -> std::io::Result<HostVerdict> {
        let needle = canonical_host(host, port);
        let text = match std::fs::read_to_string(&self.path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HostVerdict::Unknown),
            Err(e) => return Err(e),
        };
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            if line.starts_with("|1|") { continue; }
            let mut parts = line.splitn(3, ' ');
            let hosts_field = match parts.next() { Some(s) => s, None => continue };
            let key_type = match parts.next() { Some(s) => s, None => continue };
            let key_b64 = match parts.next() { Some(s) => s, None => continue };
            let matched = hosts_field
                .split(',')
                .any(|h| h == needle || h == host);
            if !matched { continue; }
            if key_type == offered_type && key_b64 == offered_b64 {
                return Ok(HostVerdict::Match);
            } else {
                return Ok(HostVerdict::Mismatch {
                    expected: KnownEntry { key_type: key_type.to_string(), key_b64: key_b64.to_string() },
                });
            }
        }
        Ok(HostVerdict::Unknown)
    }
}

pub fn canonical_host(host: &str, port: u16) -> String {
    if port == 22 { host.to_string() } else { format!("[{host}]:{port}") }
}

pub fn fingerprint_sha256(key_b64: &str) -> Result<String, base64::DecodeError> {
    let raw = base64::engine::general_purpose::STANDARD.decode(key_b64.as_bytes())?;
    let digest = Sha256::digest(&raw);
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest);
    Ok(format!("SHA256:{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_hosts_sample.txt")
    }

    #[test]
    fn match_plain_host() {
        let kh = KnownHosts::at(fixture());
        let ok = kh.verify(
            "example.com", 22, "ssh-ed25519",
            "AAAAC3NzaC1lZDI1NTE5AAAAIE7Z3o8gJ3+R6cZ5Q3JmMu1FglDfzVKv7n4yY8gqQEAa",
        ).unwrap();
        assert_eq!(ok, HostVerdict::Match);
    }

    #[test]
    fn match_bracket_host_with_port() {
        let kh = KnownHosts::at(fixture());
        let ok = kh.verify(
            "bracketed.example.com", 2222, "ssh-rsa",
            "AAAAB3NzaC1yc2EAAAADAQABAAABAQDLuDlS5/F9pYnFnFqIaRdF8nQjFQ7DtbFW8VsvTyrL",
        ).unwrap();
        assert_eq!(ok, HostVerdict::Match);
    }

    #[test]
    fn match_multi_host_line() {
        let kh = KnownHosts::at(fixture());
        let ok = kh.verify(
            "host2", 22, "ecdsa-sha2-nistp256",
            "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBKaPHCJ7p5d2",
        ).unwrap();
        assert_eq!(ok, HostVerdict::Match);
    }

    #[test]
    fn mismatch_returns_expected_key() {
        let kh = KnownHosts::at(fixture());
        let v = kh.verify(
            "example.com", 22, "ssh-ed25519", "AAAAdifferentkey",
        ).unwrap();
        match v {
            HostVerdict::Mismatch { expected } => {
                assert_eq!(expected.key_type, "ssh-ed25519");
                assert!(expected.key_b64.starts_with("AAAAC3NzaC1lZDI1NTE5"));
            }
            other => panic!("expected Mismatch, got {other:?}"),
        }
    }

    #[test]
    fn unknown_host_returns_unknown() {
        let kh = KnownHosts::at(fixture());
        let v = kh.verify(
            "unrelated.example.com", 22, "ssh-ed25519", "AAAAanyKey",
        ).unwrap();
        assert_eq!(v, HostVerdict::Unknown);
    }

    #[test]
    fn missing_file_returns_unknown() {
        let kh = KnownHosts::at(PathBuf::from("/nonexistent/known_hosts"));
        let v = kh.verify("example.com", 22, "ssh-ed25519", "AAAA").unwrap();
        assert_eq!(v, HostVerdict::Unknown);
    }

    #[test]
    fn canonical_host_format() {
        assert_eq!(canonical_host("h", 22), "h");
        assert_eq!(canonical_host("h", 2222), "[h]:2222");
    }

    #[test]
    fn fingerprint_format_is_sha256_colon_base64nopad() {
        let fp = fingerprint_sha256(
            "AAAAC3NzaC1lZDI1NTE5AAAAIE7Z3o8gJ3+R6cZ5Q3JmMu1FglDfzVKv7n4yY8gqQEAa",
        ).unwrap();
        assert!(fp.starts_with("SHA256:"));
        assert_eq!(fp.len(), "SHA256:".len() + 43);
    }

    #[test]
    fn append_writes_plain_entry_and_verifies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        let kh = KnownHosts::at(path.clone());
        kh.append("freshhost.example.com", 22, "ssh-ed25519", "AAAAfreshkey").unwrap();

        let verdict = kh.verify("freshhost.example.com", 22, "ssh-ed25519", "AAAAfreshkey").unwrap();
        assert_eq!(verdict, HostVerdict::Match);
    }

    #[test]
    fn append_creates_dirs_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/sub/known_hosts");
        let kh = KnownHosts::at(path.clone());
        kh.append("a.example.com", 22, "ssh-ed25519", "AAAAk").unwrap();
        assert!(path.exists());
    }

    #[test]
    fn append_uses_bracket_format_for_non_default_port() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        let kh = KnownHosts::at(path.clone());
        kh.append("h.example.com", 2222, "ssh-ed25519", "AAAAk").unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("[h.example.com]:2222 ssh-ed25519 AAAAk"));
    }
}
