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

    #[allow(clippy::too_many_arguments)]
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
