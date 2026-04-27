use crate::pty::PtyError;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

#[derive(Clone, Debug)]
pub struct SpawnConfig {
    pub shell: String,
    pub args: Vec<String>,
    pub cwd: Option<std::path::PathBuf>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone)]
pub enum PtyEvent {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

pub struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    reader_handle: Mutex<Option<JoinHandle<()>>>,
}

impl PtySession {
    pub fn spawn(cfg: SpawnConfig) -> Result<(Arc<Self>, mpsc::Receiver<PtyEvent>), PtyError> {
        let pty = native_pty_system()
            .openpty(PtySize { rows: cfg.rows, cols: cfg.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Spawn(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&cfg.shell);
        for a in &cfg.args { cmd.arg(a); }
        if let Some(cwd) = &cfg.cwd { cmd.cwd(cwd); }
        if let Ok(home) = std::env::var("HOME") { cmd.env("HOME", home); }
        if let Ok(term) = std::env::var("TERM") { cmd.env("TERM", term); } else { cmd.env("TERM", "xterm-256color"); }
        if let Ok(lang) = std::env::var("LANG") { cmd.env("LANG", lang); }

        let mut child = pty.slave.spawn_command(cmd).map_err(|e| PtyError::Spawn(e.to_string()))?;
        drop(pty.slave);

        let writer = pty.master.take_writer().map_err(|e| PtyError::Spawn(e.to_string()))?;
        let mut reader = pty.master.try_clone_reader().map_err(|e| PtyError::Spawn(e.to_string()))?;
        let killer = child.clone_killer();

        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let tx_reader = tx.clone();
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 64 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx_reader.send(PtyEvent::Output(buf[..n].to_vec())).is_err() { break; }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "pty read error");
                        break;
                    }
                }
            }
            let exit = child.wait().ok().and_then(|s| s.exit_code().try_into().ok());
            let _ = tx.send(PtyEvent::Exit(exit));
        });

        let session = Arc::new(Self {
            writer: Mutex::new(writer),
            master: Mutex::new(pty.master),
            killer: Mutex::new(killer),
            reader_handle: Mutex::new(Some(handle)),
        });
        Ok((session, rx))
    }

    pub fn write(&self, data: &[u8]) -> Result<(), PtyError> {
        let mut w = self.writer.lock();
        w.write_all(data)?;
        w.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.master
            .lock()
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| PtyError::Any(e.to_string()))
    }

    pub fn kill(&self) -> Result<(), PtyError> {
        let _ = self.killer.lock().kill();
        if let Some(h) = self.reader_handle.lock().take() {
            let _ = h.join();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn drain_for(rx: &mpsc::Receiver<PtyEvent>, ms: u64) -> Vec<u8> {
        let deadline = std::time::Instant::now() + Duration::from_millis(ms);
        let mut out = Vec::new();
        while std::time::Instant::now() < deadline {
            if let Ok(ev) = rx.recv_timeout(Duration::from_millis(50)) {
                match ev {
                    PtyEvent::Output(b) => out.extend_from_slice(&b),
                    PtyEvent::Exit(_) => break,
                }
            }
        }
        out
    }

    #[test]
    fn spawn_echo_outputs_text() {
        let cfg = SpawnConfig {
            shell: "/bin/sh".to_string(),
            args: vec!["-c".into(), "printf hello-pty".into()],
            cwd: None,
            cols: 80,
            rows: 24,
        };
        let (_session, rx) = PtySession::spawn(cfg).unwrap();
        let data = drain_for(&rx, 1500);
        assert!(String::from_utf8_lossy(&data).contains("hello-pty"));
    }

    #[test]
    fn write_then_read_echo() {
        let cfg = SpawnConfig {
            shell: "/bin/sh".to_string(),
            args: vec!["-c".into(), "while read line; do echo got:$line; done".into()],
            cwd: None,
            cols: 80,
            rows: 24,
        };
        let (session, rx) = PtySession::spawn(cfg).unwrap();
        session.write(b"ping\n").unwrap();
        let data = drain_for(&rx, 1500);
        assert!(String::from_utf8_lossy(&data).contains("got:ping"));
        let _ = session.kill();
    }

    #[test]
    fn resize_does_not_panic() {
        let cfg = SpawnConfig {
            shell: "/bin/sh".to_string(),
            args: vec!["-c".into(), "sleep 1".into()],
            cwd: None,
            cols: 80,
            rows: 24,
        };
        let (session, _rx) = PtySession::spawn(cfg).unwrap();
        session.resize(100, 30).unwrap();
        let _ = session.kill();
    }
}
