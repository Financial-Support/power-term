use rusqlite::{Connection, Result};

pub const CURRENT_VERSION: u32 = 1;

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
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
    }

    #[test]
    fn migrate_rejects_future_version() {
        let conn = open_in_memory();
        conn.pragma_update(None, "user_version", CURRENT_VERSION + 1).unwrap();
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
