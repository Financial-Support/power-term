# Host Store + Sidebar (Sub-project #2B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite-backed host store, macOS Keychain integration for secrets, and a left sidebar UI so users can save SSH hosts and connect from a row click — reusing the entire #2A SSH connect flow.

**Architecture:** New `store/` Rust module with `HostStore` (rusqlite) and `secrets` (keyring). Tauri commands `hosts_*` + `secret_*` mirror the shape of existing pty/ssh commands. New React Sidebar component with Cmd+B toggle, group expand/collapse, and an inline row-edit/×-delete affordance. New `HostFormModal` (Add/Edit) and `ConfirmModal` (delete). `App.connectFromHost` builds an `AuthRequest` from the stored auth method + Keychain secret, then calls the existing `driveSshConnect` from #2A.

**Tech Stack:** Rust (`rusqlite` with `bundled` feature, `keyring ^3`, existing `parking_lot`/`serde`/`uuid`/`tracing`/`thiserror`), React 18, TypeScript, vitest. No new frontend deps.

**Reference spec:** [docs/superpowers/specs/2026-04-27-host-store-2b-design.md](../specs/2026-04-27-host-store-2b-design.md)

---

## Task 1: Cargo deps + store module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/store/mod.rs`
- Create: `src-tauri/src/store/schema.rs`
- Create: `src-tauri/src/store/host.rs`
- Create: `src-tauri/src/store/secrets.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add deps to `src-tauri/Cargo.toml`**

In `[dependencies]`, append:

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
keyring = "3"
```

- [ ] **Step 2: Register the module in `src-tauri/src/lib.rs`** (final contents):

```rust
pub mod commands;
pub mod pty;
pub mod settings;
pub mod ssh;
pub mod store;
```

- [ ] **Step 3: Create `src-tauri/src/store/mod.rs`**

```rust
pub mod host;
pub mod schema;
pub mod secrets;

pub use host::{Host, HostInput, HostStore};

#[derive(thiserror::Error, Debug)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("config dir not found")]
    NoConfigDir,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid: {0}")]
    Invalid(String),
    #[error("serde: {0}")]
    Serde(String),
}

#[derive(thiserror::Error, Debug)]
pub enum SecretError {
    #[error("keyring: {0}")]
    Keyring(String),
    #[error("not found")]
    NotFound,
}
```

- [ ] **Step 4: Stub the three sub-modules**

`src-tauri/src/store/schema.rs`:
```rust
//! Filled in Task 2.
```

`src-tauri/src/store/host.rs`:
```rust
//! Filled in Task 3.

use serde::{Deserialize, Serialize};

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

pub struct HostStore;

impl HostStore {
    pub fn _placeholder() {}
}
```

`src-tauri/src/store/secrets.rs`:
```rust
//! Filled in Task 4.
```

- [ ] **Step 5: Build check**

Run: `~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml`
Expected: clean (rusqlite + keyring compile may take 30-60s the first time).

Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "chore(store): scaffold store module + rusqlite/keyring deps"
```

---

## Task 2: SQLite schema + migration runner (TDD)

**Files:**
- Modify: `src-tauri/src/store/schema.rs`

- [ ] **Step 1: Replace `src-tauri/src/store/schema.rs` with the schema runner + tests**

```rust
use rusqlite::{Connection, Result};

/// Current schema version. Increment by 1 for every migration. The runner
/// applies migrations sequentially based on PRAGMA user_version.
pub const CURRENT_VERSION: u32 = 1;

/// Run any pending migrations on `conn` and bump user_version to CURRENT_VERSION.
pub fn migrate(conn: &Connection) -> Result<()> {
    let mut version: u32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))?;
    while version < CURRENT_VERSION {
        match version {
            0 => migration_v1(conn)?,
            other => {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
                    Some(format!("no migration for version {other}")),
                ));
            }
        }
        version += 1;
        conn.pragma_update(None, "user_version", version)?;
    }
    Ok(())
}

fn migration_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE hosts (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            hostname TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
            username TEXT NOT NULL,
            group_name TEXT,
            tags_json TEXT NOT NULL DEFAULT '[]',
            auth_method TEXT NOT NULL CHECK (auth_method IN ('agent', 'key', 'password')),
            key_path TEXT,
            notes TEXT,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER
        );
        CREATE INDEX hosts_group_idx ON hosts(group_name);
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_in_memory() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn fresh_db_starts_at_version_zero() {
        let conn = open_in_memory();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 0);
    }

    #[test]
    fn migrate_creates_hosts_table_and_bumps_version() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);

        // Schema present
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hosts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // second call must not fail or duplicate
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
    }

    #[test]
    fn migrate_rejects_future_version() {
        let conn = open_in_memory();
        conn.pragma_update(None, "user_version", CURRENT_VERSION + 1).unwrap();
        // Already past current → no migrations to run, ok.
        migrate(&conn).unwrap();
    }

    #[test]
    fn port_check_constraint_enforced() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let err = conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at) \
             VALUES ('x', 'n', 'h', 0, 'u', 'agent', 0)",
            [],
        );
        assert!(err.is_err(), "port=0 must violate CHECK constraint");
    }

    #[test]
    fn auth_method_check_constraint_enforced() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let err = conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at) \
             VALUES ('x', 'n', 'h', 22, 'u', 'bogus', 0)",
            [],
        );
        assert!(err.is_err(), "auth_method='bogus' must violate CHECK constraint");
    }
}
```

- [ ] **Step 2: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml store::schema`
Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(store): SQLite schema + version migration runner"
```

---

## Task 3: HostStore CRUD (TDD)

**Files:**
- Modify: `src-tauri/src/store/host.rs`

- [ ] **Step 1: Replace `src-tauri/src/store/host.rs`**

```rust
use crate::store::{StoreError, schema};
use parking_lot::Mutex;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    conn: Mutex<Connection>,
}

