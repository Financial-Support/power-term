# SSH Connect (Sub-project #2A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSH connect to power-term so that `Cmd+K → ssh user@host` opens a remote shell in a new tab, with three auth methods (password / key file / SSH agent) and known-hosts TOFU verification.

**Architecture:** A new `ssh/` module on the Rust side mirrors the existing `pty/` module: `SshSession` is opened via `russh` (async tokio); `SshManager` registers sessions and emits the **same** Tauri events as `PtyManager` (`pty://output/<id>`, `pty://exit/<id>`) so `Terminal.tsx` is origin-agnostic. The renderer adds a `CommandPalette` (Cmd+K), `HostFingerprintPrompt` (TOFU modal), and `AuthPrompt` (auth method picker), wired through a state-machine `ssh_connect` Tauri command that returns `Connected | NeedsFingerprint | FingerprintMismatch | NeedsAuth`. Persistence + sidebar UI are deferred to sub-project #2B.

**Tech Stack:** Rust (`russh ^0.45`, `russh-keys ^0.45`, `sha2`, `async-trait`, existing tokio), React 18 + TypeScript, vitest. No new frontend deps.

**Reference spec:** [docs/superpowers/specs/2026-04-27-ssh-connect-2a-design.md](../specs/2026-04-27-ssh-connect-2a-design.md)

---

## Task 1: Cargo deps + ssh module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add SSH crates to `src-tauri/Cargo.toml`**

In the `[dependencies]` block, append:

```toml
russh = "0.45"
russh-keys = "0.45"
sha2 = "0.10"
async-trait = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-util", "net", "sync", "time", "fs"] }
```

(Tauri already depends on tokio transitively, but pulling it directly with the features we need keeps the API surface explicit.)

- [ ] **Step 2: Create `src-tauri/src/ssh/mod.rs`**

```rust
pub mod auth;
pub mod known_hosts;
pub mod manager;
pub mod session;

pub use manager::SshManager;
pub use session::{SshSession, SshTarget};

pub type SshId = String;

#[derive(thiserror::Error, Debug)]
pub enum SshError {
    #[error("connect failed: {0}")]
    Connect(String),
    #[error("ssh handshake failed: {0}")]
    Handshake(String),
    #[error("authentication failed")]
    Auth,
    #[error("authentication required")]
    NeedsAuth { available: Vec<String> },
    #[error("host fingerprint unknown")]
    UnknownFingerprint { fingerprint: String, host: String, key_type: String },
    #[error("host fingerprint mismatch")]
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown ssh id: {0}")]
    Unknown(String),
    #[error("any: {0}")]
    Any(String),
}
```

- [ ] **Step 3: Register the module in `src-tauri/src/lib.rs`**

Final contents:

```rust
pub mod commands;
pub mod pty;
pub mod settings;
pub mod ssh;
```

- [ ] **Step 4: Stub the four sub-modules so `cargo check` doesn't panic**

Create empty placeholders that later tasks will fill in. This step is intentionally minimal so the project keeps building.

`src-tauri/src/ssh/auth.rs`:
```rust
// Filled in Task 4.
```

`src-tauri/src/ssh/known_hosts.rs`:
```rust
// Filled in Tasks 2 + 3.
```

`src-tauri/src/ssh/session.rs`:
```rust
//! Filled in Task 5.
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
}

pub struct SshSession;

impl SshSession {
    pub fn _placeholder(_path: PathBuf) {}
}
```

`src-tauri/src/ssh/manager.rs`:
```rust
//! Filled in Task 6.
pub struct SshManager;

impl SshManager {
    pub fn new() -> Self { Self }
}

impl Default for SshManager {
    fn default() -> Self { Self::new() }
}
```

- [ ] **Step 5: Build check**

Run: `~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml`
Expected: clean (russh + russh-keys + sha2 download and compile; first build can take 30-60s).

- [ ] **Step 6: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "chore(ssh): scaffold ssh module skeleton + russh deps"
```

---

## Task 2: KnownHosts parsing + verification (TDD)

**Files:**
- Modify: `src-tauri/src/ssh/known_hosts.rs`
- Create: `src-tauri/tests/fixtures/known_hosts_sample.txt`

- [ ] **Step 1: Create the fixture file `src-tauri/tests/fixtures/known_hosts_sample.txt`**

```
# A comment line should be skipped
example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE7Z3o8gJ3+R6cZ5Q3JmMu1FglDfzVKv7n4yY8gqQEAa
[bracketed.example.com]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDLuDlS5/F9pYnFnFqIaRdF8nQjFQ7DtbFW8VsvTyrL
host1,host2,host3 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBKaPHCJ7p5d2
|1|f8XQXn9ZL4eCx5+t1+0YEm0kiRA=|h0XJEx8/k/CJZcz5w7vBYP6gKys= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH8z
```

- [ ] **Step 2: Replace `src-tauri/src/ssh/known_hosts.rs` with parser + verify + tests**

```rust
use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownEntry {
    /// "ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", ...
    pub key_type: String,
    /// Base64 of the public key bytes (no padding-trim).
    pub key_b64: String,
}

/// Result of looking up a host in known_hosts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostVerdict {
    /// Host is in known_hosts and the SHA256 fingerprint matches.
    Match,
    /// Host is in known_hosts but a different key was offered. Caller
    /// must show the user a mismatch warning.
    Mismatch { expected: KnownEntry },
    /// Host is not in known_hosts at all.
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

    /// Look up `host` (or `host:port` for non-22 ports) in the file and
    /// return a verdict against `(key_type, key_b64)` of the offered key.
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
            // Hashed entries (|1|salt|hash) we cannot match without doing the same HMAC; skip
            // for now so unhashed entries still work. Verify-only support is the spec'd contract.
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

/// Returns the canonical hostname representation for known_hosts: "host" for port 22,
/// "[host]:port" for any other port (matching OpenSSH).
pub fn canonical_host(host: &str, port: u16) -> String {
    if port == 22 { host.to_string() } else { format!("[{host}]:{port}") }
}

/// SHA256 fingerprint in OpenSSH's `SHA256:<base64-no-pad>` form. `key_b64` is the
/// base64-encoded server public key as it appears in known_hosts.
pub fn fingerprint_sha256(key_b64: &str) -> Result<String, base64::DecodeError> {
    let raw = base64::engine::general_purpose::STANDARD.decode(key_b64.as_bytes())?;
    let digest = Sha256::digest(&raw);
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest);
    Ok(format!("SHA256:{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // base64 of 32 sha256 bytes, no padding = 43 chars
        assert_eq!(fp.len(), "SHA256:".len() + 43);
    }
}
```

- [ ] **Step 3: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml ssh::known_hosts`
Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): KnownHosts parse + verify with SHA256 fingerprint"
```

---

## Task 3: KnownHosts append (TDD)

**Files:**
- Modify: `src-tauri/src/ssh/known_hosts.rs`

- [ ] **Step 1: Add the failing tests at the bottom of `known_hosts.rs`'s `tests` module**

Insert these `#[test]`s before the closing `}` of the `tests` mod:

