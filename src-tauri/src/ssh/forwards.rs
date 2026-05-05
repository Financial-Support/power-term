use crate::ssh::auth::Auth;
use crate::ssh::handshake::{handshake_and_auth, HandshakeError, KeyCapture, SshTarget};
use async_trait::async_trait;
use base64::Engine;
use parking_lot::Mutex as PLMutex;
use russh::client::{self, Handle, Msg};
use russh::keys::PublicKeyBase64;
use russh::Disconnect;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

#[derive(thiserror::Error, Debug)]
pub enum ForwardError {
    #[error("handshake: {0}")]
    Handshake(String),
    #[error("bind: {0}")]
    Bind(String),
    #[error("any: {0}")]
    Any(String),
}

impl From<HandshakeError> for ForwardError {
    fn from(e: HandshakeError) -> Self {
        ForwardError::Handshake(e.to_string())
    }
}

#[derive(Clone, Debug)]
pub struct ForwardSpec {
    pub kind: ForwardKind,
    pub bind_addr: String,
    pub bind_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ForwardKind {
    Local,
    Remote,
}

/// A live forward — either a tokio TcpListener (Local) or a russh
/// tcpip-forward registration (Remote). Holding this struct keeps the
/// underlying SSH connection alive; dropping or `cancel()`-ing tears it down.
pub struct RunningForward {
    cancel: CancellationToken,
}

impl RunningForward {
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

impl Drop for RunningForward {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

pub async fn start_forward(
    target: SshTarget,
    auth: Auth,
    spec: ForwardSpec,
    connect_timeout: Duration,
    keepalive: Duration,
    known_hosts_path: PathBuf,
) -> Result<Arc<RunningForward>, ForwardError> {
    match spec.kind {
        ForwardKind::Local => {
            start_local(
                target,
                auth,
                spec,
                connect_timeout,
                keepalive,
                known_hosts_path,
            )
            .await
        }
        ForwardKind::Remote => {
            start_remote(
                target,
                auth,
                spec,
                connect_timeout,
                keepalive,
                known_hosts_path,
            )
            .await
        }
    }
}

// ----- Local (-L) -----

async fn start_local(
    target: SshTarget,
    auth: Auth,
    spec: ForwardSpec,
    connect_timeout: Duration,
    keepalive: Duration,
    known_hosts_path: PathBuf,
) -> Result<Arc<RunningForward>, ForwardError> {
    let listener = TcpListener::bind((spec.bind_addr.as_str(), spec.bind_port))
        .await
        .map_err(|e| ForwardError::Bind(e.to_string()))?;

    let session = handshake_and_auth(
        target,
        auth,
        connect_timeout,
        keepalive,
        known_hosts_path,
        None,
        None,
    )
    .await?;
    let session = Arc::new(session);

    let cancel = CancellationToken::new();
    let cancel_inner = cancel.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_inner.cancelled() => break,
                accept = listener.accept() => {
                    let (mut tcp, peer) = match accept {
                        Ok(x) => x,
                        Err(e) => { tracing::warn!(error = %e, "accept failed"); break; }
                    };
                    let session = session.clone();
                    let remote_host = spec.remote_host.clone();
                    let remote_port = spec.remote_port;
                    let conn_cancel = cancel_inner.clone();
                    tokio::spawn(async move {
                        let originator_ip = peer.ip().to_string();
                        let originator_port = peer.port() as u32;
                        let channel = match session.channel_open_direct_tcpip(
                            remote_host, remote_port as u32, originator_ip, originator_port,
                        ).await {
                            Ok(ch) => ch,
                            Err(e) => { tracing::warn!(error = %e, "direct-tcpip open failed"); return; }
                        };
                        let mut stream = channel.into_stream();
                        let _ = tokio::select! {
                            _ = conn_cancel.cancelled() => Ok(()),
                            r = tokio::io::copy_bidirectional(&mut tcp, &mut stream) => r.map(|_| ()),
                        };
                    });
                }
            }
        }
        // Best-effort tear down on cancel.
        let s = match Arc::try_unwrap(session) {
            Ok(s) => s,
            Err(_) => return, // outstanding per-connection tasks still hold the Arc; let drop handle it.
        };
        let _ = s.disconnect(Disconnect::ByApplication, "", "").await;
    });

    Ok(Arc::new(RunningForward { cancel }))
}

// ----- Remote (-R) -----

/// Handler for the post-auth phase. Beyond `check_server_key` (already
/// finished) we need to accept `forwarded-tcpip` channels coming from the
/// SSH server. russh dispatches them via this trait method.
struct ForwardingHandler {
    forward_target: (String, u16),
    cancel: CancellationToken,
    /// Key bytes pinned from the trampoline connection. `check_server_key`
    /// compares byte-for-byte against these — no re-read of known_hosts, so
    /// the TOCTOU window between trampoline and this reconnect is closed.
    pinned_key_type: String,
    pinned_key_b64: String,
}

