pub mod commands;
pub mod db;
pub mod logging;
pub mod pty;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod store;
pub mod sync;

pub fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    {
        if let Err(error) = std::process::Command::new("open").arg(url).spawn() {
            tracing::warn!(error = %error, "failed to open URL with macOS open");
        }
    }
    #[cfg(target_os = "windows")]
    {
        // `cmd /C start` treats an unquoted '&' as a command separator. The
        // Supabase authorize URL contains '&', so quote the entire URL or
        // Windows may open only the first query parameter.
        let safe_url = url.replace('"', "%22");
        let quoted_url = format!("\"{safe_url}\"");
        if let Err(error) = std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(quoted_url)
            .spawn()
        {
            tracing::warn!(error = %error, "failed to open URL with Windows start");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Err(error) = std::process::Command::new("xdg-open").arg(url).spawn() {
            tracing::warn!(error = %error, "failed to open URL with xdg-open");
        }
    }
}
