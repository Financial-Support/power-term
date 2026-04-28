use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Serialize};

pub const SUPABASE_URL: Option<&str> = option_env!("POWER_TERM_SUPABASE_URL");
pub const SUPABASE_ANON_KEY: Option<&str> = option_env!("POWER_TERM_SUPABASE_ANON_KEY");

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("Supabase not configured — set POWER_TERM_SUPABASE_URL and POWER_TERM_SUPABASE_ANON_KEY at build time")]
    NotConfigured,
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("api error {status}: {body}")]
    Api { status: u16, body: String },
    #[error("json: {0}")]
    Json(String),
}

pub struct SupabaseClient {
    client: Client,
    base_url: String,
    anon_key: String,
    access_token: String,
}

impl SupabaseClient {
    pub fn new(access_token: String) -> Result<Self, ClientError> {
        let base_url = SUPABASE_URL.ok_or(ClientError::NotConfigured)?.trim_end_matches('/').to_string();
        let anon_key = SUPABASE_ANON_KEY.ok_or(ClientError::NotConfigured)?.to_string();
        Ok(Self { client: Client::new(), base_url, anon_key, access_token })
    }

    fn table_url(&self, table: &str) -> String {
        format!("{}/rest/v1/{}", self.base_url, table)
    }

    pub async fn select<T: DeserializeOwned>(&self, table: &str, filter: &str) -> Result<Vec<T>, ClientError> {
        let url = if filter.is_empty() {
            self.table_url(table)
        } else {
            format!("{}?{}", self.table_url(table), filter)
        };
        let resp = self.client
            .get(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Accept", "application/json")
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClientError::Api { status: status.as_u16(), body });
        }
        resp.json::<Vec<T>>().await.map_err(|e| ClientError::Json(e.to_string()))
    }

    pub async fn upsert<T: Serialize>(&self, table: &str, row: &T) -> Result<(), ClientError> {
        let url = format!("{}?on_conflict=id", self.table_url(table));
        let resp = self.client
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(row)
            .send()
            .await?;
        let status = resp.status();
        if status == StatusCode::NO_CONTENT || status.is_success() { return Ok(()); }
        let body = resp.text().await.unwrap_or_default();
        Err(ClientError::Api { status: status.as_u16(), body })
    }

    pub async fn upsert_settings<T: Serialize>(&self, row: &T) -> Result<(), ClientError> {
        let url = format!("{}?on_conflict=user_id", self.table_url("settings"));
        let resp = self.client
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", self.access_token))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(row)
            .send()
            .await?;
        let status = resp.status();
        if status == StatusCode::NO_CONTENT || status.is_success() { return Ok(()); }
        let body = resp.text().await.unwrap_or_default();
        Err(ClientError::Api { status: status.as_u16(), body })
    }

    pub async fn refresh_token(refresh_token: &str) -> Result<(String, String), ClientError> {
        let base_url = SUPABASE_URL.ok_or(ClientError::NotConfigured)?.trim_end_matches('/');
        let anon_key = SUPABASE_ANON_KEY.ok_or(ClientError::NotConfigured)?;
        let client = Client::new();
        let url = format!("{base_url}/auth/v1/token?grant_type=refresh_token");
        let resp = client
            .post(&url)
            .header("apikey", anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ClientError::Api { status: status.as_u16(), body });
        }
        let v: serde_json::Value = resp.json().await.map_err(|e| ClientError::Json(e.to_string()))?;
        let access = v["access_token"].as_str().ok_or_else(|| ClientError::Json("missing access_token".into()))?.to_string();
        let refresh = v["refresh_token"].as_str().ok_or_else(|| ClientError::Json("missing refresh_token".into()))?.to_string();
        Ok((access, refresh))
    }
}

/// Get a valid access token — refresh if expired.
pub async fn get_valid_token() -> Result<String, ClientError> {
    let access = crate::sync::auth::load_access_token()
        .map_err(|e| ClientError::Json(e.to_string()))?;
    let Some(token) = access else {
        return Err(ClientError::Api { status: 401, body: "not signed in".into() });
    };
    if !crate::sync::auth::is_token_expired(&token) {
        return Ok(token);
    }
    let refresh = crate::sync::auth::load_refresh_token()
        .map_err(|e| ClientError::Json(e.to_string()))?
        .ok_or_else(|| ClientError::Api { status: 401, body: "refresh token missing".into() })?;
    let (new_access, new_refresh) = SupabaseClient::refresh_token(&refresh).await?;
    crate::sync::auth::store_access_token(&new_access).map_err(|e| ClientError::Json(e.to_string()))?;
    crate::sync::auth::store_refresh_token(&new_refresh).map_err(|e| ClientError::Json(e.to_string()))?;
    Ok(new_access)
}
