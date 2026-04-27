mod manager;
mod session;

pub use manager::PtyManager;
pub use session::{PtyEvent, PtySession, SpawnConfig};

pub type PtyId = String;

#[derive(thiserror::Error, Debug)]
pub enum PtyError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown pty id: {0}")]
    Unknown(String),
    #[error("any: {0}")]
    Any(String),
}
