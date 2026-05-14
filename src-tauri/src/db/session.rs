//! A live database connection wired through an SSH tunnel. Holds the
//! engine-specific driver, the proxy that bridges to the remote DB, and
//! the SSH handle so everything tears down together.
use crate::db::proxy::{self, DbProxy, ProxyError};
use crate::ssh::auth::Auth;
use crate::ssh::handshake::{handshake_and_auth, ClientHandler, HandshakeError, SshTarget};
use parking_lot::Mutex as PLMutex;
use russh::client::Handle;
use rusqlite::types::ValueRef as SqliteValueRef;
use russh::Disconnect;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex as AsyncMutex;
use tokio_postgres::{CancelToken, SimpleQueryMessage};
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

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

#[derive(Debug, Clone, Serialize)]
pub struct DbColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DbIndex {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableMeta {
    pub table: String,
    pub columns: Vec<DbColumn>,
    pub primary_key: Vec<String>,
    pub indexes: Vec<DbIndex>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DbCell {
    pub column: String,
    pub value: Option<String>,
}

enum Driver {
    Postgres(tokio_postgres::Client),
    Mysql(mysql_async::Conn),
    Sqlite(rusqlite::Connection),
    Redis(RedisSession),
    Mssql(tiberius::Client<Compat<TcpStream>>),
}

struct RedisSession {
    stream: TcpStream,
}

pub struct DbSession {
    engine: String,
    driver: AsyncMutex<Driver>,
    _proxy: Option<DbProxy>,
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
        if engine == "sqlite" {
            let driver = rusqlite::Connection::open(&database)
                .map_err(|e| DbError::Connect(format!("sqlite: {e}")))?;
            return Ok(Self {
                engine: engine.to_string(),
                driver: AsyncMutex::new(Driver::Sqlite(driver)),
                _proxy: None,
                ssh: AsyncMutex::new(None),
                cancel_state: PLMutex::new(CancelState::Unsupported),
                creds: Creds {
                    proxy_port: 0,
                    user: db_user,
                    password: db_password,
                    database: Arc::new(std::sync::Mutex::new(database)),
                },
            });
        }
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
            "mssql" => connect_mssql(local_port, &database, &db_user, &db_password).await?,
            "redis" => connect_redis(local_port, &database, &db_user, &db_password).await?,
            other => return Err(DbError::Connect(format!("unknown engine '{other}'"))),
        };

        Ok(Self {
            engine: engine.to_string(),
            driver: AsyncMutex::new(driver),
            _proxy: Some(proxy),
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
            Driver::Sqlite(conn) => run_sqlite(conn, sql)?,
            Driver::Redis(redis) => run_redis(redis, sql).await?,
            Driver::Mssql(client) => run_mssql(client, sql).await?,
        };
        Ok(QueryResult {
            took_ms: start.elapsed().as_millis() as u64,
            ..result
        })
    }

    pub async fn describe_table(&self, table: &str) -> Result<TableMeta, DbError> {
        match self.engine.as_str() {
            "postgres" => self.describe_postgres(table).await,
            "mysql" => self.describe_mysql(table).await,
            "sqlite" => self.describe_sqlite(table).await,
            "mssql" => self.describe_mssql(table).await,
            "redis" => Ok(TableMeta {
                table: table.to_string(),
                columns: vec![
                    DbColumn { name: "key".into(), data_type: "redis-key".into(), nullable: false, default_value: None, primary_key: true },
                    DbColumn { name: "value".into(), data_type: "redis-value".into(), nullable: true, default_value: None, primary_key: false },
                ],
                primary_key: vec!["key".into()],
                indexes: vec![],
            }),
            other => Err(DbError::Query(format!("unknown engine '{other}'"))),
        }
    }

