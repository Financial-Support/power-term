#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::sftp::SftpManager;
use power_term::ssh::SshManager;
use power_term::store::HostStore;

fn main() {
    tracing_subscriber::fmt::init();

    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");
    let host_store = HostStore::open_default_path()
        .expect("failed to initialize host store");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(SftpManager::new())
        .manage(settings)
        .manage(host_store)
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
            power_term::commands::hosts_list,
            power_term::commands::hosts_create,
            power_term::commands::hosts_update,
            power_term::commands::hosts_delete,
            power_term::commands::hosts_touch,
            power_term::commands::secret_set,
            power_term::commands::secret_get,
            power_term::commands::secret_delete,
            power_term::commands::sftp_open,
            power_term::commands::sftp_close,
            power_term::commands::sftp_list,
            power_term::commands::sftp_canonicalize,
            power_term::commands::sftp_mkdir,
            power_term::commands::sftp_remove_file,
            power_term::commands::sftp_remove_dir,
            power_term::commands::sftp_rename,
            power_term::commands::sftp_download,
            power_term::commands::sftp_upload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
