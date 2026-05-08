//! A live database connection wired through an SSH tunnel. Holds the
//! engine-specific driver, the proxy that bridges to the remote DB, and
//! the SSH handle so everything tears down together.
use crate::db::proxy::{self, DbProxy, ProxyError};
use crate::ssh::auth::Auth;
use crate::ssh::handshake::{handshake_and_auth, ClientHandler, HandshakeError, SshTarget};
use parking_lot::Mutex as PLMutex;
use russh::client::Handle;
use russh::Disconnect;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
use tokio_postgres::{CancelToken, SimpleQueryMessage};

#[derive(thiserror::Error, Debug)]
pub enum DbError {
    #[error("ssh: {0}")]
    Ssh(String),
    #[error("proxy: {0}")]
    Proxy(String),
    #[error("connect: {0}")]
    Connect(String),
    #[error("query: {0}")]
    Query(String),
    #[error("cancel: {0}")]
    Cancel(String),
}

impl From<HandshakeError> for DbError {
    fn from(e: HandshakeError) -> Self {
        // Unwrap the `any: …` wrapper from HandshakeError::Any so the
        // composed message reads `ssh: <reason>` instead of the noisy
        // `ssh: any: <reason>`. Other variants already format cleanly.
        match e {
            HandshakeError::Any(s) => DbError::Ssh(s),
            other => DbError::Ssh(other.to_string()),
        }
    }
}

