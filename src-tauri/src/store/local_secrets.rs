use crate::store::{Db, StoreError};
use rusqlite::{params, OptionalExtension};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalSecret {
    pub secret: String,
    pub updated_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn set(db: &Arc<Db>, id: &str, secret: &str) -> Result<i64, StoreError> {
    let updated_at = now_ms();
    set_at(db, id, secret, updated_at)?;
    Ok(updated_at)
}

pub fn set_at(db: &Arc<Db>, id: &str, secret: &str, updated_at: i64) -> Result<(), StoreError> {
    let conn = db.lock();
    conn.execute(
        "INSERT INTO local_secrets (id, secret, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(id) DO UPDATE SET secret=excluded.secret, updated_at=excluded.updated_at",
        params![id, secret, updated_at],
    )?;
    Ok(())
}

pub fn set_if_newer(db: &Arc<Db>, id: &str, secret: &str, updated_at: i64) -> Result<bool, StoreError> {
    let conn = db.lock();
    let changed = conn.execute(
        "INSERT INTO local_secrets (id, secret, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT(id) DO UPDATE SET secret=excluded.secret, updated_at=excluded.updated_at \
         WHERE excluded.updated_at > local_secrets.updated_at",
        params![id, secret, updated_at],
    )?;
    Ok(changed > 0)
}

pub fn get(db: &Arc<Db>, id: &str) -> Result<Option<LocalSecret>, StoreError> {
    let conn = db.lock();
    Ok(conn
        .query_row(
            "SELECT secret, updated_at FROM local_secrets WHERE id=?1",
            params![id],
            |row| Ok(LocalSecret { secret: row.get(0)?, updated_at: row.get(1)? }),
        )
        .optional()?)
}

pub fn list(db: &Arc<Db>) -> Result<Vec<(String, LocalSecret)>, StoreError> {
    let conn = db.lock();
    let mut stmt = conn.prepare("SELECT id, secret, updated_at FROM local_secrets")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            LocalSecret { secret: row.get(1)?, updated_at: row.get(2)? },
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_for_hosts(db: &Arc<Db>) -> Result<Vec<(String, LocalSecret)>, StoreError> {
    let conn = db.lock();
    let mut stmt = conn.prepare(
        "SELECT s.id, s.secret, s.updated_at FROM local_secrets s \
         INNER JOIN hosts h ON h.id = s.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get(0)?,
            LocalSecret { secret: row.get(1)?, updated_at: row.get(2)? },
        ))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn is_host_id(db: &Arc<Db>, id: &str) -> Result<bool, StoreError> {
    let conn = db.lock();
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM hosts WHERE id=?1)",
        params![id],
        |row| row.get(0),
    )?)
}

pub fn delete(db: &Arc<Db>, id: &str) -> Result<i64, StoreError> {
    let updated_at = now_ms();
    db.lock().execute("DELETE FROM local_secrets WHERE id=?1", params![id])?;
    Ok(updated_at)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plaintext_round_trip_and_conflict_ordering() {
        let db = Db::open_in_memory().unwrap();
        set_at(&db, "host-1", "first", 100).unwrap();
        assert_eq!(get(&db, "host-1").unwrap().unwrap().secret, "first");
        assert!(!set_if_newer(&db, "host-1", "stale", 99).unwrap());
        assert!(set_if_newer(&db, "host-1", "new", 101).unwrap());
        assert_eq!(get(&db, "host-1").unwrap().unwrap().secret, "new");
        delete(&db, "host-1").unwrap();
        assert!(get(&db, "host-1").unwrap().is_none());
    }
}
