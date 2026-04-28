use crate::store::{Db, StoreError};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostInput {
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

pub struct HostStore {
    db: Arc<Db>,
}

impl HostStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    /// Convenience for tests — opens an in-memory db and returns the store.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        let db = Db::open_in_memory()?;
        Ok(Self { db })
    }

    pub fn list(&self) -> Result<Vec<Host>, StoreError> {
        let conn = self.db.lock();
        list_with(&conn)
    }

    pub fn create(&self, input: &HostInput) -> Result<Host, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_millis();
        let tags_json = serde_json::to_string(&input.tags).map_err(|e| StoreError::Serde(e.to_string()))?;
        conn.execute(
            "INSERT INTO hosts \
             (id, name, hostname, port, username, group_name, tags_json, auth_method, key_path, notes, created_at, last_used_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL)",
            params![
                id, input.name, input.hostname, input.port, input.username,
                input.group_name, tags_json, input.auth_method, input.key_path,
                input.notes, created_at,
            ],
        )?;
        Ok(Host {
            id,
            name: input.name.clone(),
            hostname: input.hostname.clone(),
            port: input.port,
            username: input.username.clone(),
            group_name: input.group_name.clone(),
            tags: input.tags.clone(),
            auth_method: input.auth_method.clone(),
            key_path: input.key_path.clone(),
            notes: input.notes.clone(),
            created_at,
            last_used_at: None,
        })
    }

    pub fn update(&self, id: &str, input: &HostInput) -> Result<Host, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let tags_json = serde_json::to_string(&input.tags).map_err(|e| StoreError::Serde(e.to_string()))?;
        let changed = conn.execute(
            "UPDATE hosts SET name=?1, hostname=?2, port=?3, username=?4, group_name=?5, \
             tags_json=?6, auth_method=?7, key_path=?8, notes=?9 WHERE id=?10",
            params![
                input.name, input.hostname, input.port, input.username, input.group_name,
                tags_json, input.auth_method, input.key_path, input.notes, id,
            ],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let mut stmt = conn.prepare(
            "SELECT id, name, hostname, port, username, group_name, tags_json, \
                    auth_method, key_path, notes, created_at, last_used_at \
             FROM hosts WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_host).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let changed = conn.execute("DELETE FROM hosts WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn touch(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let now = now_millis();
        let changed = conn.execute("UPDATE hosts SET last_used_at=?1 WHERE id=?2", params![now, id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

fn list_with(conn: &Connection) -> Result<Vec<Host>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, hostname, port, username, group_name, tags_json, \
                auth_method, key_path, notes, created_at, last_used_at \
         FROM hosts ORDER BY group_name IS NULL, group_name, name",
    )?;
    let rows = stmt.query_map([], row_to_host)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

fn validate(input: &HostInput) -> Result<(), StoreError> {
    if input.name.trim().is_empty() { return Err(StoreError::Invalid("name required".into())); }
    if input.hostname.trim().is_empty() { return Err(StoreError::Invalid("hostname required".into())); }
    if input.username.trim().is_empty() { return Err(StoreError::Invalid("username required".into())); }
    if input.port == 0 { return Err(StoreError::Invalid("port must be 1..=65535".into())); }
    match input.auth_method.as_str() {
        "agent" => {}
        "key" => {
            if input.key_path.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err(StoreError::Invalid("key_path required when auth_method='key'".into()));
            }
        }
        "password" => {}
        other => return Err(StoreError::Invalid(format!("unknown auth_method '{other}'"))),
    }
    Ok(())
}

fn row_to_host(row: &Row<'_>) -> rusqlite::Result<Host> {
    let tags_json: String = row.get(6)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Host {
        id: row.get(0)?,
        name: row.get(1)?,
        hostname: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        group_name: row.get(5)?,
        tags,
        auth_method: row.get(7)?,
        key_path: row.get(8)?,
        notes: row.get(9)?,
        created_at: row.get(10)?,
        last_used_at: row.get(11)?,
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

    fn input(name: &str) -> HostInput {
        HostInput {
            name: name.to_string(),
            hostname: "example.com".into(),
            port: 22,
            username: "alice".into(),
            group_name: Some("Personal".into()),
            tags: vec!["prod".into()],
            auth_method: "agent".into(),
            key_path: None,
            notes: None,
        }
    }

    #[test]
    fn create_then_list_round_trip() {
        let s = HostStore::open_in_memory().unwrap();
        let h = s.create(&input("mac")).unwrap();
        assert_eq!(h.name, "mac");
        assert!(!h.id.is_empty());
        assert!(h.created_at > 0);
        assert_eq!(h.last_used_at, None);
        assert_eq!(h.tags, vec!["prod".to_string()]);

        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], h);
    }

    #[test]
    fn list_orders_by_group_then_name() {
        let s = HostStore::open_in_memory().unwrap();
        let mut a = input("zeta"); a.group_name = Some("Personal".into());
        let mut b = input("alpha"); b.group_name = Some("Work".into());
        let mut c = input("beta"); c.group_name = None;
        s.create(&a).unwrap();
        s.create(&b).unwrap();
        s.create(&c).unwrap();

        let all = s.list().unwrap();
        let names: Vec<&str> = all.iter().map(|h| h.name.as_str()).collect();
        assert_eq!(names, vec!["zeta", "alpha", "beta"]);
    }

    #[test]
    fn update_modifies_row_keeps_created_at() {
        let s = HostStore::open_in_memory().unwrap();
        let h = s.create(&input("orig")).unwrap();
        let mut next = input("changed");
        next.port = 2222;
        let updated = s.update(&h.id, &next).unwrap();
        assert_eq!(updated.name, "changed");
        assert_eq!(updated.port, 2222);
        assert_eq!(updated.created_at, h.created_at);
    }

    #[test]
    fn update_unknown_id_returns_not_found() {
        let s = HostStore::open_in_memory().unwrap();
        let err = s.update("nope", &input("x")).unwrap_err();
        matches!(err, StoreError::NotFound(_));
    }

    #[test]
    fn delete_removes_row() {
        let s = HostStore::open_in_memory().unwrap();
        let h = s.create(&input("x")).unwrap();
        s.delete(&h.id).unwrap();
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn touch_updates_last_used_at() {
        let s = HostStore::open_in_memory().unwrap();
        let h = s.create(&input("x")).unwrap();
        assert_eq!(h.last_used_at, None);
        std::thread::sleep(std::time::Duration::from_millis(2));
        s.touch(&h.id).unwrap();
        let again = s.list().unwrap().into_iter().next().unwrap();
        assert!(again.last_used_at.unwrap() > 0);
    }

    #[test]
    fn create_validates_required_fields() {
        let s = HostStore::open_in_memory().unwrap();
        let mut bad = input("x");
        bad.name = "".into();
        assert!(s.create(&bad).is_err());
        let mut bad2 = input("x");
        bad2.hostname = "".into();
        assert!(s.create(&bad2).is_err());
        let mut bad3 = input("x");
        bad3.username = "".into();
        assert!(s.create(&bad3).is_err());
    }

    #[test]
    fn create_requires_key_path_when_method_is_key() {
        let s = HostStore::open_in_memory().unwrap();
        let mut bad = input("x");
        bad.auth_method = "key".into();
        bad.key_path = None;
        assert!(s.create(&bad).is_err());

        bad.key_path = Some("/Users/alice/.ssh/id_ed25519".into());
        assert!(s.create(&bad).is_ok());
    }
}
