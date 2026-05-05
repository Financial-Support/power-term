use crate::store::{Db, StoreError};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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
}
