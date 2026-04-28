//! Filled out in Task 3 — for now we lock the wire-format shape so the
//! frontend types in Task 6 can compile against a stable contract.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub kind: String,            // "file" | "dir" | "symlink" | "other"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_serializes_with_snake_case_fields() {
        let e = SftpEntry {
            name: "foo.txt".into(),
            kind: "file".into(),
            size: 1234,
            modified_ms: Some(1_700_000_000_000),
            permissions: 0o644,
            symlink_target: None,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"name\":\"foo.txt\""));
        assert!(json.contains("\"kind\":\"file\""));
        assert!(json.contains("\"size\":1234"));
        assert!(json.contains("\"modified_ms\":1700000000000"));
        assert!(json.contains("\"permissions\":420"));
        assert!(json.contains("\"symlink_target\":null"));
    }

    #[test]
    fn entry_kinds_serialize_as_lowercase_strings() {
        for k in ["file", "dir", "symlink", "other"] {
            let e = SftpEntry {
                name: "x".into(), kind: k.into(), size: 0,
                modified_ms: None, permissions: 0, symlink_target: None,
            };
            let json = serde_json::to_string(&e).unwrap();
            assert!(json.contains(&format!("\"kind\":\"{k}\"")));
        }
    }

    #[test]
    fn entry_with_symlink_target() {
        let e = SftpEntry {
            name: "link".into(), kind: "symlink".into(), size: 0,
            modified_ms: None, permissions: 0, symlink_target: Some("real".into()),
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"symlink_target\":\"real\""));
    }
}
