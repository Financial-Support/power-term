#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::sftp::SftpManager;
use power_term::ssh::SshManager;
use power_term::ssh::forward_manager::ForwardManager;
use power_term::store::{Db, ForwardStore, HostStore, SnippetStore, TagColorStore};
use power_term::sync::SyncManager;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

fn main() {
    tracing_subscriber::fmt::init();

    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");
    let db: Arc<Db> = Db::open_default_path()
        .expect("failed to initialize sqlite store");
    let host_store = HostStore::new(db.clone());
    let snippet_store = SnippetStore::new(db.clone());
    let forward_store = ForwardStore::new(db.clone());
    let tag_color_store = TagColorStore::new(db.clone());
    let sync_manager = SyncManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(SftpManager::new())
        .manage(settings)
        .manage(host_store)
        .manage(snippet_store)
        .manage(forward_store)
        .manage(tag_color_store)
        .manage(ForwardManager::new())
        .manage(db)
        .manage(sync_manager)
        .setup(|app| {
            // macOS menu bar: App menu with Settings…
            let settings_item = MenuItemBuilder::with_id("open_settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let app_submenu = SubmenuBuilder::new(app, "Power Term")
                .about(None)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let zoom_in_item = MenuItemBuilder::with_id("zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?;
            let zoom_out_item = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset_item = MenuItemBuilder::with_id("zoom_reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;
            let view_submenu = SubmenuBuilder::new(app, "View")
                .item(&zoom_in_item)
                .item(&zoom_out_item)
                .separator()
                .item(&zoom_reset_item)
                .build()?;
            // macOS: Edit submenu must exist for Cut/Copy/Paste/SelectAll
            // shortcuts to be wired into the responder chain. Without it,
            // cmd+V doesn't reach inputs in the webview.
            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .fullscreen()
                .separator()
                .close_window()
                .build()?;
            let help_github_item = MenuItemBuilder::with_id("help_github", "Power Term on GitHub")
                .build(app)?;
            let help_submenu = SubmenuBuilder::new(app, "Help")
                .item(&help_github_item)
                .build()?;
            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .item(&help_submenu)
                .build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app_handle, event| {
                match event.id().as_ref() {
                    "open_settings" => { let _ = app_handle.emit("menu:open-settings", ()); }
                    "zoom_in"       => { let _ = app_handle.emit("menu:zoom-in", ()); }
                    "zoom_out"      => { let _ = app_handle.emit("menu:zoom-out", ()); }
                    "zoom_reset"    => { let _ = app_handle.emit("menu:zoom-reset", ()); }
                    "help_github"   => {
                        let _ = std::process::Command::new("open")
                            .arg("https://github.com/bango97/homebrew-power-term")
                            .spawn();
                    }
                    _ => {}
                }
            });

            let handle = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let sync_state = handle.state::<SyncManager>();
                let payload = event.payload();
                let _ = handle.emit(
                    "sync:auth-debug",
                    format!("deep-link event ({} bytes)", payload.len()),
                );
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(payload) {
                    let _ = handle.emit(
                        "sync:auth-debug",
                        format!("parsed {} URL(s) from event", urls.len()),
                    );
                    for url in urls {
                        power_term::sync::handle_auth_callback(&url, &handle, &sync_state);
                    }
                } else {
                    let url = payload.trim_matches('"');
                    if url.starts_with("power-term://") {
                        power_term::sync::handle_auth_callback(url, &handle, &sync_state);
                    } else {
                        let _ = handle.emit(
                            "sync:auth-error",
                            format!("deep-link payload not parseable: {} bytes", payload.len()),
                        );
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            power_term::commands::pty_spawn,
            power_term::commands::pty_write,
            power_term::commands::pty_resize,
            power_term::commands::pty_kill,
            power_term::commands::settings_get,
            power_term::commands::settings_update,
            power_term::commands::system_accent_color,
            power_term::commands::ssh_connect,
            power_term::commands::ssh_write,
            power_term::commands::ssh_resize,
            power_term::commands::ssh_kill,
            power_term::commands::ssh_attach,
            power_term::commands::known_hosts_get,
            power_term::commands::hosts_list,
            power_term::commands::hosts_create,
            power_term::commands::hosts_update,
            power_term::commands::hosts_delete,
            power_term::commands::hosts_touch,
            power_term::commands::ssh_config_read,
            power_term::commands::local_list,
            power_term::commands::local_home,
            power_term::commands::local_reveal,
            power_term::commands::secret_set,
            power_term::commands::secret_get,
            power_term::commands::secret_delete,
            power_term::commands::snippets_list,
            power_term::commands::snippets_create,
            power_term::commands::snippets_update,
            power_term::commands::snippets_delete,
            power_term::commands::snippets_touch,
            power_term::commands::tag_colors_list,
            power_term::commands::tag_color_set,
            power_term::commands::tag_color_delete,
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
            power_term::commands::forwards_list,
            power_term::commands::forwards_create,
            power_term::commands::forwards_update,
            power_term::commands::forwards_delete,
            power_term::commands::forward_start,
            power_term::commands::forward_stop,
            power_term::commands::forward_status,
            power_term::commands::forwards_status_all,
            power_term::sync::sync_sign_in,
            power_term::sync::sync_sign_out,
            power_term::sync::sync_pull,
            power_term::sync::sync_status,
            power_term::sync::sync_get_key,
            power_term::sync::sync_set_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
