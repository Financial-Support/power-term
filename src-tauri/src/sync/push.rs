use crate::store::{Db, Forward, Host, Snippet, SshKey};
use crate::settings::Settings;
use crate::sync::client::{ClientError, SupabaseClient};
use crate::sync::encrypt::encrypt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

fn encrypt_snippet_content(
    plaintext: &str,
    snippet_id: &str,
    sync_key: Option<&[u8; 32]>,
) -> Result<String, ClientError> {
    match sync_key {
        Some(key) => encrypt(plaintext, key, snippet_id.as_bytes())
            .map_err(|e| ClientError::Json(e.to_string())),
        None => Ok(plaintext.to_string()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHostRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub hostname: String,
    pub port: i64,
    pub username: String,
    pub group_name: Option<String>,
    pub tags: serde_json::Value,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSnippetRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub content: String,
    pub tags: serde_json::Value,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteForwardRow {
    pub id: String,
    pub user_id: String,
    pub host_id: String,
    pub name: String,
    pub kind: String,
    pub bind_addr: String,
    pub bind_port: i64,
    pub remote_host: String,
    pub remote_port: i64,
    pub auto_start: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSettingsRow {
    pub user_id: String,
    pub data: serde_json::Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSshKeyRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub path: String,
    /// AES-256-GCM ciphertext when sync_key is set; plaintext otherwise.
    /// Empty string means "no captured contents to sync" — preserves the
    /// fall-back-to-disk semantics on the receiving device.
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCredentialRow {
    pub id: String,
    pub user_id: String,
    pub ciphertext: String,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub enum PendingOp {
    UpsertHost(RemoteHostRow),
    DeleteHost { id: String, updated_at: i64 },
    UpsertSnippet(RemoteSnippetRow),
    DeleteSnippet { id: String, updated_at: i64 },
    UpsertForward(RemoteForwardRow),
    DeleteForward { id: String, updated_at: i64 },
    UpsertSettings(RemoteSettingsRow),
    UpsertCredential(RemoteCredentialRow),
    DeleteCredential { id: String, updated_at: i64 },
    UpsertSshKey(RemoteSshKeyRow),
    DeleteSshKey { id: String, updated_at: i64 },
}

#[derive(Debug, Default)]
pub struct PushQueue {
    pending: Mutex<Vec<PendingOp>>,
}

impl PushQueue {
    pub fn new() -> Self { Self::default() }
    pub fn enqueue(&self, op: PendingOp) { self.pending.lock().push(op); }
    pub fn drain(&self) -> Vec<PendingOp> { std::mem::take(&mut *self.pending.lock()) }
    pub fn len(&self) -> usize { self.pending.lock().len() }
    pub fn is_empty(&self) -> bool { self.pending.lock().is_empty() }
}

pub fn host_to_row(host: &Host, user_id: &str) -> RemoteHostRow {
    RemoteHostRow {
        id: host.id.clone(),
        user_id: user_id.to_string(),
        name: host.name.clone(),
        hostname: host.hostname.clone(),
        port: host.port as i64,
        username: host.username.clone(),
        group_name: host.group_name.clone(),
        tags: serde_json::to_value(&host.tags).unwrap_or(serde_json::json!([])),
        auth_method: host.auth_method.clone(),
        key_path: host.key_path.clone(),
        notes: host.notes.clone(),
        created_at: host.created_at,
        last_used_at: host.last_used_at,
        updated_at: host.updated_at,
        deleted_at: None,
    }
}

/// Convert a local snippet into the row sent to Supabase. When `sync_key`
/// is provided, the body is AES-256-GCM encrypted with the snippet id as
/// AAD so the server cannot relabel one snippet's ciphertext as another's.
/// If no key is configured the body goes up plaintext (legacy behaviour).
pub fn snippet_to_row(
    snippet: &Snippet,
    user_id: &str,
    sync_key: Option<&[u8; 32]>,
) -> Result<RemoteSnippetRow, ClientError> {
    let content = encrypt_snippet_content(&snippet.content, &snippet.id, sync_key)?;
    Ok(RemoteSnippetRow {
        id: snippet.id.clone(),
        user_id: user_id.to_string(),
        name: snippet.name.clone(),
        content,
        tags: serde_json::to_value(&snippet.tags).unwrap_or(serde_json::json!([])),
        created_at: snippet.created_at,
        last_used_at: snippet.last_used_at,
        updated_at: snippet.updated_at,
        deleted_at: None,
    })
}

pub fn forward_to_row(fwd: &Forward, user_id: &str) -> RemoteForwardRow {
    RemoteForwardRow {
        id: fwd.id.clone(),
        user_id: user_id.to_string(),
        host_id: fwd.host_id.clone(),
        name: fwd.name.clone(),
        kind: fwd.kind.clone(),
        bind_addr: fwd.bind_addr.clone(),
        bind_port: fwd.bind_port as i64,
        remote_host: fwd.remote_host.clone(),
        remote_port: fwd.remote_port as i64,
        auto_start: fwd.auto_start,
        created_at: fwd.created_at,
        updated_at: fwd.updated_at,
        deleted_at: None,
    }
}

pub fn settings_to_row(settings: &Settings, user_id: &str) -> RemoteSettingsRow {
    RemoteSettingsRow {
        user_id: user_id.to_string(),
        data: serde_json::to_value(settings).unwrap_or_default(),
        updated_at: settings.updated_at as i64,
    }
}

pub async fn push_op(client: &SupabaseClient, op: &PendingOp) -> Result<(), ClientError> {
    match op {
        PendingOp::UpsertHost(row) => client.upsert("hosts", row).await,
        PendingOp::DeleteHost { id, updated_at } => {
            client.upsert("hosts", &serde_json::json!({ "id": id, "deleted_at": updated_at })).await
        }
        PendingOp::UpsertSnippet(row) => client.upsert("snippets", row).await,
        PendingOp::DeleteSnippet { id, updated_at } => {
            client.upsert("snippets", &serde_json::json!({ "id": id, "deleted_at": updated_at })).await
        }
        PendingOp::UpsertForward(row) => client.upsert("forwards", row).await,
        PendingOp::DeleteForward { id, updated_at } => {
            client.upsert("forwards", &serde_json::json!({ "id": id, "deleted_at": updated_at })).await
        }
        PendingOp::UpsertSettings(row) => client.upsert_settings(row).await,
        PendingOp::UpsertCredential(row) => client.upsert("credentials", row).await,
        PendingOp::DeleteCredential { id, updated_at } => {
            client.upsert("credentials", &serde_json::json!({ "id": id, "deleted_at": updated_at })).await
        }
        PendingOp::UpsertSshKey(row) => client.upsert("ssh_keys", row).await,
        PendingOp::DeleteSshKey { id, updated_at } => {
            client.upsert("ssh_keys", &serde_json::json!({ "id": id, "deleted_at": updated_at })).await
        }
    }
}

/// Encrypt a key's captured content with the user's sync key, using the
/// row id as AAD so the server can't relabel one key's ciphertext as
/// another's. Empty content stays empty so the receiver knows there's
/// nothing to materialize.
pub fn ssh_key_to_row(
    key: &SshKey,
    user_id: &str,
    sync_key: Option<&[u8; 32]>,
) -> Result<RemoteSshKeyRow, ClientError> {
    let content = if key.content.is_empty() {
        String::new()
    } else {
        match sync_key {
            Some(k) => encrypt(&key.content, k, key.id.as_bytes())
                .map_err(|e| ClientError::Json(e.to_string()))?,
            None => key.content.clone(),
        }
    };
    Ok(RemoteSshKeyRow {
        id: key.id.clone(),
        user_id: user_id.to_string(),
        name: key.name.clone(),
        path: key.path.clone(),
        content,
        created_at: key.created_at,
        updated_at: key.updated_at,
        deleted_at: None,
    })
}

pub async fn flush_queue(client: &SupabaseClient, queue: &Arc<PushQueue>) {
    let ops = queue.drain();
    for op in ops {
        if let Err(e) = push_op(client, &op).await {
            // PostgREST 404 PGRST205 means the table itself doesn't exist
            // on Supabase yet — re-queueing would loop forever, so log
            // once and drop the op. Operator runs the SQL migration to
            // recover; offline retries can't fix a missing schema.
            if e.is_table_missing() {
                tracing::warn!(error = %e, "push: target table missing on server — dropping op");
                continue;
            }
            tracing::warn!(error = %e, "push retry failed — re-enqueuing");
            queue.enqueue(op);
        }
    }
}

/// Push every local row to Supabase (used on first sync / initial upload).
pub async fn push_all_local(
    client: &SupabaseClient,
    db: &Arc<Db>,
    user_id: &str,
) -> Result<(), ClientError> {
    // Hosts
    let hosts: Vec<RemoteHostRow> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, hostname, port, username, group_name, tags_json, \
                 auth_method, key_path, notes, created_at, last_used_at, updated_at FROM hosts",
            )
            .map_err(|e| ClientError::Json(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                let tags_json: String = r.get(6)?;
                let tags: serde_json::Value =
                    serde_json::from_str(&tags_json).unwrap_or(serde_json::json!([]));
                Ok(RemoteHostRow {
                    id: r.get(0)?,
                    user_id: user_id.to_string(),
                    name: r.get(1)?,
                    hostname: r.get(2)?,
                    port: r.get::<_, i64>(3)?,
                    username: r.get(4)?,
                    group_name: r.get(5)?,
                    tags,
                    auth_method: r.get(7)?,
                    key_path: r.get(8)?,
                    notes: r.get(9)?,
                    created_at: r.get(10)?,
                    last_used_at: r.get(11)?,
                    updated_at: r.get(12)?,
                    deleted_at: None,
                })
            })
            .map_err(|e| ClientError::Json(e.to_string()))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for row in &hosts {
        if let Err(e) = client.upsert("hosts", row).await {
            tracing::warn!(id = %row.id, error = %e, "push_all_local: host upsert failed");
        }
    }

    // Snippets — encrypted with the user's sync key when one is set.
    let sync_key = crate::sync::auth::load_sync_key_bytes().ok().flatten();
    let snippets_plain: Vec<RemoteSnippetRow> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, content, tags_json, created_at, last_used_at, updated_at FROM snippets",
            )
            .map_err(|e| ClientError::Json(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                let tags_json: String = r.get(3)?;
                let tags: serde_json::Value =
                    serde_json::from_str(&tags_json).unwrap_or(serde_json::json!([]));
                Ok(RemoteSnippetRow {
                    id: r.get(0)?,
                    user_id: user_id.to_string(),
                    name: r.get(1)?,
                    content: r.get(2)?,
                    tags,
                    created_at: r.get(4)?,
                    last_used_at: r.get(5)?,
                    updated_at: r.get(6)?,
                    deleted_at: None,
                })
            })
            .map_err(|e| ClientError::Json(e.to_string()))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for mut row in snippets_plain {
        match encrypt_snippet_content(&row.content, &row.id, sync_key.as_ref()) {
            Ok(content) => row.content = content,
            Err(e) => {
                tracing::warn!(id = %row.id, error = %e, "push_all_local: snippet encrypt failed; skipping");
                continue;
            }
        }
        if let Err(e) = client.upsert("snippets", &row).await {
            tracing::warn!(id = %row.id, error = %e, "push_all_local: snippet upsert failed");
        }
    }

    // Forwards
    let forwards: Vec<RemoteForwardRow> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, host_id, name, kind, bind_addr, bind_port, remote_host, \
                 remote_port, auto_start, created_at, updated_at FROM forwards",
            )
            .map_err(|e| ClientError::Json(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RemoteForwardRow {
                    id: r.get(0)?,
                    user_id: user_id.to_string(),
                    host_id: r.get(1)?,
                    name: r.get(2)?,
                    kind: r.get(3)?,
                    bind_addr: r.get(4)?,
                    bind_port: r.get::<_, i64>(5)?,
                    remote_host: r.get(6)?,
                    remote_port: r.get::<_, i64>(7)?,
                    auto_start: r.get::<_, i64>(8)? != 0,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                    deleted_at: None,
                })
            })
            .map_err(|e| ClientError::Json(e.to_string()))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for row in &forwards {
        if let Err(e) = client.upsert("forwards", row).await {
            tracing::warn!(id = %row.id, error = %e, "push_all_local: forward upsert failed");
        }
    }

    // SSH keys — content encrypted with the sync key when one is set so
    // the captured private-key bytes are never readable on the server.
    let ssh_keys: Vec<SshKey> = {
        let conn = db.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, name, path, content, created_at, updated_at FROM ssh_keys",
            )
            .map_err(|e| ClientError::Json(e.to_string()))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SshKey {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    path: r.get(2)?,
                    content: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                })
            })
            .map_err(|e| ClientError::Json(e.to_string()))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    for k in &ssh_keys {
        let row = match ssh_key_to_row(k, user_id, sync_key.as_ref()) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(id = %k.id, error = %e, "push_all_local: ssh_key encrypt failed; skipping");
                continue;
            }
        };
        if let Err(e) = client.upsert("ssh_keys", &row).await {
            tracing::warn!(id = %k.id, error = %e, "push_all_local: ssh_key upsert failed");
        }
    }

    Ok(())
}

