use crate::pty::{PtyManager, SpawnConfig};
use crate::settings::{Settings, SettingsPatch, SettingsStore};
use crate::sync::SyncManager;
use crate::sync::push::PendingOp;
use base64::Engine;
use std::path::PathBuf;
use tauri::{AppHandle, State};

fn shell_with_fallback(opt: Option<String>) -> String {
    if let Some(s) = opt.filter(|s| !s.is_empty()) { return s; }
    if let Ok(env) = std::env::var("SHELL") { if !env.is_empty() { return env; } }
    "/bin/zsh".to_string()
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    settings: State<'_, SettingsStore>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let cfg_shell = shell_with_fallback(shell.or_else(|| settings.get().shell));
    let cfg = SpawnConfig {
        shell: cfg_shell,
        args: vec!["-l".into()],
        cwd: cwd.map(PathBuf::from),
        cols,
        rows,
    };
    manager.spawn(app, cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(
    manager: State<'_, PtyManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    manager.write(&pty_id, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&pty_id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    manager.kill(&pty_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(settings: State<'_, SettingsStore>) -> Result<Settings, String> {
    Ok(settings.get())
}

#[tauri::command]
pub fn settings_update(
    settings: State<'_, SettingsStore>,
    sync: State<'_, SyncManager>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    let updated = settings.apply(patch).map_err(|e| e.to_string())?;
    {
        let settings_clone = updated.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                if let Ok(client) = crate::sync::client::SupabaseClient::new(token.clone()) {
                    if let Some(user) = crate::sync::auth::user_from_jwt(&token) {
                        let row = crate::sync::push::settings_to_row(&settings_clone, &user.id);
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertSettings(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertSettings(row));
                        }
                    }
                }
            }
        });
    }
    Ok(updated)
}

use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::{fingerprint_sha256, KnownHosts};
use crate::ssh::session::SshTarget;
use crate::ssh::{SshError, SshManager};
use serde::{Deserialize, Serialize};
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

#[allow(clippy::too_many_arguments)]
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

#[tauri::command]
pub fn ssh_attach(
    app: AppHandle,
    manager: tauri::State<'_, SshManager>,
    pty_id: String,
) -> Result<(), String> {
    manager.attach(app, &pty_id).map_err(|e| e.to_string())
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

use crate::store::{self, Host, HostInput, HostStore, Snippet, SnippetInput, SnippetStore};

#[tauri::command]
pub fn hosts_list(store: tauri::State<'_, HostStore>) -> Result<Vec<Host>, String> {
    store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hosts_create(
    store: tauri::State<'_, HostStore>,
    sync: tauri::State<'_, SyncManager>,
    input: HostInput,
) -> Result<Host, String> {
    let host = store.create(&input).map_err(|e| e.to_string())?;
    {
        let host_clone = host.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let row = crate::sync::push::host_to_row(&host_clone, &user_id);
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertHost(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertHost(row));
                        }
                    }
                }
            }
        });
    }
    Ok(host)
}

#[tauri::command]
pub fn hosts_update(
    store: tauri::State<'_, HostStore>,
    sync: tauri::State<'_, SyncManager>,
    id: String,
    input: HostInput,
) -> Result<Host, String> {
    let host = store.update(&id, &input).map_err(|e| e.to_string())?;
    {
        let host_clone = host.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let row = crate::sync::push::host_to_row(&host_clone, &user_id);
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertHost(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertHost(row));
                        }
                    }
                }
            }
        });
    }
    Ok(host)
}