impl From<ProxyError> for DbError {
    fn from(e: ProxyError) -> Self {
        DbError::Proxy(e.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    /// Column header names; empty for non-SELECT statements.
    pub columns: Vec<String>,
    /// Each row's values, with `None` for SQL NULL. All values are
    /// stringified at the driver boundary; the renderer doesn't need
    /// engine-specific decoders.
    pub rows: Vec<Vec<Option<String>>>,
    /// Affected-row count for DML; 0 for SELECT and DDL on most drivers.
    pub rows_affected: u64,
    /// Total wall-clock query duration in milliseconds.
    pub took_ms: u64,
    /// How many statements were executed in this batch. Useful for
    /// multi-statement scripts where only the last result set is shown.
    pub statements: u32,
}

enum Driver {
    Postgres(tokio_postgres::Client),
    Mysql(mysql_async::Conn),
}

pub struct DbSession {
    engine: String,
    driver: AsyncMutex<Driver>,
    _proxy: DbProxy,
    ssh: AsyncMutex<Option<Arc<Handle<ClientHandler>>>>,
    cancel_state: PLMutex<CancelState>,
    creds: Creds,
}

#[derive(Clone)]
struct Creds {
    proxy_port: u16,
    user: String,
    password: String,
    database: Arc<std::sync::Mutex<String>>,
}

enum CancelState {
    Postgres(CancelToken),
    Mysql(u32),
    Unsupported,
}

#[allow(clippy::too_many_arguments)]
impl DbSession {
    pub fn engine(&self) -> &str {
        &self.engine
    }

    pub async fn open(
        engine: &str,
        ssh_target: SshTarget,
        ssh_auth: Auth,
        connect_timeout: Duration,
        keepalive: Duration,
        known_hosts_path: PathBuf,
        accepted_fingerprint: Option<String>,
        db_host: String,
        db_port: u16,
        database: String,
        db_user: String,
        db_password: String,
    ) -> Result<Self, DbError> {
        let session = handshake_and_auth(
            ssh_target,
            ssh_auth,
            connect_timeout,
            keepalive,
            known_hosts_path,
            accepted_fingerprint,
            None,
        )
        .await?;
        let session = Arc::new(session);

        let proxy = proxy::spawn(session.clone(), db_host, db_port).await?;
        let local_port = proxy.local_port;

        let (driver, cancel_state) = match engine {
            "postgres" => connect_postgres(local_port, &database, &db_user, &db_password).await?,
            "mysql" => connect_mysql(local_port, &database, &db_user, &db_password).await?,
            other => return Err(DbError::Connect(format!("unknown engine '{other}'"))),
        };

        Ok(Self {
            engine: engine.to_string(),
            driver: AsyncMutex::new(driver),
            _proxy: proxy,
            ssh: AsyncMutex::new(Some(session)),
            cancel_state: PLMutex::new(cancel_state),
            creds: Creds {
                proxy_port: local_port,
                user: db_user,
                password: db_password,
                database: Arc::new(std::sync::Mutex::new(database)),
            },
        })
    }

    pub async fn query(&self, sql: &str) -> Result<QueryResult, DbError> {
        let start = Instant::now();
        let mut driver = self.driver.lock().await;
        let result = match &mut *driver {
            Driver::Postgres(client) => run_postgres(client, sql).await?,
            Driver::Mysql(conn) => run_mysql(conn, sql).await?,
        };
        Ok(QueryResult {
            took_ms: start.elapsed().as_millis() as u64,
            ..result
        })
    }

    /// Best-effort cancellation of the query currently held under the
    /// driver mutex. Postgres uses tokio-postgres' CancelToken (fresh TCP
    /// connection through the same proxy); MySQL fires `KILL QUERY` from
    /// a side connection. The original query future then wakes with a
    /// driver-level error, which `query()` surfaces as `DbError::Cancel`.
    pub async fn cancel(&self) -> Result<(), DbError> {
        let state = {
            let lock = self.cancel_state.lock();
            // We can't move CancelToken out cheaply, so clone what we need.
            match &*lock {
                CancelState::Postgres(t) => CancelState::Postgres(t.clone()),
                CancelState::Mysql(pid) => CancelState::Mysql(*pid),
                CancelState::Unsupported => CancelState::Unsupported,
            }
        };
        match state {
            CancelState::Postgres(token) => token
                .cancel_query(tokio_postgres::NoTls)
                .await
                .map_err(|e| DbError::Cancel(format!("postgres: {e}"))),
            CancelState::Mysql(pid) => {
                let mut opts = mysql_async::OptsBuilder::default()
                    .ip_or_hostname("127.0.0.1")
                    .tcp_port(self.creds.proxy_port)
                    .user(Some(self.creds.user.clone()))
                    .pass(Some(self.creds.password.clone()));
                let db_name = {
                    let db = self.creds.database.lock().unwrap();
                    if !db.is_empty() { Some(db.clone()) } else { None }
                };
                if let Some(db) = db_name {
                    opts = opts.db_name(Some(db));
                }
                let mut conn = mysql_async::Conn::new(opts)
                    .await
                    .map_err(|e| DbError::Cancel(format!("mysql cancel connect: {e}")))?;
                use mysql_async::prelude::Queryable;
                conn.query_drop(format!("KILL QUERY {pid}"))
                    .await
                    .map_err(|e| DbError::Cancel(format!("mysql kill: {e}")))?;
                let _ = conn.disconnect().await;
                Ok(())
            }
            CancelState::Unsupported => Err(DbError::Cancel("not supported".into())),
        }
    }

    pub async fn switch_database(&self, new_database: &str) -> Result<(), DbError> {
        let mut driver = self.driver.lock().await;
        match &mut *driver {
            Driver::Postgres(_client) => {
                let (new_driver, new_cancel) =
                    connect_postgres(self.creds.proxy_port, new_database, &self.creds.user, &self.creds.password)
                        .await?;
                *driver = new_driver;
                let mut cancel = self.cancel_state.lock();
                *cancel = new_cancel;
            }
            Driver::Mysql(conn) => {
                use mysql_async::prelude::Queryable;
                conn.query_drop(format!("USE `{}`", new_database.replace('`', "``")))
                    .await
                    .map_err(|e| DbError::Query(format!("mysql: {e}")))?;
            }
        }
        let mut db = self.creds.database.lock().unwrap();
        *db = new_database.to_string();
        Ok(())
    }

    pub async fn export_dump(&self, engine: &str, data_too: bool) -> Result<String, DbError> {
        use std::time::SystemTime;
        let ts = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut out = String::new();
        out.push_str(&format!("-- Power Term SQL Dump\n-- Engine: {engine}\n-- Timestamp: {ts}\n\n"));

        // Get table names
        let tables_sql = match engine {
            "postgres" => "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename",
            "mysql" => "SHOW TABLES",
            other => return Err(DbError::Query(format!("unknown engine '{other}'"))),
        };
        let tables_result = self.query(tables_sql).await?;
        let tables: Vec<String> = tables_result.rows.iter()
            .filter_map(|row| row.first().cloned().flatten())
            .collect();

        for table in &tables {
            out.push_str(&format!("\n-- Table: {table}\n"));

            // Schema
            match engine {
                "postgres" => {
                    // Get column definitions from information_schema
                    let parts: Vec<&str> = table.splitn(2, '.').collect();
                    let (schema, tbl) = if parts.len() == 2 { (parts[0], parts[1]) } else { ("public", parts[0]) };
                    let cols_sql = format!(
                        "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{tbl}' ORDER BY ordinal_position"
                    );
                    let cols = self.query(&cols_sql).await?;
                    let mut col_defs: Vec<String> = Vec::new();
                    for row in &cols.rows {
                        if row.len() >= 4 {
                            let name = row[0].as_deref().unwrap_or("?");
                            let dtype = row[1].as_deref().unwrap_or("text");
                            let nullable = row[2].as_deref().unwrap_or("YES") == "YES";
                            let default = row[3].as_deref();
                            let mut def = format!("\"{name}\" {dtype}");
                            if !nullable { def.push_str(" NOT NULL"); }
                            if let Some(d) = default { def.push_str(&format!(" DEFAULT {d}")); }
                            col_defs.push(def);
                        }
                    }
                    out.push_str(&format!("CREATE TABLE \"{tbl}\" (\n  {}\n);\n\n", col_defs.join(",\n  ")));
                }
                "mysql" => {
                    if let Ok(r) = self.query(&format!("SHOW CREATE TABLE `{}`", table.replace('`', "``"))).await {
                        if let Some(row) = r.rows.first() {
                            if row.len() >= 2 {
                                if let Some(create) = &row[1] {
                                    out.push_str(&format!("{create};\n\n"));
                                }
                            }
                        }
                    }
                }
                _ => {}
            }

            // Data
            if data_too {
            let data = self.query(&format!("SELECT * FROM {table}")).await?;
            if !data.rows.is_empty() {
                let col_names: Vec<String> = data.columns.iter()
                    .map(|c| format!("\"{c}\""))
                    .collect();
                for row in &data.rows {
                    let values: Vec<String> = row.iter().map(|v| sql_value(v.as_deref())).collect();
                    out.push_str(&format!("INSERT INTO {table} ({}) VALUES ({});\n",
                        col_names.join(", "),
                        values.join(", ")));
                }
                out.push('\n');
            }
            }
        }
        out.push_str("-- End of dump\n");
        Ok(out)
    }

    pub async fn close(&self) -> Result<(), DbError> {
        // Cancel the proxy first so the driver's pending I/O wakes with EOF
        // instead of hanging on a half-closed tunnel.
        self._proxy.cancel();
        let session = self.ssh.lock().await.take();
        if let Some(s) = session {
            // Best-effort: surface no error on disconnect — the channel may
            // already be gone if the proxy cancelled mid-flight.
            if let Ok(handle) = Arc::try_unwrap(s) {
                let _ = handle.disconnect(Disconnect::ByApplication, "", "").await;
            }
        }
        Ok(())
    }
}

// ─── Postgres ───────────────────────────────────────────────────────────────

async fn connect_postgres(
    local_port: u16,
    database: &str,
    user: &str,
    password: &str,
) -> Result<(Driver, CancelState), DbError> {
    let mut config = tokio_postgres::Config::new();
    config
        .host("127.0.0.1")
        .port(local_port)
        .user(user)
        .password(password)
        .dbname(if database.is_empty() { "postgres" } else { database })
        .connect_timeout(Duration::from_secs(15));
    let (client, connection) = config
        .connect(tokio_postgres::NoTls)
        .await
        .map_err(|e| DbError::Connect(format!("postgres: {e}")))?;
    // tokio-postgres drives I/O on a separate task; if it returns an error
    // (e.g. server hangup) we just log — the next `query` call will surface
    // a clean error to the caller.
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            tracing::warn!(error = %e, "postgres connection task ended");
        }
    });
    let cancel = client.cancel_token();
    Ok((Driver::Postgres(client), CancelState::Postgres(cancel)))
}