```rust
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
```

- [ ] **Step 2: Run, expect FAIL (no `append` method yet)**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml ssh::known_hosts::tests::append`
Expected: 3 compile errors / test failures because `append` is undefined.

- [ ] **Step 3: Implement `KnownHosts::append`**

In `known_hosts.rs`, add this method inside `impl KnownHosts`:

```rust
    /// Append a plain (unhashed) entry. Creates parent directories if missing.
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
```

- [ ] **Step 4: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml ssh::known_hosts`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): KnownHosts append (atomic, plain entries)"
```

---

## Task 4: Auth types + key file loader (TDD)

**Files:**
- Modify: `src-tauri/src/ssh/auth.rs`

- [ ] **Step 1: Replace `src-tauri/src/ssh/auth.rs`**

```rust
use crate::ssh::SshError;
use russh_keys::key::PrivateKey;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub enum Auth {
    Password { password: String },
    KeyFile { path: PathBuf, passphrase: Option<String> },
    Agent,
}

impl Auth {
    /// Returns a short tag for logging / NeedsAuth#tried tracking.
    pub fn tag(&self) -> &'static str {
        match self {
            Auth::Password { .. } => "password",
            Auth::KeyFile { .. } => "publickey",
            Auth::Agent => "agent",
        }
    }
}

/// Load and decrypt an SSH private key from disk.
///
/// Accepts OpenSSH and PEM-encoded keys (russh-keys handles both).
/// If the key is passphrase-protected, `passphrase` must be provided.
pub fn load_key_from_file(path: &Path, passphrase: Option<&str>) -> Result<PrivateKey, SshError> {
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

    /// A small unencrypted ed25519 OpenSSH key used solely for tests.
    /// Generated with: `ssh-keygen -t ed25519 -N "" -f tests/fixtures/id_ed25519_plain -C test`
    /// The pair below is a stable test fixture committed under tests/fixtures.
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
            // The fixture isn't generated yet (Step 2 of this task); skip the test.
            // After Step 2 lands the fixture, this branch is unreachable.
            eprintln!("skipping: fixture not yet generated");
            return;
        }
        let key = load_key_from_file(&path, None).expect("plain key should load");
        // We don't care about the exact algorithm, just that we got a key.
        let _ = key.fingerprint();
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
```

- [ ] **Step 2: Generate the test fixture key**

The test references a checked-in unencrypted ed25519 key at `src-tauri/tests/fixtures/id_ed25519_plain`. Generate it once and commit it. The key is for tests only — never used to authenticate to anything.

Run:

```bash
mkdir -p /Users/band/Projects/band/power-term/src-tauri/tests/fixtures
ssh-keygen -t ed25519 -N "" -f /Users/band/Projects/band/power-term/src-tauri/tests/fixtures/id_ed25519_plain -C "power-term-test-fixture-do-not-use" -q
```

If `ssh-keygen` is not available, you can write a Rust one-shot binary that calls `russh_keys::PrivateKey::random_ed25519().write_openssh_pem(...)` and run it once; commit the output and remove the bin. Either way, both files (`id_ed25519_plain` and `id_ed25519_plain.pub`) end up under `tests/fixtures/`.

- [ ] **Step 3: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml ssh::auth`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): Auth enum + key file loader"
```

---

## Task 5: SshSession (russh wrapper) — connect, auth, channel, IO

**Files:**
- Modify: `src-tauri/src/ssh/session.rs`

This is the largest task. The reader-loop / event-channel pattern mirrors `PtySession` exactly so the manager can reuse the same forwarder shape.

- [ ] **Step 1: Replace `src-tauri/src/ssh/session.rs`**

```rust
use crate::pty::PtyEvent;
use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::{fingerprint_sha256, HostVerdict, KnownHosts};
use crate::ssh::SshError;
use async_trait::async_trait;
use parking_lot::Mutex;
use russh::client::{self, Handle, Handler, Msg};
use russh::keys::key::PublicKey;
use russh::{ChannelMsg, Disconnect};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
}

/// Result of `check_server_key` we cache on the handler so the caller can act on it.
#[derive(Debug, Clone)]
enum HostKeyVerdict {
    Trusted,
    Unknown { fingerprint: String, key_type: String },
    Mismatch { fingerprint: String, expected_b64: String, expected_type: String, key_type: String },
}

struct ClientHandler {
    host: String,
    port: u16,
    known_hosts_path: std::path::PathBuf,
    accepted: Option<String>,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
}

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let key_type = key.name().to_string();
        let raw = key.public_key_bytes();
        let key_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &raw,
        );
        let fingerprint = fingerprint_sha256(&key_b64).map_err(|_| russh::Error::Inconsistent)?;

        if let Some(accepted) = &self.accepted {
            if accepted == &fingerprint {
                *self.verdict.lock() = Some(HostKeyVerdict::Trusted);
                return Ok(true);
            }
        }
        let kh = KnownHosts::at(self.known_hosts_path.clone());
        let v = kh.verify(&self.host, self.port, &key_type, &key_b64).map_err(|_| russh::Error::Inconsistent)?;
        match v {
            HostVerdict::Match => {
                *self.verdict.lock() = Some(HostKeyVerdict::Trusted);
                Ok(true)
            }
            HostVerdict::Unknown => {
                *self.verdict.lock() = Some(HostKeyVerdict::Unknown { fingerprint, key_type });
                Ok(false)
            }
            HostVerdict::Mismatch { expected } => {
                *self.verdict.lock() = Some(HostKeyVerdict::Mismatch {
                    fingerprint,
                    expected_b64: expected.key_b64,
                    expected_type: expected.key_type,
                    key_type,
                });
                Ok(false)
            }
        }
    }
}

pub struct SshSession {
    /// Async writer to the channel (lives on tokio).
    writer: AsyncMutex<russh::Channel<Msg>>,
    /// Cancellation that ends the reader task and any pending writes.
    cancel: CancellationToken,
}

