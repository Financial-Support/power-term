//! Database query runner. Each session opens a regular SSH session, spawns
//! a transient `127.0.0.1:0` listener that bridges incoming TCP connections
//! to a russh `direct-tcpip` channel, and connects the engine-specific
//! driver (tokio-postgres or mysql_async) through that listener. Drivers
//! talk plain TCP — they don't need to know SSH exists.
//!
//! The whole stack tears down when the session's `close()` is called or
//! when the session is dropped: cancellation token cancels the bridging
//! tasks, the channel closes, and the SSH handle is best-effort
//! disconnected.

pub mod manager;
pub mod proxy;
pub mod session;

pub use manager::DbManager;
pub use session::{DbCell, DbColumn, DbError, DbIndex, DbSession, QueryResult, TableMeta};
