pub mod commands;
pub mod db;
pub mod pty;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod store;
pub mod sync;

pub fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(url).spawn(); }
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(url).spawn(); }
}
