pub mod db;
pub mod host;
pub mod schema;
pub mod secrets;

pub use db::Db;
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
