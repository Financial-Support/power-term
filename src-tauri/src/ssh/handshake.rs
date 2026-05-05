//! Shared SSH handshake + host-key verification + auth.
//!
//! `ssh::session` (terminal shells), `sftp::session` (file transfers), and
//! `ssh::forwards` (port forwards) all need the same connect-and-authenticate
//! sequence. They diverge only in what they ask of the channel afterwards
//! (request_pty + shell vs. sftp subsystem vs. direct-tcpip).
use crate::ssh::auth::Auth;
use crate::ssh::known_hosts::{fingerprint_sha256, HostVerdict, KnownHosts};
use async_trait::async_trait;
use base64::Engine;
use parking_lot::Mutex as PLMutex;
use russh::client::{self, Handle, Handler};
use russh::keys::key::PublicKey;
use russh::keys::PublicKeyBase64;
use russh::Disconnect;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[derive(thiserror::Error, Debug)]
pub enum HandshakeError {
    #[error("connect failed: {0}")]
    Connect(String),
    #[error("ssh handshake failed: {0}")]
    Handshake(String),
    #[error("authentication failed")]
    Auth,
    #[error("host fingerprint unknown")]
    UnknownFingerprint {
        fingerprint: String,
        host: String,
        key_type: String,
    },
    #[error("host fingerprint mismatch")]
    FingerprintMismatch {
        fingerprint: String,
        expected: String,
        host: String,
    },
    #[error("any: {0}")]
    Any(String),
}

#[derive(Clone, Debug)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
}

#[derive(Debug, Clone)]
enum HostKeyVerdict {
    Trusted,
    Unknown {
        fingerprint: String,
        key_type: String,
    },
    Mismatch {
        fingerprint: String,
        expected_b64: String,
        expected_type: String,
    },
    /// Caller passed `accepted_fingerprint = X` but server presented Y. TOCTOU
    /// defense: never authenticate to a different key than what the user
    /// clicked Accept on, even if the new key is ALSO unknown.
    AcceptedMismatch {
        accepted: String,
        live: String,
    },
}

/// Shared cell for callers that need the accepted `(key_type, key_b64)` bytes
/// after `handshake_and_auth` returns (TOCTOU defense for re-connects).
pub type KeyCapture = Option<Arc<PLMutex<Option<(String, String)>>>>;

pub struct ClientHandler {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
    accepted: Option<String>,
    verdict: Arc<PLMutex<Option<HostKeyVerdict>>>,
    /// If set, the accepted (key_type, key_b64) bytes are written here when
    /// check_server_key returns Ok(true), so callers can pin them for later
    /// byte-for-byte comparison (TOCTOU defense for re-connects).
    key_capture: KeyCapture,
}

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let key_type = key.name().to_string();
        let raw = key.public_key_bytes();
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(&raw);
        let fingerprint =
            fingerprint_sha256(&key_b64).map_err(|_| russh::Error::Inconsistent)?;
        let kh = KnownHosts::at(self.known_hosts_path.clone());

        if let Some(accepted) = &self.accepted {
            if accepted == &fingerprint {
                // User accepted THIS exact fingerprint via the renderer modal.
                // Persist it so the next connect doesn't re-prompt; replace any
                // prior entry for this host (covers both new-host and reset
                // mismatch flows). Persistence failure is non-fatal: we still
                // trust this connection for the user's current intent.
                if let Err(e) = kh.replace_for_host(&self.host, self.port, &key_type, &key_b64) {
                    tracing::warn!(error = %e, host = %self.host, "failed to persist accepted host key");
                }
                *self.verdict.lock() = Some(HostKeyVerdict::Trusted);
                if let Some(cap) = &self.key_capture {
                    *cap.lock() = Some((key_type, key_b64));
                }
                return Ok(true);
            }
            // accept_fingerprint set but server presented a different key.
            // Refuse authentication — user must explicitly accept the new
            // fingerprint.
            *self.verdict.lock() = Some(HostKeyVerdict::AcceptedMismatch {
                accepted: accepted.clone(),
                live: fingerprint,
            });
            return Ok(false);
        }

        let v = kh
            .verify(&self.host, self.port, &key_type, &key_b64)
            .map_err(|_| russh::Error::Inconsistent)?;
        match v {
            HostVerdict::Match => {
                *self.verdict.lock() = Some(HostKeyVerdict::Trusted);
                if let Some(cap) = &self.key_capture {
                    *cap.lock() = Some((key_type, key_b64));
                }
                Ok(true)
            }
            HostVerdict::Unknown => {
                *self.verdict.lock() = Some(HostKeyVerdict::Unknown {
                    fingerprint,
                    key_type,
                });
                Ok(false)
            }
            HostVerdict::Mismatch { expected } => {
                *self.verdict.lock() = Some(HostKeyVerdict::Mismatch {
                    fingerprint,
                    expected_b64: expected.key_b64,
                    expected_type: expected.key_type,
                });
                Ok(false)
            }
        }
    }
}