impl SshSession {
    /// Connect to `target`, verify the host key, authenticate with `auth`, then
    /// open a session channel + request a PTY + request a shell. On success,
    /// spawn the reader task and return the session plus the receiver of `PtyEvent`s.
    pub async fn connect(
        target: SshTarget,
        auth: Auth,
        cols: u16,
        rows: u16,
        connect_timeout: Duration,
        keepalive: Duration,
        known_hosts_path: std::path::PathBuf,
        accepted_fingerprint: Option<String>,
    ) -> Result<(Arc<Self>, mpsc::Receiver<PtyEvent>), SshError> {
        let mut config = client::Config::default();
        config.inactivity_timeout = Some(keepalive * 4);
        config.keepalive_interval = Some(keepalive);
        let config = Arc::new(config);

        let verdict = Arc::new(Mutex::new(None::<HostKeyVerdict>));
        let handler = ClientHandler {
            host: target.host.clone(),
            port: target.port,
            known_hosts_path,
            accepted: accepted_fingerprint,
            verdict: verdict.clone(),
        };

        let connect_future = client::connect(config, (target.host.as_str(), target.port), handler);
        let mut session: Handle<ClientHandler> = tokio::time::timeout(connect_timeout, connect_future)
            .await
            .map_err(|_| SshError::Connect("timed out".into()))?
            .map_err(|e| SshError::Handshake(e.to_string()))?;

        // If the handler set a non-Trusted verdict, surface it.
        if let Some(v) = verdict.lock().clone() {
            match v {
                HostKeyVerdict::Trusted => {}
                HostKeyVerdict::Unknown { fingerprint, key_type } => {
                    let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
                    return Err(SshError::UnknownFingerprint { fingerprint, host: target.host.clone(), key_type });
                }
                HostKeyVerdict::Mismatch { fingerprint, expected_b64, expected_type, key_type: _ } => {
                    let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
                    return Err(SshError::FingerprintMismatch {
                        fingerprint,
                        expected: format!("{expected_type} {expected_b64}"),
                        host: target.host.clone(),
                    });
                }
            }
        }

        // Authenticate.
        let user = target.user.clone();
        let authed = match auth {
            Auth::Password { password } => session.authenticate_password(user, password).await
                .map_err(|e| SshError::Any(format!("auth password: {e}")))?,
            Auth::KeyFile { path, passphrase } => {
                let key = crate::ssh::auth::load_key_from_file(&path, passphrase.as_deref())?;
                session.authenticate_publickey(user, Arc::new(key)).await
                    .map_err(|e| SshError::Any(format!("auth publickey: {e}")))?
            }
            Auth::Agent => {
                let mut agent = russh_keys::agent::client::AgentClient::connect_env()
                    .await
                    .map_err(|e| SshError::Any(format!("agent connect: {e}")))?;
                let identities = agent.request_identities().await
                    .map_err(|e| SshError::Any(format!("agent identities: {e}")))?;
                let mut authed = false;
                for id in identities {
                    let id = Arc::new(id);
                    if session.authenticate_future(user.clone(), id, &mut agent).await
                        .map_err(|e| SshError::Any(format!("agent auth: {e}")))? {
                        authed = true;
                        break;
                    }
                }
                authed
            }
        };
        if !authed {
            let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
            return Err(SshError::Auth);
        }

        // Open channel, request PTY, start shell.
        let mut channel = session.channel_open_session().await
            .map_err(|e| SshError::Any(format!("open session: {e}")))?;
        channel.request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[]).await
            .map_err(|e| SshError::Any(format!("request_pty: {e}")))?;
        channel.request_shell(true).await
            .map_err(|e| SshError::Any(format!("request_shell: {e}")))?;

        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let cancel = CancellationToken::new();

        // Spawn the reader task on Tauri's tokio runtime.
        let read_channel = channel.clone();
        let read_cancel = cancel.clone();
        let read_tx = tx.clone();
        tauri::async_runtime::spawn(async move {
            reader_loop(read_channel, read_tx, read_cancel).await;
            let _ = tx.send(PtyEvent::Exit { code: None, signal: Some("network_error".into()) });
            let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
        });

        Ok((Arc::new(Self {
            writer: AsyncMutex::new(channel),
            cancel,
        }), rx))
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), SshError> {
        let mut ch = self.writer.lock().await;
        ch.data(data).await.map_err(|e| SshError::Any(format!("ssh write: {e}")))
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        let mut ch = self.writer.lock().await;
        ch.window_change(cols as u32, rows as u32, 0, 0).await
            .map_err(|e| SshError::Any(format!("ssh resize: {e}")))
    }

    pub async fn kill(&self) -> Result<(), SshError> {
        self.cancel.cancel();
        let mut ch = self.writer.lock().await;
        let _ = ch.eof().await;
        let _ = ch.close().await;
        Ok(())
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        // Best-effort: cancel the reader so the spawned task wakes and exits.
        self.cancel.cancel();
    }
}

async fn reader_loop(
    mut channel: russh::Channel<Msg>,
    tx: mpsc::Sender<PtyEvent>,
    cancel: CancellationToken,
) {
    let mut exit_code: Option<i32> = None;
    let mut signal_name: Option<String> = None;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tx.send(PtyEvent::Output(data.to_vec())).is_err() { break; }
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        // stderr / extended; pipe into the same stream
                        if tx.send(PtyEvent::Output(data.to_vec())).is_err() { break; }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit_code = Some(exit_status as i32);
                    }
                    Some(ChannelMsg::ExitSignal { signal_name: name, .. }) => {
                        signal_name = Some(format!("{:?}", name));
                    }
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) => break,
                    Some(_) => {}
                    None => break,
                }
            }
        }
    }
    let _ = tx.send(PtyEvent::Exit { code: exit_code, signal: signal_name });
}
```

- [ ] **Step 2: Add `tokio-util` to Cargo.toml**

The session uses `tokio_util::sync::CancellationToken`. In `[dependencies]`:

```toml
tokio-util = { version = "0.7", features = ["rt"] }
```

- [ ] **Step 3: Build check**

Run: `~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml`
Expected: clean. (russh API mismatches will surface here; if compile fails, prefer adapting the call sites to whatever the locked russh version exposes — the public *shape* of `SshSession` must stay the same.)

- [ ] **Step 4: clippy gate**

Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean. Fix any warnings before committing.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): SshSession with russh client + reader task + 3 auth methods"
```

---

## Task 6: SshManager (registry, event forwarding)

**Files:**
- Modify: `src-tauri/src/ssh/manager.rs`

Mirror `PtyManager` so both speak the same `pty://output|exit/<id>` topic shape.

- [ ] **Step 1: Replace `src-tauri/src/ssh/manager.rs`**

