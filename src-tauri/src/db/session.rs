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
    driver: AsyncMutex<Driver>,
    /// The proxy is dropped on session close which tears down the listener.
    /// Kept private — Drop on this field also fires when the whole struct
    /// drops, so we get a free belt-and-braces cleanup.
    _proxy: DbProxy,
    /// Disconnect hook fired explicitly on `close()`. Held in an Option so
    /// `close` can take ownership and consume it exactly once.
    ssh: AsyncMutex<Option<Arc<Handle<ClientHandler>>>>,
    /// Engine-specific cancellation handle. Postgres uses tokio-postgres'
    /// CancelToken (sends SSH_FXP_CANCEL on a fresh tunnel connection);
    /// MySQL stores the connection id and runs `KILL QUERY` from a side
    /// connection. Either way the original query future wakes with an
    /// I/O error and `query()` returns it as `DbError::Cancel`.
    cancel_state: PLMutex<CancelState>,
    /// Reused by the cancel path on MySQL — we open a fresh `Conn` to the
    /// same proxy port so we don't have to ask the user for the password
    /// again at cancel time.
    creds: Creds,
}

#[derive(Clone)]
struct Creds {
    proxy_port: u16,
    user: String,
    password: String,
    database: String,
}

enum CancelState {
    Postgres(CancelToken),
    Mysql(u32),
    Unsupported,
}

#[allow(clippy::too_many_arguments)]
impl DbSession {
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
            driver: AsyncMutex::new(driver),
            _proxy: proxy,
            ssh: AsyncMutex::new(Some(session)),
            cancel_state: PLMutex::new(cancel_state),
            creds: Creds {
                proxy_port: local_port,
                user: db_user,
                password: db_password,
                database,
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
                if !self.creds.database.is_empty() {
                    opts = opts.db_name(Some(self.creds.database.clone()));
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
        .dbname(if database.is_empty() { user } else { database })
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