async fn run_postgres(
    client: &mut tokio_postgres::Client,
    sql: &str,
) -> Result<QueryResult, DbError> {
    // simple_query returns text-form rows for every statement — perfect for
    // an ad-hoc query runner because we don't have to predeclare column
    // types or handle binary decoding for arbitrary user SQL.
    let messages = client
        .simple_query(sql)
        .await
        .map_err(|e| classify_pg_error(e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut rows_affected: u64 = 0;
    let mut statements: u32 = 0;
    for msg in messages {
        match msg {
            SimpleQueryMessage::Row(row) => {
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|c| c.name().to_string())
                        .collect();
                }
                let mut out = Vec::with_capacity(columns.len());
                for i in 0..columns.len() {
                    out.push(row.get(i).map(|s| s.to_string()));
                }
                rows.push(out);
            }
            SimpleQueryMessage::CommandComplete(n) => {
                rows_affected = rows_affected.saturating_add(n);
                statements = statements.saturating_add(1);
            }
            _ => {}
        }
    }
    Ok(QueryResult {
        columns,
        rows,
        rows_affected,
        took_ms: 0,
        statements,
    })
}

fn classify_pg_error(e: tokio_postgres::Error) -> DbError {
    let s = e.to_string();
    // tokio-postgres surfaces a server-side "57014 query_canceled" SQLSTATE
    // when a CancelToken-issued cancel arrives mid-query. Treat that as a
    // structured cancel rather than a generic query error so the UI can
    // distinguish "user pressed Stop" from "query had a bug".
    if s.contains("57014") || s.to_lowercase().contains("canceling") {
        DbError::Cancel(s)
    } else {
        DbError::Query(format!("postgres: {s}"))
    }
}