impl HostStore {
    pub fn open(path: PathBuf) -> Result<Self, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn open_in_memory() -> Result<Self, StoreError> {
        let conn = Connection::open_in_memory()?;
        schema::migrate(&conn)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn open_default_path() -> Result<Self, StoreError> {
        let dir = dirs::config_dir().ok_or(StoreError::NoConfigDir)?.join("power-term");
        Self::open(dir.join("hosts.db"))
    }

    pub fn list(&self) -> Result<Vec<Host>, StoreError> {
        let conn = self.conn.lock();
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

    pub fn create(&self, input: &HostInput) -> Result<Host, StoreError> {
        validate(input)?;
        let conn = self.conn.lock();
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
        let conn = self.conn.lock();
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
        // Re-read to get created_at + last_used_at unchanged.
        let mut stmt = conn.prepare(
            "SELECT id, name, hostname, port, username, group_name, tags_json, \
                    auth_method, key_path, notes, created_at, last_used_at \
             FROM hosts WHERE id=?1",
        )?;
        stmt.query_row(params![id], row_to_host).map_err(StoreError::from)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock();
        let changed = conn.execute("DELETE FROM hosts WHERE id=?1", params![id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }

    pub fn touch(&self, id: &str) -> Result<(), StoreError> {
        let conn = self.conn.lock();
        let now = now_millis();
        let changed = conn.execute("UPDATE hosts SET last_used_at=?1 WHERE id=?2", params![now, id])?;
        if changed == 0 {
            return Err(StoreError::NotFound(id.to_string()));
        }
        Ok(())
    }
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

// Silence path import — used in `Host` defs.
#[allow(dead_code)]
fn _path_ref(_p: &Path) {}

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
        // Personal/zeta, Work/alpha, NULL/beta — NULL group sorted last per "IS NULL"
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
        let mut bad = input("");
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
```

- [ ] **Step 2: Run tests**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml store::host`
Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(store): HostStore CRUD with validation + serde tags"
```

---

## Task 4: Keychain secrets wrapper (TDD)

**Files:**
- Modify: `src-tauri/src/store/secrets.rs`

The macOS Keychain CI story: real Keychain access needs an interactive user session. We provide a `mock-keychain` cargo feature that swaps the real `keyring::Entry` for an in-process `parking_lot::Mutex<HashMap>`. Default features keep real Keychain — production uses real Keychain, tests use the mock.

- [ ] **Step 1: Add the feature to `Cargo.toml`**

Find the `[features]` block (added in MVP Task 1) and replace with:

```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
mock-keychain = []
```

- [ ] **Step 2: Replace `src-tauri/src/store/secrets.rs`**

```rust
use crate::store::SecretError;

const SERVICE: &str = "com.band.power-term";

/// Set the secret for `host_id`. Replaces any prior secret.
pub fn set(host_id: &str, secret: &str) -> Result<(), SecretError> {
    let account = format!("host:{host_id}");
    backend::set(SERVICE, &account, secret)
}

/// Read the secret for `host_id`. Returns `Ok(None)` if not present.
pub fn get(host_id: &str) -> Result<Option<String>, SecretError> {
    let account = format!("host:{host_id}");
    backend::get(SERVICE, &account)
}

/// Delete the secret for `host_id`. Returns Ok(()) even if there was nothing to delete.
pub fn delete(host_id: &str) -> Result<(), SecretError> {
    let account = format!("host:{host_id}");
    backend::delete(SERVICE, &account)
}

#[cfg(not(feature = "mock-keychain"))]
mod backend {
    use super::SecretError;
    use keyring::Entry;

    pub fn set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        entry.set_password(secret).map_err(|e| SecretError::Keyring(e.to_string()))
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }

    pub fn delete(service: &str, account: &str) -> Result<(), SecretError> {
        let entry = Entry::new(service, account).map_err(|e| SecretError::Keyring(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Keyring(e.to_string())),
        }
    }
}

#[cfg(feature = "mock-keychain")]
mod backend {
    use super::SecretError;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::OnceLock;

    fn store() -> &'static Mutex<HashMap<String, String>> {
        static S: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
        S.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn key(service: &str, account: &str) -> String {
        format!("{service}|{account}")
    }

    pub fn set(service: &str, account: &str, secret: &str) -> Result<(), SecretError> {
        store().lock().insert(key(service, account), secret.to_string());
        Ok(())
    }

    pub fn get(service: &str, account: &str) -> Result<Option<String>, SecretError> {
        Ok(store().lock().get(&key(service, account)).cloned())
    }

    pub fn delete(service: &str, account: &str) -> Result<(), SecretError> {
        store().lock().remove(&key(service, account));
        Ok(())
    }
}

#[cfg(test)]
#[cfg(feature = "mock-keychain")]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        // Use a unique host_id to avoid cross-test bleed.
        let id = format!("test-{}", uuid::Uuid::new_v4());
        assert_eq!(get(&id).unwrap(), None);
        set(&id, "s3cret").unwrap();
        assert_eq!(get(&id).unwrap(), Some("s3cret".to_string()));
        delete(&id).unwrap();
        assert_eq!(get(&id).unwrap(), None);
    }

    #[test]
    fn set_overwrites() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        set(&id, "first").unwrap();
        set(&id, "second").unwrap();
        assert_eq!(get(&id).unwrap(), Some("second".to_string()));
        delete(&id).unwrap();
    }

    #[test]
    fn delete_missing_is_ok() {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        delete(&id).unwrap();
    }
}
```

- [ ] **Step 3: Run tests with the mock feature flag**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --features mock-keychain store::secrets`
Expected: 3 tests pass.

- [ ] **Step 4: Verify the default (real keychain) build still compiles**

Run: `~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml`
Expected: clean.

Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(store): macOS Keychain wrapper with mock-keychain test feature"
```

---

## Task 5: Tauri commands hosts_* + secret_*

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Append host + secret commands to `src-tauri/src/commands.rs`**

```rust
use crate::store::{self, Host, HostInput, HostStore};

#[tauri::command]
pub fn hosts_list(store: tauri::State<'_, HostStore>) -> Result<Vec<Host>, String> {
    store.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hosts_create(
    store: tauri::State<'_, HostStore>,
    input: HostInput,
) -> Result<Host, String> {
    store.create(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hosts_update(
    store: tauri::State<'_, HostStore>,
    id: String,
    input: HostInput,
) -> Result<Host, String> {
    store.update(&id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hosts_delete(
    store: tauri::State<'_, HostStore>,
    id: String,
) -> Result<(), String> {
    store.delete(&id).map_err(|e| e.to_string())?;
    // Best-effort: also clear any saved secret so we don't leak Keychain entries.
    if let Err(e) = store::secrets::delete(&id) {
        tracing::warn!(host_id = %id, error = ?e, "failed to delete secret on host delete");
    }
    Ok(())
}

#[tauri::command]
pub fn hosts_touch(
    store: tauri::State<'_, HostStore>,
    id: String,
) -> Result<(), String> {
    store.touch(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(host_id: String, secret: String) -> Result<(), String> {
    store::secrets::set(&host_id, &secret).map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn secret_get(host_id: String) -> Result<Option<String>, String> {
    store::secrets::get(&host_id).map_err(|e| format!("{e:?}"))
}

#[tauri::command]
pub fn secret_delete(host_id: String) -> Result<(), String> {
    store::secrets::delete(&host_id).map_err(|e| format!("{e:?}"))
}
```

- [ ] **Step 2: Wire HostStore + new commands in `src-tauri/src/main.rs`** (replace):

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::ssh::SshManager;
use power_term::store::HostStore;

fn main() {
    tracing_subscriber::fmt::init();

    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");
    let host_store = HostStore::open_default_path()
        .expect("failed to initialize host store");

    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(settings)
        .manage(host_store)
        .invoke_handler(tauri::generate_handler![
            power_term::commands::pty_spawn,
            power_term::commands::pty_write,
            power_term::commands::pty_resize,
            power_term::commands::pty_kill,
            power_term::commands::settings_get,
            power_term::commands::settings_update,
            power_term::commands::ssh_connect,
            power_term::commands::ssh_write,
            power_term::commands::ssh_resize,
            power_term::commands::ssh_kill,
            power_term::commands::known_hosts_get,
            power_term::commands::hosts_list,
            power_term::commands::hosts_create,
            power_term::commands::hosts_update,
            power_term::commands::hosts_delete,
            power_term::commands::hosts_touch,
            power_term::commands::secret_set,
            power_term::commands::secret_get,
            power_term::commands::secret_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Build + clippy**

Run: `~/.cargo/bin/cargo check --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml`
Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: both clean.

- [ ] **Step 4: All existing lib tests still pass**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --lib`
Expected: previous 24 tests + 6 schema + 8 host = 38 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add -A
git -C /Users/band/Projects/band/power-term commit -m "feat(commands): wire hosts_* + secret_* Tauri commands"
```

---

## Task 6: Frontend types + hostStore Zustand (TDD)

**Files:**
- Modify: `src/types.ts`
- Create: `src/state/hostStore.ts`
- Create: `src/state/hostStore.test.ts`

- [ ] **Step 1: Append host types to `src/types.ts`** — keep all existing exports, add at the end:

```typescript
export type AuthMethodKind = 'agent' | 'key' | 'password';

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  group_name: string | null;
  tags: string[];
  auth_method: AuthMethodKind;
  key_path: string | null;
  notes: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface HostInput {
  name: string;
  hostname: string;
  port: number;
  username: string;
  group_name: string | null;
  tags: string[];
  auth_method: AuthMethodKind;
  key_path: string | null;
  notes: string | null;
}
```

- [ ] **Step 2: Write `src/state/hostStore.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ipc', () => ({
  hostsList: vi.fn(),
  hostsCreate: vi.fn(),
  hostsUpdate: vi.fn(),
  hostsDelete: vi.fn(),
  hostsTouch: vi.fn(),
}));

import { hostsList, hostsCreate, hostsUpdate, hostsDelete, hostsTouch } from '../lib/ipc';
import { useHostStore } from './hostStore';
import type { Host, HostInput } from '../types';

const sample = (overrides: Partial<Host> = {}): Host => ({
  id: 'h1',
  name: 'mac',
  hostname: 'example.com',
  port: 22,
  username: 'alice',
  group_name: 'Personal',
  tags: ['prod'],
  auth_method: 'agent',
  key_path: null,
  notes: null,
  created_at: 1000,
  last_used_at: null,
  ...overrides,
});

const sampleInput = (): HostInput => ({
  name: 'mac', hostname: 'example.com', port: 22, username: 'alice',
  group_name: 'Personal', tags: ['prod'], auth_method: 'agent',
  key_path: null, notes: null,
});

beforeEach(() => {
  useHostStore.setState({ hosts: [], loading: false, error: null });
  vi.clearAllMocks();
});

describe('hostStore', () => {
  it('load() fills hosts from ipc', async () => {
    (hostsList as any).mockResolvedValue([sample({ id: 'a' }), sample({ id: 'b', name: 'home' })]);
    await useHostStore.getState().load();
    expect(useHostStore.getState().hosts.map(h => h.id)).toEqual(['a', 'b']);
  });

  it('create() prepends to hosts and clears error', async () => {
    (hostsCreate as any).mockResolvedValue(sample({ id: 'new' }));
    useHostStore.setState({ hosts: [sample({ id: 'old' })] });
    await useHostStore.getState().create(sampleInput());
    const ids = useHostStore.getState().hosts.map(h => h.id);
    expect(ids).toContain('new');
    expect(ids).toContain('old');
  });

  it('update() replaces in place by id', async () => {
    (hostsUpdate as any).mockResolvedValue(sample({ id: 'a', name: 'changed' }));
    useHostStore.setState({ hosts: [sample({ id: 'a' })] });
    await useHostStore.getState().update('a', sampleInput());
    expect(useHostStore.getState().hosts[0].name).toBe('changed');
  });

  it('delete() removes from hosts', async () => {
    (hostsDelete as any).mockResolvedValue(undefined);
    useHostStore.setState({ hosts: [sample({ id: 'a' }), sample({ id: 'b' })] });
    await useHostStore.getState().delete('a');
    expect(useHostStore.getState().hosts.map(h => h.id)).toEqual(['b']);
  });

  it('touch() updates last_used_at locally optimistically', async () => {
    (hostsTouch as any).mockResolvedValue(undefined);
    useHostStore.setState({ hosts: [sample({ id: 'a', last_used_at: null })] });
    await useHostStore.getState().touch('a');
    const last = useHostStore.getState().hosts[0].last_used_at;
    expect(last).not.toBeNull();
  });

  it('load() captures error on failure', async () => {
    (hostsList as any).mockRejectedValue(new Error('boom'));
    await useHostStore.getState().load();
    expect(useHostStore.getState().error).toMatch(/boom/);
  });
});
```

- [ ] **Step 3: Run, expect FAIL (module missing)**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/state/hostStore.test.ts`
Expected: FAIL.

- [ ] **Step 4: Write `src/state/hostStore.ts`**

```typescript
import { create } from 'zustand';
import { hostsCreate, hostsDelete, hostsList, hostsTouch, hostsUpdate } from '../lib/ipc';
import type { Host, HostInput } from '../types';

interface State {
  hosts: Host[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: HostInput) => Promise<Host | null>;
  update: (id: string, input: HostInput) => Promise<Host | null>;
  delete: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useHostStore = create<State>((set, get) => ({
  hosts: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const hosts = await hostsList();
      set({ hosts, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  create: async (input) => {
    try {
      const h = await hostsCreate(input);
      set((s) => ({ hosts: [h, ...s.hosts], error: null }));
      return h;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const h = await hostsUpdate(id, input);
      set((s) => ({ hosts: s.hosts.map((x) => (x.id === id ? h : x)), error: null }));
      return h;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await hostsDelete(id);
      set((s) => ({ hosts: s.hosts.filter((x) => x.id !== id), error: null }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
  touch: async (id) => {
    try {
      await hostsTouch(id);
      set((s) => ({
        hosts: s.hosts.map((x) => (x.id === id ? { ...x, last_used_at: Date.now() } : x)),
      }));
    } catch (e) {
      // Touch errors are non-fatal: keep state, log only.
      console.warn('hosts_touch failed', e);
    }
    void get; // satisfy linter for unused get
  },
}));
```

- [ ] **Step 5: Run, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/state/hostStore.test.ts`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/types.ts src/state/
git -C /Users/band/Projects/band/power-term commit -m "feat(state): hostStore Zustand for saved hosts"
```

---

## Task 7: Frontend IPC additions (hosts + secrets)

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Append to `src/lib/ipc.ts`** (existing imports of `invoke` already present at top):

```typescript
import type { Host, HostInput } from '../types';

export async function hostsList(): Promise<Host[]> {
  return invoke<Host[]>('hosts_list');
}

export async function hostsCreate(input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_create', { input });
}

export async function hostsUpdate(id: string, input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_update', { id, input });
}

export async function hostsDelete(id: string): Promise<void> {
  await invoke('hosts_delete', { id });
}

export async function hostsTouch(id: string): Promise<void> {
  await invoke('hosts_touch', { id });
}

export async function secretSet(hostId: string, secret: string): Promise<void> {
  await invoke('secret_set', { hostId, secret });
}

export async function secretGet(hostId: string): Promise<string | null> {
  return invoke<string | null>('secret_get', { hostId });
}

export async function secretDelete(hostId: string): Promise<void> {
  await invoke('secret_delete', { hostId });
}
```

(If your existing `ipc.ts` already imports `Host`/`HostInput` types via a unified import block at the top, fold the new line in there instead of re-importing.)

- [ ] **Step 2: tsc**

Run: `npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Re-run all frontend tests**

Run: `npm --prefix /Users/band/Projects/band/power-term test`
Expected: previous 29 + 6 new hostStore = 35 tests pass.

- [ ] **Step 4: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/lib/
git -C /Users/band/Projects/band/power-term commit -m "feat(ipc): host + secret command wrappers"
```

---

## Task 8: HostFormModal (TDD)

**Files:**
- Create: `src/components/HostFormModal.tsx`
- Create: `src/components/HostFormModal.test.tsx`

- [ ] **Step 1: Write `src/components/HostFormModal.test.tsx`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostFormModal } from './HostFormModal';
import type { Host } from '../types';

const sampleHost = (): Host => ({
  id: 'h1', name: 'mac', hostname: 'example.com', port: 22, username: 'alice',
  group_name: 'Personal', tags: ['prod'], auth_method: 'agent',
  key_path: null, notes: null, created_at: 1000, last_used_at: null,
});

describe('HostFormModal', () => {
  it('renders Add title when no host given', () => {
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/add host/i)).toBeInTheDocument();
  });

  it('renders Edit title with prefilled fields', () => {
    render(<HostFormModal mode="edit" host={sampleHost()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/edit host/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('mac')).toBeInTheDocument();
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument();
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Save with required fields filled invokes onSave with input + secret', async () => {
    const onSave = vi.fn();
    render(<HostFormModal mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'mac');
    await userEvent.type(screen.getByLabelText(/^hostname$/i), 'example.com');
    await userEvent.type(screen.getByLabelText(/^username$/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0];
    expect(arg.input.name).toBe('mac');
    expect(arg.input.hostname).toBe('example.com');
    expect(arg.input.username).toBe('alice');
    expect(arg.input.port).toBe(22);
    expect(arg.input.auth_method).toBe('agent');
  });

  it('Save is disabled when required fields are empty', async () => {
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('switching auth to key shows key_path input and requires it', async () => {
    const onSave = vi.fn();
    render(<HostFormModal mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'x');
    await userEvent.type(screen.getByLabelText(/^hostname$/i), 'h');
    await userEvent.type(screen.getByLabelText(/^username$/i), 'u');
    await userEvent.click(screen.getByLabelText(/private key/i));

    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // key_path empty

    await userEvent.type(screen.getByLabelText(/key path/i), '/Users/u/.ssh/id_ed25519');
    expect(save.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/HostFormModal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `src/components/HostFormModal.tsx`**

```typescript
import { useEffect, useState } from 'react';
import type { AuthMethodKind, Host, HostInput } from '../types';

export interface HostFormSaveArgs {
  input: HostInput;
  /** New secret to save to keychain, if any. */
  secret: string | null;
  /** True if the user toggled save-to-keychain ON. */
  saveSecret: boolean;
  /** True if user explicitly toggled save-to-keychain OFF (delete any existing). */
  forgetSecret: boolean;
}

interface Props {
  mode: 'create' | 'edit';
  host?: Host;
  onSave: (args: HostFormSaveArgs) => void;
  onCancel: () => void;
}

export function HostFormModal({ mode, host, onSave, onCancel }: Props) {
  const [name, setName] = useState(host?.name ?? '');
  const [hostname, setHostname] = useState(host?.hostname ?? '');
  const [port, setPort] = useState<number>(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? '');
  const [groupName, setGroupName] = useState(host?.group_name ?? '');
  const [tagsText, setTagsText] = useState((host?.tags ?? []).join(', '));
  const [authMethod, setAuthMethod] = useState<AuthMethodKind>(host?.auth_method ?? 'agent');
  const [keyPath, setKeyPath] = useState(host?.key_path ?? '');
  const [secret, setSecret] = useState('');
  const [secretDirty, setSecretDirty] = useState(false);
  const [saveSecret, setSaveSecret] = useState(true);
  const [notes, setNotes] = useState(host?.notes ?? '');

  // Reset secret-dirty whenever the auth method flips so we don't carry an old
  // password input across method changes.
  useEffect(() => { setSecret(''); setSecretDirty(false); }, [authMethod]);

  const validatePort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;

  const validForm =
    name.trim() !== '' &&
    hostname.trim() !== '' &&
    username.trim() !== '' &&
    validatePort(port) &&
    (authMethod !== 'key' || keyPath.trim() !== '');

  const submit = () => {
    if (!validForm) return;
    const tags = tagsText
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const dedupedTags = Array.from(new Set(tags));
    const input: HostInput = {
      name: name.trim(),
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      group_name: groupName.trim() === '' ? null : groupName.trim(),
      tags: dedupedTags,
      auth_method: authMethod,
      key_path: authMethod === 'key' ? keyPath.trim() : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    const wantsSecret = (authMethod === 'password' && secret !== '') ||
                        (authMethod === 'key' && secret !== '');
    onSave({
      input,
      secret: wantsSecret ? secret : null,
      saveSecret: wantsSecret && saveSecret,
      forgetSecret: !saveSecret && !wantsSecret && secretDirty,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="host form">
      <div className="modal modal-form">
        <h2>{mode === 'create' ? 'Add host' : 'Edit host'}</h2>
        <div className="form-grid">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Hostname<input value={hostname} onChange={(e) => setHostname(e.target.value)} /></label>
          <label>Port<input type="number" min={1} max={65535} value={port}
            onChange={(e) => setPort(Number(e.target.value))} /></label>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>Group<input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Personal" /></label>
          <label>Tags<input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="prod, db" /></label>
        </div>

        <fieldset className="auth-method">
          <legend>Authentication</legend>
          <label><input type="radio" name="auth" checked={authMethod === 'agent'} onChange={() => setAuthMethod('agent')} /> SSH agent</label>
          <label><input type="radio" name="auth" checked={authMethod === 'key'} onChange={() => setAuthMethod('key')} /> Private key</label>
          <label><input type="radio" name="auth" checked={authMethod === 'password'} onChange={() => setAuthMethod('password')} /> Password</label>
        </fieldset>

        {authMethod === 'key' && (
          <div className="auth-fields">
            <label>Key path
              <input value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="/Users/you/.ssh/id_ed25519" />
            </label>
            <label>Passphrase (optional)
              <input type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={saveSecret} onChange={(e) => setSaveSecret(e.target.checked)} /> Save passphrase to Keychain
            </label>
          </div>
        )}

        {authMethod === 'password' && (
          <div className="auth-fields">
            <label>Password
              <input type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={saveSecret} onChange={(e) => setSaveSecret(e.target.checked)} /> Save password to Keychain
            </label>
          </div>
        )}

        <label>Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!validForm}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/HostFormModal.test.tsx`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/components/
git -C /Users/band/Projects/band/power-term commit -m "feat(ui): HostFormModal with validation + Keychain save toggle"
```

---

## Task 9: ConfirmModal (small)

**Files:**
- Create: `src/components/ConfirmModal.tsx`

- [ ] **Step 1: Create `src/components/ConfirmModal.tsx`**

```typescript
interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmModal({
  title, message, confirmLabel = 'OK', cancelLabel = 'Cancel',
  onConfirm, onCancel, destructive,
}: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-label={title}>
      <div className={`modal ${destructive ? 'modal-warning' : ''}`}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/components/
git -C /Users/band/Projects/band/power-term commit -m "feat(ui): generic ConfirmModal"
```

---

## Task 10: Sidebar component (TDD)

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/Sidebar.test.tsx`

- [ ] **Step 1: Write `src/components/Sidebar.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';

const h = (over: Partial<Host>): Host => ({
  id: 'a', name: 'aname', hostname: 'h', port: 22, username: 'u',
  group_name: null, tags: [], auth_method: 'agent', key_path: null,
  notes: null, created_at: 1, last_used_at: null, ...over,
});

beforeEach(() => {
  useHostStore.setState({ hosts: [], loading: false, error: null });
});

describe('Sidebar', () => {
  it('renders a "+ New Host" button and the Cmd+K hint', () => {
    render(<Sidebar onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new host/i })).toBeInTheDocument();
    expect(screen.getByText(/cmd\+k/i)).toBeInTheDocument();
  });

  it('groups hosts by group_name with synthetic Ungrouped', () => {
    useHostStore.setState({
      hosts: [
        h({ id: 'p1', name: 'mac', group_name: 'Personal' }),
        h({ id: 'p2', name: 'home', group_name: 'Personal' }),
        h({ id: 'w1', name: 'bastion', group_name: 'Work' }),
        h({ id: 'u1', name: 'temp', group_name: null }),
      ],
    });
    render(<Sidebar onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    expect(screen.getByText('mac')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('bastion')).toBeInTheDocument();
    expect(screen.getByText('temp')).toBeInTheDocument();
  });

  it('clicking a host row calls onConnect with that host', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac' })] });
    const onConnect = vi.fn();
    render(<Sidebar onConnect={onConnect} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText('mac'));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0].id).toBe('a');
  });

  it('clicking "+ New Host" calls onAdd', async () => {
    const onAdd = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /new host/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('clicking the row delete (×) calls onDelete', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac' })] });
    const onDelete = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByLabelText(/delete host mac/i));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe('a');
  });

  it('group header click toggles expansion', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac', group_name: 'Personal' })] });
    render(<Sidebar onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('mac')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Personal'));
    expect(screen.queryByText('mac')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Personal'));
    expect(screen.getByText('mac')).toBeInTheDocument();
  });

  it('shows empty-state hint when hosts are empty', () => {
    render(<Sidebar onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no saved hosts/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/Sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `src/components/Sidebar.tsx`**

```typescript
import { useMemo, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';

interface Props {
  onConnect: (host: Host) => void;
  onAdd: () => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
}

interface Group {
  name: string;
  rawKey: string | null; // original group_name (null = ungrouped)
  hosts: Host[];
}

const UNGROUPED = 'Ungrouped';

export function Sidebar({ onConnect, onAdd, onEdit, onDelete }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const error = useHostStore((s) => s.error);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const h of hosts) {
      const key = h.group_name ?? UNGROUPED;
      if (!map.has(key)) {
        map.set(key, { name: key, rawKey: h.group_name, hosts: [] });
      }
      map.get(key)!.hosts.push(h);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.rawKey === null) return 1;
      if (b.rawKey === null) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [hosts]);

  const toggle = (name: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <aside className="sidebar" aria-label="hosts sidebar">
      <div className="sidebar-actions">
        <button type="button" className="primary" onClick={onAdd}>+ New Host</button>
      </div>
      {error && <p className="sidebar-error">{error}</p>}
      <div className="sidebar-list">
        {hosts.length === 0 && (
          <p className="sidebar-empty">No saved hosts. Click <strong>+ New Host</strong> or use Cmd+K to connect ad-hoc.</p>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.name);
          return (
            <div key={g.name} className="sidebar-group">
              <button type="button" className="sidebar-group-header" onClick={() => toggle(g.name)}>
                <span className="sidebar-caret">{isCollapsed ? '▸' : '▾'}</span> {g.name}
              </button>
              {!isCollapsed && (
                <ul className="sidebar-hosts">
                  {g.hosts.map((h) => (
                    <li key={h.id} className="sidebar-host">
                      <button type="button" className="sidebar-host-name" onClick={() => onConnect(h)}>
                        {h.name}
                      </button>
                      <span className="sidebar-host-actions">
                        <button type="button" aria-label={`edit host ${h.name}`} onClick={() => onEdit(h)}>✎</button>
                        <button type="button" aria-label={`delete host ${h.name}`} onClick={() => onDelete(h)}>×</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="sidebar-hint">Tip: Cmd+K opens the command palette.</p>
    </aside>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/components/Sidebar.test.tsx`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/components/
git -C /Users/band/Projects/band/power-term commit -m "feat(ui): Sidebar with group tree + row click + edit/× actions"
```

---

## Task 11: useSidebarToggle hook (TDD)

**Files:**
- Create: `src/hooks/useSidebarToggle.ts`
- Create: `src/hooks/useSidebarToggle.test.ts`

- [ ] **Step 1: Write the failing test `src/hooks/useSidebarToggle.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarToggle } from './useSidebarToggle';

function dispatchCmdB() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true }));
}

describe('useSidebarToggle', () => {
  it('starts open by default', () => {
    const { result } = renderHook(() => useSidebarToggle());
    expect(result.current.open).toBe(true);
  });

  it('Cmd+B toggles open <-> closed', () => {
    const { result } = renderHook(() => useSidebarToggle());
    act(() => dispatchCmdB());
    expect(result.current.open).toBe(false);
    act(() => dispatchCmdB());
    expect(result.current.open).toBe(true);
  });

  it('imperative setOpen works', () => {
    const { result } = renderHook(() => useSidebarToggle());
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/hooks/useSidebarToggle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/hooks/useSidebarToggle.ts`**

```typescript
import { useEffect, useState } from 'react';

export interface SidebarToggle {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export function useSidebarToggle(initialOpen: boolean = true): SidebarToggle {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return { open, setOpen, toggle: () => setOpen((v) => !v) };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npm --prefix /Users/band/Projects/band/power-term test -- src/hooks/useSidebarToggle.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/hooks/
git -C /Users/band/Projects/band/power-term commit -m "feat(hooks): useSidebarToggle (Cmd+B)"
```

---

## Task 12: App wiring — Sidebar + modals + connect-from-host

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Terminal.tsx` (no change here — kind dispatch already handles ssh)

The App flow:

1. On mount, `useHostStore.load()` populates the sidebar.
2. Sidebar mounted left of `<main>`, conditionally rendered by `useSidebarToggle().open`.
3. `+ New Host` opens `HostFormModal` (mode `create`).
4. `✎` opens it in `edit` mode with that host.
5. `×` opens `ConfirmModal`; OK calls `useHostStore.delete(id)`.
6. Saving the form: call `hostStore.create` or `update`, then if `secret != null && saveSecret` call `secretSet`; if `forgetSecret` call `secretDelete`.
7. Sidebar row click → `connectFromHost(host)`:
   - For agent: build `AuthRequest { kind: 'agent' }` directly.
   - For key: try `secretGet(host.id)` for passphrase; build `{ kind: 'key', path: host.key_path!, passphrase }`.
   - For password: `secretGet(host.id)`; if value present, build `{ kind: 'password', password }`. If missing, drop into the existing `AuthPrompt` flow with `kind: 'password'` pre-selected.
   - Call `driveSshConnect(target, auth, null)`. After `Connected`, call `hostStore.touch(host.id)`. Tab title is `host.name` (override the existing `${user}@${host}`).

- [ ] **Step 1: Replace `src/App.tsx`**

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { Sidebar } from './components/Sidebar';
import { HostFormModal, type HostFormSaveArgs } from './components/HostFormModal';
import { ConfirmModal } from './components/ConfirmModal';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHostStore } from './state/hostStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { useSidebarToggle } from './hooks/useSidebarToggle';
import { ptyKill, ptySpawn, secretDelete, secretGet, secretSet, sshConnect, sshKill } from './lib/ipc';
import type { AuthRequest, Host, SshTarget } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type SshFlow =
  | { phase: 'idle' }
  | { phase: 'connecting'; target: SshTarget; auth: AuthRequest; acceptFp: string | null; titleOverride?: string; touchHostId?: string }
  | { phase: 'fingerprint'; target: SshTarget; auth: AuthRequest; fingerprint: string; keyType: string; mismatch?: { expected: string }; titleOverride?: string; touchHostId?: string }
  | { phase: 'auth'; target: SshTarget; tried: string[]; available: string[]; error?: string; titleOverride?: string; touchHostId?: string };

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; host: Host };

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);

  const loadHosts = useHostStore((s) => s.load);
  const createHost = useHostStore((s) => s.create);
  const updateHost = useHostStore((s) => s.update);
  const deleteHost = useHostStore((s) => s.delete);
  const touchHost = useHostStore((s) => s.touch);

  const sidebar = useSidebarToggle();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshFlow, setSshFlow] = useState<SshFlow>({ phase: 'idle' });
  const [form, setForm] = useState<FormMode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Host | null>(null);
  const flowToken = useRef(0);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadHosts(); }, [loadHosts]);

  const newLocalTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultLocalTitle(settings?.shell ?? null), 'local');
    } catch (e) {
      console.error('pty_spawn failed', e);
    }
  }, [addTab, settings?.shell]);

  const handleClose = useCallback(async (id: string) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    try {
      if (tab.kind === 'ssh') await sshKill(tab.ptyId);
      else await ptyKill(tab.ptyId);
    } catch (e) { console.warn('kill failed', e); }
    closeTab(id);
    if (useSessionStore.getState().tabs.length === 0) {
      void getCurrentWindow().close();
    }
  }, [closeTab]);

  const driveSshConnect = useCallback(async (
    target: SshTarget,
    auth: AuthRequest,
    acceptFp: string | null,
    titleOverride?: string,
    touchHostId?: string,
  ) => {
    const myToken = ++flowToken.current;
    setSshFlow({ phase: 'connecting', target, auth, acceptFp, titleOverride, touchHostId });
    try {
      const result = await sshConnect({ target, auth, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, acceptFingerprint: acceptFp });
      if (myToken !== flowToken.current) return;
      if (result.status === 'connected') {
        addTab(result.id, titleOverride ?? `${target.user}@${target.host}`, 'ssh');
        if (touchHostId) void touchHost(touchHostId);
        setSshFlow({ phase: 'idle' });
      } else if (result.status === 'needs_fingerprint') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: result.key_type, titleOverride, touchHostId });
      } else if (result.status === 'fingerprint_mismatch') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: 'unknown', mismatch: { expected: result.expected }, titleOverride, touchHostId });
      } else if (result.status === 'needs_auth') {
        setSshFlow({ phase: 'auth', target, tried: result.tried, available: result.available, titleOverride, touchHostId });
      }
    } catch (e) {
      if (myToken !== flowToken.current) return;
      console.error('ssh_connect failed', e);
      setSshFlow({ phase: 'auth', target, tried: [], available: ['agent', 'publickey', 'password'], error: String(e), titleOverride, touchHostId });
    }
  }, [addTab, touchHost]);

  const onPaletteSshConnect = useCallback((target: SshTarget) => {
    setPaletteOpen(false);
    void driveSshConnect(target, { kind: 'agent' }, null);
  }, [driveSshConnect]);

  // Connect from a sidebar row click.
  const connectFromHost = useCallback(async (host: Host) => {
    const target: SshTarget = { user: host.username, host: host.hostname, port: host.port };
    let auth: AuthRequest;
    if (host.auth_method === 'agent') {
      auth = { kind: 'agent' };
    } else if (host.auth_method === 'key') {
      const passphrase = (await secretGet(host.id).catch(() => null)) ?? undefined;
      auth = { kind: 'key', path: host.key_path ?? '', passphrase };
    } else {
      const password = await secretGet(host.id).catch(() => null);
      if (password === null) {
        // Drop into AuthPrompt with password pre-selected.
        setSshFlow({
          phase: 'auth',
          target,
          tried: [],
          available: ['password'],
          titleOverride: host.name,
          touchHostId: host.id,
        });
        return;
      }
      auth = { kind: 'password', password };
    }
    await driveSshConnect(target, auth, null, host.name, host.id);
  }, [driveSshConnect]);

  // Save HostFormModal (create or edit) — also persists secrets if requested.
  const handleFormSave = useCallback(async (args: HostFormSaveArgs) => {
    const targetId = form.kind === 'edit' ? form.host.id : null;
    const saved = targetId
      ? await updateHost(targetId, args.input)
      : await createHost(args.input);
    if (!saved) return; // error already in store
    if (args.saveSecret && args.secret) {
      try { await secretSet(saved.id, args.secret); }
      catch (e) { console.warn('secret_set failed', e); }
    } else if (args.forgetSecret) {
      try { await secretDelete(saved.id); }
      catch (e) { console.warn('secret_delete failed', e); }
    }
    setForm({ kind: 'closed' });
  }, [form, updateHost, createHost]);

  const handleDelete = useCallback(async (host: Host) => {
    await deleteHost(host.id);
    setConfirmDelete(null);
  }, [deleteHost]);

  useHotkeys({ onNewTab: () => void newLocalTab(), onCloseTab: (id) => void handleClose(id) });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        if (sshFlow.phase !== 'idle' || form.kind !== 'closed' || confirmDelete) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sshFlow.phase, form.kind, confirmDelete]);

  const openedFirstTab = useRef(false);
  useEffect(() => {
    if (settings && tabs.length === 0 && !openedFirstTab.current) {
      openedFirstTab.current = true;
      void newLocalTab();
    }
  }, [settings, tabs.length, newLocalTab]);

  const theme = useTheme();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const visibleId = useMemo(() => activeTabId, [activeTabId]);

  return (
    <div className={`app theme-${theme}`}>
      <TitleBar>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <div className="body">
        {sidebar.open && (
          <Sidebar
            onConnect={(h) => void connectFromHost(h)}
            onAdd={() => setForm({ kind: 'create' })}
            onEdit={(h) => setForm({ kind: 'edit', host: h })}
            onDelete={(h) => setConfirmDelete(h)}
          />
        )}
        <main className="terminals">
          {tabs.map((t) => (
            <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
          ))}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSshConnect={onPaletteSshConnect} />
      {sshFlow.phase === 'fingerprint' && (
        <HostFingerprintPrompt
          host={sshFlow.target.host}
          fingerprint={sshFlow.fingerprint}
          keyType={sshFlow.keyType}
          isMismatch={!!sshFlow.mismatch}
          expected={sshFlow.mismatch?.expected}
          onAccept={() => driveSshConnect(sshFlow.target, sshFlow.auth, sshFlow.fingerprint, sshFlow.titleOverride, sshFlow.touchHostId)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
      {sshFlow.phase === 'auth' && (
        <AuthPrompt
          user={sshFlow.target.user}
          host={sshFlow.target.host}
          triedAgent={sshFlow.tried.includes('agent')}
          errorMessage={sshFlow.error}
          onSubmit={(auth) => driveSshConnect(sshFlow.target, auth, null, sshFlow.titleOverride, sshFlow.touchHostId)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
      {form.kind !== 'closed' && (
        <HostFormModal
          mode={form.kind === 'edit' ? 'edit' : 'create'}
          host={form.kind === 'edit' ? form.host : undefined}
          onSave={(args) => void handleFormSave(args)}
          onCancel={() => setForm({ kind: 'closed' })}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete host?"
          message={`Remove "${confirmDelete.name}" from saved hosts? Any saved password / passphrase will also be removed from the Keychain.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function defaultLocalTitle(shell: string | null): string {
  if (!shell) return 'shell';
  const base = shell.split('/').pop() ?? 'shell';
  return base;
}
```

- [ ] **Step 2: Append sidebar + form CSS to `src/styles.css`**

```css
.body { flex: 1; display: flex; min-height: 0; }
.sidebar {
  width: 240px; flex: 0 0 240px;
  display: flex; flex-direction: column;
  background: var(--tab-bg); border-right: 1px solid var(--border);
  user-select: none;
}
.sidebar-actions { padding: 8px; }
.sidebar-actions button.primary {
  width: 100%; padding: 6px 10px; border: 0; border-radius: 6px;
  background: #2563eb; color: white; cursor: pointer; font: inherit; font-size: 13px;
}
.sidebar-error { color: #dc2626; padding: 0 10px; font-size: 12px; }
.sidebar-list { flex: 1; overflow: auto; padding: 0 4px; }
.sidebar-empty { padding: 12px; font-size: 12px; opacity: 0.7; }
.sidebar-group-header {
  width: 100%; text-align: left; padding: 4px 8px; font-size: 12px; font-weight: 600;
  background: transparent; border: 0; color: var(--fg); cursor: pointer;
}
.sidebar-caret { display: inline-block; width: 12px; opacity: 0.6; }
.sidebar-hosts { list-style: none; margin: 0; padding: 0; }
.sidebar-host {
  display: flex; align-items: center; padding: 0 8px; border-radius: 4px;
}
.sidebar-host:hover { background: var(--tab-active); }
.sidebar-host-name {
  flex: 1; text-align: left; padding: 4px 8px; background: transparent; border: 0;
  color: var(--fg); cursor: pointer; font: inherit; font-size: 13px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sidebar-host-actions { display: none; gap: 2px; }
.sidebar-host:hover .sidebar-host-actions { display: flex; }
.sidebar-host-actions button {
  background: transparent; border: 0; cursor: pointer; padding: 2px 4px;
  color: var(--fg); opacity: 0.6;
}
.sidebar-host-actions button:hover { opacity: 1; }
.sidebar-hint { padding: 8px; font-size: 11px; opacity: 0.5; border-top: 1px solid var(--border); }

.modal.modal-form { width: 520px; }
.modal .form-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 0 0 12px 0;
}
.modal .form-grid label, .modal-form label, .modal-form fieldset.auth-method {
  display: flex; flex-direction: column; gap: 2px; font-size: 12px;
}
.modal-form label.checkbox { flex-direction: row; align-items: center; gap: 6px; font-size: 12px; }
.modal .form-grid input, .modal-form textarea, .modal-form input, .modal-form .auth-fields input {
  padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg); color: var(--fg); font: inherit; font-size: 13px;
}
.modal-actions button.danger { background: #dc2626; color: white; border-color: #dc2626; }
```

- [ ] **Step 3: tsc + tests**

Run: `npx tsc -p /Users/band/Projects/band/power-term/tsconfig.json --noEmit`
Expected: clean.

Run: `npm --prefix /Users/band/Projects/band/power-term test`
Expected: 35 + 6 (HostFormModal) + 7 (Sidebar) + 3 (useSidebarToggle) = 51 tests pass.

- [ ] **Step 4: Production frontend build**

Run: `npm --prefix /Users/band/Projects/band/power-term run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git -C /Users/band/Projects/band/power-term add src/
git -C /Users/band/Projects/band/power-term commit -m "feat(app): mount Sidebar + HostFormModal + ConfirmModal + connect-from-host"
```

---

## Task 13: Production tauri:build smoke

**Files:** none (verification)

- [ ] **Step 1: Build with PATH set so cargo is found**

Run: `PATH="$HOME/.cargo/bin:$PATH" npm --prefix /Users/band/Projects/band/power-term run tauri:build`
Expected: produces `src-tauri/target/release/bundle/macos/power-term.app` and a `.dmg` under `bundle/dmg/`.

- [ ] **Step 2: All Rust tests still pass under both feature sets**

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --lib`
Expected: 24 (existing) + 6 (schema) + 8 (host) = 38 pass; secrets module tests skipped (require `mock-keychain` feature).

Run: `~/.cargo/bin/cargo test --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --features mock-keychain --lib`
Expected: 41 pass (same set + 3 secrets tests).

- [ ] **Step 3: clippy clean both ways**

Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --all-targets -- -D warnings`
Run: `~/.cargo/bin/cargo clippy --manifest-path /Users/band/Projects/band/power-term/src-tauri/Cargo.toml --features mock-keychain --all-targets -- -D warnings`
Expected: both clean.

- [ ] **Step 4: Manual smoke checklist** (record results, do not commit)

- [ ] App launches; sidebar visible on the left with empty-state hint
- [ ] `Cmd+B` toggles sidebar; toggling does not affect terminal sessions
- [ ] Click `+ New Host` → modal → fill fields → Save → sidebar shows new row in correct group
- [ ] Click row → connects via stored auth method (agent in the simplest case)
- [ ] Edit → modal pre-fills → change name → Save → sidebar reflects change
- [ ] Delete → confirm modal → host removed; if password was saved, Keychain Access shows the entry is gone
- [ ] Restart app: hosts persist, sidebar repopulates from SQLite
- [ ] Save a host with password + "Save to Keychain"; click row → connects without prompt; toggle off save-to-Keychain in edit form → reconnect → AuthPrompt appears
- [ ] Cmd+K still works while sidebar is open

- [ ] **Step 5: Empty smoke commit**

```bash
git -C /Users/band/Projects/band/power-term commit --allow-empty -m "chore(host-store): #2B smoke passes on macOS"
```

If a checklist item fails, file a follow-up task and **do not** mark this step complete.

---

## Definition of Done

- 38 lib tests (default) + 41 lib tests (mock-keychain feature) pass.
- 51 frontend vitest tests pass.
- `cargo clippy --all-targets -- -D warnings` clean under both feature sets.
- `tsc --noEmit` clean.
- `npm run tauri:build` produces a .app and .dmg.
- All in-scope features in spec §5–§10 work in the manual smoke run.
- Hosts persist across app restarts; Keychain entries are deleted on host delete.
