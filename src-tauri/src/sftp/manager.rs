use crate::sftp::session::{SftpSession, SftpTarget};
use crate::sftp::{SftpError, SftpId};
use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::KnownHosts;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub struct SftpManager {
    sessions: Mutex<HashMap<SftpId, Arc<SftpSession>>>,
    transfers: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            transfers: Mutex::new(HashMap::new()),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn open(
        &self,
        target: SftpTarget,
        auth: Auth,
        connect_timeout: Duration,
        keepalive: Duration,
        accepted_fingerprint: Option<String>,
    ) -> Result<SftpId, SftpError> {
        let host = target.host.clone();
        let known_hosts_path = KnownHosts::default_user_path()
            .ok_or_else(|| SftpError::Any("no home dir".into()))?;
        let session = SftpSession::open(
            target, auth, connect_timeout, keepalive, known_hosts_path, accepted_fingerprint,
        ).await?;
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.lock().insert(id.clone(), session);
        tracing::info!(sftp_id = %id, host = %host, "sftp opened");
        Ok(id)
    }

    pub fn get(&self, id: &SftpId) -> Result<Arc<SftpSession>, SftpError> {
        self.sessions.lock().get(id).cloned()
            .ok_or_else(|| SftpError::Unknown(id.clone()))
    }

    pub fn start_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        self.transfers.lock().insert(transfer_id.to_string(), token.clone());
        token
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> bool {
        if let Some(token) = self.transfers.lock().get(transfer_id) {
            token.store(true, Ordering::Relaxed);
            true
        } else {
            false
        }
    }

    pub fn finish_transfer(&self, transfer_id: &str) {
        self.transfers.lock().remove(transfer_id);
    }

    pub async fn close(&self, id: &SftpId) -> Result<(), SftpError> {
        let s = {
            let mut sessions = self.sessions.lock();
            sessions.remove(id).ok_or_else(|| SftpError::Unknown(id.clone()))?
        };
        tracing::info!(sftp_id = %id, "sftp closed");
        s.close().await
    }
}

impl Default for SftpManager {
    fn default() -> Self { Self::new() }
}