/// Connect, verify host key, authenticate. Returns the russh `Handle` ready for
/// channel-open or subsystem requests. `accepted_fingerprint` short-circuits
/// the known_hosts check when the user has just clicked Accept on a TOFU prompt.
/// If `key_capture` is `Some`, the accepted `(key_type, key_b64)` bytes are
/// written into the cell so callers can pin them for TOCTOU-safe re-connects.
pub async fn handshake_and_auth(
    target: SshTarget,
    auth: Auth,
    connect_timeout: Duration,
    keepalive: Duration,
    known_hosts_path: PathBuf,
    accepted_fingerprint: Option<String>,
    key_capture: KeyCapture,
) -> Result<Handle<ClientHandler>, HandshakeError> {
    let config = client::Config {
        inactivity_timeout: Some(keepalive * 4),
        keepalive_interval: Some(keepalive),
        ..Default::default()
    };
    let config = Arc::new(config);

    let verdict = Arc::new(PLMutex::new(None::<HostKeyVerdict>));
    let handler = ClientHandler {
        host: target.host.clone(),
        port: target.port,
        known_hosts_path,
        accepted: accepted_fingerprint,
        verdict: verdict.clone(),
        key_capture,
    };

    let connect_future = client::connect(config, (target.host.as_str(), target.port), handler);
    let connect_result = tokio::time::timeout(connect_timeout, connect_future)
        .await
        .map_err(|_| HandshakeError::Connect("timed out".into()))?;

    // When check_server_key returns Ok(false), russh aborts the handshake
    // and `connect_result` is Err(_). Translate that to the typed
    // fingerprint error using the verdict we captured inside the handler,
    // BEFORE falling back to a generic Handshake error.
    let captured_verdict = verdict.lock().clone();
    match captured_verdict {
        Some(HostKeyVerdict::Unknown {
            fingerprint,
            key_type,
        }) => {
            return Err(HandshakeError::UnknownFingerprint {
                fingerprint,
                host: target.host.clone(),
                key_type,
            });
        }
        Some(HostKeyVerdict::Mismatch {
            fingerprint,
            expected_b64,
            expected_type,
        }) => {
            return Err(HandshakeError::FingerprintMismatch {
                fingerprint,
                expected: format!("{expected_type} {expected_b64}"),
                host: target.host.clone(),
            });
        }
        Some(HostKeyVerdict::AcceptedMismatch { accepted, live }) => {
            return Err(HandshakeError::Any(format!(
                "fingerprint did not match server: accepted {accepted}, server presented {live}"
            )));
        }
        // Trusted or None — fall through; connect_result will be Ok.
        _ => {}
    }

    let mut session: Handle<ClientHandler> = connect_result
        .map_err(|e| HandshakeError::Handshake(e.to_string()))?;

    // Defense in depth: re-check verdict if anything mutated post-connect.
    let captured_verdict = verdict.lock().clone();
    if let Some(v) = captured_verdict {
        match v {
            HostKeyVerdict::Trusted => {}
            HostKeyVerdict::Unknown {
                fingerprint,
                key_type,
            } => {
                let _ = session
                    .disconnect(Disconnect::ByApplication, "", "")
                    .await;
                return Err(HandshakeError::UnknownFingerprint {
                    fingerprint,
                    host: target.host.clone(),
                    key_type,
                });
            }
            HostKeyVerdict::Mismatch {
                fingerprint,
                expected_b64,
                expected_type,
            } => {
                let _ = session
                    .disconnect(Disconnect::ByApplication, "", "")
                    .await;
                return Err(HandshakeError::FingerprintMismatch {
                    fingerprint,
                    expected: format!("{expected_type} {expected_b64}"),
                    host: target.host.clone(),
                });
            }
            HostKeyVerdict::AcceptedMismatch { accepted, live } => {
                let _ = session
                    .disconnect(Disconnect::ByApplication, "", "")
                    .await;
                return Err(HandshakeError::Any(format!(
                    "fingerprint did not match server: accepted {accepted}, server presented {live}"
                )));
            }
        }
    }

    // Authenticate. Each russh authenticate_* method returns:
    //   Ok(true)  -> server accepted the credentials
    //   Ok(false) -> server cleanly rejected (wrong password, no matching key) — falls through
    //                to the `if !authed` check below, which surfaces HandshakeError::Auth.
    //   Err(_)    -> protocol/transport error (rare); surfaced as HandshakeError::Any.
    let user = target.user.clone();
    let authed = match auth {
        Auth::Password { password } => session
            .authenticate_password(user, password)
            .await
            .map_err(|e| HandshakeError::Any(format!("auth password: {e}")))?,
        Auth::KeyFile { path, passphrase } => {
            let key = crate::ssh::auth::load_key_from_file(&path, passphrase.as_deref())
                // Avoid the `any: any: ...` double-prefix when SshError::Any
                // displays as `any: …` — unwrap the inner message instead.
                .map_err(|e| match e {
                    crate::ssh::SshError::Any(s) => HandshakeError::Any(s),
                    other => HandshakeError::Any(other.to_string()),
                })?;
            session
                .authenticate_publickey(user, Arc::new(key))
                .await
                .map_err(|e| HandshakeError::Any(format!("auth publickey: {e}")))?
        }
        Auth::Agent => authenticate_agent(&mut session, user).await?,
    };
    if !authed {
        let _ = session
            .disconnect(Disconnect::ByApplication, "", "")
            .await;
        return Err(HandshakeError::Auth);
    }
    Ok(session)
}

/// Authenticate against `session` by walking through identities offered by the
/// running ssh-agent.  Each `authenticate_future` call consumes the agent
/// connection, so we reconnect for every attempt.
async fn authenticate_agent(
    session: &mut Handle<ClientHandler>,
    user: String,
) -> Result<bool, HandshakeError> {
    let mut listing_agent = russh_keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| HandshakeError::Any(format!("agent connect: {e}")))?;
    let identities = listing_agent
        .request_identities()
        .await
        .map_err(|e| HandshakeError::Any(format!("agent identities: {e}")))?;
    drop(listing_agent);
    for id in identities {
        // Each attempt needs a fresh agent connection because
        // `authenticate_future` consumes the Signer.
        let signer = match russh_keys::agent::client::AgentClient::connect_env().await {
            Ok(c) => c,
            Err(e) => return Err(HandshakeError::Any(format!("agent signer reconnect: {e}"))),
        };
        let (_signer, ok) = session.authenticate_future(user.clone(), id, signer).await;
        match ok {
            Ok(true) => return Ok(true),
            Ok(false) => continue,
            Err(e) => return Err(HandshakeError::Any(format!("agent authenticate: {e}"))),
        }
    }
    Ok(false)
}
