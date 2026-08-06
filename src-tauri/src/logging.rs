use std::fs::{create_dir_all, OpenOptions};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

const LOG_FILE_NAME: &str = "power-term.log";

/// Return the single log file users can attach when diagnosing a desktop
/// issue. Tauri's app log directory is platform-specific; on Windows this is
/// `%LOCALAPPDATA%\\com.power-term.app\\logs`.
pub fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_log_dir()
        .map(|dir| dir.join(LOG_FILE_NAME))
        .map_err(|error| error.to_string())
}

/// Install the native logger after Tauri has resolved the app directories.
/// Keeping this as a plain file logger makes it available in packaged Windows
/// builds where there is no console attached to the process.
pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let log_path = path(app)?;
    if let Some(parent) = log_path.parent() {
        create_dir_all(parent).map_err(|error| format!("create log directory: {error}"))?;
    }

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("open log file: {error}"))?;

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,power_term=debug"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_ansi(false)
        .with_writer(file)
        .try_init()
        .map_err(|error| format!("install logger: {error}"))?;

    Ok(log_path)
}
