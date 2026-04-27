//! Filled in Task 5.
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
}

pub struct SshSession;

impl SshSession {
    #[allow(dead_code)]
    pub fn _placeholder(_path: PathBuf) {}
}
