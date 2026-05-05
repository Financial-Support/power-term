//! Owns live `DbSession`s, keyed by an opaque id the renderer holds onto.
//! Identical pattern to `SftpManager` / `SshManager`: open returns the id,
//! query/close look up by id.
use crate::db::session::{DbError, DbSession, QueryResult};
use parking_lot::Mutex as PLMutex;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Default)]
pub struct DbManager {
    sessions: PLMutex<HashMap<String, Arc<DbSession>>>,
}

impl DbManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, session: DbSession) -> String {
        let id = Uuid::new_v4().to_string();
        self.sessions.lock().insert(id.clone(), Arc::new(session));
        id
    }

    pub fn get(&self, id: &str) -> Result<Arc<DbSession>, DbError> {
        self.sessions
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| DbError::Connect(format!("unknown db session '{id}'")))
    }

    pub async fn close(&self, id: &str) -> Result<(), DbError> {
        let session = self.sessions.lock().remove(id);
        if let Some(s) = session {
            s.close().await?;
        }
        Ok(())
    }

    pub async fn query(&self, id: &str, sql: &str) -> Result<QueryResult, DbError> {
        let s = self.get(id)?;
        s.query(sql).await
    }
}
