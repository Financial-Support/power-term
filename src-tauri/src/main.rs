#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use power_term::db::DbManager;
use power_term::pty::PtyManager;
use power_term::settings::SettingsStore;
use power_term::sftp::SftpManager;
use power_term::ssh::SshManager;
use power_term::ssh::forward_manager::ForwardManager;
use power_term::store::{Db, DbConnectionStore, ForwardStore, HostStore, SnippetStore, SshKeyStore, TagColorStore};
use power_term::sync::SyncManager;
use std::sync::Arc;
use tauri::{Emitter, Listener, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

use power_term::open_url;

fn normalized_power_term_url(value: &str) -> Option<String> {
    let value = value.trim_matches('"');
    let parsed = url::Url::parse(value).ok()?;
    if parsed.scheme().eq_ignore_ascii_case("power-term") {
        Some(value.to_string())
    } else {
        None
    }
}

fn deep_link_summary(value: &str) -> String {
    let Ok(parsed) = url::Url::parse(value) else {
        return "invalid callback URL".to_string();
    };
    let query_keys = parsed
        .query_pairs()
        .map(|(key, _)| key.into_owned())
        .collect::<Vec<_>>();
    let fragment_keys = parsed
        .fragment()
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| pair.split_once('=').map(|(key, _)| key.to_string()))
        .collect::<Vec<_>>();
    format!(
        "scheme={} host={} path={} query_keys=[{}] fragment_keys=[{}]",
        parsed.scheme(),
        parsed.host_str().unwrap_or_default(),
        parsed.path(),
        query_keys.join(","),
        fragment_keys.join(","),
    )
}

fn handle_deep_link_urls(app: &tauri::AppHandle, urls: impl IntoIterator<Item = String>) {
    let sync_state = app.state::<SyncManager>();
    for url in urls {
        tracing::info!(summary = %deep_link_summary(&url), "processing deep-link callback");
        power_term::sync::handle_auth_callback(&url, app, &sync_state);
    }
}