    pub async fn update_row(
        &self,
        table: &str,
        key: &[DbCell],
        changes: &[DbCell],
    ) -> Result<QueryResult, DbError> {
        if key.is_empty() {
            return Err(DbError::Query("cannot update row without primary key values".into()));
        }
        if changes.is_empty() {
            return Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: 0, took_ms: 0, statements: 0 });
        }
        let sql = format!(
            "UPDATE {} SET {} WHERE {}",
            self.quote_table(table)?,
            changes.iter()
                .map(|c| Ok(format!("{} = {}", self.quote_ident(&c.column)?, sql_value(c.value.as_deref()))))
                .collect::<Result<Vec<_>, DbError>>()?
                .join(", "),
            key.iter()
                .map(|c| Ok(format!("{} {}", self.quote_ident(&c.column)?, sql_predicate(c.value.as_deref()))))
                .collect::<Result<Vec<_>, DbError>>()?
                .join(" AND "),
        );
        self.query(&sql).await
    }

    pub async fn insert_row(&self, table: &str, values: &[DbCell]) -> Result<QueryResult, DbError> {
        if values.is_empty() {
            return Err(DbError::Query("cannot insert row without values".into()));
        }
        let cols = values.iter()
            .map(|c| self.quote_ident(&c.column))
            .collect::<Result<Vec<_>, DbError>>()?
            .join(", ");
        let vals = values.iter()
            .map(|c| sql_value(c.value.as_deref()))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("INSERT INTO {} ({cols}) VALUES ({vals})", self.quote_table(table)?);
        self.query(&sql).await
    }

    pub async fn delete_row(&self, table: &str, key: &[DbCell]) -> Result<QueryResult, DbError> {
        if key.is_empty() {
            return Err(DbError::Query("cannot delete row without primary key values".into()));
        }
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            self.quote_table(table)?,
            key.iter()
                .map(|c| Ok(format!("{} {}", self.quote_ident(&c.column)?, sql_predicate(c.value.as_deref()))))
                .collect::<Result<Vec<_>, DbError>>()?
                .join(" AND "),
        );
        self.query(&sql).await
    }

    fn quote_ident(&self, ident: &str) -> Result<String, DbError> {
        if ident.trim().is_empty() || ident.contains('\0') {
            return Err(DbError::Query("invalid empty identifier".into()));
        }
        Ok(match self.engine.as_str() {
            "mysql" => format!("`{}`", ident.replace('`', "``")),
            "mssql" => format!("[{}]", ident.replace(']', "]]")),
            "sqlite" => format!("\"{}\"", ident.replace('"', "\"\"")),
            _ => format!("\"{}\"", ident.replace('"', "\"\"")),
        })
    }

    fn quote_table(&self, table: &str) -> Result<String, DbError> {
        let parts: Vec<&str> = table.split('.').filter(|p| !p.trim().is_empty()).collect();
        if parts.is_empty() || parts.len() > 2 {
            return Err(DbError::Query(format!("invalid table name '{table}'")));
        }
        Ok(parts.into_iter()
            .map(|p| self.quote_ident(p))
            .collect::<Result<Vec<_>, DbError>>()?
            .join("."))
    }

    async fn describe_postgres(&self, table: &str) -> Result<TableMeta, DbError> {
        let (schema, tbl) = split_table(table, "public");
        let columns_sql = format!(
            "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, \
                    CASE WHEN kcu.column_name IS NULL THEN 'NO' ELSE 'YES' END AS primary_key \
             FROM information_schema.columns c \
             LEFT JOIN information_schema.table_constraints tc \
               ON tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' \
             LEFT JOIN information_schema.key_column_usage kcu \
               ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name \
              AND kcu.table_schema = c.table_schema AND kcu.table_name = c.table_name AND kcu.column_name = c.column_name \
             WHERE c.table_schema = {} AND c.table_name = {} \
             ORDER BY c.ordinal_position",
            sql_value(Some(&schema)),
            sql_value(Some(&tbl)),
        );
        let rows = self.query(&columns_sql).await?;
        let columns = rows.rows.into_iter().map(|r| {
            let name = cell(&r, 0);
            let primary_key = cell(&r, 4) == "YES";
            DbColumn {
                name,
                data_type: cell(&r, 1),
                nullable: cell(&r, 2) == "YES",
                default_value: r.get(3).cloned().flatten(),
                primary_key,
            }
        }).collect::<Vec<_>>();
        let indexes_sql = format!(
            "SELECT i.relname AS index_name, ix.indisunique, ix.indisprimary, \
                    array_to_string(array_agg(a.attname ORDER BY u.ord), ',') AS columns \
             FROM pg_class t \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_index ix ON t.oid = ix.indrelid \
             JOIN pg_class i ON i.oid = ix.indexrelid \
             JOIN unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord) ON TRUE \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum \
             WHERE n.nspname = {} AND t.relname = {} \
             GROUP BY i.relname, ix.indisunique, ix.indisprimary \
             ORDER BY ix.indisprimary DESC, i.relname",
            sql_value(Some(&schema)),
            sql_value(Some(&tbl)),
        );
        let indexes = self.query(&indexes_sql).await?.rows.into_iter().map(|r| DbIndex {
            name: cell(&r, 0),
            unique: cell(&r, 1) == "t",
            primary: cell(&r, 2) == "t",
            columns: cell(&r, 3).split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
        }).collect::<Vec<_>>();
        let primary_key = columns.iter().filter(|c| c.primary_key).map(|c| c.name.clone()).collect();
        Ok(TableMeta { table: table.to_string(), columns, primary_key, indexes })
    }

    async fn describe_mysql(&self, table: &str) -> Result<TableMeta, DbError> {
        let (_schema, tbl) = split_table(table, "");
        let columns_sql = format!("SHOW COLUMNS FROM {}", self.quote_table(table)?);
        let columns = self.query(&columns_sql).await?.rows.into_iter().map(|r| {
            let key = cell(&r, 3);
            DbColumn {
                name: cell(&r, 0),
                data_type: cell(&r, 1),
                nullable: cell(&r, 2).eq_ignore_ascii_case("YES"),
                default_value: r.get(4).cloned().flatten(),
                primary_key: key == "PRI",
            }
        }).collect::<Vec<_>>();
        let indexes_sql = format!("SHOW INDEX FROM {}", self.quote_table(table)?);
        let mut map: std::collections::BTreeMap<String, DbIndex> = std::collections::BTreeMap::new();
        for r in self.query(&indexes_sql).await?.rows {
            let name = cell(&r, 2);
            let col = cell(&r, 4);
            let unique = cell(&r, 1) == "0";
            let primary = name == "PRIMARY";
            map.entry(name.clone())
                .and_modify(|idx| idx.columns.push(col.clone()))
                .or_insert(DbIndex { name, columns: vec![col], unique, primary });
        }
        let primary_key = columns.iter().filter(|c| c.primary_key).map(|c| c.name.clone()).collect();
        Ok(TableMeta { table: if tbl.is_empty() { table.to_string() } else { table.to_string() }, columns, primary_key, indexes: map.into_values().collect() })
    }

    async fn describe_sqlite(&self, table: &str) -> Result<TableMeta, DbError> {
        let q = self.quote_ident(table)?;
        let columns_sql = format!("PRAGMA table_info({q})");
        let columns = self.query(&columns_sql).await?.rows.into_iter().map(|r| {
            let pk = cell(&r, 5) != "0";
            DbColumn {
                name: cell(&r, 1),
                data_type: cell(&r, 2),
                nullable: cell(&r, 3) == "0",
                default_value: r.get(4).cloned().flatten(),
                primary_key: pk,
            }
        }).collect::<Vec<_>>();
        let mut indexes = Vec::new();
        for r in self.query(&format!("PRAGMA index_list({q})")).await?.rows {
            let name = cell(&r, 1);
            let unique = cell(&r, 2) == "1";
            let primary = cell(&r, 3) == "pk";
            let cols = self.query(&format!("PRAGMA index_info({})", self.quote_ident(&name)?)).await?
                .rows
                .into_iter()
                .map(|row| cell(&row, 2))
                .filter(|s| !s.is_empty())
                .collect();
            indexes.push(DbIndex { name, columns: cols, unique, primary });
        }
        let primary_key = columns.iter().filter(|c| c.primary_key).map(|c| c.name.clone()).collect();
        Ok(TableMeta { table: table.to_string(), columns, primary_key, indexes })
    }

    async fn describe_mssql(&self, table: &str) -> Result<TableMeta, DbError> {
        let (schema, tbl) = split_table(table, "dbo");
        let columns_sql = format!(
            "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, \
                    CASE WHEN kcu.COLUMN_NAME IS NULL THEN 'NO' ELSE 'YES' END AS primary_key \
             FROM INFORMATION_SCHEMA.COLUMNS c \
             LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc \
               ON tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY' \
             LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu \
               ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
              AND kcu.TABLE_SCHEMA = c.TABLE_SCHEMA AND kcu.TABLE_NAME = c.TABLE_NAME AND kcu.COLUMN_NAME = c.COLUMN_NAME \
             WHERE c.TABLE_SCHEMA = {} AND c.TABLE_NAME = {} \
             ORDER BY c.ORDINAL_POSITION",
            sql_value(Some(&schema)),
            sql_value(Some(&tbl)),
        );
        let rows = self.query(&columns_sql).await?;
        let columns = rows.rows.into_iter().map(|r| {
            let primary_key = cell(&r, 4) == "YES";
            DbColumn {
                name: cell(&r, 0),
                data_type: cell(&r, 1),
                nullable: cell(&r, 2) == "YES",
                default_value: r.get(3).cloned().flatten(),
                primary_key,
            }
        }).collect::<Vec<_>>();
        let indexes_sql = format!(
            "SELECT i.name, i.is_unique, i.is_primary_key, STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns \
             FROM sys.indexes i \
             JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
             JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
             JOIN sys.tables t ON t.object_id = i.object_id \
             JOIN sys.schemas s ON s.schema_id = t.schema_id \
             WHERE s.name = {} AND t.name = {} AND i.name IS NOT NULL \
             GROUP BY i.name, i.is_unique, i.is_primary_key \
             ORDER BY i.is_primary_key DESC, i.name",
            sql_value(Some(&schema)),
            sql_value(Some(&tbl)),
        );
        let indexes = self.query(&indexes_sql).await?.rows.into_iter().map(|r| DbIndex {
            name: cell(&r, 0),
            unique: cell(&r, 1) == "true" || cell(&r, 1) == "1",
            primary: cell(&r, 2) == "true" || cell(&r, 2) == "1",
            columns: cell(&r, 3).split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
        }).collect::<Vec<_>>();
        let primary_key = columns.iter().filter(|c| c.primary_key).map(|c| c.name.clone()).collect();
        Ok(TableMeta { table: table.to_string(), columns, primary_key, indexes })
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
            Driver::Sqlite(_) => {}
            Driver::Redis(redis) => {
                let _ = redis_command(redis, &["SELECT".into(), new_database.to_string()]).await?;
            }
            Driver::Mssql(client) => {
                let sql = format!("USE {}", self.quote_ident(new_database)?);
                client.simple_query(sql).await
                    .map_err(|e| DbError::Query(format!("mssql: {e}")))?
                    .into_results().await
                    .map_err(|e| DbError::Query(format!("mssql: {e}")))?;
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
        if let Some(proxy) = &self._proxy {
            proxy.cancel();
        }
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

// ─── MSSQL ─────────────────────────────────────────────────────────────────

async fn connect_mssql(
    local_port: u16,
    database: &str,
    user: &str,
    password: &str,
) -> Result<(Driver, CancelState), DbError> {
    let mut config = tiberius::Config::new();
    config.host("127.0.0.1");
    config.port(local_port);
    if !database.is_empty() {
        config.database(database);
    }
    config.authentication(tiberius::AuthMethod::sql_server(user, password));
    // SSH tunnel already protects transport to the remote host. Trusting the
    // SQL Server cert keeps self-signed internal instances usable.
    config.trust_cert();
    let tcp = TcpStream::connect(("127.0.0.1", local_port))
        .await
        .map_err(|e| DbError::Connect(format!("mssql tcp: {e}")))?;
    tcp.set_nodelay(true)
        .map_err(|e| DbError::Connect(format!("mssql nodelay: {e}")))?;
    let client = tiberius::Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| DbError::Connect(format!("mssql: {e}")))?;
    Ok((Driver::Mssql(client), CancelState::Unsupported))
}

async fn run_mssql(
    client: &mut tiberius::Client<Compat<TcpStream>>,
    sql: &str,
) -> Result<QueryResult, DbError> {
    let mut stream = client.simple_query(sql)
        .await
        .map_err(|e| DbError::Query(format!("mssql: {e}")))?;
    let columns = stream.columns()
        .await
        .map_err(|e| DbError::Query(format!("mssql: {e}")))?
        .map(|cols| cols.iter().map(|c| c.name().to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    let results = stream.into_results()
        .await
        .map_err(|e| DbError::Query(format!("mssql: {e}")))?;
    let mut rows = Vec::new();
    for row in results.into_iter().flatten() {
        if rows.is_empty() && columns.is_empty() {
            // Non-row result set; keep metadata empty.
        }
        rows.push(row.cells().map(|(_, data)| mssql_value_to_string(data)).collect());
    }
    let rows_affected = if rows.is_empty() { 0 } else { 0 };
    Ok(QueryResult {
        columns,
        rows,
        rows_affected,
        took_ms: 0,
        statements: 1,
    })
}

fn mssql_value_to_string(data: &tiberius::ColumnData<'static>) -> Option<String> {
    use tiberius::ColumnData;
    match data {
        ColumnData::Binary(None)
        | ColumnData::Bit(None)
        | ColumnData::String(None)
        | ColumnData::I16(None)
        | ColumnData::I32(None)
        | ColumnData::I64(None)
        | ColumnData::F32(None)
        | ColumnData::F64(None)
        | ColumnData::Guid(None)
        | ColumnData::Numeric(None)
        | ColumnData::Xml(None) => None,
        ColumnData::Binary(Some(v)) => Some(format!("<{} bytes binary>", v.len())),
        ColumnData::Bit(Some(v)) => Some(v.to_string()),
        ColumnData::String(Some(v)) => Some(v.to_string()),
        ColumnData::I16(Some(v)) => Some(v.to_string()),
        ColumnData::I32(Some(v)) => Some(v.to_string()),
        ColumnData::I64(Some(v)) => Some(v.to_string()),
        ColumnData::F32(Some(v)) => Some(v.to_string()),
        ColumnData::F64(Some(v)) => Some(v.to_string()),
        ColumnData::Guid(Some(v)) => Some(v.to_string()),
        ColumnData::Numeric(Some(v)) => Some(v.to_string()),
        ColumnData::Xml(Some(v)) => Some(v.to_string()),
        other => Some(format!("{other:?}")),
    }
}

// ─── SQLite ────────────────────────────────────────────────────────────────

fn run_sqlite(
    conn: &mut rusqlite::Connection,
    sql: &str,
) -> Result<QueryResult, DbError> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: 0, took_ms: 0, statements: 0 });
    }
    let mut stmt = match conn.prepare(trimmed) {
        Ok(stmt) => stmt,
        Err(_) => {
            conn.execute_batch(trimmed)
                .map_err(|e| DbError::Query(format!("sqlite: {e}")))?;
            return Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: conn.changes(), took_ms: 0, statements: 1 });
        }
    };
    let col_count = stmt.column_count();
    if col_count == 0 {
        let n = stmt.execute([])
            .map_err(|e| DbError::Query(format!("sqlite: {e}")))?;
        return Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: n as u64, took_ms: 0, statements: 1 });
    }
    let columns = stmt.column_names().iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let mapped = stmt.query_map([], |row| {
        let mut out = Vec::with_capacity(col_count);
        for i in 0..col_count {
            out.push(sqlite_value_to_string(row.get_ref(i)?));
        }
        Ok(out)
    }).map_err(|e| DbError::Query(format!("sqlite: {e}")))?;
    let rows = mapped.collect::<Result<Vec<_>, _>>()
        .map_err(|e| DbError::Query(format!("sqlite: {e}")))?;
    Ok(QueryResult { columns, rows, rows_affected: 0, took_ms: 0, statements: 1 })
}