pub async fn push_credential(
    client: &SupabaseClient,
    host_id: &str,
    user_id: &str,
    plaintext: &str,
    sync_key: Option<&[u8; 32]>,
    updated_at: i64,
) -> Result<(), ClientError> {
    let ciphertext = match sync_key {
        // Bind host_id as AAD so the server cannot move ciphertext between
        // hosts and have us decrypt the wrong password into the wrong slot.
        Some(key) => encrypt(plaintext, key, host_id.as_bytes())
            .map_err(|e| ClientError::Json(e.to_string()))?,
        None => "ENCRYPTED:NO_KEY".to_string(),
    };
    let row = RemoteCredentialRow {
        id: host_id.to_string(),
        user_id: user_id.to_string(),
        ciphertext,
        updated_at,
        deleted_at: None,
    };
    client.upsert("credentials", &row).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_queue_enqueue_and_drain() {
        let q = PushQueue::new();
        assert_eq!(q.len(), 0);
        q.enqueue(PendingOp::DeleteHost { id: "h1".into(), updated_at: 1000 });
        q.enqueue(PendingOp::DeleteHost { id: "h2".into(), updated_at: 2000 });
        assert_eq!(q.len(), 2);
        let drained = q.drain();
        assert_eq!(drained.len(), 2);
        assert_eq!(q.len(), 0);
    }

    #[test]
    fn host_to_row_maps_fields() {
        let host = Host {
            id: "h1".into(),
            name: "srv".into(),
            hostname: "1.2.3.4".into(),
            port: 22,
            username: "root".into(),
            group_name: None,
            tags: vec![],
            auth_method: "agent".into(),
            key_path: None,
            notes: None,
            created_at: 1000,
            last_used_at: None,
            updated_at: 2000,
        };
        let row = host_to_row(&host, "user-uuid-123");
        assert_eq!(row.id, "h1");
        assert_eq!(row.user_id, "user-uuid-123");
        assert_eq!(row.port, 22);
        assert_eq!(row.updated_at, 2000);
        assert!(row.deleted_at.is_none());
    }

    #[test]
    fn snippet_to_row_plaintext_when_no_key() {
        let s = Snippet {
            id: "s1".into(),
            name: "hello".into(),
            content: "echo hi".into(),
            tags: vec!["shell".into()],
            created_at: 100,
            last_used_at: None,
            updated_at: 200,
        };
        let row = snippet_to_row(&s, "user-uuid-123", None).unwrap();
        assert_eq!(row.id, "s1");
        assert_eq!(row.content, "echo hi", "without a sync key, content goes up plaintext");
    }

    #[test]
    fn snippet_to_row_encrypts_when_key_present() {
        use crate::sync::encrypt::{generate_key, is_encrypted};
        let s = Snippet {
            id: "s2".into(),
            name: "hello".into(),
            content: "secret-token-XYZ".into(),
            tags: vec![],
            created_at: 100,
            last_used_at: None,
            updated_at: 200,
        };
        let key = generate_key();
        let row = snippet_to_row(&s, "u", Some(&key)).unwrap();
        assert!(is_encrypted(&row.content), "snippet body must be enveloped, not plaintext");
        assert!(!row.content.contains("secret-token-XYZ"));
    }
}