```rust
use crate::pty::PtyEvent;
use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::KnownHosts;
use crate::ssh::session::{SshSession, SshTarget};
use crate::ssh::{SshError, SshId};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct SshManager {
    sessions: Mutex<HashMap<SshId, Arc<SshSession>>>,
}

impl SshManager {
    pub fn new() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }

    pub async fn connect(
        &self,
        app: AppHandle,
        target: SshTarget,
        auth: Auth,
        cols: u16,
        rows: u16,
        connect_timeout: Duration,
        keepalive: Duration,
        accepted_fingerprint: Option<String>,
    ) -> Result<SshId, SshError> {
        let host_label = target.host.clone();
        let known_hosts_path = KnownHosts::default_user_path()
            .ok_or_else(|| SshError::Any("no home dir".into()))?;
        let (session, rx) = SshSession::connect(
            target,
            auth,
            cols,
            rows,
            connect_timeout,
            keepalive,
            known_hosts_path,
            accepted_fingerprint,
        ).await?;
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.lock().insert(id.clone(), session);
        tracing::info!(ssh_id = %id, host = %host_label, "ssh connected");

        let app_handle = app.clone();
        let event_id = id.clone();
        let output_topic = format!("pty://output/{event_id}");
        let exit_topic = format!("pty://exit/{event_id}");
        std::thread::spawn(move || {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD;
            while let Ok(ev) = rx.recv() {
                match ev {
                    PtyEvent::Output(bytes) => {
                        let payload = b64.encode(&bytes);
                        if let Err(e) = app_handle.emit(&output_topic, payload) {
                            tracing::warn!(ssh_id = %event_id, error = %e, "tauri emit failed; stopping forwarder");
                            break;
                        }
                    }
                    PtyEvent::Exit { code, signal } => {
                        tracing::debug!(ssh_id = %event_id, ?code, ?signal, "ssh exit forwarded");
                        let _ = app_handle.emit(&exit_topic, serde_json::json!({
                            "code": code,
                            "signal": signal,
                        }));
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    pub async fn write(&self, id: &SshId, data: &[u8]) -> Result<(), SshError> {
        let s = self.get(id)?;
        s.write(data).await
    }

    pub async fn resize(&self, id: &SshId, cols: u16, rows: u16) -> Result<(), SshError> {
        let s = self.get(id)?;
        s.resize(cols, rows).await
    }

    pub async fn kill(&self, id: &SshId) -> Result<(), SshError> {
        let s = {
            let mut sessions = self.sessions.lock();
            sessions.remove(id).ok_or_else(|| SshError::Unknown(id.clone()))?
        };
        tracing::info!(ssh_id = %id, "ssh killed");
        s.kill().await
    }

    fn get(&self, id: &SshId) -> Result<Arc<SshSession>, SshError> {
        self.sessions.lock().get(id).cloned()
            .ok_or_else(|| SshError::Unknown(id.clone()))
    }
}

impl Default for SshManager {
    fn default() -> Self { Self::new() }
}
```

- [ ] **Step 2: Build + clippy**

Run:
```
~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml
~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): SshManager with same pty:// event wire-format as PtyManager"
```

---

## Task 7: Tauri commands (ssh_connect state machine, ssh_write/resize/kill, known_hosts_get)

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Append to `src-tauri/src/commands.rs`**

Append (do not replace) the existing file with:

```rust
use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::{fingerprint_sha256, KnownHosts};
use crate::ssh::session::SshTarget;
use crate::ssh::{SshError, SshManager};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct SshTargetArg {
    pub host: String,
    pub port: u16,
    pub user: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthRequest {
    Agent,
    Password { password: String },
    Key { path: String, passphrase: Option<String> },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SshConnectResult {
    Connected { id: String },
    NeedsFingerprint { fingerprint: String, host: String, key_type: String },
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    NeedsAuth { tried: Vec<String>, available: Vec<String> },
}

impl From<AuthRequest> for Auth {
    fn from(a: AuthRequest) -> Self {
        match a {
            AuthRequest::Agent => Auth::Agent,
            AuthRequest::Password { password } => Auth::Password { password },
            AuthRequest::Key { path, passphrase } => Auth::KeyFile { path: PathBuf::from(path), passphrase },
        }
    }
}

#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    manager: tauri::State<'_, SshManager>,
    settings: tauri::State<'_, crate::settings::SettingsStore>,
    target: SshTargetArg,
    auth: AuthRequest,
    cols: u16,
    rows: u16,
    accept_fingerprint: Option<String>,
) -> Result<SshConnectResult, String> {
    let s = settings.get();
    let connect_timeout = Duration::from_secs(s.ssh_connect_timeout_secs as u64);
    let keepalive = Duration::from_secs(s.ssh_keepalive_interval_secs as u64);
    let target = SshTarget { host: target.host, port: target.port, user: target.user };
    let tried_tag = match &auth {
        AuthRequest::Agent => "agent",
        AuthRequest::Password { .. } => "password",
        AuthRequest::Key { .. } => "publickey",
    }.to_string();

    match manager.connect(app, target.clone(), auth.into(), cols, rows, connect_timeout, keepalive, accept_fingerprint).await {
        Ok(id) => Ok(SshConnectResult::Connected { id }),
        Err(SshError::UnknownFingerprint { fingerprint, host, key_type }) =>
            Ok(SshConnectResult::NeedsFingerprint { fingerprint, host, key_type }),
        Err(SshError::FingerprintMismatch { fingerprint, expected, host }) =>
            Ok(SshConnectResult::FingerprintMismatch { fingerprint, expected, host }),
        Err(SshError::Auth) => Ok(SshConnectResult::NeedsAuth {
            tried: vec![tried_tag],
            available: vec!["agent".into(), "publickey".into(), "password".into()],
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn ssh_write(
    manager: tauri::State<'_, SshManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    manager.write(&pty_id, &bytes).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    manager: tauri::State<'_, SshManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&pty_id, cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_kill(
    manager: tauri::State<'_, SshManager>,
    pty_id: String,
) -> Result<(), String> {
    manager.kill(&pty_id).await.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct KnownHostsLookup {
    pub fingerprint: Option<String>,
    pub key_type: Option<String>,
}

#[tauri::command]
pub fn known_hosts_get(host: String, port: u16) -> Result<KnownHostsLookup, String> {
    let path = KnownHosts::default_user_path().ok_or_else(|| "no home dir".to_string())?;
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound =>
            return Ok(KnownHostsLookup { fingerprint: None, key_type: None }),
        Err(e) => return Err(e.to_string()),
    };
    let needle_with_port = if port == 22 { host.clone() } else { format!("[{host}]:{port}") };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("|1|") { continue; }
        let mut parts = line.splitn(3, ' ');
        let hosts_field = match parts.next() { Some(s) => s, None => continue };
        let key_type = match parts.next() { Some(s) => s, None => continue };
        let key_b64 = match parts.next() { Some(s) => s, None => continue };
        if hosts_field.split(',').any(|h| h == needle_with_port || h == host) {
            let fp = fingerprint_sha256(key_b64).map_err(|e| e.to_string())?;
            return Ok(KnownHostsLookup { fingerprint: Some(fp), key_type: Some(key_type.to_string()) });
        }
    }
    Ok(KnownHostsLookup { fingerprint: None, key_type: None })
}
```

