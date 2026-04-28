//! SFTP session: russh-sftp 2.x wrapper that mirrors the host-key + auth flow
//! of `crate::ssh::session::SshSession` (#2A) and exposes a high-level file
//! operation surface to the manager (Task 4) and command layer (Task 5).
//!
//! The underlying russh-sftp `SftpSession` (aliased as `SftpClient` in this
//! file to avoid ambiguity with our own struct of the same name) takes
//! ownership of the russh `Channel<Msg>` via `into_stream()`. Channel writes
//! and reads are then driven through the russh-sftp client's own internal
//! request/response state, so unlike the PTY transport we don't need a
//! dedicated reader-loop / command-channel pattern here — wrap the high-level
//! client in an `AsyncMutex` and serialize calls.
use crate::sftp::SftpError;
use crate::ssh::auth::Auth;
use crate::ssh::handshake::{handshake_and_auth, ClientHandler, HandshakeError};
use russh::client::Handle;
use russh::Disconnect;
use russh_sftp::client::SftpSession as SftpClient;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;

/// SFTP target reuses the same shape as the SSH transport target. Re-exported
/// as a type alias so existing call sites in `sftp::manager` and `commands.rs`
/// don't need to change.
pub type SftpTarget = crate::ssh::handshake::SshTarget;

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub permissions: u32,
    pub symlink_target: Option<String>,
}

fn handshake_to_sftp_err(e: HandshakeError) -> SftpError {
    match e {
        HandshakeError::Connect(s) => SftpError::Connect(s),
        HandshakeError::Handshake(s) => SftpError::Handshake(s),
        HandshakeError::Auth => SftpError::Auth,
        HandshakeError::UnknownFingerprint {
            fingerprint,
            host,
            key_type,
        } => SftpError::UnknownFingerprint {
            fingerprint,
            host,
            key_type,
        },
        HandshakeError::FingerprintMismatch {
            fingerprint,
            expected,
            host,
        } => SftpError::FingerprintMismatch {
            fingerprint,
            expected,
            host,
        },
        HandshakeError::Any(s) => SftpError::Any(s),
    }
}

pub struct SftpSession {
    sftp: AsyncMutex<SftpClient>,
    /// Hold the russh session alive for the lifetime of the SFTP session.
    /// Wrapped in AsyncMutex so close() can disconnect.
    ssh: AsyncMutex<Handle<ClientHandler>>,
}

impl SftpSession {
    #[allow(clippy::too_many_arguments)]
    pub async fn open(
        target: SftpTarget,
        auth: Auth,
        connect_timeout: Duration,
        keepalive: Duration,
        known_hosts_path: PathBuf,
        accepted_fingerprint: Option<String>,
    ) -> Result<Arc<Self>, SftpError> {
        let session = handshake_and_auth(
            target.clone(),
            auth,
            connect_timeout,
            keepalive,
            known_hosts_path,
            accepted_fingerprint,
        )
        .await
        .map_err(handshake_to_sftp_err)?;

        // Open SFTP subsystem.
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| SftpError::Any(format!("open session: {e}")))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| SftpError::Any(format!("request_subsystem sftp: {e}")))?;
        let sftp = SftpClient::new(channel.into_stream())
            .await
            .map_err(|e| SftpError::Any(format!("sftp init: {e}")))?;

        Ok(Arc::new(Self {
            sftp: AsyncMutex::new(sftp),
            ssh: AsyncMutex::new(session),
        }))
    }

    pub async fn list(&self, path: &str) -> Result<Vec<SftpEntry>, SftpError> {
        let sftp = self.sftp.lock().await;
        // russh-sftp 2.x: read_dir returns a synchronous iterator (ReadDir)
        // that has already filtered out "." and "..". Each item is a
        // DirEntry with file_name() -> String and metadata() -> FileAttributes.
        let dir = sftp.read_dir(path).await.map_err(map_sftp_err)?;
        let mut entries = Vec::new();
        for item in dir {
            let name = item.file_name();
            let attrs = item.metadata();
            entries.push(attrs_to_entry(name, &attrs));
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    pub async fn canonicalize(&self, path: &str) -> Result<String, SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.canonicalize(path.to_string())
            .await
            .map_err(map_sftp_err)
    }

    pub async fn mkdir(&self, path: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.create_dir(path.to_string())
            .await
            .map_err(map_sftp_err)
    }

    pub async fn remove_file(&self, path: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.remove_file(path.to_string())
            .await
            .map_err(map_sftp_err)
    }

    pub async fn remove_dir(&self, path: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.remove_dir(path.to_string())
            .await
            .map_err(map_sftp_err)
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.rename(from.to_string(), to.to_string())
            .await
            .map_err(map_sftp_err)
    }

    pub async fn download(&self, remote: &str, local: &Path) -> Result<u64, SftpError> {
        let sftp = self.sftp.lock().await;
        let mut remote_file = sftp.open(remote.to_string()).await.map_err(map_sftp_err)?;
        if let Some(parent) = local.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut local_file = tokio::fs::File::create(local).await?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| SftpError::Any(format!("remote read: {e}")))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).await?;
            total += n as u64;
        }
        local_file.flush().await?;
        Ok(total)
    }

    pub async fn upload(&self, local: &Path, remote: &str) -> Result<u64, SftpError> {
        let sftp = self.sftp.lock().await;
        let mut local_file = tokio::fs::File::open(local).await?;
        let mut remote_file = sftp
            .open_with_flags(
                remote.to_string(),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(map_sftp_err)?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut total: u64 = 0;
        loop {
            let n = local_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| SftpError::Any(format!("remote write: {e}")))?;
            total += n as u64;
        }
        remote_file
            .shutdown()
            .await
            .map_err(|e| SftpError::Any(format!("remote shutdown: {e}")))?;
        Ok(total)
    }

    pub async fn close(&self) -> Result<(), SftpError> {
        // Don't error if either close fails — disconnect path is best-effort.
        let sftp = self.sftp.lock().await;
        let _ = sftp.close().await;
        drop(sftp);
        let ssh = self.ssh.lock().await;
        let _ = ssh.disconnect(Disconnect::ByApplication, "", "").await;
        Ok(())
    }
}