fn main() {
    let settings = SettingsStore::load_default_path()
        .expect("failed to initialize settings store");
    let db: Arc<Db> = Db::open_default_path()
        .expect("failed to initialize sqlite store");
    let host_store = HostStore::new(db.clone());
    let snippet_store = SnippetStore::new(db.clone());
    let forward_store = ForwardStore::new(db.clone());
    let tag_color_store = TagColorStore::new(db.clone());
    let db_connection_store = DbConnectionStore::new(db.clone());
    let ssh_key_store = SshKeyStore::new(db.clone());
    let sync_manager = SyncManager::new(db.clone());

    tauri::Builder::default()
        // This must be registered before the deep-link plugin. On Windows a
        // protocol callback is delivered by starting the executable again;
        // this plugin forwards those arguments to the already-running app.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let arg_count = args.len();
            let urls = args
                .into_iter()
                .filter_map(|arg| normalized_power_term_url(&arg))
                .collect::<Vec<_>>();
            tracing::info!(
                arg_count,
                callback_count = urls.len(),
                cwd = %cwd,
                "single-instance launch received"
            );
            let _ = app.emit(
                "sync:auth-debug",
                format!(
                    "single-instance callback received ({} argument(s), {} power-term URL(s))",
                    arg_count,
                    urls.len()
                ),
            );
            if !urls.is_empty() {
                handle_deep_link_urls(app, urls);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PtyManager::new())
        .manage(SshManager::new())
        .manage(SftpManager::new())
        .manage(settings)
        .manage(host_store)
        .manage(snippet_store)
        .manage(forward_store)
        .manage(tag_color_store)
        .manage(ForwardManager::new())
        .manage(db_connection_store)
        .manage(ssh_key_store)
        .manage(DbManager::new())
        .manage(db)
        .manage(sync_manager)
        .setup(|app| {
            match power_term::logging::init(app.handle()) {
                Ok(path) => tracing::info!(log_path = %path.display(), "native logging initialized"),
                Err(error) => eprintln!("Power Term logging unavailable: {error}"),
            }
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "Power Term started");

            // macOS menu bar: App menu with Settings…
            let settings_item = MenuItemBuilder::with_id("open_settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let check_for_updates_item =
                MenuItemBuilder::with_id("check_for_updates", "Check for Updates…")
                    .build(app)?;
            let mut app_submenu = SubmenuBuilder::new(app, "Power Term")
                .about(None)
                .separator()
                .item(&check_for_updates_item)
                .item(&settings_item)
                .separator();
            #[cfg(target_os = "macos")]
            {
                app_submenu = app_submenu
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator();
            }
            let app_submenu = app_submenu.quit().build()?;
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
                    "check_for_updates" => { let _ = app_handle.emit("menu:check-for-updates", ()); }
                    "zoom_in"       => { let _ = app_handle.emit("menu:zoom-in", ()); }
                    "zoom_out"      => { let _ = app_handle.emit("menu:zoom-out", ()); }
                    "zoom_reset"    => { let _ = app_handle.emit("menu:zoom-reset", ()); }
                    "help_github" => {
                        open_url(env!("CARGO_PKG_REPOSITORY"));
                    }
                    _ => {}
                }
            });

            let handle = app.handle().clone();
            let event_handle = handle.clone();
            app.listen("deep-link://new-url", move |event| {
                let payload = event.payload();
                tracing::info!(payload_bytes = payload.len(), "deep-link event received");
                let _ = event_handle.emit(
                    "sync:auth-debug",
                    format!("deep-link event ({} bytes)", payload.len()),
                );
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(payload) {
                    let _ = event_handle.emit(
                        "sync:auth-debug",
                        format!("parsed {} URL(s) from event", urls.len()),
                    );
                    handle_deep_link_urls(&event_handle, urls);
                } else {
                    if let Some(url) = normalized_power_term_url(payload) {
                        handle_deep_link_urls(&event_handle, [url]);
                    } else {
                        let _ = event_handle.emit(
                            "sync:auth-error",
                            format!("deep-link payload not parseable: {} bytes", payload.len()),
                        );
                    }
                }
            });

            // On Windows/Linux, the deep-link plugin receives the callback as
            // a command-line argument and emits its event during plugin setup,
            // before this app-level listener exists. Read the retained URL so
            // an OAuth callback that launched this process is not lost.
            match app
                .state::<tauri_plugin_deep_link::DeepLink<tauri::Wry>>()
                .get_current()
            {
                Ok(Some(urls)) => {
                    tracing::info!(url_count = urls.len(), "processing startup deep-link URLs");
                    let _ = handle.emit(
                        "sync:auth-debug",
                        format!("processing {} startup deep-link URL(s)", urls.len()),
                    );
                    handle_deep_link_urls(&handle, urls.into_iter().map(|url| url.to_string()));
                }
                Ok(None) => {}
                Err(e) => tracing::warn!(error = %e, "could not read startup deep-link URL"),
            }
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
            power_term::commands::open_external_url,
            power_term::commands::debug_log,
            power_term::commands::debug_log_path,
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
            power_term::commands::local_read_text,
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
            power_term::commands::tag_rename,
            power_term::commands::tag_delete,
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
            power_term::commands::sftp_cancel_transfer,
            power_term::commands::forwards_list,
            power_term::commands::forwards_create,
            power_term::commands::forwards_update,
            power_term::commands::forwards_delete,
            power_term::commands::forward_start,
            power_term::commands::forward_stop,
            power_term::commands::forward_status,
            power_term::commands::forwards_status_all,
            power_term::commands::db_connections_list,
            power_term::commands::db_connections_create,
            power_term::commands::db_connections_update,
            power_term::commands::db_connections_delete,
            power_term::commands::db_session_open,
            power_term::commands::db_session_close,
            power_term::commands::db_query,
            power_term::commands::db_describe_table,
            power_term::commands::db_update_row,
            power_term::commands::db_insert_row,
            power_term::commands::db_delete_row,
            power_term::commands::db_execute_schema,
            power_term::commands::db_query_cancel,
            power_term::commands::db_list_tables,
            power_term::commands::db_list_databases,
            power_term::commands::db_switch_database,
            power_term::commands::db_export_dump,
            power_term::commands::read_text_file,
            power_term::commands::write_text_file,
            power_term::commands::ssh_keys_list,
            power_term::commands::ssh_keys_create,
            power_term::commands::ssh_keys_update,
            power_term::commands::ssh_keys_delete,
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