fn sqlite_value_to_string(v: SqliteValueRef<'_>) -> Option<String> {
    match v {
        SqliteValueRef::Null => None,
        SqliteValueRef::Integer(i) => Some(i.to_string()),
        SqliteValueRef::Real(f) => Some(f.to_string()),
        SqliteValueRef::Text(t) => Some(String::from_utf8_lossy(t).into_owned()),
        SqliteValueRef::Blob(b) => Some(format!("<{} bytes blob>", b.len())),
    }
}

// ─── Redis ─────────────────────────────────────────────────────────────────

async fn connect_redis(
    local_port: u16,
    database: &str,
    user: &str,
    password: &str,
) -> Result<(Driver, CancelState), DbError> {
    let stream = TcpStream::connect(("127.0.0.1", local_port))
        .await
        .map_err(|e| DbError::Connect(format!("redis: {e}")))?;
    let mut session = RedisSession { stream };
    if !password.is_empty() {
        let mut args = vec!["AUTH".to_string()];
        if !user.is_empty() {
            args.push(user.to_string());
        }
        args.push(password.to_string());
        let _ = redis_command(&mut session, &args).await?;
    }
    if !database.trim().is_empty() {
        let _ = redis_command(&mut session, &["SELECT".into(), database.trim().into()]).await?;
    }
    Ok((Driver::Redis(session), CancelState::Unsupported))
}

