use crate::store::{Db, StoreError};
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DbConnectionInput {
    pub host_id: String,
    pub name: String,
    /// "mysql" | "postgres"
    pub engine: String,
    pub db_host: String,
    pub db_port: u16,
    pub database: String,
    pub db_user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DbConnection {
    pub id: String,
    pub host_id: String,
    pub name: String,
    pub engine: String,
    pub db_host: String,
    pub db_port: u16,
    pub database: String,
    pub db_user: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
}

pub struct DbConnectionStore {
    db: Arc<Db>,
}

impl DbConnectionStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        Ok(Self {
            db: Db::open_in_memory()?,
        })
    }

    pub fn list(&self) -> Result<Vec<DbConnection>, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare(SELECT_LIST)?;
        let rows = stmt.query_map([], row_to_conn)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get(&self, id: &str) -> Result<DbConnection, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare(&format!("{SELECT_LIST} WHERE id=?1"))?;
        stmt.query_row(params![id], row_to_conn).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => StoreError::NotFound(id.to_string()),
            other => StoreError::from(other),
        })
    }

    pub fn create(&self, input: &DbConnectionInput) -> Result<DbConnection, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let id = uuid::Uuid::new_v4().to_string();
        let now = now_millis();
        conn.execute(
            "INSERT INTO db_connections \
             (id, host_id, name, engine, db_host, db_port, database, db_user, \
              created_at, updated_at, last_used_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL)",
            params![
                id, input.host_id, input.name, input.engine, input.db_host,
                input.db_port, input.database, input.db_user, now,
            ],
        )?;
        Ok(DbConnection {
            id,
            host_id: input.host_id.clone(),
            name: input.name.clone(),
            engine: input.engine.clone(),
            db_host: input.db_host.clone(),
            db_port: input.db_port,
            database: input.database.clone(),
            db_user: input.db_user.clone(),
            created_at: now,
            updated_at: now,
            last_used_at: None,
        })
    }

    pub fn update(&self, id: &str, input: &DbConnectionInput) -> Result<DbConnection, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let now = now_millis();
        let n = conn.execute(
            "UPDATE db_connections SET host_id=?1, name=?2, engine=?3, db_host=?4, \
             db_port=?5, database=?6, db_user=?7, updated_at=?8 WHERE id=?9",
            params![
                input.host_id, input.name, input.engine, input.db_host,
                input.db_port, input.database, input.db_user, now, id,
            ],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let mut stmt = conn.prepare(&format!("{SELECT_LIST} WHERE id=?1"))?;
        stmt.query_row(params![id], row_to_conn).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let n = conn.execute("DELETE FROM db_connections WHERE id=?1", params![id])?;
        if n == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn touch(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let n = conn.execute(
            "UPDATE db_connections SET last_used_at=?1 WHERE id=?2",
            params![now_millis(), id],
        )?;
        if n == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

const SELECT_LIST: &str = "SELECT id, host_id, name, engine, db_host, db_port, database, \
    db_user, created_at, updated_at, last_used_at FROM db_connections";

fn row_to_conn(row: &Row<'_>) -> rusqlite::Result<DbConnection> {
    Ok(DbConnection {
        id: row.get(0)?,
        host_id: row.get(1)?,
        name: row.get(2)?,
        engine: row.get(3)?,
        db_host: row.get(4)?,
        db_port: row.get(5)?,
        database: row.get(6)?,
        db_user: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_used_at: row.get(10)?,
    })
}

fn validate(input: &DbConnectionInput) -> Result<(), StoreError> {
    if input.host_id.trim().is_empty() {
        return Err(StoreError::Invalid("host_id required".into()));
    }
    if input.name.trim().is_empty() {
        return Err(StoreError::Invalid("name required".into()));
    }
    match input.engine.as_str() {
        "mysql" | "postgres" => {}
        other => return Err(StoreError::Invalid(format!("unknown engine '{other}'"))),
    }
    if input.db_host.trim().is_empty() {
        return Err(StoreError::Invalid("db_host required".into()));
    }
    if input.db_port == 0 {
        return Err(StoreError::Invalid("db_port must be 1..=65535".into()));
    }
    if input.db_user.trim().is_empty() {
        return Err(StoreError::Invalid("db_user required".into()));
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

    fn store_with_host() -> (Arc<Db>, DbConnectionStore) {
        let db = Db::open_in_memory().unwrap();
        {
            let conn = db.lock();
            conn.execute(
                "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at) \
                 VALUES ('h1', 'srv', 'example.com', 22, 'a', 'agent', 0)",
                [],
            )
            .unwrap();
        }
        let s = DbConnectionStore::new(db.clone());
        (db, s)
    }

    fn input(name: &str, engine: &str) -> DbConnectionInput {
        DbConnectionInput {
            host_id: "h1".into(),
            name: name.into(),
            engine: engine.into(),
            db_host: "127.0.0.1".into(),
            db_port: if engine == "mysql" { 3306 } else { 5432 },
            database: "app".into(),
            db_user: "alice".into(),
        }
    }

    #[test]
    fn create_then_list_round_trip() {
        let (_db, s) = store_with_host();
        let c = s.create(&input("primary", "postgres")).unwrap();
        assert_eq!(c.name, "primary");
        assert_eq!(c.engine, "postgres");
        assert_eq!(c.db_port, 5432);
        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], c);
    }

    #[test]
    fn validate_rejects_unknown_engine() {
        let (_db, s) = store_with_host();
        let mut bad = input("x", "postgres");
        bad.engine = "oracle".into();
        assert!(s.create(&bad).is_err());
    }

    #[test]
    fn update_changes_fields_and_bumps_updated_at() {
        let (_db, s) = store_with_host();
        let c = s.create(&input("orig", "mysql")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let updated = s.update(&c.id, &input("renamed", "mysql")).unwrap();
        assert_eq!(updated.name, "renamed");
        assert!(updated.updated_at >= c.updated_at);
    }

    #[test]
    fn delete_returns_not_found_for_missing() {
        let (_db, s) = store_with_host();
        assert!(s.delete("nope").is_err());
    }

    #[test]
    fn cascade_when_host_deleted() {
        let (db, s) = store_with_host();
        s.create(&input("x", "postgres")).unwrap();
        {
            let conn = db.lock();
            conn.execute("DELETE FROM hosts WHERE id='h1'", []).unwrap();
        }
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn touch_updates_last_used_at() {
        let (_db, s) = store_with_host();
        let c = s.create(&input("x", "mysql")).unwrap();
        assert_eq!(c.last_used_at, None);
        s.touch(&c.id).unwrap();
        let after = s.list().unwrap().into_iter().next().unwrap();
        assert!(after.last_used_at.unwrap() > 0);
    }
}
