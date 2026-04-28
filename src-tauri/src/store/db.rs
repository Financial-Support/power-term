use crate::store::{schema, StoreError};
use parking_lot::{Mutex, MutexGuard};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;

/// Owns the single SQLite connection used by all stores in this crate.
/// Ensures the schema migration runs exactly once at startup.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: PathBuf) -> Result<Arc<Self>, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "foreign_keys", true)?;
        schema::migrate(&conn)?;
        Ok(Arc::new(Self { conn: Mutex::new(conn) }))
    }

    pub fn open_in_memory() -> Result<Arc<Self>, StoreError> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", true)?;
        schema::migrate(&conn)?;
        Ok(Arc::new(Self { conn: Mutex::new(conn) }))
    }

    pub fn open_default_path() -> Result<Arc<Self>, StoreError> {
        let dir = dirs::config_dir().ok_or(StoreError::NoConfigDir)?.join("power-term");
        Self::open(dir.join("hosts.db"))
    }

    /// Acquire the underlying connection. The lock is released when the guard
    /// is dropped — keep critical sections short.
    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock()
    }
}
