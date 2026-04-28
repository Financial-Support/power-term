//! Filled in Task 3.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub permissions: u32,
    pub symlink_target: Option<String>,
}

pub struct SftpSession;

impl SftpSession {
    #[allow(dead_code)]
    pub fn _placeholder() {}
}
