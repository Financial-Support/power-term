# Power-Term — Sub-project #3: SFTP File Manager

**Date:** 2026-04-28
**Status:** Approved (brainstorming, auto-approved per user authorization)
**Roadmap position:** Sub-project #3, building on top of #2A (russh sessions, auth) and #2B (saved hosts).

## 1. Purpose

Add an SFTP file browser to power-term. The user opens SFTP for a saved host from the sidebar's row context menu and gets a new tab with a remote file listing — navigate directories, download/upload files, delete, mkdir, rename. Reuses #2B's saved-host config (host, port, username, auth method + Keychain secret) and the same `russh` connection layer.

The SFTP tab is a third tab kind (`sftp`) alongside `local` (PTY) and `ssh` (terminal). The Terminal renderer is xterm-only; the SFTP tab uses a new `FileBrowser` React component instead.

## 2. Out of scope

- Drag-and-drop from macOS Finder to upload — deferred polish (`browser` API + Tauri file-drop event integration).
- Dual-pane (local + remote) — single-pane remote browser only for MVP.
- File preview / quick-look inside the tab.
- Symlink target editing; we list `is_symlink` and the target name for display only.
- Resumable uploads, chunked-by-resume (we read/write the whole file).
- Editing files in place via a remote text editor.
- Open-with-system-app workflow (download → reveal in Finder is the closest substitute).
- SFTP-via-existing-SSH-session multiplexing — each `sftp_open` uses its own russh connection. Acceptable since #2B doesn't keep SSH sessions persistent outside terminal tabs.

## 3. Stack

| Layer | Choice |
| --- | --- |
| SFTP client | `russh-sftp` ≥ 2.x (sits on top of `russh` 0.45) |
| Async runtime | Tauri-managed tokio (already in use for `SshSession`) |
| Frontend | React 18 + TypeScript + Zustand (existing) |
| File icons | Inline SVG / emoji-font fallback (no new dep) |

No new frontend dependencies.

## 4. Architecture

### 4.1 Tab kind contract

Extend `Tab.kind` from `'local' | 'ssh'` to `'local' | 'ssh' | 'sftp'`. The tab keeps the same `ptyId` shape (a UUIDv4 issued by the backend on session open), but the UI dispatches:

- `kind === 'local'` → `Terminal` component (PTY)
- `kind === 'ssh'` → `Terminal` component (SSH)
- `kind === 'sftp'` → new `FileBrowser` component

