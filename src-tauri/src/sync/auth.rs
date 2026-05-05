use crate::store::SecretError;

const SERVICE: &str = "com.band.power-term";
const ACCOUNT_ACCESS: &str = "sync:access_token";
const ACCOUNT_REFRESH: &str = "sync:refresh_token";
const ACCOUNT_KEY: &str = "sync:key";
const ACCOUNT_OAUTH_STATE: &str = "sync:oauth_state";

pub fn store_access_token(token: &str) -> Result<(), SecretError> {
    crate::store::secrets::backend_set(SERVICE, ACCOUNT_ACCESS, token)
}

pub fn load_access_token() -> Result<Option<String>, SecretError> {
    crate::store::secrets::backend_get(SERVICE, ACCOUNT_ACCESS)
}

pub fn store_refresh_token(token: &str) -> Result<(), SecretError> {
    crate::store::secrets::backend_set(SERVICE, ACCOUNT_REFRESH, token)
}

pub fn load_refresh_token() -> Result<Option<String>, SecretError> {
    crate::store::secrets::backend_get(SERVICE, ACCOUNT_REFRESH)
}

pub fn clear_tokens() -> Result<(), SecretError> {
    crate::store::secrets::backend_delete(SERVICE, ACCOUNT_ACCESS)?;
    crate::store::secrets::backend_delete(SERVICE, ACCOUNT_REFRESH)?;
    Ok(())
}

pub fn store_sync_key_bytes(key: &[u8; 32]) -> Result<(), SecretError> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    crate::store::secrets::backend_set(SERVICE, ACCOUNT_KEY, &encoded)
}

pub fn load_sync_key_bytes() -> Result<Option<[u8; 32]>, SecretError> {
    use base64::Engine;
    match crate::store::secrets::backend_get(SERVICE, ACCOUNT_KEY)? {
        None => Ok(None),
        Some(encoded) => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&encoded)
                .map_err(|e| SecretError::Keyring(format!("base64: {e}")))?;
            if bytes.len() != 32 {
                return Err(SecretError::Keyring("sync key wrong length".to_string()));
            }
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            Ok(Some(arr))
        }
    }
}

pub fn delete_sync_key() -> Result<(), SecretError> {
    crate::store::secrets::backend_delete(SERVICE, ACCOUNT_KEY)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncUser {
    pub id: String,
    pub email: Option<String>,
}

/// Decode user info from a JWT payload (base64url middle segment).
pub fn user_from_jwt(token: &str) -> Option<SyncUser> {
    use base64::Engine;
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 { return None; }
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&payload).ok()?;
    let id = v.get("sub")?.as_str()?.to_string();
    let email = v.get("email").and_then(|e| e.as_str()).map(|s| s.to_string());
    Some(SyncUser { id, email })
}

/// Returns true if the JWT exp claim is in the past.
pub fn is_token_expired(token: &str) -> bool {
    use base64::Engine;
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 { return true; }
    let Ok(payload) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) else {
        return true;
    };
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(&payload) else {
        return true;
    };
    let Some(exp) = v.get("exp").and_then(|e| e.as_u64()) else {
        return true;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    exp < now
}

/// Build the Supabase GitHub OAuth URL with an anti-CSRF `state` parameter.
/// The state is persisted to Keychain so we can validate it when the
/// `power-term://auth/callback` deep-link comes back. Without this, any
/// process that registers the scheme could deliver a forged callback and
/// have its tokens accepted as ours.
///
/// Supabase doesn't round-trip the `state` query parameter we send to
/// `/auth/v1/authorize` — it only forwards `access_token`/`refresh_token`
/// in the URL fragment of `redirect_to`. So we embed our state inside
/// the redirect URL itself: `power-term://auth/callback?state=<X>`.
/// After Supabase appends `#access_token=...&refresh_token=...`, the
/// final callback carries both pieces and the parser reads each from
/// its own URL section.
pub fn oauth_url(supabase_url: &str) -> Result<String, SecretError> {
    let state = generate_oauth_state();
    crate::store::secrets::backend_set(SERVICE, ACCOUNT_OAUTH_STATE, &state)?;
    let redirect_to = format!("power-term://auth/callback?state={state}");
    let redirect_to_encoded: String =
        url::form_urlencoded::byte_serialize(redirect_to.as_bytes()).collect();
    Ok(format!(
        "{supabase_url}/auth/v1/authorize?provider=github&redirect_to={redirect_to_encoded}"
    ))
}

