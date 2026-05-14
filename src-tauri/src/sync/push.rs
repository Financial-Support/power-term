use crate::store::{Db, Forward, Host, Snippet, SshKey};
use crate::settings::Settings;
use crate::sync::client::{ClientError, SupabaseClient};
use crate::sync::encrypt::encrypt;
use rusqlite::params;
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
    /// Tombstone timestamp. Skipped when None so PostgREST upsert does
    /// NOT touch the server's existing deleted_at — that's what kept
    /// re-emerging deleted rows: a bootstrap push_all_local would send
    /// `deleted_at: null` and clobber the tombstone for any row a peer
    /// device had just deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCredentialRow {
    pub id: String,
    pub user_id: String,
    pub ciphertext: String,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
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

/// Persistent outbound sync queue.
///
/// Each operation is serialized to JSON and inserted into the
/// `pending_ops` SQLite table at enqueue time. `flush_queue` reads
/// rows in order, pushes each to Supabase, and deletes the row only
/// after a successful push. This way a tombstone created offline (or
/// any other op that couldn't reach the server immediately) survives
/// app restarts — the previous in-memory queue would silently drop
/// these on quit, letting the next pull resurrect deleted rows from
/// the server's still-alive copy.
pub struct PushQueue {
    db: Arc<Db>,
}

impl PushQueue {
    pub fn new(db: Arc<Db>) -> Self { Self { db } }

    pub fn enqueue(&self, op: PendingOp) {
        let payload = match serde_json::to_string(&op) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "could not serialize pending op — dropping");
                return;
            }
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let conn = self.db.lock();
        if let Err(e) = conn.execute(
            "INSERT INTO pending_ops (payload, created_at) VALUES (?1, ?2)",
            params![payload, now],
        ) {
            tracing::warn!(error = %e, "could not persist pending op — dropping");
        }
    }

    /// Returns `(row_id, op)` for every pending row in insertion order.
    /// Rows that fail to deserialize are deleted so a single bad row
    /// can't wedge the queue forever after a schema change.
    pub fn pending(&self) -> Vec<(i64, PendingOp)> {
        let conn = self.db.lock();
        let mut stmt = match conn.prepare("SELECT id, payload FROM pending_ops ORDER BY id ASC") {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "could not read pending_ops");
                return Vec::new();
            }
        };
        let rows = match stmt.query_map([], |r| {
            let id: i64 = r.get(0)?;
            let payload: String = r.get(1)?;
            Ok((id, payload))
        }) {
            Ok(it) => it,
            Err(e) => {
                tracing::warn!(error = %e, "could not query pending_ops");
                return Vec::new();
            }
        };
        let mut out = Vec::new();
        let mut bad_ids: Vec<i64> = Vec::new();
        for r in rows.flatten() {
            match serde_json::from_str::<PendingOp>(&r.1) {
                Ok(op) => out.push((r.0, op)),
                Err(e) => {
                    tracing::warn!(id = r.0, error = %e, "pending op JSON unreadable — discarding");
                    bad_ids.push(r.0);
                }
            }
        }
        drop(stmt);
        for id in bad_ids {
            let _ = conn.execute("DELETE FROM pending_ops WHERE id=?1", params![id]);
        }
        out
    }

    pub fn delete(&self, id: i64) {
        let conn = self.db.lock();
        if let Err(e) = conn.execute("DELETE FROM pending_ops WHERE id=?1", params![id]) {
            tracing::warn!(id, error = %e, "could not delete pending op");
        }
    }

    pub fn len(&self) -> usize {
        let conn = self.db.lock();
        conn.query_row("SELECT COUNT(*) FROM pending_ops", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)
            .unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool { self.len() == 0 }
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
    let ops = queue.pending();
    for (id, op) in ops {
        match push_op(client, &op).await {
            Ok(()) => queue.delete(id),
            // PostgREST 404 PGRST205 means the table itself doesn't exist
            // on Supabase yet — keeping the op would loop forever, so log
            // once and drop the row. Operator runs the SQL migration to
            // recover; offline retries can't fix a missing schema.
            Err(e) if e.is_table_missing() => {
                tracing::warn!(error = %e, "push: target table missing on server — dropping op");
                queue.delete(id);
            }
            Err(e) => {
                tracing::warn!(error = %e, "push retry failed — keeping op for next sync");
            }
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

    fn test_queue() -> PushQueue {
        let db = Db::open_in_memory().unwrap();
        crate::store::schema::migrate(&db.lock()).unwrap();
        PushQueue::new(db)
    }

    #[test]
    fn push_queue_enqueue_persists_through_handles() {
        let q = test_queue();
        assert_eq!(q.len(), 0);
        q.enqueue(PendingOp::DeleteHost { id: "h1".into(), updated_at: 1000 });
        q.enqueue(PendingOp::DeleteHost { id: "h2".into(), updated_at: 2000 });
        assert_eq!(q.len(), 2);
        let pending = q.pending();
        assert_eq!(pending.len(), 2);
        // pending() does not consume — same ops still present.
        assert_eq!(q.len(), 2);
        for (id, _) in pending {
            q.delete(id);
        }
        assert_eq!(q.len(), 0);
    }

    #[test]
    fn push_queue_survives_reopen() {
        // The whole point of moving the queue to SQLite: a tombstone
        // enqueued before quit must still be there when a new PushQueue
        // is constructed over the same db.
        let db = Db::open_in_memory().unwrap();
        crate::store::schema::migrate(&db.lock()).unwrap();
        let q1 = PushQueue::new(db.clone());
        q1.enqueue(PendingOp::DeleteHost { id: "ghost".into(), updated_at: 1234 });
        drop(q1);

        let q2 = PushQueue::new(db);
        assert_eq!(q2.len(), 1);
        let pending = q2.pending();
        assert!(matches!(
            &pending[0].1,
            PendingOp::DeleteHost { id, updated_at } if id == "ghost" && *updated_at == 1234
        ));
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
