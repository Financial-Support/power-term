use crate::store::{Db, StoreError};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnippetInput {
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

pub struct SnippetStore {
    db: Arc<Db>,
}

impl SnippetStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let db = Db::open_in_memory()?;
        Ok(Self { db })
    }

    pub fn list(&self) -> Result<Vec<Snippet>, StoreError> {
        let conn = self.db.lock();
        list_with(&conn)
    }

    pub fn create(&self, input: &SnippetInput) -> Result<Snippet, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_millis();
        let tags_json = serde_json::to_string(&input.tags).map_err(|e| StoreError::Serde(e.to_string()))?;
        conn.execute(
            "INSERT INTO snippets (id, name, content, tags_json, created_at, last_used_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
            params![id, input.name, input.content, tags_json, created_at],
        )?;
        Ok(Snippet {
            id,
            name: input.name.clone(),
            content: input.content.clone(),
            tags: input.tags.clone(),
            created_at,
            last_used_at: None,
        })
    }

    pub fn update(&self, id: &str, input: &SnippetInput) -> Result<Snippet, StoreError> {
        validate(input)?;
        let conn = self.db.lock();
        let tags_json = serde_json::to_string(&input.tags).map_err(|e| StoreError::Serde(e.to_string()))?;
        let changed = conn.execute(
            "UPDATE snippets SET name=?1, content=?2, tags_json=?3 WHERE id=?4",
            params![input.name, input.content, tags_json, id],
        )?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        let mut stmt = conn.prepare(
            "SELECT id, name, content, tags_json, created_at, last_used_at FROM snippets WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_snippet).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let changed = conn.execute("DELETE FROM snippets WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn touch(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let now = now_millis();
        let changed = conn.execute("UPDATE snippets SET last_used_at=?1 WHERE id=?2", params![now, id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
}

fn list_with(conn: &Connection) -> Result<Vec<Snippet>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, content, tags_json, created_at, last_used_at \
         FROM snippets ORDER BY name",
    )?;
    let rows = stmt.query_map([], row_to_snippet)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

fn validate(input: &SnippetInput) -> Result<(), StoreError> {
    if input.name.trim().is_empty() { return Err(StoreError::Invalid("name required".into())); }
    if input.content.is_empty() { return Err(StoreError::Invalid("content required".into())); }
    if input.name.len() > 80 { return Err(StoreError::Invalid("name too long (max 80)".into())); }
    Ok(())
}

fn row_to_snippet(row: &Row<'_>) -> rusqlite::Result<Snippet> {
    let tags_json: String = row.get(3)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Snippet {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        tags,
        created_at: row.get(4)?,
        last_used_at: row.get(5)?,
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

    fn input(name: &str) -> SnippetInput {
        SnippetInput {
            name: name.to_string(),
            content: "ls -la\n".to_string(),
            tags: vec!["fs".into()],
        }
    }

    #[test]
    fn create_then_list_round_trip() {
        let s = SnippetStore::open_in_memory().unwrap();
        let snip = s.create(&input("ls")).unwrap();
        assert_eq!(snip.name, "ls");
        assert!(!snip.id.is_empty());
        assert!(snip.created_at > 0);
        assert_eq!(snip.last_used_at, None);
        assert_eq!(snip.tags, vec!["fs".to_string()]);

        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0], snip);
    }

    #[test]
    fn list_orders_by_name() {
        let s = SnippetStore::open_in_memory().unwrap();
        s.create(&input("zeta")).unwrap();
        s.create(&input("alpha")).unwrap();
        s.create(&input("beta")).unwrap();
        let all = s.list().unwrap();
        let names: Vec<&str> = all.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta", "zeta"]);
    }

    #[test]
    fn update_modifies_row_keeps_created_at() {
        let s = SnippetStore::open_in_memory().unwrap();
        let orig = s.create(&input("orig")).unwrap();
        let mut next = input("changed");
        next.content = "echo hi\n".into();
        let updated = s.update(&orig.id, &next).unwrap();
        assert_eq!(updated.name, "changed");
        assert_eq!(updated.content, "echo hi\n");
        assert_eq!(updated.created_at, orig.created_at);
    }

    #[test]
    fn update_unknown_id_returns_not_found() {
        let s = SnippetStore::open_in_memory().unwrap();
        let err = s.update("nope", &input("x")).unwrap_err();
        matches!(err, StoreError::NotFound(_));
    }

    #[test]
    fn delete_removes_row() {
        let s = SnippetStore::open_in_memory().unwrap();
        let snip = s.create(&input("x")).unwrap();
        s.delete(&snip.id).unwrap();
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn touch_updates_last_used_at() {
        let s = SnippetStore::open_in_memory().unwrap();
        let snip = s.create(&input("x")).unwrap();
        assert_eq!(snip.last_used_at, None);
        std::thread::sleep(std::time::Duration::from_millis(2));
        s.touch(&snip.id).unwrap();
        let again = s.list().unwrap().into_iter().next().unwrap();
        assert!(again.last_used_at.unwrap() > 0);
    }

    #[test]
    fn create_validates_required_fields() {
        let s = SnippetStore::open_in_memory().unwrap();
        let mut bad = input("x");
        bad.name = "".into();
        assert!(s.create(&bad).is_err());
        let mut bad2 = input("x");
        bad2.content = "".into();
        assert!(s.create(&bad2).is_err());
    }

    #[test]
    fn create_rejects_overlong_name() {
        let s = SnippetStore::open_in_memory().unwrap();
        let mut bad = input("x");
        bad.name = "a".repeat(81);
        assert!(s.create(&bad).is_err());
    }
}
