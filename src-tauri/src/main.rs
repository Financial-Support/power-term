#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::ssh::SshManager;

fn main() {
    tracing_subscriber::fmt::init();

    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");

    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(settings)
        .invoke_handler(tauri::generate_handler![
            power_term::commands::pty_spawn,
            power_term::commands::pty_write,
            power_term::commands::pty_resize,
            power_term::commands::pty_kill,
            power_term::commands::settings_get,
            power_term::commands::settings_update,
            power_term::commands::ssh_connect,
            power_term::commands::ssh_write,
            power_term::commands::ssh_resize,
            power_term::commands::ssh_kill,
            power_term::commands::known_hosts_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
