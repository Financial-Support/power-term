//! SSH session: russh client wrapper that mirrors the `PtySession` shape.
//!
//! The reader-loop / event-channel pattern matches `PtySession` exactly so the
//! manager (Task 6) can reuse the same forwarder for both transports.
//!
//! Architecture: the underlying `russh::Channel<Msg>` is not `Clone`. Rather
//! than wrap it in a mutex (which would block writes while the reader awaits
//! `wait()`), we keep the channel inside the reader task and route
//! write/resize/kill operations to it through a tokio mpsc command channel.
use crate::pty::PtyEvent;
use crate::ssh::auth::Auth;
use crate::ssh::handshake::{handshake_and_auth, HandshakeError};
use crate::ssh::SshError;
use russh::client::Msg;
use russh::{ChannelMsg, Disconnect};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc as tmpsc, oneshot};
use tokio_util::sync::CancellationToken;

pub use crate::ssh::handshake::SshTarget;

fn handshake_to_ssh_err(e: HandshakeError) -> SshError {
    match e {
        HandshakeError::Connect(s) => SshError::Connect(s),
        HandshakeError::Handshake(s) => SshError::Handshake(s),
        HandshakeError::Auth => SshError::Auth,
        HandshakeError::UnknownFingerprint {
            fingerprint,
            host,
            key_type,
        } => SshError::UnknownFingerprint {
            fingerprint,
            host,
            key_type,
        },
        HandshakeError::FingerprintMismatch {
            fingerprint,
            expected,
            host,
        } => SshError::FingerprintMismatch {
            fingerprint,
            expected,
            host,
        },
        HandshakeError::Any(s) => SshError::Any(s),
    }
}

/// Commands sent from `SshSession` methods to the reader task that owns the
/// `russh::Channel`.
enum Command {
    Write {
        data: Vec<u8>,
        ack: oneshot::Sender<Result<(), russh::Error>>,
    },
    Resize {
        cols: u16,
        rows: u16,
        ack: oneshot::Sender<Result<(), russh::Error>>,
    },
}

pub struct SshSession {
    cmd_tx: tmpsc::Sender<Command>,
    cancel: CancellationToken,
}

impl SshSession {
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        target: SshTarget,
        auth: Auth,
        cols: u16,
        rows: u16,
        connect_timeout: Duration,
        keepalive: Duration,
        known_hosts_path: std::path::PathBuf,
        accepted_fingerprint: Option<String>,
    ) -> Result<(Arc<Self>, mpsc::Receiver<PtyEvent>), SshError> {
        let session = handshake_and_auth(
            target.clone(),
            auth,
            connect_timeout,
            keepalive,
            known_hosts_path,
            accepted_fingerprint,
            None,
        )
        .await
        .map_err(handshake_to_ssh_err)?;

        // Open channel, request PTY, start shell.
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| SshError::Any(format!("open session: {e}")))?;
        channel
            .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
            .await
            .map_err(|e| SshError::Any(format!("request_pty: {e}")))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| SshError::Any(format!("request_shell: {e}")))?;

        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let (cmd_tx, cmd_rx) = tmpsc::channel::<Command>(64);
        let cancel = CancellationToken::new();

        // Spawn the reader task on Tauri's tokio runtime. It owns the channel
        // exclusively and demuxes between server-pushed messages and outbound
        // commands sent through `cmd_rx`.
        let reader_cancel = cancel.clone();
        tauri::async_runtime::spawn(async move {
            reader_loop(channel, tx, cmd_rx, reader_cancel).await;
            // Best-effort: ask the server to disconnect at the session level.
            let _ = session
                .disconnect(Disconnect::ByApplication, "", "")
                .await;
        });

        Ok((Arc::new(Self { cmd_tx, cancel }), rx))
    }

    pub async fn write(&self, data: &[u8]) -> Result<(), SshError> {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.cmd_tx
            .send(Command::Write {
                data: data.to_vec(),
                ack: ack_tx,
            })
            .await
            .map_err(|_| SshError::Any("ssh write: reader task is gone".into()))?;
        match ack_rx.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(SshError::Any(format!("ssh write: {e}"))),
            Err(_) => Err(SshError::Any("ssh write: ack dropped".into())),
        }
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), SshError> {
        let (ack_tx, ack_rx) = oneshot::channel();
        self.cmd_tx
            .send(Command::Resize {
                cols,
                rows,
                ack: ack_tx,
            })
            .await
            .map_err(|_| SshError::Any("ssh resize: reader task is gone".into()))?;
        match ack_rx.await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(SshError::Any(format!("ssh resize: {e}"))),
            Err(_) => Err(SshError::Any("ssh resize: ack dropped".into())),
        }
    }

    pub async fn kill(&self) -> Result<(), SshError> {
        // Cancellation will cause the reader task to drop the channel, which
        // sends EOF + Close as part of teardown.
        self.cancel.cancel();
        Ok(())
    }
}

impl Drop for SshSession {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

async fn reader_loop(
    mut channel: russh::Channel<Msg>,
    tx: mpsc::Sender<PtyEvent>,
    mut cmd_rx: tmpsc::Receiver<Command>,
    cancel: CancellationToken,
) {
    let mut exit_code: Option<i32> = None;
    let mut signal_name: Option<String> = None;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(Command::Write { data, ack }) => {
                        let res = channel.data(&data[..]).await;
                        let _ = ack.send(res);
                    }
                    Some(Command::Resize { cols, rows, ack }) => {
                        let res = channel
                            .window_change(cols as u32, rows as u32, 0, 0)
                            .await;
                        let _ = ack.send(res);
                    }
                    None => {
                        // Sender dropped — session is being dismantled.
                        break;
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tx.send(PtyEvent::Output(data.to_vec())).is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if tx.send(PtyEvent::Output(data.to_vec())).is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit_code = Some(exit_status as i32);
                    }
                    Some(ChannelMsg::ExitSignal {
                        signal_name: name, ..
                    }) => {
                        signal_name = Some(format_sig(&name));
                    }
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) => break,
                    Some(_) => {}
                    None => break,
                }
            }
        }
    }
    // If the loop ended without seeing ExitStatus/ExitSignal AND it wasn't
    // user-initiated cancellation, treat it as a network drop. The signal
    // string is the contract surfaced to the renderer per spec §10 / §13.
    if exit_code.is_none() && signal_name.is_none() && !cancel.is_cancelled() {
        signal_name = Some("network_error".to_string());
    }

    // Best-effort EOF + Close so the server doesn't hang on its end.
    let _ = channel.eof().await;
    let _ = channel.close().await;
    let _ = tx.send(PtyEvent::Exit {
        code: exit_code,
        signal: signal_name,
    });
}

/// Format a russh `Sig` enum into a clean uppercase mnemonic string.
/// Avoids the ugly `Custom("HUP")` debug rendering for end-user-visible exit banners.
fn format_sig(sig: &russh::Sig) -> String {
    use russh::Sig;
    match sig {
        Sig::ABRT => "ABRT".into(),
        Sig::ALRM => "ALRM".into(),
        Sig::FPE => "FPE".into(),
        Sig::HUP => "HUP".into(),
        Sig::ILL => "ILL".into(),
        Sig::INT => "INT".into(),
        Sig::KILL => "KILL".into(),
        Sig::PIPE => "PIPE".into(),
        Sig::QUIT => "QUIT".into(),
        Sig::SEGV => "SEGV".into(),
        Sig::TERM => "TERM".into(),
        Sig::USR1 => "USR1".into(),
        Sig::Custom(s) => s.clone(),
    }
}