async fn run_redis(
    session: &mut RedisSession,
    sql: &str,
) -> Result<QueryResult, DbError> {
    let args = shell_words(sql);
    if args.is_empty() {
        return Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: 0, took_ms: 0, statements: 0 });
    }
    let resp = redis_command(session, &args).await?;
    let rows = match resp {
        RespValue::Array(items) => items.into_iter().map(|v| vec![Some(resp_to_string(v))]).collect(),
        other => vec![vec![Some(resp_to_string(other))]],
    };
    Ok(QueryResult { columns: vec!["response".into()], rows, rows_affected: 0, took_ms: 0, statements: 1 })
}

async fn redis_command(session: &mut RedisSession, args: &[String]) -> Result<RespValue, DbError> {
    let mut buf = format!("*{}\r\n", args.len()).into_bytes();
    for arg in args {
        buf.extend_from_slice(format!("${}\r\n", arg.as_bytes().len()).as_bytes());
        buf.extend_from_slice(arg.as_bytes());
        buf.extend_from_slice(b"\r\n");
    }
    session.stream.write_all(&buf).await
        .map_err(|e| DbError::Query(format!("redis write: {e}")))?;
    read_resp(&mut session.stream).await
}

#[derive(Debug)]
enum RespValue {
    Simple(String),
    Integer(i64),
    Bulk(Option<Vec<u8>>),
    Array(Vec<RespValue>),
}

