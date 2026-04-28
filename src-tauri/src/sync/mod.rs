pub mod auth;
pub mod client;
pub mod encrypt;
pub mod pull;
pub mod push;

use crate::store::Db;
use crate::sync::auth::SyncUser;
use crate::sync::client::{get_valid_token, SupabaseClient};
use crate::sync::push::{PushQueue, flush_queue};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Idle,
    Syncing,
    Synced,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub user: Option<SyncUser>,
    pub status: SyncStatus,
    pub last_synced: Option<u64>,
    pub pending_count: usize,
    pub error: Option<String>,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            user: None,
            status: SyncStatus::Idle,
            last_synced: None,
            pending_count: 0,
            error: None,
        }
    }
}

pub struct SyncManager {
    state: Mutex<SyncState>,
    queue: Arc<PushQueue>,
}

impl SyncManager {
    pub fn new() -> Self {
        let access = auth::load_access_token().ok().flatten();
        let user = access.as_deref().and_then(auth::user_from_jwt);
        let mut state = SyncState::default();
        state.user = user;
        Self { state: Mutex::new(state), queue: Arc::new(PushQueue::new()) }
    }

    pub fn get_state(&self) -> SyncState {
        let s = self.state.lock();
        let mut out = s.clone();
        out.pending_count = self.queue.len();
        out
    }

    pub fn queue(&self) -> Arc<PushQueue> { self.queue.clone() }

    fn emit_state(&self, app: &AppHandle) {
        let state = self.get_state();
        let _ = app.emit("sync:state", &state);
    }

    pub async fn pull(&self, app: &AppHandle, db: &Arc<Db>) {
        {
            let mut s = self.state.lock();
            s.status = SyncStatus::Syncing;
            s.error = None;
        }
        self.emit_state(app);

        let queue = self.queue.clone();
        let result: Result<(), String> = async {
            let token = get_valid_token().await.map_err(|e| e.to_string())?;
            let client = SupabaseClient::new(token).map_err(|e| e.to_string())?;
            let sync_key = auth::load_sync_key_bytes().ok().flatten();
            pull::pull_all(&client, db, sync_key.as_ref()).await.map_err(|e| e.to_string())?;
            flush_queue(&client, &queue).await;
            Ok(())
        }.await;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        {
            let mut s = self.state.lock();
            match result {
                Ok(()) => {
                    s.status = SyncStatus::Synced;
                    s.last_synced = Some(now);
                    s.error = None;
                }
                Err(e) => {
                    s.status = SyncStatus::Error;
                    s.error = Some(e);
                }
            }
        }
        self.emit_state(app);
    }

    pub fn enqueue(&self, op: push::PendingOp) {
        self.queue.enqueue(op);
    }

    pub fn set_user(&self, user: Option<SyncUser>, app: &AppHandle) {
        self.state.lock().user = user;
        self.emit_state(app);
    }
}

impl Default for SyncManager {
    fn default() -> Self { Self::new() }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_sign_in() -> Result<(), String> {
    let url = client::SUPABASE_URL.ok_or("Supabase not configured")?;
    let oauth_url = auth::oauth_url(url);
    std::process::Command::new("open")
        .arg(&oauth_url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sync_sign_out(
    app: AppHandle,
    sync: State<'_, SyncManager>,
) -> Result<(), String> {
    auth::clear_tokens().map_err(|e| e.to_string())?;
    sync.set_user(None, &app);
    Ok(())
}

#[tauri::command]
pub async fn sync_pull(
    app: AppHandle,
    sync: State<'_, SyncManager>,
) -> Result<SyncState, String> {
    // db will be wired in Task 10
    Ok(sync.get_state())
}

#[tauri::command]
pub async fn sync_status(sync: State<'_, SyncManager>) -> Result<SyncState, String> {
    Ok(sync.get_state())
}

#[tauri::command]
pub async fn sync_get_key() -> Result<String, String> {
    let key = match auth::load_sync_key_bytes().map_err(|e| e.to_string())? {
        Some(k) => k,
        None => {
            let k = encrypt::generate_key();
            auth::store_sync_key_bytes(&k).map_err(|e| e.to_string())?;
            k
        }
    };
    Ok(encrypt::key_to_base58(&key))
}

#[tauri::command]
pub async fn sync_set_key(key_b58: String) -> Result<(), String> {
    let key = encrypt::key_from_base58(&key_b58)
        .ok_or("Invalid sync key — must be a valid Base58 string of the correct length")?;
    auth::store_sync_key_bytes(&key).map_err(|e| e.to_string())
}

/// Called from the deep-link handler with the callback URL.
pub fn handle_auth_callback(url: &str, app: &AppHandle, sync: &SyncManager) {
    let query = url
        .split_once('?')
        .map(|(_, q)| q)
        .or_else(|| url.split_once('#').map(|(_, q)| q))
        .unwrap_or("");
    let mut access_token = None;
    let mut refresh_token = None;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "access_token" { access_token = Some(v.to_string()); }
            if k == "refresh_token" { refresh_token = Some(v.to_string()); }
        }
    }
    let (Some(access), Some(refresh)) = (access_token, refresh_token) else {
        tracing::warn!("deep-link callback missing tokens: {url}");
        return;
    };
    if let Err(e) = auth::store_access_token(&access) {
        tracing::error!(error = %e, "failed to store access token");
        return;
    }
    if let Err(e) = auth::store_refresh_token(&refresh) {
        tracing::error!(error = %e, "failed to store refresh token");
        return;
    }
    let user = auth::user_from_jwt(&access);
    sync.set_user(user, app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_state_default_is_idle() {
        let m = SyncManager::new();
        let s = m.get_state();
        assert_eq!(s.status, SyncStatus::Idle);
        assert!(s.user.is_none());
        assert_eq!(s.pending_count, 0);
    }

    #[test]
    fn handle_auth_callback_parses_query_params() {
        let url = "power-term://auth/callback?access_token=eyABC&refresh_token=rfXYZ";
        let query = url.split_once('?').map(|(_, q)| q).unwrap_or("");
        let mut access = None;
        let mut refresh = None;
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "access_token" { access = Some(v.to_string()); }
                if k == "refresh_token" { refresh = Some(v.to_string()); }
            }
        }
        assert_eq!(access.as_deref(), Some("eyABC"));
        assert_eq!(refresh.as_deref(), Some("rfXYZ"));
    }

    #[test]
    fn handle_auth_callback_parses_hash_fragment() {
        let url = "power-term://auth/callback#access_token=eyABC&refresh_token=rfXYZ";
        let query = url.split_once('?').map(|(_, q)| q)
            .or_else(|| url.split_once('#').map(|(_, q)| q))
            .unwrap_or("");
        let mut access = None;
        for pair in query.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "access_token" { access = Some(v); }
            }
        }
        assert_eq!(access, Some("eyABC"));
    }
}
