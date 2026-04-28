use rusqlite::{Connection, Result};

pub const CURRENT_VERSION: u32 = 2;

pub fn migrate(conn: &Connection) -> Result<()> {
    let mut version: u32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > CURRENT_VERSION {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
            Some(format!(
                "database schema version {version} is newer than this build's {CURRENT_VERSION}; \
                 install a newer power-term or restore an older hosts.db"
            )),
        ));
    }
    while version < CURRENT_VERSION {
        match version {
            0 => migration_v1(conn)?,
            1 => migration_v2(conn)?,
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

fn migration_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE snippets (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            tags_json TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER
        );
        CREATE INDEX snippets_name_idx ON snippets(name);
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
    fn migrate_creates_both_tables_and_bumps_version() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);

        let hosts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='hosts'",
                [], |r| r.get(0),
            ).unwrap();
        let snippets_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='snippets'",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(hosts_count, 1);
        assert_eq!(snippets_count, 1);
    }

    #[test]
    fn migrate_v1_to_v2_only_creates_snippets() {
        let conn = open_in_memory();
        // Pretend a previous build wrote schema v1 (just hosts).
        conn.execute_batch(
            r#"
            CREATE TABLE hosts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
              hostname TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22,
              username TEXT NOT NULL, group_name TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
              auth_method TEXT NOT NULL, key_path TEXT, notes TEXT,
              created_at INTEGER NOT NULL, last_used_at INTEGER);
            "#,
        ).unwrap();
        conn.pragma_update(None, "user_version", 1u32).unwrap();

        migrate(&conn).unwrap();

        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 2);

        let snippets_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='snippets'",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(snippets_count, 1);
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
    }

    #[test]
    fn migrate_rejects_future_version() {
        let conn = open_in_memory();
        conn.pragma_update(None, "user_version", CURRENT_VERSION + 1).unwrap();
        let err = migrate(&conn).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("newer than this build"), "expected version-too-new error, got: {msg}");
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
