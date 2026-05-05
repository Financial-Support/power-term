use crate::store::{Db, StoreError};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Color metadata for a tag name. Tag *membership* lives on `hosts.tags_json`;
/// this side table just remembers which color a user picked for each name.
/// Tags without a row here fall back to a deterministic UI default.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TagColor {
    pub name: String,
    pub color: String,
}

pub struct TagColorStore {
    db: Arc<Db>,
}

impl TagColorStore {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }

    pub fn list(&self) -> Result<Vec<TagColor>, StoreError> {
        let conn = self.db.lock();
        let mut stmt = conn.prepare("SELECT name, color FROM tag_colors ORDER BY name")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TagColor {
                    name: row.get(0)?,
                    color: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert(&self, name: &str, color: &str) -> Result<TagColor, StoreError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::Invalid("tag name cannot be empty".into()));
        }
        if !valid_color(color) {
            return Err(StoreError::Invalid(format!(
                "color must be a #RRGGBB hex literal, got '{color}'"
            )));
        }
        let conn = self.db.lock();
        conn.execute(
            "INSERT INTO tag_colors (name, color) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET color = excluded.color",
            params![name, color],
        )?;
        Ok(TagColor {
            name: name.to_string(),
            color: color.to_string(),
        })
    }

    pub fn delete(&self, name: &str) -> Result<(), StoreError> {
        let conn = self.db.lock();
        let n = conn.execute("DELETE FROM tag_colors WHERE name = ?1", params![name])?;
        if n == 0 {
            return Err(StoreError::NotFound(format!("tag color '{name}'")));
        }
        Ok(())
    }

    /// Rename a tag everywhere: the colour row (if any) and every host's
    /// `tags_json`. If the new name already exists on a host, the rename
    /// dedupes. If both `old` and `new` have colour rows, the new colour wins
    /// and the old row is dropped. Bumps `updated_at` on touched hosts so the
    /// sync layer picks them up.
    pub fn rename(&self, old: &str, new: &str) -> Result<(), StoreError> {
        let old = old.trim();
        let new = new.trim();
        if old.is_empty() || new.is_empty() {
            return Err(StoreError::Invalid("tag name cannot be empty".into()));
        }
        if old == new {
            return Ok(());
        }
        let mut guard = self.db.lock();
        let tx = guard.transaction()?;

        // Rename color row when only `old` exists; otherwise delete the old
        // row so the existing `new` row's color is preserved.
        let new_exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM tag_colors WHERE name = ?1",
            params![new],
            |r| r.get(0),
        )?;
        if new_exists == 0 {
            tx.execute(
                "UPDATE tag_colors SET name = ?1 WHERE name = ?2",
                params![new, old],
            )?;
        } else {
            tx.execute("DELETE FROM tag_colors WHERE name = ?1", params![old])?;
        }

        let now = now_millis();
        let mut to_update: Vec<(String, Vec<String>)> = Vec::new();
        {
            let mut stmt = tx.prepare("SELECT id, tags_json FROM hosts")?;
            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let tags_json: String = row.get(1)?;
                Ok((id, tags_json))
            })?;
            for r in rows {
                let (id, tags_json) = r?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                if !tags.iter().any(|t| t == old) {
                    continue;
                }
                let mut next: Vec<String> = Vec::with_capacity(tags.len());
                let mut seen: HashSet<String> = HashSet::new();
                for t in tags {
                    let mapped = if t == old { new.to_string() } else { t };
                    if seen.insert(mapped.clone()) {
                        next.push(mapped);
                    }
                }
                to_update.push((id, next));
            }
        }
        for (id, tags) in to_update {
            let json = serde_json::to_string(&tags)
                .map_err(|e| StoreError::Serde(e.to_string()))?;
            tx.execute(
                "UPDATE hosts SET tags_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![json, now, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Remove a tag everywhere: drops its colour row (if any) and strips it
    /// from every host's `tags_json`. Bumps `updated_at` on touched hosts.
    pub fn delete_everywhere(&self, name: &str) -> Result<(), StoreError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(StoreError::Invalid("tag name cannot be empty".into()));
        }
        let mut guard = self.db.lock();
        let tx = guard.transaction()?;
        tx.execute("DELETE FROM tag_colors WHERE name = ?1", params![name])?;

        let now = now_millis();
        let mut to_update: Vec<(String, Vec<String>)> = Vec::new();
        {
            let mut stmt = tx.prepare("SELECT id, tags_json FROM hosts")?;
            let rows = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let tags_json: String = row.get(1)?;
                Ok((id, tags_json))
            })?;
            for r in rows {
                let (id, tags_json) = r?;
                let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
                if !tags.iter().any(|t| t == name) {
                    continue;
                }
                let next: Vec<String> = tags.into_iter().filter(|t| t != name).collect();
                to_update.push((id, next));
            }
        }
        for (id, tags) in to_update {
            let json = serde_json::to_string(&tags)
                .map_err(|e| StoreError::Serde(e.to_string()))?;
            tx.execute(
                "UPDATE hosts SET tags_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![json, now, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn valid_color(s: &str) -> bool {
    // Accept only #RRGGBB (case-insensitive). Keeps the UI surface tight and
    // prevents arbitrary CSS values from leaking into the chip background.
    let bytes = s.as_bytes();
    bytes.len() == 7
        && bytes[0] == b'#'
        && bytes[1..].iter().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> TagColorStore {
        let db = Db::open_in_memory().unwrap();
        TagColorStore::new(db)
    }

    fn store_with_hosts() -> (Arc<Db>, TagColorStore) {
        let db = Db::open_in_memory().unwrap();
        let s = TagColorStore::new(db.clone());
        (db, s)
    }

    fn insert_host(db: &Db, id: &str, tags: &[&str]) {
        let json = serde_json::to_string(tags).unwrap();
        let conn = db.lock();
        conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, group_name, tags_json, \
             auth_method, key_path, notes, created_at, last_used_at, updated_at) \
             VALUES (?1, ?2, 'h', 22, 'u', NULL, ?3, 'agent', NULL, NULL, 1, NULL, 1)",
            params![id, id, json],
        )
        .unwrap();
    }

    fn host_tags(db: &Db, id: &str) -> Vec<String> {
        let conn = db.lock();
        let json: String = conn
            .query_row(
                "SELECT tags_json FROM hosts WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        serde_json::from_str(&json).unwrap()
    }

    fn host_updated_at(db: &Db, id: &str) -> i64 {
        let conn = db.lock();
        conn.query_row(
            "SELECT updated_at FROM hosts WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn roundtrip_upsert_and_list() {
        let s = store();
        s.upsert("prod", "#ff5588").unwrap();
        s.upsert("staging", "#33aaee").unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "prod");
        assert_eq!(all[0].color, "#ff5588");
    }

    #[test]
    fn upsert_overwrites_existing_color() {
        let s = store();
        s.upsert("prod", "#ff5588").unwrap();
        s.upsert("prod", "#000000").unwrap();
        let all = s.list().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].color, "#000000");
    }

    #[test]
    fn rejects_invalid_color() {
        let s = store();
        assert!(s.upsert("prod", "red").is_err());
        assert!(s.upsert("prod", "#abc").is_err());
        assert!(s.upsert("prod", "#gggggg").is_err());
    }

    #[test]
    fn rejects_empty_name() {
        let s = store();
        assert!(s.upsert("   ", "#ffffff").is_err());
    }

    #[test]
    fn delete_returns_not_found_for_missing() {
        let s = store();
        assert!(s.delete("nope").is_err());
    }

    #[test]
    fn delete_removes_existing() {
        let s = store();
        s.upsert("prod", "#ff5588").unwrap();
        s.delete("prod").unwrap();
        assert!(s.list().unwrap().is_empty());
    }

    #[test]
    fn rename_updates_color_row_and_hosts() {
        let (db, s) = store_with_hosts();
        s.upsert("prod", "#ff5588").unwrap();
        insert_host(&db, "h1", &["prod", "db"]);
        insert_host(&db, "h2", &["staging"]);

        s.rename("prod", "production").unwrap();

        let colors = s.list().unwrap();
        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].name, "production");
        assert_eq!(colors[0].color, "#ff5588");

        assert_eq!(host_tags(&db, "h1"), vec!["production", "db"]);
        assert_eq!(host_tags(&db, "h2"), vec!["staging"]);
        assert!(host_updated_at(&db, "h1") > 1);
        assert_eq!(host_updated_at(&db, "h2"), 1, "untouched host should not bump");
    }

    #[test]
    fn rename_into_existing_dedupes_and_keeps_target_color() {
        let (db, s) = store_with_hosts();
        s.upsert("prod", "#ff0000").unwrap();
        s.upsert("production", "#00ff00").unwrap();
        insert_host(&db, "h1", &["prod", "production", "db"]);

        s.rename("prod", "production").unwrap();

        let colors = s.list().unwrap();
        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].name, "production");
        assert_eq!(colors[0].color, "#00ff00", "target color wins");
        assert_eq!(host_tags(&db, "h1"), vec!["production", "db"]);
    }

    #[test]
    fn rename_rejects_empty_or_noop() {
        let s = store();
        assert!(s.rename("", "x").is_err());
        assert!(s.rename("x", "").is_err());
        s.rename("same", "same").unwrap();
    }

    #[test]
    fn delete_everywhere_strips_from_hosts_and_drops_color() {
        let (db, s) = store_with_hosts();
        s.upsert("prod", "#ff0000").unwrap();
        insert_host(&db, "h1", &["prod", "db"]);
        insert_host(&db, "h2", &["prod"]);
        insert_host(&db, "h3", &["other"]);

        s.delete_everywhere("prod").unwrap();

        assert!(s.list().unwrap().is_empty());
        assert_eq!(host_tags(&db, "h1"), vec!["db"]);
        assert_eq!(host_tags(&db, "h2"), Vec::<String>::new());
        assert_eq!(host_tags(&db, "h3"), vec!["other"]);
        assert!(host_updated_at(&db, "h1") > 1);
        assert!(host_updated_at(&db, "h2") > 1);
        assert_eq!(host_updated_at(&db, "h3"), 1);
    }

    #[test]
    fn delete_everywhere_without_color_still_strips_hosts() {
        let (db, s) = store_with_hosts();
        insert_host(&db, "h1", &["prod"]);
        s.delete_everywhere("prod").unwrap();
        assert_eq!(host_tags(&db, "h1"), Vec::<String>::new());
    }
}
