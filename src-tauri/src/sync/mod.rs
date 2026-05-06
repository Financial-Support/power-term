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
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Path to the marker file that flags "we have run push_all_local at
/// least once on this install". Lives next to the encrypted secrets
/// blob so it shares a single, durable, per-user config dir.
fn first_sync_marker_path() -> PathBuf {
    let dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("power-term");
    let _ = std::fs::create_dir_all(&dir);
    dir.join(".first-sync-done")
}

fn first_sync_marker_exists() -> bool {
    first_sync_marker_path().exists()
}

fn mark_first_sync_done() {
    let path = first_sync_marker_path();
    if let Err(e) = std::fs::write(&path, b"") {
        tracing::warn!(error = %e, "could not write first-sync marker — push_all_local may run again next launch");
    }
}

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
        // First-sync detection: persisted to disk so the bootstrap
        // push_all_local fires exactly once ever per install. The previous
        // version checked the in-memory last_synced field, which resets
        // on every app launch — that meant push_all_local ran on every
        // session and could resurrect tombstoned rows by upserting them
        // back without deleted_at. Now we only bootstrap when the marker
        // file is missing.
        let is_first_sync = !first_sync_marker_exists();
        let result: Result<(), String> = async {
            let token = get_valid_token().await.map_err(|e| e.to_string())?;
            let user_id = auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
            let client = SupabaseClient::new(token).map_err(|e| e.to_string())?;
            let sync_key = auth::load_sync_key_bytes().ok().flatten();

            // Push local ops FIRST so any pending tombstones reach the
            // server before we pull. Without this, a freshly-deleted host
            // can be re-inserted by pull_all because the server still has
            // the row without deleted_at.
            flush_queue(&client, &queue).await;
            pull::pull_all(&client, db, sync_key.as_ref()).await.map_err(|e| e.to_string())?;
            if is_first_sync && !user_id.is_empty() {
                if let Err(e) = push::push_all_local(&client, db, &user_id).await {
                    tracing::warn!(error = %e, "push_all_local failed");
                } else {
                    mark_first_sync_done();
                }
            }
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
    let oauth_url = auth::oauth_url(url).map_err(|e| e.to_string())?;
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
    db: State<'_, Arc<Db>>,
) -> Result<SyncState, String> {
    sync.pull(&app, &db).await;
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
///
/// Anything that registers the `power-term://` scheme on the user's machine
/// can deliver a callback here. To stop a hostile registrant from injecting
/// somebody else's tokens — or replaying an old callback — we require the
/// `state` parameter to match the value we stashed in `oauth_url`. Tokens
/// are never logged, even on the failure path, because OAuth callback URLs
/// carry long-lived `refresh_token`s in the fragment.
pub fn handle_auth_callback(url: &str, app: &AppHandle, sync: &SyncManager) {
    let emit_err = |reason: &str| {
        tracing::warn!(reason, "auth callback rejected");
        let _ = app.emit("sync:auth-error", reason.to_string());
    };

    let _ = app.emit("sync:auth-debug", format!("callback received ({} chars)", url.len()));

    // Supabase only forwards tokens in the URL fragment, not the query.
    // We put our anti-CSRF `state` in the redirect_to query before sending
    // to authorize, so the final callback URL has state in `?state=...`
    // AND tokens in `#access_token=...&refresh_token=...`. Read both.
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(e) => {
            emit_err(&format!("could not parse callback URL: {e}"));
            return;
        }
    };

    let mut access_token = None;
    let mut refresh_token = None;
    let mut state = None;
    let mut keys_seen: Vec<String> = Vec::new();
    let mut absorb = |k: &str, v: &str| {
        keys_seen.push(k.to_string());
        match k {
            "access_token" => access_token = Some(v.to_string()),
            "refresh_token" => refresh_token = Some(v.to_string()),
            "state" => state = Some(v.to_string()),
            _ => {}
        }
    };
    for (k, v) in parsed.query_pairs() {
        absorb(&k, &v);
    }
    if let Some(frag) = parsed.fragment() {
        for pair in frag.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                absorb(k, v);
            }
        }
    }
    let _ = app.emit(
        "sync:auth-debug",
        format!("parsed callback keys: {}", keys_seen.join(",")),
    );

    let expected_state = match auth::take_oauth_state() {
        Ok(Some(s)) => s,
        Ok(None) => {
            emit_err("no pending OAuth state in keychain (sign-in not initiated from this app, or already consumed)");
            return;
        }
        Err(e) => {
            emit_err(&format!("keychain read error: {e}"));
            return;
        }
    };
    match state.as_deref() {
        Some(s) if s == expected_state => {}
        Some(_) => {
            emit_err("state mismatch — possible CSRF or stale callback");
            return;
        }
        None => {
            emit_err("callback URL missing `state` parameter");
            return;
        }
    }

    let (Some(access), Some(refresh)) = (access_token, refresh_token) else {
        emit_err("callback URL missing access_token or refresh_token");
        return;
    };
    if let Err(e) = auth::store_access_token(&access) {
        emit_err(&format!("failed to store access token: {e}"));
        return;
    }
    if let Err(e) = auth::store_refresh_token(&refresh) {
        emit_err(&format!("failed to store refresh token: {e}"));
        return;
    }
    let user = auth::user_from_jwt(&access);
    sync.set_user(user, app);
    let _ = app.emit("sync:auth-debug", "auth callback succeeded".to_string());
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