/// Read and clear the pending OAuth `state`. Returns `None` if no flow is
/// in progress; callers must reject the callback in that case.
pub fn take_oauth_state() -> Result<Option<String>, SecretError> {
    let state = crate::store::secrets::backend_get(SERVICE, ACCOUNT_OAUTH_STATE)?;
    let _ = crate::store::secrets::backend_delete(SERVICE, ACCOUNT_OAUTH_STATE);
    Ok(state)
}

fn generate_oauth_state() -> String {
    use aes_gcm::aead::{rand_core::RngCore, OsRng};
    let mut buf = [0u8; 24];
    OsRng.fill_bytes(&mut buf);
    bs58::encode(buf).into_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_jwt(sub: &str, email: &str, exp: u64) -> String {
        use base64::Engine;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"HS256","typ":"JWT"}"#);
        let payload_json = format!(r#"{{"sub":"{sub}","email":"{email}","exp":{exp}}}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload_json.as_bytes());
        format!("{header}.{payload}.fakesig")
    }

    #[test]
    fn user_from_jwt_extracts_fields() {
        let token = make_jwt("user-123", "a@b.com", 9999999999);
        let user = user_from_jwt(&token).unwrap();
        assert_eq!(user.id, "user-123");
        assert_eq!(user.email.as_deref(), Some("a@b.com"));
    }

    #[test]
    fn user_from_jwt_returns_none_for_malformed() {
        assert!(user_from_jwt("notajwt").is_none());
    }

    #[test]
    fn is_token_expired_past_exp() {
        let token = make_jwt("u", "e@e.com", 1);
        assert!(is_token_expired(&token));
    }

    #[test]
    fn is_token_expired_future_exp() {
        let token = make_jwt("u", "e@e.com", 9999999999);
        assert!(!is_token_expired(&token));
    }

    #[cfg(feature = "mock-keychain")]
    #[test]
    fn oauth_url_contains_provider_redirect_and_state() {
        let raw = oauth_url("https://xyz.supabase.co").unwrap();
        assert!(raw.starts_with("https://xyz.supabase.co"));
        let parsed = url::Url::parse(&raw).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(pairs.get("provider").map(String::as_str), Some("github"));
        // redirect_to is URL-encoded; query_pairs gives us the decoded value.
        let redirect_to = pairs.get("redirect_to").expect("redirect_to present");
        assert!(redirect_to.starts_with("power-term://auth/callback?state="));
        // state is persisted so the callback can validate it
        let state = take_oauth_state().unwrap();
        assert!(state.is_some());
        // and consumed on read
        assert!(take_oauth_state().unwrap().is_none());
    }

    #[test]
    fn generate_oauth_state_is_unique() {
        let a = generate_oauth_state();
        let b = generate_oauth_state();
        assert_ne!(a, b);
        assert!(a.len() >= 30, "state should be long enough to resist guessing");
    }

    #[cfg(feature = "mock-keychain")]
    #[test]
    fn token_round_trip() {
        store_access_token("tok123").unwrap();
        assert_eq!(load_access_token().unwrap(), Some("tok123".to_string()));
        clear_tokens().unwrap();
        assert_eq!(load_access_token().unwrap(), None);
    }

    #[cfg(feature = "mock-keychain")]
    #[test]
    fn sync_key_round_trip() {
        let key = crate::sync::encrypt::generate_key();
        store_sync_key_bytes(&key).unwrap();
        let loaded = load_sync_key_bytes().unwrap().unwrap();
        assert_eq!(key, loaded);
        delete_sync_key().unwrap();
        assert!(load_sync_key_bytes().unwrap().is_none());
    }
}
