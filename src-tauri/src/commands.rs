use crate::pty::{PtyManager, SpawnConfig};
use crate::settings::{Settings, SettingsPatch, SettingsStore};
use base64::Engine;
use std::path::PathBuf;
use tauri::{AppHandle, State};

fn shell_with_fallback(opt: Option<String>) -> String {
    if let Some(s) = opt.filter(|s| !s.is_empty()) { return s; }
    if let Ok(env) = std::env::var("SHELL") { if !env.is_empty() { return env; } }
    "/bin/zsh".to_string()
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    settings: State<'_, SettingsStore>,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let cfg_shell = shell_with_fallback(shell.or_else(|| settings.get().shell));
    let cfg = SpawnConfig {
        shell: cfg_shell,
        args: vec!["-l".into()],
        cwd: cwd.map(PathBuf::from),
        cols,
        rows,
    };
    manager.spawn(app, cfg).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write(
    manager: State<'_, PtyManager>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    manager.write(&pty_id, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&pty_id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    manager.kill(&pty_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(settings: State<'_, SettingsStore>) -> Result<Settings, String> {
    Ok(settings.get())
}

#[tauri::command]
pub fn settings_update(
    settings: State<'_, SettingsStore>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    settings.apply(patch).map_err(|e| e.to_string())
}