fn attrs_to_entry(name: String, attrs: &russh_sftp::protocol::FileAttributes) -> SftpEntry {
    let kind = if attrs.is_dir() {
        "dir".to_string()
    } else if attrs.is_symlink() {
        "symlink".to_string()
    } else if attrs.is_regular() {
        "file".to_string()
    } else {
        "other".to_string()
    };
    SftpEntry {
        name,
        kind,
        size: attrs.size.unwrap_or(0),
        modified_ms: attrs.mtime.map(|t| (t as i64) * 1000),
        permissions: attrs.permissions.unwrap_or(0),
        symlink_target: None,
    }
}

fn map_sftp_err(e: russh_sftp::client::error::Error) -> SftpError {
    use russh_sftp::client::error::Error as E;
    use russh_sftp::protocol::StatusCode;
    let s = e.to_string();
    match e {
        E::Status(st) => match st.status_code {
            StatusCode::NoSuchFile => SftpError::NotFound(st.error_message),
            StatusCode::PermissionDenied => SftpError::PermissionDenied(st.error_message),
            _ => SftpError::Any(s),
        },
        _ => SftpError::Any(s),
    }
}

// Ensure the serde tests from Task 2 still compile against this new file.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_serializes_with_snake_case_fields() {
        let e = SftpEntry {
            name: "foo.txt".into(),
            kind: "file".into(),
            size: 1234,
            modified_ms: Some(1_700_000_000_000),
            permissions: 0o644,
            symlink_target: None,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"name\":\"foo.txt\""));
        assert!(json.contains("\"kind\":\"file\""));
        assert!(json.contains("\"size\":1234"));
        assert!(json.contains("\"modified_ms\":1700000000000"));
        assert!(json.contains("\"permissions\":420"));
        assert!(json.contains("\"symlink_target\":null"));
    }

    #[test]
    fn entry_kinds_serialize_as_lowercase_strings() {
        for k in ["file", "dir", "symlink", "other"] {
            let e = SftpEntry {
                name: "x".into(),
                kind: k.into(),
                size: 0,
                modified_ms: None,
                permissions: 0,
                symlink_target: None,
            };
            let json = serde_json::to_string(&e).unwrap();
            assert!(json.contains(&format!("\"kind\":\"{k}\"")));
        }
    }

    #[test]
    fn entry_with_symlink_target() {
        let e = SftpEntry {
            name: "link".into(),
            kind: "symlink".into(),
            size: 0,
            modified_ms: None,
            permissions: 0,
            symlink_target: Some("real".into()),
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"symlink_target\":\"real\""));
    }
}
