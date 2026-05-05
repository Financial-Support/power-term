use crate::store::{Db, StoreError};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SshKeyInput {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct SshKeyStore {
    db: Arc<Db>,
}

impl SshKeyStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn list(&self) -> Result<Vec<SshKey>, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at FROM ssh_keys ORDER BY name",
        )?;
        let rows = stmt.query_map([], row_to_key)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create(&self, input: &SshKeyInput) -> Result<SshKey, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        conn.execute(
            "INSERT INTO ssh_keys (id, name, path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, input.name.trim(), input.path.trim(), now],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(_, msg) if msg.as_deref().unwrap_or("").contains("UNIQUE") => {
                StoreError::Invalid(format!("a key already exists for path '{}'", input.path.trim()))
            }
            other => StoreError::from(other),
        })?;
        Ok(SshKey {
            id,
            name: input.name.trim().to_string(),
            path: input.path.trim().to_string(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update(&self, id: &str, input: &SshKeyInput) -> Result<SshKey, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let now = now_millis();
        let n = conn
            .execute(
                "UPDATE ssh_keys SET name=?1, path=?2, updated_at=?3 WHERE id=?4",
                params![input.name.trim(), input.path.trim(), now, id],
            )
            .map_err(|e| match e {
                rusqlite::Error::SqliteFailure(_, msg) if msg.as_deref().unwrap_or("").contains("UNIQUE") => {
                    StoreError::Invalid(format!("a key already exists for path '{}'", input.path.trim()))
                }
                other => StoreError::from(other),
            })?;
        if n == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let mut stmt = conn.prepare(
            "SELECT id, name, path, created_at, updated_at FROM ssh_keys WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_key).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let n = conn.execute("DELETE FROM ssh_keys WHERE id=?1", params![id])?;
        if n == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

fn row_to_key(row: &Row<'_>) -> rusqlite::Result<SshKey> {
    Ok(SshKey {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn validate(input: &SshKeyInput) -> Result<(), StoreError> {
    if input.name.trim().is_empty() {
        return Err(StoreError::Invalid("name required".into()));
    }
    if input.path.trim().is_empty() {
        return Err(StoreError::Invalid("path required".into()));
    }
    Ok(())
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

    fn store() -> SshKeyStore {
        let db = Db::open_in_memory().unwrap();
        SshKeyStore::new(db)
    }

    fn input(name: &str, path: &str) -> SshKeyInput {
        SshKeyInput { name: name.into(), path: path.into() }
    }

    #[test]
    fn create_and_list() {
        let s = store();
        s.create(&input("personal", "/Users/me/.ssh/id_ed25519")).unwrap();
        s.create(&input("work", "/Users/me/.ssh/id_work")).unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "personal");
        assert_eq!(all[1].name, "work");
    }

    #[test]
    fn duplicate_path_rejected() {
        let s = store();
        s.create(&input("a", "/k")).unwrap();
        let err = s.create(&input("b", "/k")).unwrap_err();
        match err {
            StoreError::Invalid(m) => assert!(m.contains("already exists")),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn update_modifies_row() {
        let s = store();
        let k = s.create(&input("orig", "/k1")).unwrap();
        let up = s.update(&k.id, &input("renamed", "/k2")).unwrap();
        assert_eq!(up.name, "renamed");
        assert_eq!(up.path, "/k2");
    }

    #[test]
    fn delete_returns_not_found_for_missing() {
        let s = store();
        assert!(s.delete("nope").is_err());
    }

    #[test]
    fn validate_rejects_empty() {
        let s = store();
        assert!(s.create(&input("", "/k")).is_err());
        assert!(s.create(&input("name", "")).is_err());
    }
}
