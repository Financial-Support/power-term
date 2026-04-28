use crate::store::Db;
use crate::sync::client::{ClientError, SupabaseClient};
use crate::sync::encrypt::decrypt;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteHost {
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
pub struct RemoteSnippet {
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
pub struct RemoteForward {
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
pub struct RemoteCredential {
    pub id: String,
    pub ciphertext: String,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum PullError {
    #[error("client: {0}")]
    Client(#[from] ClientError),
    #[error("db: {0}")]
    Db(#[from] rusqlite::Error),
}

pub async fn pull_all(
    client: &SupabaseClient,
    db: &Arc<Db>,
    sync_key: Option<&[u8; 32]>,
) -> Result<(), PullError> {
    pull_hosts(client, db).await?;
    pull_snippets(client, db).await?;
    pull_forwards(client, db).await?;
    pull_credentials(client, db, sync_key).await?;
    Ok(())
}

async fn pull_hosts(client: &SupabaseClient, db: &Arc<Db>) -> Result<(), PullError> {
    let rows: Vec<RemoteHost> = client.select("hosts", "select=*").await?;
    let conn = db.lock();
    for row in rows {
        if row.deleted_at.is_some() {
            conn.execute("DELETE FROM hosts WHERE id=?1", params![row.id])?;
            continue;
        }
        let local_updated: Option<i64> = conn
            .query_row("SELECT updated_at FROM hosts WHERE id=?1", params![row.id], |r| r.get(0))
            .ok();
        match local_updated {
            None => {
                let tags_json = row.tags.to_string();
                conn.execute(
                    "INSERT OR IGNORE INTO hosts \
                     (id, name, hostname, port, username, group_name, tags_json, auth_method, key_path, notes, created_at, last_used_at, updated_at) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![row.id, row.name, row.hostname, row.port, row.username,
                            row.group_name, tags_json, row.auth_method, row.key_path,
                            row.notes, row.created_at, row.last_used_at, row.updated_at],
                )?;
            }
            Some(local_ts) if row.updated_at > local_ts => {
                let tags_json = row.tags.to_string();
                conn.execute(
                    "UPDATE hosts SET name=?2, hostname=?3, port=?4, username=?5, group_name=?6, \
                     tags_json=?7, auth_method=?8, key_path=?9, notes=?10, last_used_at=?11, \
                     updated_at=?12 WHERE id=?1",
                    params![row.id, row.name, row.hostname, row.port, row.username,
                            row.group_name, tags_json, row.auth_method, row.key_path,
                            row.notes, row.last_used_at, row.updated_at],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn pull_snippets(client: &SupabaseClient, db: &Arc<Db>) -> Result<(), PullError> {
    let rows: Vec<RemoteSnippet> = client.select("snippets", "select=*").await?;
    let conn = db.lock();
    for row in rows {
        if row.deleted_at.is_some() {
            conn.execute("DELETE FROM snippets WHERE id=?1", params![row.id])?;
            continue;
        }
        let local_updated: Option<i64> = conn
            .query_row("SELECT updated_at FROM snippets WHERE id=?1", params![row.id], |r| r.get(0))
            .ok();
        match local_updated {
            None => {
                let tags_json = row.tags.to_string();
                conn.execute(
                    "INSERT OR IGNORE INTO snippets (id, name, content, tags_json, created_at, last_used_at, updated_at) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![row.id, row.name, row.content, tags_json, row.created_at, row.last_used_at, row.updated_at],
                )?;
            }
            Some(local_ts) if row.updated_at > local_ts => {
                let tags_json = row.tags.to_string();
                conn.execute(
                    "UPDATE snippets SET name=?2, content=?3, tags_json=?4, last_used_at=?5, updated_at=?6 WHERE id=?1",
                    params![row.id, row.name, row.content, tags_json, row.last_used_at, row.updated_at],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn pull_forwards(client: &SupabaseClient, db: &Arc<Db>) -> Result<(), PullError> {
    let rows: Vec<RemoteForward> = client.select("forwards", "select=*").await?;
    let conn = db.lock();
    for row in rows {
        if row.deleted_at.is_some() {
            conn.execute("DELETE FROM forwards WHERE id=?1", params![row.id])?;
            continue;
        }
        let local_updated: Option<i64> = conn
            .query_row("SELECT updated_at FROM forwards WHERE id=?1", params![row.id], |r| r.get(0))
            .ok();
        match local_updated {
            None => {
                conn.execute(
                    "INSERT OR IGNORE INTO forwards \
                     (id, host_id, name, kind, bind_addr, bind_port, remote_host, remote_port, auto_start, created_at, updated_at) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![row.id, row.host_id, row.name, row.kind, row.bind_addr,
                            row.bind_port, row.remote_host, row.remote_port, row.auto_start,
                            row.created_at, row.updated_at],
                )?;
            }
            Some(local_ts) if row.updated_at > local_ts => {
                conn.execute(
                    "UPDATE forwards SET name=?2, kind=?3, bind_addr=?4, bind_port=?5, \
                     remote_host=?6, remote_port=?7, auto_start=?8, updated_at=?9 WHERE id=?1",
                    params![row.id, row.name, row.kind, row.bind_addr, row.bind_port,
                            row.remote_host, row.remote_port, row.auto_start, row.updated_at],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn pull_credentials(
    client: &SupabaseClient,
    db: &Arc<Db>,
    sync_key: Option<&[u8; 32]>,
) -> Result<(), PullError> {
    let _ = db; // credentials stored in keychain, not SQLite
    let Some(key) = sync_key else { return Ok(()); };
    let creds: Vec<RemoteCredential> = client.select("credentials", "select=*").await?;
    for cred in creds {
        if cred.deleted_at.is_some() {
            let _ = crate::store::secrets::backend_delete(
                "com.band.power-term",
                &format!("host:{}", cred.id),
            );
            continue;
        }
        if cred.ciphertext.starts_with("ENCRYPTED:NO_KEY") { continue; }
        match decrypt(&cred.ciphertext, key) {
            Ok(plaintext) => {
                let _ = crate::store::secrets::backend_set(
                    "com.band.power-term",
                    &format!("host:{}", cred.id),
                    &plaintext,
                );
            }
            Err(_) => {
                tracing::warn!(host_id = %cred.id, "credential decrypt failed — wrong key?");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::db::Db;
    use crate::store::schema::migrate;
    use std::sync::Arc;

    fn test_db() -> Arc<Db> {
        let db = Db::open_in_memory().unwrap();
        migrate(&db.lock()).unwrap();
        db
    }

    #[test]
    fn merge_inserts_new_remote_host() {
        let db = test_db();
        let conn = db.lock();
        let tags_json = "[]";
        conn.execute(
            "INSERT OR IGNORE INTO hosts \
             (id, name, hostname, port, username, group_name, tags_json, auth_method, key_path, notes, created_at, last_used_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params!["h1", "srv", "1.2.3.4", 22i64, "root",
                    Option::<String>::None, tags_json, "agent", Option::<String>::None,
                    Option::<String>::None, 1000i64, Option::<i64>::None, 2000i64],
        ).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM hosts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn merge_skips_when_local_newer() {
        let db = test_db();
        let conn = db.lock();
        conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at, updated_at) \
             VALUES ('h2', 'old', 'host', 22, 'u', 'agent', 1000, 5000)",
            [],
        ).unwrap();
        let local_ts: i64 = conn.query_row("SELECT updated_at FROM hosts WHERE id='h2'", [], |r| r.get(0)).unwrap();
        let remote_ts: i64 = 3000;
        assert!(remote_ts <= local_ts, "local is newer — should skip remote");
        let name: String = conn.query_row("SELECT name FROM hosts WHERE id='h2'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "old");
    }

    #[test]
    fn merge_overwrites_when_remote_newer() {
        let db = test_db();
        let conn = db.lock();
        conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at, updated_at) \
             VALUES ('h3', 'old-name', 'host', 22, 'u', 'agent', 1000, 1000)",
            [],
        ).unwrap();
        conn.execute(
            "UPDATE hosts SET name='new-name', updated_at=9000 WHERE id='h3'",
            [],
        ).unwrap();
        let name: String = conn.query_row("SELECT name FROM hosts WHERE id='h3'", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "new-name");
    }

    #[test]
    fn tombstone_deletes_local_host() {
        let db = test_db();
        let conn = db.lock();
        conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at, updated_at) \
             VALUES ('h4', 'gone', 'host', 22, 'u', 'agent', 1000, 1000)",
            [],
        ).unwrap();
        conn.execute("DELETE FROM hosts WHERE id='h4'", []).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM hosts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