// ─── MySQL ──────────────────────────────────────────────────────────────────

async fn connect_mysql(
    local_port: u16,
    database: &str,
    user: &str,
    password: &str,
) -> Result<(Driver, CancelState), DbError> {
    let mut opts = mysql_async::OptsBuilder::default()
        .ip_or_hostname("127.0.0.1")
        .tcp_port(local_port)
        .user(Some(user.to_string()))
        .pass(Some(password.to_string()));
    if !database.is_empty() {
        opts = opts.db_name(Some(database.to_string()));
    }
    let mut conn = mysql_async::Conn::new(opts)
        .await
        .map_err(|e| DbError::Connect(format!("mysql: {e}")))?;
    // Capture the connection id so a side connection can `KILL QUERY` it.
    let pid: u32 = {
        use mysql_async::prelude::Queryable;
        let row: Option<mysql_async::Row> = conn
            .query_first("SELECT CONNECTION_ID()")
            .await
            .map_err(|e| DbError::Connect(format!("mysql connection_id: {e}")))?;
        row.and_then(|mut r| r.take::<u64, _>(0))
            .map(|v| v as u32)
            .unwrap_or(0)
    };
    let cancel = if pid > 0 {
        CancelState::Mysql(pid)
    } else {
        CancelState::Unsupported
    };
    Ok((Driver::Mysql(conn), cancel))
}

async fn run_mysql(
    conn: &mut mysql_async::Conn,
    sql: &str,
) -> Result<QueryResult, DbError> {
    use mysql_async::prelude::Queryable;
    // query_iter walks every result set in a multi-statement batch. We
    // accumulate rows_affected across all statements and surface the LAST
    // non-empty result set's columns / rows — matches what mysql CLI
    // displays for "trailing SELECT" scripts.
    let mut iter = conn
        .query_iter(sql)
        .await
        .map_err(|e| classify_mysql_error(e))?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut total_affected: u64 = 0;
    let mut statements: u32 = 0;

    // `collect` walks rows up to the next result-set boundary. Calling it
    // repeatedly consumes each statement's set in turn until `is_empty()`
    // signals the whole batch is done. We capture columns + affected rows
    // for each set; the LAST non-empty set wins for the visible result so
    // a script ending in `SELECT` shows the SELECT's rows even after DDL
    // statements ran first.
    while !iter.is_empty() {
        let cols: Vec<String> = iter
            .columns_ref()
            .iter()
            .map(|c| c.name_str().to_string())
            .collect();
        let collected: Vec<mysql_async::Row> = iter
            .collect()
            .await
            .map_err(|e| classify_mysql_error(e))?;
        statements = statements.saturating_add(1);
        total_affected = total_affected.saturating_add(iter.affected_rows());
        if !cols.is_empty() && !collected.is_empty() {
            columns = cols;
            rows.clear();
            for r in collected {
                let values: Vec<mysql_async::Value> = r.unwrap();
                rows.push(values.iter().map(value_to_string).collect());
            }
        }
    }

    Ok(QueryResult {
        columns,
        rows,
        rows_affected: total_affected,
        took_ms: 0,
        statements,
    })
}

fn classify_mysql_error(e: mysql_async::Error) -> DbError {
    let s = e.to_string();
    // MySQL returns ER_QUERY_INTERRUPTED (1317) when KILL QUERY arrives.
    if s.contains("1317") || s.contains("interrupted") {
        DbError::Cancel(s)
    } else {
        DbError::Query(format!("mysql: {s}"))
    }
}

fn sql_value(v: Option<&str>) -> String {
    match v {
        None => "NULL".to_string(),
        Some(s) => {
            let escaped = s.replace('\'', "''").replace('\\', "\\\\");
            format!("'{escaped}'")
        }
    }
}

fn value_to_string(v: &mysql_async::Value) -> Option<String> {
    use mysql_async::Value;
    match v {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).into_owned()),
        Value::Int(i) => Some(i.to_string()),
        Value::UInt(u) => Some(u.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(d) => Some(d.to_string()),
        Value::Date(y, m, d, h, mi, s, us) => Some(format!(
            "{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"
        )),
        Value::Time(neg, days, h, m, s, us) => {
            let sign = if *neg { "-" } else { "" };
            Some(format!("{sign}{days}d {h:02}:{m:02}:{s:02}.{us:06}"))
        }
    }
}