Tab title is the host name (matching #2B's connect-from-host title override).

### 4.2 Module map (Rust)

```
src-tauri/src/
├── sftp/                       (new directory)
│   ├── mod.rs                  (SftpError, SftpId)
│   ├── session.rs              (SftpSession: connect, list, read, write, mkdir, remove, rename, rmdir)
│   └── manager.rs              (SftpManager: HashMap<SftpId, Arc<SftpSession>>)
├── commands.rs                 (modified — add sftp_* commands)
└── main.rs                     (modified — manage(SftpManager))
```

`SftpSession` holds the live SFTP channel (russh-sftp `SftpClient`). It does NOT emit Tauri events — SFTP ops are request/response RPC commands, not push streams. The manager registers sessions purely so the renderer holds a string id and the backend can route ops without re-establishing the connection on every command.

### 4.3 Frontend additions

```
src/components/
├── FileBrowser.tsx                   (new — list view, breadcrumb, action bar)
├── FileRow.tsx                       (new — single row with name/size/mtime + actions)
src/state/sftpStore.ts                (new — per-tab SFTP state: cwd, entries, loading, sortBy)
src/lib/ipc.ts                        (modified — sftp* wrappers)
src/types.ts                          (modified — TabKind union + SftpEntry shape)
src/state/sessionStore.ts             (modified — TabKind union)
src/components/Sidebar.tsx            (modified — row hover adds "📂" SFTP-open button alongside ✎/×)
src/App.tsx                           (modified — connectSftpFromHost handler, tab dispatch by kind)
```

## 5. Tauri command surface (added)

```rust
#[tauri::command] async fn sftp_open(
    host: String, port: u16, user: String,
    auth: AuthRequest,                  // mirror of ssh_connect's AuthRequest
    accept_fingerprint: Option<String>,
) -> Result<SftpOpenResult, String>;

#[tauri::command] async fn sftp_close(sftp_id: String) -> Result<(), String>;

#[tauri::command] async fn sftp_list(sftp_id: String, path: String) -> Result<Vec<SftpEntry>, String>;
#[tauri::command] async fn sftp_canonicalize(sftp_id: String, path: String) -> Result<String, String>;
#[tauri::command] async fn sftp_mkdir(sftp_id: String, path: String) -> Result<(), String>;
#[tauri::command] async fn sftp_remove_file(sftp_id: String, path: String) -> Result<(), String>;
#[tauri::command] async fn sftp_remove_dir(sftp_id: String, path: String) -> Result<(), String>;
#[tauri::command] async fn sftp_rename(sftp_id: String, from: String, to: String) -> Result<(), String>;

// Transfer ops use the local filesystem as the other endpoint.
#[tauri::command] async fn sftp_download(sftp_id: String, remote: String, local: String) -> Result<u64, String>;
#[tauri::command] async fn sftp_upload(sftp_id: String, local: String, remote: String) -> Result<u64, String>;
```

`SftpOpenResult` mirrors `SshConnectResult` from #2A — same `Connected | NeedsFingerprint | FingerprintMismatch | NeedsAuth` envelope so the renderer can route to the existing `HostFingerprintPrompt` and `AuthPrompt` modals.

`SftpEntry`:

```rust
pub struct SftpEntry {
    pub name: String,           // basename only
    pub kind: String,           // "file" | "dir" | "symlink" | "other"
    pub size: u64,              // 0 for non-files
    pub modified_ms: Option<i64>, // mtime in epoch ms; None if unknown
    pub permissions: u32,       // POSIX mode bits, 0 if unknown
    pub symlink_target: Option<String>, // resolved name for display, None if not a symlink
}
```

`AuthRequest` JSON tag matches #2A: `{ kind: "agent" | "password" | "key", ... }`.

## 6. SftpSession lifecycle

```rust
impl SftpSession {
    /// Connect to host, authenticate, open a sftp subsystem channel.
    pub async fn open(
        target: SshTarget,
        auth: Auth,
        connect_timeout: Duration,
        keepalive: Duration,
        known_hosts_path: PathBuf,
        accepted_fingerprint: Option<String>,
    ) -> Result<Arc<Self>, SftpError>;

    pub async fn list(&self, path: &str) -> Result<Vec<SftpEntry>, SftpError>;
    pub async fn canonicalize(&self, path: &str) -> Result<String, SftpError>;
    pub async fn mkdir(&self, path: &str) -> Result<(), SftpError>;
    pub async fn remove_file(&self, path: &str) -> Result<(), SftpError>;
    pub async fn remove_dir(&self, path: &str) -> Result<(), SftpError>;
    pub async fn rename(&self, from: &str, to: &str) -> Result<(), SftpError>;

    /// Stream remote -> local, returns bytes copied.
    pub async fn download(&self, remote: &str, local: &Path) -> Result<u64, SftpError>;
    /// Stream local -> remote, returns bytes copied.
    pub async fn upload(&self, local: &Path, remote: &str) -> Result<u64, SftpError>;

    pub async fn close(&self) -> Result<(), SftpError>;
}
```

The session reuses the host-key verification logic from #2A (`ClientHandler` with `verdict: Arc<Mutex<HostKeyVerdict>>`). Auth maps to the same three methods. SFTP errors map cleanly: `russh_sftp::Error::Status` with `StatusCode::NoSuchFile`, etc., become typed `SftpError` variants.

## 7. Frontend UX

```
┌──────── tabs row ─────────────────────────────────────────────┐
│  [shell]  [user@host]  [📂 saved-host]  [+]                   │
├──────────┬────────────────────────────────────────────────────┤
│ Sidebar  │ ┌─ FileBrowser tab content ───────────────────────┐│
│          │ │ ◀ /home/alice                            [⟳][⬆][📁]│
│ ▾ Personal│ ├─────────────────────────────────────────────────┤│
│  • mac   │ │ Name              Size       Modified          ▾││
│  • home  │ │ ▸ ..                                             ││
│ ▾ Work   │ │ 📁 projects                  2026-04-20         ││
│  • prod  │ │ 📄 .bashrc        2.1 KB     2026-04-15         ││
│          │ │ 📄 deploy.sh      4.8 KB     2026-04-22         ││
│          │ │ ...                                              ││
│          │ └─────────────────────────────────────────────────┘│
└──────────┴────────────────────────────────────────────────────┘
```

Behaviour:

- Tab opens at `~` (the SFTP server's reported home — query via `canonicalize(".")`).
- Breadcrumb at the top is editable; pressing Enter jumps to that path.
- `◀` button: cd to parent (`..` row also works).
- Action bar buttons:
  - `⟳` reload current dir
  - `⬆` upload — opens an OS file picker, selected file goes to `<cwd>/<basename>`
  - `📁` new folder — opens a small inline prompt
- Row click on dir → `cd` into it. Row click on file → no-op.
- Row right-click (or hover-revealed `⋯`) menu: Download, Rename, Delete.
- Toggle "show hidden files" in the column header dropdown (persisted in component state).
- Sort: by name (default), size, modified — ascending/descending.
- Loading spinner while listing.

Per-tab state lives in `useSftpStore` keyed by `tabId`.

### 7.1 Sidebar context

The Sidebar host row gets a third hover button: `📂` — opens a new SFTP tab for that host using the stored auth. Same flow as #2B's connect-from-host but it ends up calling `sftp_open` instead of `ssh_connect`, and dispatches to `FileBrowser` on success.

## 8. Connect-from-host SFTP flow

Mirrors #2B exactly, with `ssh_connect` → `sftp_open` swap:

1. Sidebar row → `📂` button → `App.openSftpFromHost(host)`
2. Build `target = { user, host, port }` and resolve auth via stored method + Keychain.
3. Call `sftp_open` (with `accept_fingerprint = null` first).
4. On `NeedsFingerprint` → existing `HostFingerprintPrompt` (the SFTP flow's state machine reuses the same `SshFlow` union from `App.tsx`, just keyed on a different `kind` field).
5. On `NeedsAuth` → existing `AuthPrompt`.
6. On `Connected { id }` → `addTab(id, host.name, 'sftp')` and `hostStore.touch(host.id)`.

The `SshFlow` union is renamed to `RemoteFlow` and gains a `targetKind: 'shell' | 'sftp'` discriminator carried through every phase. The renderer dispatches the connect verb based on `targetKind`.

## 9. Error handling

| Failure | Behaviour |
| --- | --- |
| Initial connect / auth failures | Same as #2A — `NeedsFingerprint`/`NeedsAuth`/etc. |
| `SftpError::NoSuchFile` on list | Inline error banner in the FileBrowser; user can navigate elsewhere |
| `SftpError::PermissionDenied` on op | Toast with the message |
| Network drop mid-session | The next op fails → banner "SFTP session disconnected"; user can close the tab and re-open |
| `sftp_close` on unknown id | `Err("unknown sftp id")` |
| Upload local file > 100 MB | Soft warning toast (no hard cap; the user can cancel by closing the tab) |
| Filename clash on upload | Server-side overwrite per russh-sftp default. UI shows a confirm dialog ("File `foo.sh` already exists. Overwrite?") before issuing `sftp_upload`. |
| Download local target exists | `download()` opens local with `truncate(true)` so it overwrites; UI shows a confirm dialog before issuing `sftp_download` if the local destination already exists. |

## 10. Testing

- **Rust unit (mock-keychain feature for any sec ops):**
  - Smoke tests of `SftpEntry` JSON serde shape (no actual SFTP server in CI).
  - Auth/connect path covered by #2A; SFTP-specific ops are tested via integration `#[ignore]` against a localhost sshd.
- **Frontend vitest:**
  - `sftpStore` actions: `setCwd`, `setEntries`, sort toggle, hidden-files toggle.
  - `FileRow`: clicking dir invokes `onCd`; clicking file is a no-op; the action menu dispatches the right op.
  - `FileBrowser`: breadcrumb input + Enter triggers cd; reload + new-folder buttons fire callbacks.
- **Manual smoke** (in plan):
  - Open SFTP from a saved host using agent / key / password auth.
  - Navigate down a few directories, back up.
  - Create folder, rename file, delete file.
  - Download a small text file → opens Finder reveal? (Only for MVP: confirm file exists at the local path the dialog showed.)
  - Upload a small file from the OS picker; verify it appears in the listing.
  - Disconnect cable; next op shows the disconnected banner.

## 11. File layout (delta)

```
src-tauri/Cargo.toml                  (+ russh-sftp)
src-tauri/src/sftp/                   (new)
src-tauri/src/commands.rs             (+ sftp_* handlers)
src-tauri/src/main.rs                 (+ manage(SftpManager))
src-tauri/capabilities/default.json   (+ core:dialog:* if we need OS file pickers in commands)

src/types.ts                          (TabKind union, SftpEntry, RemoteFlow types)
src/state/sessionStore.ts             ('sftp' kind)
src/state/sftpStore.ts                (new)
src/lib/ipc.ts                        (sftp* wrappers)
src/components/FileBrowser.tsx        (new)
src/components/FileRow.tsx            (new)
src/components/Sidebar.tsx            (modified — 📂 button)
src/App.tsx                           (modified — RemoteFlow + tab kind dispatch)
src/styles.css                        (modified — file-browser layout)
```

## 12. Risks

- **`russh-sftp` API churn.** Stable enough on 2.x; pin a single minor.
- **OS file dialogs.** Tauri 2 ships a `dialog` plugin (`tauri-plugin-dialog`). We add it to deps + `core:dialog:*` permission so `sftp_upload` can prompt the user for a local file. For `sftp_download` we use `dialog::save_file` to pick the local destination.
- **Concurrent ops on a single SFTP channel.** russh-sftp serializes commands; we hold an `AsyncMutex<SftpClient>` in the session and queue requests. Acceptable for MVP — UI already disables most actions during in-flight ops.
- **Large file transfers block the UI.** russh-sftp reads/writes in chunks; we don't show progress for MVP. Files > 100 MB will appear to hang. Document the limitation; add a progress bar in #4 polish.

## 13. Open questions

None. All decisions are locked.