#[async_trait]
impl client::Handler for ForwardingHandler {
    type Error = russh::Error;

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let local = self.forward_target.clone();
        let cancel = self.cancel.clone();
        tokio::spawn(async move {
            let mut stream = channel.into_stream();
            let mut local_tcp = match tokio::net::TcpStream::connect((local.0.as_str(), local.1)).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, "remote forward: local connect failed");
                    let _ = stream.shutdown().await;
                    return;
                }
            };
            let _ = tokio::select! {
                _ = cancel.cancelled() => Ok(()),
                r = tokio::io::copy_bidirectional(&mut stream, &mut local_tcp) => r.map(|_| ()),
            };
        });
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        key: &russh::keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = key.name().to_string();
        let raw = key.public_key_bytes();
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(&raw);
        Ok(key_type == self.pinned_key_type && key_b64 == self.pinned_key_b64)
    }
}

async fn start_remote(
    target: SshTarget,
    auth: Auth,
    spec: ForwardSpec,
    connect_timeout: Duration,
    keepalive: Duration,
    known_hosts_path: PathBuf,
) -> Result<Arc<RunningForward>, ForwardError> {
    let cancel = CancellationToken::new();

    // Trampoline: run the shared host-key check + auth once. This persists
    // any TOFU acceptance into ~/.ssh/known_hosts, then we discard the handle
    // because remote forwards need a session whose Handler implements
    // server_channel_open_forwarded_tcpip.
    let key_capture: KeyCapture = Some(Arc::new(PLMutex::new(None)));
    {
        let h = handshake_and_auth(
            target.clone(),
            auth.clone(),
            connect_timeout,
            keepalive,
            known_hosts_path,
            None,
            key_capture.clone(),
        )
        .await?;
        drop(h);
    }
    let (pinned_key_type, pinned_key_b64) = key_capture
        .as_ref()
        .and_then(|c| c.lock().take())
        .ok_or_else(|| ForwardError::Any("trampoline did not capture server key".into()))?;

    // Real connection wired to the forwarding handler. ForwardingHandler
    // compares the key bytes against what the trampoline pinned — no re-read
    // of known_hosts, so the TOCTOU window is closed.
    let handler = ForwardingHandler {
        forward_target: (spec.remote_host.clone(), spec.remote_port),
        cancel: cancel.clone(),
        pinned_key_type,
        pinned_key_b64,
    };
    let config = client::Config {
        inactivity_timeout: Some(keepalive * 4),
        keepalive_interval: Some(keepalive),
        ..Default::default()
    };
    let connect_future = client::connect(
        Arc::new(config),
        (target.host.as_str(), target.port),
        handler,
    );
    let mut session = tokio::time::timeout(connect_timeout, connect_future)
        .await
        .map_err(|_| ForwardError::Any("timed out".into()))?
        .map_err(|e| ForwardError::Any(format!("connect: {e}")))?;

    let authed = match auth {
        Auth::Password { password } => session
            .authenticate_password(target.user.clone(), password)
            .await
            .map_err(|e| ForwardError::Any(format!("auth password: {e}")))?,
        Auth::KeyFile { path, passphrase } => {
            let key = crate::ssh::auth::load_key_from_file(&path, passphrase.as_deref())
                .map_err(|e| match e {
                    crate::ssh::SshError::Any(s) => ForwardError::Any(s),
                    other => ForwardError::Any(other.to_string()),
                })?;
            session
                .authenticate_publickey(target.user.clone(), Arc::new(key))
                .await
                .map_err(|e| ForwardError::Any(format!("auth publickey: {e}")))?
        }
        Auth::KeyContent { content, passphrase } => {
            let key = crate::ssh::auth::load_key_from_content(&content, passphrase.as_deref())
                .map_err(|e| match e {
                    crate::ssh::SshError::Any(s) => ForwardError::Any(s),
                    other => ForwardError::Any(other.to_string()),
                })?;
            session
                .authenticate_publickey(target.user.clone(), Arc::new(key))
                .await
                .map_err(|e| ForwardError::Any(format!("auth publickey: {e}")))?
        }
        Auth::Agent => authenticate_agent_via(&mut session, target.user.clone()).await?,
    };
    if !authed {
        let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
        return Err(ForwardError::Any("authentication failed".into()));
    }

    session
        .tcpip_forward(&spec.bind_addr, spec.bind_port as u32)
        .await
        .map_err(|e| ForwardError::Any(format!("tcpip_forward: {e}")))?;

    let cancel_inner = cancel.clone();
    tauri::async_runtime::spawn(async move {
        cancel_inner.cancelled().await;
        let _ = session.disconnect(Disconnect::ByApplication, "", "").await;
    });

    Ok(Arc::new(RunningForward { cancel }))
}

async fn authenticate_agent_via(
    session: &mut Handle<ForwardingHandler>,
    user: String,
) -> Result<bool, ForwardError> {
    let mut listing_agent = russh_keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| ForwardError::Any(format!("agent connect: {e}")))?;
    let identities = listing_agent
        .request_identities()
        .await
        .map_err(|e| ForwardError::Any(format!("agent identities: {e}")))?;
    drop(listing_agent);
    for id in identities {
        let signer = russh_keys::agent::client::AgentClient::connect_env()
            .await
            .map_err(|e| ForwardError::Any(format!("agent reconnect: {e}")))?;
        let (_signer, ok) = session
            .authenticate_future(user.clone(), id, signer)
            .await;
        match ok {
            Ok(true) => return Ok(true),
            Ok(false) => continue,
            Err(e) => return Err(ForwardError::Any(format!("agent authenticate: {e}"))),
        }
    }
    Ok(false)
}