- [ ] **Step 2: Wire the new commands in `src-tauri/src/main.rs`**

Replace `src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::ssh::SshManager;

fn main() {
    tracing_subscriber::fmt::init();

    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");

    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(settings)
        .invoke_handler(tauri::generate_handler![
            power_term::commands::pty_spawn,
            power_term::commands::pty_write,
            power_term::commands::pty_resize,
            power_term::commands::pty_kill,
            power_term::commands::settings_get,
            power_term::commands::settings_update,
            power_term::commands::ssh_connect,
            power_term::commands::ssh_write,
            power_term::commands::ssh_resize,
            power_term::commands::ssh_kill,
            power_term::commands::known_hosts_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Build + clippy**

Run:
```
~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml
~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings
```
Expected: both clean.

- [ ] **Step 4: Re-run all existing tests so we know no regressions**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --lib`
Expected: 6 (settings + pty) + 11 (known_hosts) + 4 (auth) = 21 lib tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(commands): wire ssh_connect state machine + ssh_* + known_hosts_get"
```

---

## Task 8: Settings additions for SSH timeouts

**Files:**
- Modify: `src-tauri/src/settings/mod.rs`

- [ ] **Step 1: Add fields to `Settings`**

In `src-tauri/src/settings/mod.rs`, find the `Settings` struct and replace it with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Settings {
    pub shell: Option<String>,
    pub font_family: String,
    pub font_size: u16,
    pub theme: String,
    pub cursor_blink: bool,
    pub scrollback_lines: u32,
    pub ssh_connect_timeout_secs: u32,
    pub ssh_keepalive_interval_secs: u32,
}
```

And replace `Default for Settings` with:

```rust
impl Default for Settings {
    fn default() -> Self {
        Self {
            shell: None,
            font_family: "JetBrains Mono".to_string(),
            font_size: 14,
            theme: "auto".to_string(),
            cursor_blink: true,
            scrollback_lines: 10_000,
            ssh_connect_timeout_secs: 10,
            ssh_keepalive_interval_secs: 30,
        }
    }
}
```

And in `SettingsPatch`, add the matching optional fields:

```rust
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct SettingsPatch {
    pub shell: Option<Option<String>>,
    pub font_family: Option<String>,
    pub font_size: Option<u16>,
    pub theme: Option<String>,
    pub cursor_blink: Option<bool>,
    pub scrollback_lines: Option<u32>,
    pub ssh_connect_timeout_secs: Option<u32>,
    pub ssh_keepalive_interval_secs: Option<u32>,
}
```

Inside `apply`, add:

```rust
        if let Some(v) = patch.ssh_connect_timeout_secs { s.ssh_connect_timeout_secs = v; }
        if let Some(v) = patch.ssh_keepalive_interval_secs { s.ssh_keepalive_interval_secs = v; }
```

(Insert before `atomic_write(&self.path, &s)?;`.)

- [ ] **Step 2: Run settings tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml settings::tests`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src-tauri/src/settings/
git -C /Users/band/Projects/band/power-term commit -m "feat(settings): ssh_connect_timeout_secs + ssh_keepalive_interval_secs"
```

---

## Task 9: Frontend types + sshTarget parser (TDD)

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/sshTarget.ts`
- Create: `src/lib/sshTarget.test.ts`

- [ ] **Step 1: Extend `src/types.ts`** (replace, keeping old exports)

```typescript
export type Theme = 'light' | 'dark' | 'auto';

export interface Settings {
  shell: string | null;
  font_family: string;
  font_size: number;
  theme: Theme;
  cursor_blink: boolean;
  scrollback_lines: number;
  ssh_connect_timeout_secs: number;
  ssh_keepalive_interval_secs: number;
}

export type SettingsPatch = Partial<Omit<Settings, 'shell'>> & { shell?: string | null };

export type TabKind = 'local' | 'ssh';

export interface Tab {
  id: string;
  ptyId: string;
  title: string;
  kind: TabKind;
  exitCode?: number | null;
}

export interface PtyExitPayload {
  code: number | null;
  signal: string | null;
}

export interface SshTarget {
  host: string;
  port: number;
  user: string;
}

export type AuthRequest =
  | { kind: 'agent' }
  | { kind: 'password'; password: string }
  | { kind: 'key'; path: string; passphrase?: string };

export type SshConnectResult =
  | { status: 'connected'; id: string }
  | { status: 'needs_fingerprint'; fingerprint: string; host: string; key_type: string }
  | { status: 'fingerprint_mismatch'; fingerprint: string; expected: string; host: string }
  | { status: 'needs_auth'; tried: string[]; available: string[] };
```

- [ ] **Step 2: Write `src/lib/sshTarget.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { parseSshTarget } from './sshTarget';

