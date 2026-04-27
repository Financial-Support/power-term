pub mod auth;
pub mod known_hosts;
pub mod manager;
pub mod session;

pub use manager::SshManager;
pub use session::{SshSession, SshTarget};

pub type SshId = String;

#[derive(thiserror::Error, Debug)]
pub enum SshError {
    #[error("connect failed: {0}")]
    Connect(String),
    #[error("ssh handshake failed: {0}")]
    Handshake(String),
    #[error("authentication failed")]
    Auth,
    #[error("authentication required")]
    NeedsAuth { available: Vec<String> },
    #[error("host fingerprint unknown")]
    UnknownFingerprint { fingerprint: String, host: String, key_type: String },
    #[error("host fingerprint mismatch")]
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown ssh id: {0}")]
    Unknown(String),
    #[error("any: {0}")]
    Any(String),
}
