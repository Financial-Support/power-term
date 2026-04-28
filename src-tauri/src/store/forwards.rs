use crate::store::{Db, StoreError};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ForwardInput {
    pub host_id: String,
    pub name: String,
    pub kind: String,            // "local" | "remote"
    pub bind_addr: String,
    pub bind_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Forward {
    pub id: String,
    pub host_id: String,
    pub name: String,
    pub kind: String,
    pub bind_addr: String,
    pub bind_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
    pub created_at: i64,
}

pub struct ForwardStore {
    db: Arc<Db>,
}

impl ForwardStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Ok(Self { db: Db::open_in_memory()? })
    }

    pub fn list(&self) -> Result<Vec<Forward>, StoreError> {
        let conn = self.db.lock();
        list_with(&conn)
    }

    pub fn list_by_host(&self, host_id: &str) -> Result<Vec<Forward>, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host_id, name, kind, bind_addr, bind_port, remote_host, remote_port, auto_start, created_at \
             FROM forwards WHERE host_id=?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(params![host_id], row_to_forward)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Forward, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare(
            "SELECT id, host_id, name, kind, bind_addr, bind_port, remote_host, remote_port, auto_start, created_at \
             FROM forwards WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_forward).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => StoreError::NotFound(id.to_string()),
            other => StoreError::from(other),
        })
    }

    pub fn create(&self, input: &ForwardInput) -> Result<Forward, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        // Check that host_id refers to an existing host (better error than the
        // FK violation we'd otherwise get, which would surface as opaque text).
        let host_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM hosts WHERE id=?1", params![&input.host_id], |r| r.get(0),
        )?;
        if host_exists == 0 {
            return Err(StoreError::Invalid(format!("host_id '{}' does not exist", input.host_id)));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_millis();
        conn.execute(
            "INSERT INTO forwards (id, host_id, name, kind, bind_addr, bind_port, \
             remote_host, remote_port, auto_start, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id, input.host_id, input.name, input.kind, input.bind_addr, input.bind_port,
                input.remote_host, input.remote_port, input.auto_start as i64, created_at,
            ],
        )?;
        Ok(Forward {
            id,
            host_id: input.host_id.clone(),
            name: input.name.clone(),
            kind: input.kind.clone(),
            bind_addr: input.bind_addr.clone(),
            bind_port: input.bind_port,
            remote_host: input.remote_host.clone(),
            remote_port: input.remote_port,
            auto_start: input.auto_start,
            created_at,
        })
    }

    pub fn update(&self, id: &str, input: &ForwardInput) -> Result<Forward, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let changed = conn.execute(
            "UPDATE forwards SET host_id=?1, name=?2, kind=?3, bind_addr=?4, bind_port=?5, \
             remote_host=?6, remote_port=?7, auto_start=?8 WHERE id=?9",
            params![
                input.host_id, input.name, input.kind, input.bind_addr, input.bind_port,
                input.remote_host, input.remote_port, input.auto_start as i64, id,
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let mut stmt = conn.prepare(
            "SELECT id, host_id, name, kind, bind_addr, bind_port, remote_host, remote_port, auto_start, created_at \
             FROM forwards WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_forward).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let changed = conn.execute("DELETE FROM forwards WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

fn list_with(conn: &Connection) -> Result<Vec<Forward>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, host_id, name, kind, bind_addr, bind_port, remote_host, remote_port, auto_start, created_at \
         FROM forwards ORDER BY name",
    )?;
    let rows = stmt.query_map([], row_to_forward)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

fn validate(input: &ForwardInput) -> Result<(), StoreError> {
    if input.name.trim().is_empty() { return Err(StoreError::Invalid("name required".into())); }
    if input.name.len() > 80 { return Err(StoreError::Invalid("name too long (max 80)".into())); }
    if input.host_id.trim().is_empty() { return Err(StoreError::Invalid("host_id required".into())); }
    match input.kind.as_str() {
        "local" | "remote" => {}
        other => return Err(StoreError::Invalid(format!("unknown kind '{other}'"))),
    }
    if input.bind_port == 0 { return Err(StoreError::Invalid("bind_port must be 1..65535".into())); }
    if input.remote_port == 0 { return Err(StoreError::Invalid("remote_port must be 1..65535".into())); }
    if input.bind_addr.trim().is_empty() { return Err(StoreError::Invalid("bind_addr required".into())); }
    if input.remote_host.trim().is_empty() { return Err(StoreError::Invalid("remote_host required".into())); }
    Ok(())
}

fn row_to_forward(row: &Row<'_>) -> rusqlite::Result<Forward> {
    let auto_start: i64 = row.get(8)?;
    Ok(Forward {
        id: row.get(0)?,
        host_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        bind_addr: row.get(4)?,
        bind_port: row.get(5)?,
        remote_host: row.get(6)?,
        remote_port: row.get(7)?,
        auto_start: auto_start != 0,
        created_at: row.get(9)?,
    })
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::HostStore;

    fn seed_host(store: &HostStore) -> String {
        let h = store.create(&crate::store::HostInput {
            name: "h".into(),
            hostname: "example.com".into(),
            port: 22,
            username: "u".into(),
            group_name: None,
            tags: vec![],
            auth_method: "agent".into(),
            key_path: None,
            notes: None,
        }).unwrap();
        h.id
    }

    fn input(host_id: &str, name: &str) -> ForwardInput {
        ForwardInput {
            host_id: host_id.to_string(),
            name: name.to_string(),
            kind: "local".into(),
            bind_addr: "127.0.0.1".into(),
            bind_port: 5432,
            remote_host: "db.local".into(),
            remote_port: 5432,
            auto_start: false,
        }
    }

    #[test]
    fn create_then_list_round_trip() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let host_id = seed_host(&hosts);
        let store = ForwardStore::new(db);
        let f = store.create(&input(&host_id, "tunnel")).unwrap();
        assert_eq!(f.name, "tunnel");
        assert!(f.created_at > 0);
        let all = store.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], f);
    }

    #[test]
    fn create_rejects_unknown_host_id() {
        let store = ForwardStore::open_in_memory().unwrap();
        let err = store.create(&input("nope", "x")).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("does not exist"), "got: {msg}");
    }

    #[test]
    fn create_validates_required_fields() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let host_id = seed_host(&hosts);
        let store = ForwardStore::new(db);
        let mut bad = input(&host_id, "");
        bad.name = "".into();
        assert!(store.create(&bad).is_err());
        let mut bad2 = input(&host_id, "x");
        bad2.kind = "wat".into();
        assert!(store.create(&bad2).is_err());
        let mut bad3 = input(&host_id, "x");
        bad3.bind_port = 0;
        assert!(store.create(&bad3).is_err());
        let mut bad4 = input(&host_id, "x");
        bad4.remote_host = "".into();
        assert!(store.create(&bad4).is_err());
    }

    #[test]
    fn update_modifies_row() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let host_id = seed_host(&hosts);
        let store = ForwardStore::new(db);
        let f = store.create(&input(&host_id, "orig")).unwrap();
        let mut next = input(&host_id, "renamed");
        next.bind_port = 9999;
        let updated = store.update(&f.id, &next).unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.bind_port, 9999);
    }

    #[test]
    fn delete_removes_row() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let host_id = seed_host(&hosts);
        let store = ForwardStore::new(db);
        let f = store.create(&input(&host_id, "x")).unwrap();
        store.delete(&f.id).unwrap();
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn list_by_host_filters() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let h1 = seed_host(&hosts);
        let h2 = seed_host(&hosts);
        let store = ForwardStore::new(db);
        store.create(&input(&h1, "a")).unwrap();
        store.create(&input(&h2, "b")).unwrap();
        store.create(&input(&h1, "c")).unwrap();
        let only_h1 = store.list_by_host(&h1).unwrap();
        assert_eq!(only_h1.len(), 2);
        assert!(only_h1.iter().all(|f| f.host_id == h1));
    }

    #[test]
    fn cascade_delete_host_removes_forwards() {
        let db = crate::store::Db::open_in_memory().unwrap();
        let hosts = HostStore::new(db.clone());
        let host_id = seed_host(&hosts);
        let store = ForwardStore::new(db);
        store.create(&input(&host_id, "x")).unwrap();
        hosts.delete(&host_id).unwrap();
        assert!(
            store.list().unwrap().is_empty(),
            "expected forward to be cascade-deleted with its host"
        );
    }
}