describe('parseSshTarget', () => {
  it('parses user@host', () => {
    expect(parseSshTarget('band@example.com')).toEqual({ user: 'band', host: 'example.com', port: 22 });
  });

  it('parses user@host:port', () => {
    expect(parseSshTarget('band@example.com:2222'))
      .toEqual({ user: 'band', host: 'example.com', port: 2222 });
  });

  it('host without user uses $USER fallback', () => {
    const res = parseSshTarget('example.com', 'ndba');
    expect(res).toEqual({ user: 'ndba', host: 'example.com', port: 22 });
  });

  it('rejects empty host', () => {
    expect(() => parseSshTarget('')).toThrow();
    expect(() => parseSshTarget('user@')).toThrow();
  });

  it('rejects non-numeric port', () => {
    expect(() => parseSshTarget('a@b:abc')).toThrow();
  });

  it('rejects out-of-range port', () => {
    expect(() => parseSshTarget('a@b:99999')).toThrow();
  });

  it('parses bracketed IPv6', () => {
    expect(parseSshTarget('band@[::1]:2222'))
      .toEqual({ user: 'band', host: '::1', port: 2222 });
  });

  it('rejects malformed IPv6 brackets', () => {
    expect(() => parseSshTarget('band@[::1')).toThrow();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/lib/sshTarget.test.ts`
Expected: FAIL — `Cannot find module './sshTarget'`.

- [ ] **Step 4: Write `src/lib/sshTarget.ts`**

```typescript
import type { SshTarget } from '../types';

export function parseSshTarget(input: string, defaultUser?: string): SshTarget {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty target');

  let user = defaultUser ?? '';
  let rest = trimmed;
  const at = trimmed.indexOf('@');
  if (at >= 0) {
    user = trimmed.slice(0, at);
    rest = trimmed.slice(at + 1);
    if (!user) throw new Error('empty user');
  }
  if (!user) throw new Error('user required');
  if (!rest) throw new Error('empty host');

  let host: string;
  let port = 22;
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) throw new Error('unterminated [bracket]');
    host = rest.slice(1, end);
    const after = rest.slice(end + 1);
    if (after.startsWith(':')) {
      port = parsePort(after.slice(1));
    } else if (after.length > 0) {
      throw new Error('unexpected chars after bracket');
    }
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon >= 0) {
      host = rest.slice(0, colon);
      port = parsePort(rest.slice(colon + 1));
    } else {
      host = rest;
    }
  }
  if (!host) throw new Error('empty host');
  return { user, host, port };
}

function parsePort(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid port: ${s}`);
  return n;
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/lib/sshTarget.test.ts`
Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/types.ts src/lib/
git -C /Users/band/Projects/band/power-term commit -m "feat(ssh): SshTarget parser + types for AuthRequest/SshConnectResult"
```

---

## Task 10: Frontend IPC additions + sessionStore.kind

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/state/sessionStore.ts`
- Modify: `src/state/sessionStore.test.ts`

- [ ] **Step 1: Append SSH wrappers to `src/lib/ipc.ts`**

Add at the end of the file:

```typescript
import type { AuthRequest, SshConnectResult, SshTarget } from '../types';

export async function sshConnect(args: {
  target: SshTarget;
  auth: AuthRequest;
  cols: number;
  rows: number;
  acceptFingerprint?: string | null;
}): Promise<SshConnectResult> {
  return invoke<SshConnectResult>('ssh_connect', {
    target: args.target,
    auth: args.auth,
    cols: args.cols,
    rows: args.rows,
    acceptFingerprint: args.acceptFingerprint ?? null,
  });
}

export async function sshWrite(ptyId: string, data: string | Uint8Array): Promise<void> {
  await invoke('ssh_write', { ptyId, data: encodeBase64(data) });
}

export async function sshResize(ptyId: string, cols: number, rows: number): Promise<void> {
  await invoke('ssh_resize', { ptyId, cols, rows });
}

export async function sshKill(ptyId: string): Promise<void> {
  await invoke('ssh_kill', { ptyId });
}

export async function knownHostsGet(host: string, port: number): Promise<{ fingerprint: string | null; key_type: string | null }> {
  return invoke('known_hosts_get', { host, port });
}
```

- [ ] **Step 2: Update `src/state/sessionStore.ts` to track `kind`**

Replace the file's `addTab` signature and impl:

```typescript
import { create } from 'zustand';
import type { Tab, TabKind } from '../types';

let counter = 0;
const newId = () => `tab-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (ptyId: string, title: string, kind?: TabKind) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  rename: (id: string, title: string) => void;
  markExit: (ptyId: string, code: number | null) => void;
}

export const useSessionStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,
  addTab: (ptyId, title, kind = 'local') => {
    const tab: Tab = { id: newId(), ptyId, title, kind };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const next = tabs.filter((t) => t.id !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      const neighbour = next[idx] ?? next[idx - 1] ?? null;
      nextActive = neighbour?.id ?? null;
    }
    set({ tabs: next, activeTabId: nextActive });
  },
  setActive: (id) => set({ activeTabId: id }),
  rename: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
  markExit: (ptyId, code) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.ptyId === ptyId ? { ...t, exitCode: code } : t)),
    })),
}));
```

- [ ] **Step 3: Add a kind-aware test in `src/state/sessionStore.test.ts`**

Append before the closing `});` of the `describe` block:

```typescript
  it('addTab defaults kind to local; ssh kind is preserved', () => {
    const { addTab } = useSessionStore.getState();
    const localId = addTab('pty-loc', 'a');
    const sshId = addTab('pty-ssh', 'b', 'ssh');
    const tabs = useSessionStore.getState().tabs;
    expect(tabs.find((t) => t.id === localId)!.kind).toBe('local');
    expect(tabs.find((t) => t.id === sshId)!.kind).toBe('ssh');
  });
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix /Users/band/Projects/band/power-term test`
Expected: 14 tests pass (was 13; +1 new sessionStore test).

- [ ] **Step 5: tsc clean**

Run: `npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/
git -C /Users/band/Projects/band/power-term commit -m "feat(state): Tab.kind ssh|local; ipc adds ssh* + knownHostsGet"
```

---

## Task 11: HostFingerprintPrompt + AuthPrompt components

**Files:**
- Create: `src/components/HostFingerprintPrompt.tsx`
- Create: `src/components/AuthPrompt.tsx`

These are small modal forms; their happy-path behaviour will be exercised by the App-level Cmd+K flow rather than DOM unit tests.

- [ ] **Step 1: Create `src/components/HostFingerprintPrompt.tsx`**

```typescript
interface Props {
  host: string;
  fingerprint: string;
  keyType: string;
  /** Set when the user is replacing a known-but-mismatched key (TOFU2). */
  isMismatch?: boolean;
  expected?: string;
  onAccept: () => void;
  onCancel: () => void;
}

