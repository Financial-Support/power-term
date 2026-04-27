use crate::pty::session::{PtyEvent, PtySession, SpawnConfig};
use crate::pty::{PtyError, PtyId};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct PtyManager {
    sessions: Mutex<HashMap<PtyId, Arc<PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    pub fn spawn(&self, app: AppHandle, cfg: SpawnConfig) -> Result<PtyId, PtyError> {
        let shell = cfg.shell.clone();
        let (session, rx) = PtySession::spawn(cfg)?;
        let id = uuid::Uuid::new_v4().to_string();
        self.sessions.lock().insert(id.clone(), session);
        tracing::info!(pty_id = %id, shell = %shell, "pty spawned");

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
                            tracing::warn!(pty_id = %event_id, error = %e, "tauri emit failed; stopping forwarder");
                            break;
                        }
                    }
                    PtyEvent::Exit { code, signal } => {
                        tracing::debug!(pty_id = %event_id, ?code, ?signal, "pty exit forwarded");
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

    pub fn write(&self, id: &PtyId, data: &[u8]) -> Result<(), PtyError> {
        let s = self.get(id)?;
        s.write(data)
    }

    pub fn resize(&self, id: &PtyId, cols: u16, rows: u16) -> Result<(), PtyError> {
        let s = self.get(id)?;
        s.resize(cols, rows)
    }

    pub fn kill(&self, id: &PtyId) -> Result<(), PtyError> {
        let s = {
            let mut sessions = self.sessions.lock();
            sessions.remove(id).ok_or_else(|| PtyError::Unknown(id.clone()))?
        };
        tracing::info!(pty_id = %id, "pty killed");
        s.kill()
    }

    fn get(&self, id: &PtyId) -> Result<Arc<PtySession>, PtyError> {
        self.sessions
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| PtyError::Unknown(id.clone()))
    }
}

impl Default for PtyManager {
    fn default() -> Self { Self::new() }
}
