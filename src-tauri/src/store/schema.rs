use rusqlite::{Connection, Result};

pub const CURRENT_VERSION: u32 = 7;

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
            2 => migration_v3(conn)?,
            3 => migration_v4(conn)?,
            4 => migration_v5(conn)?,
            5 => migration_v6(conn)?,
            6 => migration_v7(conn)?,
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

fn migration_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE forwards (
            id TEXT PRIMARY KEY NOT NULL,
            host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('local', 'remote')),
            bind_addr TEXT NOT NULL DEFAULT '127.0.0.1',
            bind_port INTEGER NOT NULL CHECK (bind_port BETWEEN 1 AND 65535),
            remote_host TEXT NOT NULL,
            remote_port INTEGER NOT NULL CHECK (remote_port BETWEEN 1 AND 65535),
            auto_start INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX forwards_host_id_idx ON forwards(host_id);
        "#,
    )?;
    Ok(())
}

fn migration_v4(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        ALTER TABLE hosts    ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE snippets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE forwards ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
        "#,
    )?;
    Ok(())
}

fn migration_v5(conn: &Connection) -> Result<()> {
    // Side table for tag → color metadata. Tag membership lives on
    // hosts.tags_json (free-form strings); this only stores the chosen
    // color for each known tag name. Missing rows fall back to a
    // deterministic default color computed in the UI.
    conn.execute_batch(
        r#"
        CREATE TABLE tag_colors (
            name  TEXT PRIMARY KEY NOT NULL,
            color TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

fn migration_v7(conn: &Connection) -> Result<()> {
    // SSH key registry — a side table users curate from the Settings →
    // Keys tab. Each row binds a friendly label to an absolute private
    // key path; HostFormModal picks the path from this list instead of
    // forcing every host to remember its own. `path` is unique so the
    // same key file can't be registered twice under different labels.
    conn.execute_batch(
        r#"
        CREATE TABLE ssh_keys (
            id          TEXT PRIMARY KEY NOT NULL,
            name        TEXT NOT NULL,
            path        TEXT NOT NULL UNIQUE,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )?;
    Ok(())
}

fn migration_v6(conn: &Connection) -> Result<()> {
    // Database connections — references a saved Host (whose SSH config we
    // reuse to tunnel) plus engine-specific endpoint and credential
    // metadata. Passwords live in the OS keyring, keyed by the row id
    // (see secrets module), so they never touch this table.
    conn.execute_batch(
        r#"
        CREATE TABLE db_connections (
            id          TEXT PRIMARY KEY NOT NULL,
            host_id     TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            engine      TEXT NOT NULL CHECK (engine IN ('mysql', 'postgres')),
            db_host     TEXT NOT NULL DEFAULT '127.0.0.1',
            db_port     INTEGER NOT NULL CHECK (db_port BETWEEN 1 AND 65535),
            database    TEXT NOT NULL DEFAULT '',
            db_user     TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER
        );
        CREATE INDEX db_connections_host_id_idx ON db_connections(host_id);
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
    fn migrate_from_v1_runs_all_migrations_to_current() {
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
        assert_eq!(v, CURRENT_VERSION);

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

    #[test]
    fn migrate_creates_forwards_table_and_bumps_to_v3() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='forwards'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn migrate_v2_to_v3_only_creates_forwards() {
        let conn = open_in_memory();
        // Seed schema v2: hosts + snippets only.
        conn.execute_batch(
            r#"
            CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL,
              hostname TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL,
              group_name TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
              auth_method TEXT NOT NULL, key_path TEXT, notes TEXT,
              created_at INTEGER NOT NULL, last_used_at INTEGER);
            CREATE TABLE snippets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
              content TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
              created_at INTEGER NOT NULL, last_used_at INTEGER);
            "#,
        ).unwrap();
        conn.pragma_update(None, "user_version", 2u32).unwrap();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
    }

    #[test]
    fn cascade_delete_host_removes_forwards() {
        let conn = open_in_memory();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate(&conn).unwrap();
        // Insert a host then a forward referencing it.
        conn.execute(
            "INSERT INTO hosts (id, name, hostname, port, username, auth_method, created_at) \
             VALUES ('h1', 'mac', 'example.com', 22, 'a', 'agent', 0)", [],
        ).unwrap();
        conn.execute(
            "INSERT INTO forwards (id, host_id, name, kind, bind_addr, bind_port, \
             remote_host, remote_port, auto_start, created_at) \
             VALUES ('f1', 'h1', 'tunnel', 'local', '127.0.0.1', 5432, 'db.local', 5432, 0, 0)", [],
        ).unwrap();
        conn.execute("DELETE FROM hosts WHERE id='h1'", []).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM forwards", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "ON DELETE CASCADE should have removed the forward row");
    }

    #[test]
    fn migration_v4_adds_updated_at_columns() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let v: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, CURRENT_VERSION);
        conn.execute_batch("SELECT updated_at FROM hosts LIMIT 0").unwrap();
        conn.execute_batch("SELECT updated_at FROM snippets LIMIT 0").unwrap();
        conn.execute_batch("SELECT updated_at FROM forwards LIMIT 0").unwrap();
    }

    #[test]
    fn migration_v6_creates_db_connections_table() {
        let conn = open_in_memory();
        migrate(&conn).unwrap();
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='db_connections'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn migration_v3_to_v4_adds_updated_at_to_existing_tables() {
        let conn = open_in_memory();
        conn.execute_batch(r#"
            CREATE TABLE hosts (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL,
              port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL, group_name TEXT,
              tags_json TEXT NOT NULL DEFAULT '[]', auth_method TEXT NOT NULL, key_path TEXT,
              notes TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER);
            CREATE TABLE snippets (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
              content TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
              created_at INTEGER NOT NULL, last_used_at INTEGER);
            CREATE TABLE forwards (id TEXT PRIMARY KEY NOT NULL, host_id TEXT NOT NULL,
              name TEXT NOT NULL, kind TEXT NOT NULL, bind_addr TEXT NOT NULL DEFAULT '127.0.0.1',
              bind_port INTEGER NOT NULL, remote_host TEXT NOT NULL, remote_port INTEGER NOT NULL,
              auto_start INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
        "#).unwrap();
        conn.pragma_update(None, "user_version", 3u32).unwrap();
        migrate(&conn).unwrap();
        conn.execute_batch("SELECT updated_at FROM hosts LIMIT 0").unwrap();
        conn.execute_batch("SELECT updated_at FROM snippets LIMIT 0").unwrap();
        conn.execute_batch("SELECT updated_at FROM forwards LIMIT 0").unwrap();
    }
}