export function HostFingerprintPrompt(props: Props) {
  const { host, fingerprint, keyType, isMismatch, expected, onAccept, onCancel } = props;
  return (
    <div className="modal-backdrop" role="dialog" aria-label="host fingerprint">
      <div className={`modal ${isMismatch ? 'modal-warning' : ''}`}>
        <h2>{isMismatch ? '⚠ Host key changed' : 'New host'}</h2>
        <p>
          {isMismatch
            ? `The fingerprint of ${host} does not match the one previously trusted.`
            : `${host} is not in your known_hosts. Verify the fingerprint with the server admin before trusting.`}
        </p>
        <dl className="fingerprint">
          <dt>Type</dt><dd>{keyType}</dd>
          <dt>Fingerprint</dt><dd className="mono">{fingerprint}</dd>
          {expected && <><dt>Previously trusted</dt><dd className="mono">{expected}</dd></>}
        </dl>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={onAccept}>
            {isMismatch ? 'Reset and accept' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/AuthPrompt.tsx`**

```typescript
import { useState } from 'react';
import type { AuthRequest } from '../types';

interface Props {
  user: string;
  host: string;
  triedAgent: boolean;
  errorMessage?: string;
  onSubmit: (auth: AuthRequest) => void;
  onCancel: () => void;
}

type Method = 'agent' | 'key' | 'password';

export function AuthPrompt({ user, host, triedAgent, errorMessage, onSubmit, onCancel }: Props) {
  const [method, setMethod] = useState<Method>(triedAgent ? 'key' : 'agent');
  const [keyPath, setKeyPath] = useState('');
  const [keyPass, setKeyPass] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    if (method === 'agent') return onSubmit({ kind: 'agent' });
    if (method === 'key') return onSubmit({ kind: 'key', path: keyPath, passphrase: keyPass || undefined });
    return onSubmit({ kind: 'password', password });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="ssh auth">
      <div className="modal">
        <h2>Authenticate to {user}@{host}</h2>
        {errorMessage && <p className="error">{errorMessage}</p>}
        <fieldset className="auth-method">
          <label><input type="radio" name="auth" checked={method === 'agent'} onChange={() => setMethod('agent')} /> SSH agent</label>
          <label><input type="radio" name="auth" checked={method === 'key'} onChange={() => setMethod('key')} /> Private key file</label>
          <label><input type="radio" name="auth" checked={method === 'password'} onChange={() => setMethod('password')} /> Password</label>
        </fieldset>
        {method === 'key' && (
          <div className="auth-fields">
            <input placeholder="/Users/you/.ssh/id_ed25519" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
            <input type="password" placeholder="Passphrase (optional)" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} />
          </div>
        )}
        {method === 'password' && (
          <div className="auth-fields">
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit}>Connect</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: tsc check**

Run: `npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/components/
git -C /Users/band/Projects/band/power-term commit -m "feat(ui): HostFingerprintPrompt + AuthPrompt modals"
```

---

## Task 12: CommandPalette (Cmd+K) — TDD parse, render

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Create: `src/components/CommandPalette.test.tsx`

- [ ] **Step 1: Write `src/components/CommandPalette.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('renders an input', () => {
    render(<CommandPalette open onClose={() => {}} onSshConnect={vi.fn()} />);
    expect(screen.getByPlaceholderText(/ssh user@host/i)).toBeInTheDocument();
  });

  it('typing "ssh user@host" + Enter triggers onSshConnect', async () => {
    const onSshConnect = vi.fn();
    render(<CommandPalette open onClose={() => {}} onSshConnect={onSshConnect} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, 'ssh band@example.com:2222{Enter}');
    expect(onSshConnect).toHaveBeenCalledWith({ user: 'band', host: 'example.com', port: 2222 });
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onSshConnect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a parse error and does not call onSshConnect on bad input', async () => {
    const onSshConnect = vi.fn();
    render(<CommandPalette open onClose={() => {}} onSshConnect={onSshConnect} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, 'ssh @@@{Enter}');
    expect(onSshConnect).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid|empty/i)).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<CommandPalette open={false} onClose={() => {}} onSshConnect={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/ssh user@host/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL (module missing)**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/CommandPalette.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `src/components/CommandPalette.tsx`**

```typescript
import { useState } from 'react';
import { parseSshTarget } from '../lib/sshTarget';
import type { SshTarget } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSshConnect: (target: SshTarget) => void;
}

export function CommandPalette({ open, onClose, onSshConnect }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed.toLowerCase().startsWith('ssh ')) {
        const arg = trimmed.slice(4).trim();
        try {
          const target = parseSshTarget(arg);
          onSshConnect(target);
          setText('');
          setError(null);
          onClose();
        } catch (err) {
          setError(String((err as Error).message ?? err));
        }
      } else {
        setError('only "ssh user@host[:port]" is supported in this build');
      }
    }
  };

  return (
    <div className="palette-backdrop" role="dialog" aria-label="command palette" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="ssh user@host[:port]"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={handleKey}
        />
        {error && <p className="palette-error">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/CommandPalette.test.tsx`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/
git -C /Users/band/Projects/band/power-term commit -m "feat(ui): CommandPalette (Cmd+K) — ssh user@host shortcut"
```

---

## Task 13: App wiring — Cmd+K, modals, connect flow

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/Terminal.tsx` (route writes/resize/kill to ssh* when tab.kind === 'ssh')

- [ ] **Step 1: Update `src/components/Terminal.tsx` to dispatch by tab kind**

In `Terminal.tsx`, replace the import line `import { onPtyExit, onPtyOutput, ptyResize, ptyWrite } from '../lib/ipc';` with:

```typescript
import { onPtyExit, onPtyOutput, ptyResize, ptyWrite, sshResize, sshWrite } from '../lib/ipc';
```

Then replace the `term.onData` and `term.onResize` lines:

```typescript
    const onData = term.onData((data) => {
      if (tab.kind === 'ssh') void sshWrite(tab.ptyId, data);
      else void ptyWrite(tab.ptyId, data);
    });
    const onResize = term.onResize(({ cols, rows }) => {
      if (tab.kind === 'ssh') void sshResize(tab.ptyId, cols, rows);
      else void ptyResize(tab.ptyId, cols, rows);
    });
```

(The output/exit listeners are already source-agnostic — both managers emit on the same `pty://output|exit/<id>` topic.)

- [ ] **Step 2: Replace `src/App.tsx` with the wired version**

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { ptyKill, ptySpawn, sshConnect, sshKill } from './lib/ipc';
import type { AuthRequest, SshTarget } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type SshFlow =
  | { phase: 'idle' }
  | { phase: 'connecting'; target: SshTarget; auth: AuthRequest; acceptFp: string | null }
  | { phase: 'fingerprint'; target: SshTarget; auth: AuthRequest; fingerprint: string; keyType: string; mismatch?: { expected: string } }
  | { phase: 'auth'; target: SshTarget; tried: string[]; available: string[]; error?: string };

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshFlow, setSshFlow] = useState<SshFlow>({ phase: 'idle' });

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const newLocalTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultLocalTitle(settings?.shell ?? null), 'local');
    } catch (e) {
      console.error('pty_spawn failed', e);
    }
  }, [addTab, settings?.shell]);

  const handleClose = useCallback(async (id: string) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    try {
      if (tab.kind === 'ssh') await sshKill(tab.ptyId);
      else await ptyKill(tab.ptyId);
    } catch (e) { console.warn('kill failed', e); }
    closeTab(id);
    if (useSessionStore.getState().tabs.length === 0) {
      void getCurrentWindow().close();
    }
  }, [closeTab]);

  // SSH flow driver
  const driveSshConnect = useCallback(async (target: SshTarget, auth: AuthRequest, acceptFp: string | null) => {
    setSshFlow({ phase: 'connecting', target, auth, acceptFp });
    const result = await sshConnect({ target, auth, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, acceptFingerprint: acceptFp });
    if (result.status === 'connected') {
      addTab(result.id, `${target.user}@${target.host}`, 'ssh');
      setSshFlow({ phase: 'idle' });
    } else if (result.status === 'needs_fingerprint') {
      setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: result.key_type });
    } else if (result.status === 'fingerprint_mismatch') {
      setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: 'unknown', mismatch: { expected: result.expected } });
    } else if (result.status === 'needs_auth') {
      setSshFlow({ phase: 'auth', target, tried: result.tried, available: result.available });
    }
  }, [addTab]);

  const onPaletteSshConnect = useCallback((target: SshTarget) => {
    setPaletteOpen(false);
    void driveSshConnect(target, { kind: 'agent' }, null);
  }, [driveSshConnect]);

  useHotkeys({ onNewTab: () => void newLocalTab(), onCloseTab: (id) => void handleClose(id) });

  // Cmd+K opens the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openedFirstTab = useRef(false);
  useEffect(() => {
    if (settings && tabs.length === 0 && !openedFirstTab.current) {
      openedFirstTab.current = true;
      void newLocalTab();
    }
  }, [settings, tabs.length, newLocalTab]);

  const theme = useTheme();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const visibleId = useMemo(() => activeTabId, [activeTabId]);

  return (
    <div className={`app theme-${theme}`}>
      <TitleBar>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <main className="terminals">
        {tabs.map((t) => (
          <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
        ))}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSshConnect={onPaletteSshConnect} />
      {sshFlow.phase === 'fingerprint' && (
        <HostFingerprintPrompt
          host={sshFlow.target.host}
          fingerprint={sshFlow.fingerprint}
          keyType={sshFlow.keyType}
          isMismatch={!!sshFlow.mismatch}
          expected={sshFlow.mismatch?.expected}
          onAccept={() => driveSshConnect(sshFlow.target, sshFlow.auth, sshFlow.fingerprint)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
      {sshFlow.phase === 'auth' && (
        <AuthPrompt
          user={sshFlow.target.user}
          host={sshFlow.target.host}
          triedAgent={sshFlow.tried.includes('agent')}
          errorMessage={sshFlow.error}
          onSubmit={(auth) => driveSshConnect(sshFlow.target, auth, null)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
    </div>
  );
}

function defaultLocalTitle(shell: string | null): string {
  if (!shell) return 'shell';
  const base = shell.split('/').pop() ?? 'shell';
  return base;
}
```

- [ ] **Step 3: Append palette + modal CSS to `src/styles.css`**

Append to the end of the file:

```css
.palette-backdrop, .modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; justify-content: center; align-items: flex-start; padding-top: 15vh;
  z-index: 100;
}
.palette {
  width: 600px; max-width: 90vw; background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.palette input {
  width: 100%; padding: 8px 10px; font: inherit; font-size: 14px;
  background: transparent; color: var(--fg); border: 0; outline: 0;
}
.palette-error { color: #d97706; padding: 6px 10px 0 10px; font-size: 12px; }

.modal {
  width: 460px; max-width: 90vw; background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 16px;
}
.modal.modal-warning { border-color: #dc2626; }
.modal h2 { margin: 0 0 8px 0; font-size: 16px; }
.modal p { font-size: 13px; line-height: 1.5; margin: 0 0 12px 0; }
.modal .error { color: #dc2626; font-size: 12px; }
.modal dl.fingerprint { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 12px; margin: 0 0 12px 0; }
.modal dl.fingerprint dt { opacity: 0.7; }
.modal dl.fingerprint .mono { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; word-break: break-all; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.modal-actions button { padding: 6px 12px; border: 1px solid var(--border); background: var(--tab-bg); color: var(--fg); border-radius: 6px; cursor: pointer; }
.modal-actions button.primary { background: #2563eb; color: white; border-color: #2563eb; }
.modal fieldset.auth-method { display: flex; flex-direction: column; gap: 4px; border: 0; padding: 0; margin: 0 0 12px 0; }
.modal fieldset.auth-method label { font-size: 13px; cursor: pointer; }
.auth-fields { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px 0; }
.auth-fields input { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--tab-bg); color: var(--fg); font: inherit; font-size: 13px; }
```

- [ ] **Step 4: tsc + tests**

Run:
```
npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit
npm --prefix /Users/band/Projects/band/power-term test
```
Expected: tsc clean; 19 tests pass (was 14; +5 CommandPalette).

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/
git -C /Users/band/Projects/band/power-term commit -m "feat(app): wire Cmd+K palette + SSH flow modals + Terminal kind dispatch"
```

---

## Task 14: Capabilities + production build smoke

**Files:**
- Modify: `src-tauri/capabilities/default.json` (if needed — current set already covers core:event/window)

- [ ] **Step 1: Confirm capabilities cover the new commands**

Tauri 2's default `core:default` permission lets the renderer call any registered command, so `ssh_*` and `known_hosts_get` need no extra ACL entry. Verify by reading `src-tauri/capabilities/default.json` and confirming it lists `core:default`.

If you find Tauri builds rejecting commands at runtime (`Permission ssh_connect denied` in console), add:

```json
{ "permissions": ["core:default", "core:event:default", "core:window:default"] }
```

(already present from MVP). No changes needed otherwise.

- [ ] **Step 2: Final build smoke**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm --prefix /Users/band/Projects/band/power-term run tauri:build
```

Expected: build succeeds, `power-term.app` is produced under `src-tauri/target/release/bundle/macos/`. (DMG bundling may still fail on unsigned setups; that's a known MVP limitation, not new.)

- [ ] **Step 3: Manual smoke (record results, do not commit)**

These need a real macOS user session with at least one reachable SSH host:

- [ ] App launches, default local tab opens
- [ ] `Cmd+K` → palette opens, `ssh you@your-known-host` Enter → connects via agent (assumes `SSH_AUTH_SOCK` set)
- [ ] `Cmd+K` → `ssh root@new.example.com` (one you've never connected to) → fingerprint modal shows; Accept → tab opens; reconnect later with no prompt
- [ ] Edit `~/.ssh/known_hosts`, change the previously-accepted entry's key bytes; reconnect → red mismatch modal; Reset → connects again
- [ ] `Cmd+K` → host where agent has no matching identity → AuthPrompt opens; pick key file → connects
- [ ] Same flow with password-only host → password prompt → connects
- [ ] Disconnect network mid-session → tab shows `[process exited (code null)]` with `signal: "network_error"` (visible via `RUST_LOG=power_term=debug` in dev console)
- [ ] `Cmd+W` closes a remote tab cleanly
- [ ] Light/dark theme still applies to modals

- [ ] **Step 4: Empty smoke commit**

```bash
git -C /Users/band/Projects/band/power-term commit --allow-empty -m "chore(ssh): #2A smoke passes on macOS"
```

If a smoke item fails, file a follow-up task and **do not** mark this task complete.

---

## Definition of Done

- 21+ Rust lib tests pass (existing 6 + 11 known_hosts + 4 auth).
- 19+ frontend vitest tests pass (existing 13 + 1 sessionStore.kind + 5 CommandPalette).
- `cargo clippy --all-targets -- -D warnings` clean.
- `tsc --noEmit` clean.
- `npm run tauri:build` produces `power-term.app`.
- Cmd+K → `ssh user@host` connects via the user's agent in the smoke run, with TOFU prompt for new hosts.
- No persistence in this sub-project; that's #2B.
