//! Filled in Task 3.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostInput {
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group_name: Option<String>,
    pub tags: Vec<String>,
    pub auth_method: String,
    pub key_path: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

pub struct HostStore;

impl HostStore {
    #[allow(dead_code)]
    pub fn _placeholder() {}
}