async fn read_resp(stream: &mut TcpStream) -> Result<RespValue, DbError> {
    let prefix = read_byte(stream).await?;
    match prefix {
        b'+' => Ok(RespValue::Simple(read_line(stream).await?)),
        b'-' => {
            let e = read_line(stream).await?;
            Err(DbError::Query(format!("redis: {e}")))
        }
        b':' => {
            let n = read_line(stream).await?.parse().unwrap_or(0);
            Ok(RespValue::Integer(n))
        }
        b'$' => {
            let len: i64 = read_line(stream).await?.parse().unwrap_or(-1);
            if len < 0 {
                return Ok(RespValue::Bulk(None));
            }
            let mut data = vec![0u8; len as usize + 2];
            stream.read_exact(&mut data).await
                .map_err(|e| DbError::Query(format!("redis read: {e}")))?;
            data.truncate(len as usize);
            Ok(RespValue::Bulk(Some(data)))
        }
        b'*' => {
            let len: i64 = read_line(stream).await?.parse().unwrap_or(0);
            let mut items = Vec::new();
            for _ in 0..len.max(0) {
                items.push(Box::pin(read_resp(stream)).await?);
            }
            Ok(RespValue::Array(items))
        }
        other => Err(DbError::Query(format!("redis: unexpected RESP byte {other}"))),
    }
}

