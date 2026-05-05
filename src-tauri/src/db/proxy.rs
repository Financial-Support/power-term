//! Transient single-shot port forward used to give plain-TCP database
//! drivers a way through the SSH session. Spawns a listener on
//! `127.0.0.1:0`, returns the OS-assigned port, and tunnels every
//! incoming connection to the requested `(remote_host, remote_port)`
//! over a russh `direct-tcpip` channel.
//!
//! Cancellation: dropping the returned `DbProxy` (or calling `cancel()`)
//! signals the accept loop and any in-flight per-connection bridges to
//! stop, after which the SSH channels close on their own.
use crate::ssh::handshake::ClientHandler;
use russh::client::Handle;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

#[derive(thiserror::Error, Debug)]
pub enum ProxyError {
    #[error("bind: {0}")]
    Bind(#[from] std::io::Error),
}

pub struct DbProxy {
    pub local_port: u16,
    cancel: CancellationToken,
}

impl DbProxy {
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
}

impl Drop for DbProxy {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

pub async fn spawn(
    ssh: Arc<Handle<ClientHandler>>,
    remote_host: String,
    remote_port: u16,
) -> Result<DbProxy, ProxyError> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_port = listener.local_addr()?.port();
    let cancel = CancellationToken::new();
    let cancel_inner = cancel.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_inner.cancelled() => break,
                accept = listener.accept() => {
                    let (mut tcp, peer) = match accept {
                        Ok(x) => x,
                        Err(e) => {
                            tracing::warn!(error = %e, "db proxy accept failed");
                            break;
                        }
                    };
                    let ssh = ssh.clone();
                    let host = remote_host.clone();
                    let port = remote_port;
                    let conn_cancel = cancel_inner.clone();
                    tokio::spawn(async move {
                        let originator_ip = peer.ip().to_string();
                        let originator_port = peer.port() as u32;
                        let channel = match ssh
                            .channel_open_direct_tcpip(host, port as u32, originator_ip, originator_port)
                            .await
                        {
                            Ok(ch) => ch,
                            Err(e) => {
                                tracing::warn!(error = %e, "db proxy: direct-tcpip open failed");
                                return;
                            }
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
    });

    Ok(DbProxy { local_port, cancel })
}