#[tauri::command]
pub fn hosts_delete(
    store: tauri::State<'_, HostStore>,
    sync: tauri::State<'_, SyncManager>,
    id: String,
) -> Result<(), String> {
    store.delete(&id).map_err(|e| e.to_string())?;
    if let Err(e) = store::secrets::delete(&id) {
        tracing::warn!(host_id = %id, error = ?e, "failed to delete secret on host delete");
    }
    {
        let delete_id = id.clone();
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                    let op = PendingOp::DeleteHost { id: delete_id.clone(), updated_at };
                    if let Err(e) = crate::sync::push::push_op(&client, &op).await {
                        tracing::warn!(error = %e, "sync push failed — queuing");
                        queue.enqueue(PendingOp::DeleteHost { id: delete_id, updated_at });
                    }
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn hosts_touch(
    store: tauri::State<'_, HostStore>,
    id: String,
) -> Result<(), String> {
    store.touch(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(host_id: String, secret: String) -> Result<(), String> {
    store::secrets::set(&host_id, &secret).map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn secret_get(host_id: String) -> Result<Option<String>, String> {
    store::secrets::get(&host_id).map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn secret_delete(host_id: String) -> Result<(), String> {
    store::secrets::delete(&host_id).map_err(|e| format!("{e:?}"))
}

use crate::sftp::session::{SftpEntry, SftpTarget};
use crate::sftp::{SftpError, SftpManager};

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SftpOpenResult {
    Connected { id: String },
    NeedsFingerprint { fingerprint: String, host: String, key_type: String },
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    NeedsAuth { tried: Vec<String>, available: Vec<String> },
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn sftp_open(
    manager: tauri::State<'_, SftpManager>,
    settings: tauri::State<'_, crate::settings::SettingsStore>,
    host: String,
    port: u16,
    user: String,
    auth: AuthRequest,
    accept_fingerprint: Option<String>,
) -> Result<SftpOpenResult, String> {
    let s = settings.get();
    let connect_timeout = Duration::from_secs(s.ssh_connect_timeout_secs as u64);
    let keepalive = Duration::from_secs(s.ssh_keepalive_interval_secs as u64);
    let target = SftpTarget { host, port, user };
    let tried_tag = match &auth {
        AuthRequest::Agent => "agent",
        AuthRequest::Password { .. } => "password",
        AuthRequest::Key { .. } => "publickey",
    }.to_string();

    match manager.open(target, auth.into(), connect_timeout, keepalive, accept_fingerprint).await {
        Ok(id) => Ok(SftpOpenResult::Connected { id }),
        Err(SftpError::UnknownFingerprint { fingerprint, host, key_type }) =>
            Ok(SftpOpenResult::NeedsFingerprint { fingerprint, host, key_type }),
        Err(SftpError::FingerprintMismatch { fingerprint, expected, host }) =>
            Ok(SftpOpenResult::FingerprintMismatch { fingerprint, expected, host }),
        Err(SftpError::Auth) => Ok(SftpOpenResult::NeedsAuth {
            tried: vec![tried_tag],
            available: vec!["agent".into(), "publickey".into(), "password".into()],
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn sftp_close(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
) -> Result<(), String> {
    manager.close(&sftp_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_list(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.list(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_canonicalize(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<String, String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.canonicalize(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.mkdir(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_remove_file(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.remove_file(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_remove_dir(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    path: String,
) -> Result<(), String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.remove_dir(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.rename(&from, &to).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_download(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    remote: String,
    local: String,
) -> Result<u64, String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.download(&remote, std::path::Path::new(&local)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    manager: tauri::State<'_, SftpManager>,
    sftp_id: String,
    local: String,
    remote: String,
) -> Result<u64, String> {
    let s = manager.get(&sftp_id).map_err(|e| e.to_string())?;
    s.upload(std::path::Path::new(&local), &remote).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippets_list(store: tauri::State<'_, SnippetStore>) -> Result<Vec<Snippet>, String> {
    store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippets_create(
    store: tauri::State<'_, SnippetStore>,
    sync: tauri::State<'_, SyncManager>,
    input: SnippetInput,
) -> Result<Snippet, String> {
    let snippet = store.create(&input).map_err(|e| e.to_string())?;
    {
        let snippet_clone = snippet.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let sync_key = crate::sync::auth::load_sync_key_bytes().ok().flatten();
                        let row = match crate::sync::push::snippet_to_row(&snippet_clone, &user_id, sync_key.as_ref()) {
                            Ok(r) => r,
                            Err(e) => { tracing::warn!(error = %e, "snippet encrypt failed — skipping push"); return; }
                        };
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertSnippet(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertSnippet(row));
                        }
                    }
                }
            }
        });
    }
    Ok(snippet)
}

#[tauri::command]
pub fn snippets_update(
    store: tauri::State<'_, SnippetStore>,
    sync: tauri::State<'_, SyncManager>,
    id: String,
    input: SnippetInput,
) -> Result<Snippet, String> {
    let snippet = store.update(&id, &input).map_err(|e| e.to_string())?;
    {
        let snippet_clone = snippet.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let sync_key = crate::sync::auth::load_sync_key_bytes().ok().flatten();
                        let row = match crate::sync::push::snippet_to_row(&snippet_clone, &user_id, sync_key.as_ref()) {
                            Ok(r) => r,
                            Err(e) => { tracing::warn!(error = %e, "snippet encrypt failed — skipping push"); return; }
                        };
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertSnippet(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertSnippet(row));
                        }
                    }
                }
            }
        });
    }
    Ok(snippet)
}

#[tauri::command]
pub fn snippets_delete(
    store: tauri::State<'_, SnippetStore>,
    sync: tauri::State<'_, SyncManager>,
    id: String,
) -> Result<(), String> {
    store.delete(&id).map_err(|e| e.to_string())?;
    {
        let delete_id = id.clone();
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                    let op = PendingOp::DeleteSnippet { id: delete_id.clone(), updated_at };
                    if let Err(e) = crate::sync::push::push_op(&client, &op).await {
                        tracing::warn!(error = %e, "sync push failed — queuing");
                        queue.enqueue(PendingOp::DeleteSnippet { id: delete_id, updated_at });
                    }
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn snippets_touch(
    store: tauri::State<'_, SnippetStore>,
    id: String,
) -> Result<(), String> {
    store.touch(&id).map_err(|e| e.to_string())
}

// ─── Port Forwarding ────────────────────────────────────────────────────────

use crate::ssh::forward_manager::{ForwardManager, ForwardStatus};
use crate::ssh::forwards::{ForwardKind, ForwardSpec};
use crate::store::{Forward, ForwardInput, ForwardStore};

#[tauri::command]
pub fn forwards_list(store: tauri::State<'_, ForwardStore>) -> Result<Vec<Forward>, String> {
    store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn forwards_create(
    store: tauri::State<'_, ForwardStore>,
    sync: tauri::State<'_, SyncManager>,
    input: ForwardInput,
) -> Result<Forward, String> {
    let forward = store.create(&input).map_err(|e| e.to_string())?;
    {
        let forward_clone = forward.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let row = crate::sync::push::forward_to_row(&forward_clone, &user_id);
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertForward(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertForward(row));
                        }
                    }
                }
            }
        });
    }
    Ok(forward)
}

#[tauri::command]
pub fn forwards_update(
    store: tauri::State<'_, ForwardStore>,
    sync: tauri::State<'_, SyncManager>,
    id: String,
    input: ForwardInput,
) -> Result<Forward, String> {
    let forward = store.update(&id, &input).map_err(|e| e.to_string())?;
    {
        let forward_clone = forward.clone();
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                let user_id = crate::sync::auth::user_from_jwt(&token).map(|u| u.id).unwrap_or_default();
                if !user_id.is_empty() {
                    if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                        let row = crate::sync::push::forward_to_row(&forward_clone, &user_id);
                        if let Err(e) = crate::sync::push::push_op(&client, &PendingOp::UpsertForward(row.clone())).await {
                            tracing::warn!(error = %e, "sync push failed — queuing");
                            queue.enqueue(PendingOp::UpsertForward(row));
                        }
                    }
                }
            }
        });
    }
    Ok(forward)
}

#[tauri::command]
pub fn forwards_delete(
    store: tauri::State<'_, ForwardStore>,
    manager: tauri::State<'_, ForwardManager>,
    sync: tauri::State<'_, SyncManager>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    store.delete(&id).map_err(|e| e.to_string())?;
    let _ = manager.stop(app, &id);
    {
        let delete_id = id.clone();
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let queue = sync.queue();
        tauri::async_runtime::spawn(async move {
            if let Ok(token) = crate::sync::client::get_valid_token().await {
                if let Ok(client) = crate::sync::client::SupabaseClient::new(token) {
                    let op = PendingOp::DeleteForward { id: delete_id.clone(), updated_at };
                    if let Err(e) = crate::sync::push::push_op(&client, &op).await {
                        tracing::warn!(error = %e, "sync push failed — queuing");
                        queue.enqueue(PendingOp::DeleteForward { id: delete_id, updated_at });
                    }
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn forward_status(
    manager: tauri::State<'_, ForwardManager>, id: String,
) -> Result<ForwardStatus, String> { Ok(manager.status(&id)) }

#[tauri::command]
pub fn forwards_status_all(
    manager: tauri::State<'_, ForwardManager>,
) -> Result<Vec<ForwardStatus>, String> { Ok(manager.statuses()) }

#[tauri::command]
pub async fn forward_start(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ForwardManager>,
    forward_store: tauri::State<'_, ForwardStore>,
    host_store: tauri::State<'_, HostStore>,
    settings: tauri::State<'_, crate::settings::SettingsStore>,
    id: String,
) -> Result<ForwardStatus, String> {
    let forward = forward_store.get(&id).map_err(|e| e.to_string())?;
    let host = host_store.get(&forward.host_id).map_err(|e| e.to_string())?;

    let target = SshTarget { host: host.hostname.clone(), port: host.port, user: host.username.clone() };
    let auth = match host.auth_method.as_str() {
        "agent" => crate::ssh::auth::Auth::Agent,
        "key" => {
            let path = host.key_path
                .filter(|p| !p.trim().is_empty())
                .ok_or_else(|| "key auth requires a key_path".to_string())?;
            let passphrase = crate::store::secrets::get(&host.id).ok().flatten();
            crate::ssh::auth::Auth::KeyFile {
                path: std::path::PathBuf::from(path),
                passphrase,
            }
        }
        _ => {
            let password = crate::store::secrets::get(&host.id).ok().flatten()
                .ok_or_else(|| "password auth requires a saved password in the keychain (forward MVP)".to_string())?;
            crate::ssh::auth::Auth::Password { password }
        }
    };

    let kind = match forward.kind.as_str() {
        "local" => ForwardKind::Local,
        "remote" => ForwardKind::Remote,
        other => return Err(format!("unknown kind '{other}'")),
    };
    let spec = ForwardSpec {
        kind,
        bind_addr: forward.bind_addr,
        bind_port: forward.bind_port,
        remote_host: forward.remote_host,
        remote_port: forward.remote_port,
    };
    let s = settings.get();
    let connect_timeout = std::time::Duration::from_secs(s.ssh_connect_timeout_secs as u64);
    let keepalive = std::time::Duration::from_secs(s.ssh_keepalive_interval_secs as u64);

    manager.start(app, id, target, auth, spec, connect_timeout, keepalive).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn forward_stop(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ForwardManager>,
    id: String,
) -> Result<ForwardStatus, String> {
    Ok(manager.stop(app, &id))
}
