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

#[derive(Debug, Clone, Serialize)]
pub struct SftpTransferProgress {
    pub transfer_id: String,
    pub direction: String,
    pub path: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub state: String,
    pub error: Option<String>,
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
            None,
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

    /// Recursively remove a remote directory tree. SFTP RMDIR only succeeds
    /// on empty directories, so we walk the tree post-order via an iterative
    /// stack, removing each file and symlink we encounter and rmdir-ing each
    /// directory once all its children are gone. Empty directories take the
    /// same code path and just trigger a single rmdir at the end.
    pub async fn remove_dir(&self, path: &str) -> Result<(), SftpError> {
        // Each frame is (path, expanded?). When first popped we list
        // children and push them; we then re-push the dir with expanded=true
        // so on the next visit (after all children are processed) we issue
        // the actual rmdir.
        let mut stack: Vec<(String, bool)> = vec![(path.to_string(), false)];
        while let Some((dir, expanded)) = stack.pop() {
            if expanded {
                let sftp = self.sftp.lock().await;
                sftp.remove_dir(dir).await.map_err(map_sftp_err)?;
                continue;
            }
            stack.push((dir.clone(), true));
            let entries = self.list(&dir).await?;
            for e in entries {
                let child = format!("{}/{}", dir.trim_end_matches('/'), e.name);
                match e.kind.as_str() {
                    "dir" => stack.push((child, false)),
                    _ => {
                        // file, symlink, other — SFTP REMOVE handles all
                        // non-directory entries uniformly.
                        let sftp = self.sftp.lock().await;
                        sftp.remove_file(child).await.map_err(map_sftp_err)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        sftp.rename(from.to_string(), to.to_string())
            .await
            .map_err(map_sftp_err)
    }

    /// Public download entry point. Stats `remote` and dispatches to the
    /// directory- or file-recursive variant. Returns total bytes copied.
    pub async fn download(&self, remote: &str, local: &Path) -> Result<u64, SftpError> {
        self.download_with_progress(remote, local, &mut |_, _| true).await
    }

    /// Download with byte progress. For directories, the total is computed
    /// before copying so the renderer can show a stable percentage.
    pub async fn download_with_progress(
        &self,
        remote: &str,
        local: &Path,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
        let total_size = self.remote_total_size(remote).await?;
        let mut copied: u64 = 0;
        let meta = {
            let sftp = self.sftp.lock().await;
            sftp.metadata(remote.to_string())
                .await
                .map_err(map_sftp_err)?
        };
        let result = if meta.is_dir() {
            self.download_dir_progress(remote, local, total_size, &mut copied, progress).await
        } else {
            self.download_file_progress(remote, local, total_size, &mut copied, progress).await
        }?;
        let _ = progress(copied, total_size);
        Ok(result)
    }

    /// Public upload entry point. Stats `local` and dispatches to the
    /// directory- or file-recursive variant. Returns total bytes copied.
    pub async fn upload(&self, local: &Path, remote: &str) -> Result<u64, SftpError> {
        self.upload_with_progress(local, remote, &mut |_, _| true).await
    }

    /// Upload with byte progress. For directories, the total is computed
    /// before copying so the renderer can show a stable percentage.
    pub async fn upload_with_progress(
        &self,
        local: &Path,
        remote: &str,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
        let total_size = local_total_size(local).await?;
        let mut copied: u64 = 0;
        let meta = tokio::fs::metadata(local).await?;
        let result = if meta.is_dir() {
            self.upload_dir_progress(local, remote, total_size, &mut copied, progress).await
        } else {
            self.upload_file_progress(local, remote, total_size, &mut copied, progress).await
        }?;
        let _ = progress(copied, total_size);
        Ok(result)
    }

    async fn download_file_progress(
        &self,
        remote: &str,
        local: &Path,
        total_size: u64,
        copied: &mut u64,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
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
            *copied += n as u64;
            if !progress(*copied, total_size) {
                return Err(SftpError::Any("transfer cancelled".into()));
            }
        }
        local_file.flush().await?;
        Ok(total)
    }

    async fn upload_file_progress(
        &self,
        local: &Path,
        remote: &str,
        total_size: u64,
        copied: &mut u64,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
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
            *copied += n as u64;
            if !progress(*copied, total_size) {
                return Err(SftpError::Any("transfer cancelled".into()));
            }
        }
        remote_file
            .shutdown()
            .await
            .map_err(|e| SftpError::Any(format!("remote shutdown: {e}")))?;
        Ok(total)
    }

    /// Recursively copy a remote directory tree into `local`. Iterative
    /// queue rather than async recursion so each operation locks the sftp
    /// mutex for the smallest possible window. Symlinks are skipped to
    /// avoid following links out of the intended subtree.
    async fn download_dir_progress(
        &self,
        remote: &str,
        local: &Path,
        total_size: u64,
        copied: &mut u64,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
        tokio::fs::create_dir_all(local).await?;
        let mut total: u64 = 0;
        let mut queue: Vec<(String, PathBuf)> =
            vec![(remote.to_string(), local.to_path_buf())];
        while let Some((rdir, ldir)) = queue.pop() {
            let entries = self.list(&rdir).await?;
            for e in entries {
                let r = format!("{}/{}", rdir.trim_end_matches('/'), e.name);
                let l = ldir.join(&e.name);
                match e.kind.as_str() {
                    "dir" => {
                        tokio::fs::create_dir_all(&l).await?;
                        queue.push((r, l));
                    }
                    "file" => {
                        total += self.download_file_progress(&r, &l, total_size, copied, progress).await?;
                    }
                    _ => { /* skip symlinks and unknown kinds */ }
                }
            }
        }
        Ok(total)
    }

    /// Recursively copy a local directory tree into `remote`. The remote
    /// root is created best-effort — an "already exists" error is ignored
    /// so partial-resume / merge-into-existing-folder works naturally;
    /// any other failure surfaces when the first contained file open fails.
    async fn upload_dir_progress(
        &self,
        local: &Path,
        remote: &str,
        total_size: u64,
        copied: &mut u64,
        progress: &mut (dyn FnMut(u64, u64) -> bool + Send),
    ) -> Result<u64, SftpError> {
        let _ = self.try_mkdir(remote).await;
        let mut total: u64 = 0;
        let mut queue: Vec<(PathBuf, String)> =
            vec![(local.to_path_buf(), remote.to_string())];
        while let Some((ldir, rdir)) = queue.pop() {
            let mut rd = tokio::fs::read_dir(&ldir).await?;
            while let Some(entry) = rd.next_entry().await? {
                let name = entry.file_name().to_string_lossy().to_string();
                let l = entry.path();
                let r = format!("{}/{}", rdir.trim_end_matches('/'), name);
                let ft = entry.file_type().await?;
                if ft.is_dir() {
                    let _ = self.try_mkdir(&r).await;
                    queue.push((l, r));
                } else if ft.is_file() {
                    total += self.upload_file_progress(&l, &r, total_size, copied, progress).await?;
                }
                // skip symlinks
            }
        }
        Ok(total)
    }

    /// Like `mkdir` but treats "already exists" as success. Other server
    /// errors propagate so the caller can decide to abort.
    async fn try_mkdir(&self, path: &str) -> Result<(), SftpError> {
        let sftp = self.sftp.lock().await;
        if sftp
            .try_exists(path.to_string())
            .await
            .map_err(map_sftp_err)?
        {
            return Ok(());
        }
        sftp.create_dir(path.to_string())
            .await
            .map_err(map_sftp_err)
    }

    async fn remote_total_size(&self, remote: &str) -> Result<u64, SftpError> {
        let meta = {
            let sftp = self.sftp.lock().await;
            sftp.metadata(remote.to_string())
                .await
                .map_err(map_sftp_err)?
        };
        if !meta.is_dir() {
            return Ok(meta.size.unwrap_or(0));
        }

        let mut total: u64 = 0;
        let mut stack = vec![remote.to_string()];
        while let Some(dir) = stack.pop() {
            let entries = self.list(&dir).await?;
            for e in entries {
                let child = format!("{}/{}", dir.trim_end_matches('/'), e.name);
                match e.kind.as_str() {
                    "dir" => stack.push(child),
                    "file" => total += e.size,
                    _ => {}
                }
            }
        }
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

async fn local_total_size(path: &Path) -> Result<u64, SftpError> {
    let meta = tokio::fs::metadata(path).await?;
    if !meta.is_dir() {
        return Ok(meta.len());
    }

    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = rd.next_entry().await? {
            let ft = entry.file_type().await?;
            if ft.is_dir() {
                stack.push(entry.path());
            } else if ft.is_file() {
                total += entry.metadata().await?.len();
            }
        }
    }
    Ok(total)
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
