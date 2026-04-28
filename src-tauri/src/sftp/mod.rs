pub mod manager;
pub mod session;

pub use manager::SftpManager;
pub use session::{SftpEntry, SftpSession};

pub type SftpId = String;

#[derive(thiserror::Error, Debug)]
pub enum SftpError {
    #[error("connect failed: {0}")]
    Connect(String),
    #[error("ssh handshake failed: {0}")]
    Handshake(String),
    #[error("authentication failed")]
    Auth,
    #[error("host fingerprint unknown")]
    UnknownFingerprint { fingerprint: String, host: String, key_type: String },
    #[error("host fingerprint mismatch")]
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    #[error("not found: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown sftp id: {0}")]
    Unknown(String),
    #[error("any: {0}")]
    Any(String),
}
