use crate::store::{Forward, Host, Snippet};
use crate::settings::Settings;
use crate::sync::client::{ClientError, SupabaseClient};
use crate::sync::encrypt::encrypt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHostRow {
    pub id: String,
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
pub struct RemoteCredentialRow {
    pub id: String,
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

pub fn host_to_row(host: &Host) -> RemoteHostRow {
    RemoteHostRow {
        id: host.id.clone(),
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

pub fn snippet_to_row(snippet: &Snippet) -> RemoteSnippetRow {
    RemoteSnippetRow {
        id: snippet.id.clone(),
        name: snippet.name.clone(),
        content: snippet.content.clone(),
        tags: serde_json::to_value(&snippet.tags).unwrap_or(serde_json::json!([])),
        created_at: snippet.created_at,
        last_used_at: snippet.last_used_at,
        updated_at: snippet.updated_at,
        deleted_at: None,
    }
}

pub fn forward_to_row(fwd: &Forward) -> RemoteForwardRow {
    RemoteForwardRow {
        id: fwd.id.clone(),
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
    }
}

pub async fn flush_queue(client: &SupabaseClient, queue: &Arc<PushQueue>) {
    let ops = queue.drain();
    for op in ops {
        if let Err(e) = push_op(client, &op).await {
            tracing::warn!(error = %e, "push retry failed — re-enqueuing");
            queue.enqueue(op);
        }
    }
}

pub async fn push_credential(
    client: &SupabaseClient,
    host_id: &str,
    plaintext: &str,
    sync_key: Option<&[u8; 32]>,
    updated_at: i64,
) -> Result<(), ClientError> {
    let ciphertext = match sync_key {
        Some(key) => encrypt(plaintext, key).map_err(|e| ClientError::Json(e.to_string()))?,
        None => "ENCRYPTED:NO_KEY".to_string(),
    };
    let row = RemoteCredentialRow { id: host_id.to_string(), ciphertext, updated_at, deleted_at: None };
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
        let row = host_to_row(&host);
        assert_eq!(row.id, "h1");
        assert_eq!(row.port, 22);
        assert_eq!(row.updated_at, 2000);
        assert!(row.deleted_at.is_none());
    }

    #[test]
    fn snippet_to_row_maps_fields() {
        let s = Snippet {
            id: "s1".into(),
            name: "hello".into(),
            content: "echo hi".into(),
            tags: vec!["shell".into()],
            created_at: 100,
            last_used_at: None,
            updated_at: 200,
        };
        let row = snippet_to_row(&s);
        assert_eq!(row.id, "s1");
        assert_eq!(row.updated_at, 200);
    }
}
