use crate::ssh::auth::Auth;
#[allow(unused_imports)]
use crate::ssh::forwards::{start_forward, ForwardError, ForwardKind, ForwardSpec, RunningForward};
use crate::ssh::handshake::SshTarget;
use crate::ssh::known_hosts::KnownHosts;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct ForwardStatus {
    pub id: String,
    pub state: String,    // "stopped" | "starting" | "running" | "error"
    pub error: Option<String>,
}

pub struct ForwardManager {
    inner: Mutex<Inner>,
}

struct Inner {
    running: HashMap<String, Arc<RunningForward>>,
    statuses: HashMap<String, ForwardStatus>,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner { running: HashMap::new(), statuses: HashMap::new() }),
        }
    }

    pub fn status(&self, id: &str) -> ForwardStatus {
        let inner = self.inner.lock();
        inner.statuses.get(id).cloned().unwrap_or(ForwardStatus {
            id: id.to_string(), state: "stopped".into(), error: None,
        })
    }

    pub fn statuses(&self) -> Vec<ForwardStatus> {
        let inner = self.inner.lock();
        inner.statuses.values().cloned().collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        &self,
        app: AppHandle,
        id: String,
        target: SshTarget,
        auth: Auth,
        spec: ForwardSpec,
        connect_timeout: Duration,
        keepalive: Duration,
    ) -> Result<ForwardStatus, ForwardError> {
        // Abort any previous run with the same id.
        {
            let mut inner = self.inner.lock();
            if let Some(prev) = inner.running.remove(&id) {
                prev.cancel();
            }
        }
        self.set_status(&app, ForwardStatus { id: id.clone(), state: "starting".into(), error: None });

        let kh_path = KnownHosts::default_user_path()
            .ok_or_else(|| ForwardError::Any("no home dir".into()))?;

        match start_forward(target, auth, spec, connect_timeout, keepalive, kh_path).await {
            Ok(running) => {
                let status = ForwardStatus { id: id.clone(), state: "running".into(), error: None };
                let mut inner = self.inner.lock();
                inner.running.insert(id.clone(), running);
                inner.statuses.insert(id.clone(), status.clone());
                drop(inner);
                emit_status(&app, &status);
                Ok(status)
            }
            Err(e) => {
                let status = ForwardStatus { id: id.clone(), state: "error".into(), error: Some(e.to_string()) };
                self.set_status(&app, status.clone());
                Err(e)
            }
        }
    }

    pub fn stop(&self, app: AppHandle, id: &str) -> ForwardStatus {
        let mut inner = self.inner.lock();
        if let Some(prev) = inner.running.remove(id) {
            prev.cancel();
        }
        let status = ForwardStatus { id: id.to_string(), state: "stopped".into(), error: None };
        inner.statuses.insert(id.to_string(), status.clone());
        drop(inner);
        emit_status(&app, &status);
        status
    }

    fn set_status(&self, app: &AppHandle, status: ForwardStatus) {
        self.inner.lock().statuses.insert(status.id.clone(), status.clone());
        emit_status(app, &status);
    }
}

fn emit_status(app: &AppHandle, status: &ForwardStatus) {
    let topic = format!("forward://status/{}", status.id);
    if let Err(e) = app.emit(&topic, status) {
        tracing::warn!(forward_id = %status.id, error = %e, "tauri emit status failed");
    }
}

impl Default for ForwardManager { fn default() -> Self { Self::new() } }