async fn read_byte(stream: &mut TcpStream) -> Result<u8, DbError> {
    let mut b = [0u8; 1];
    stream.read_exact(&mut b).await
        .map_err(|e| DbError::Query(format!("redis read: {e}")))?;
    Ok(b[0])
}

async fn read_line(stream: &mut TcpStream) -> Result<String, DbError> {
    let mut out = Vec::new();
    loop {
        let b = read_byte(stream).await?;
        if b == b'\r' {
            let lf = read_byte(stream).await?;
            if lf == b'\n' { break; }
            out.push(b);
            out.push(lf);
        } else {
            out.push(b);
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

fn resp_to_string(v: RespValue) -> String {
    match v {
        RespValue::Simple(s) => s,
        RespValue::Integer(i) => i.to_string(),
        RespValue::Bulk(None) => "NULL".into(),
        RespValue::Bulk(Some(b)) => String::from_utf8_lossy(&b).into_owned(),
        RespValue::Array(items) => items.into_iter().map(resp_to_string).collect::<Vec<_>>().join("\n"),
    }
}

fn shell_words(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;
    for ch in input.chars() {
        if escape {
            cur.push(ch);
            escape = false;
            continue;
        }
        if ch == '\\' {
            escape = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q { quote = None; } else { cur.push(ch); }
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn sql_predicate(v: Option<&str>) -> String {
    match v {
        None => "IS NULL".to_string(),
        Some(_) => format!("= {}", sql_value(v)),
    }
}

fn split_table(table: &str, default_schema: &str) -> (String, String) {
    let mut parts = table.splitn(2, '.');
    let first = parts.next().unwrap_or("").to_string();
    match parts.next() {
        Some(second) => (first, second.to_string()),
        None => (default_schema.to_string(), first),
    }
}

fn cell(row: &[Option<String>], idx: usize) -> String {
    row.get(idx).cloned().flatten().unwrap_or_default()
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
