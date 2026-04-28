# Power-Term — Sub-project #4B: Port Forwarding (Local + Remote)

**Date:** 2026-04-28
**Status:** Approved (brainstorming, auto-approved per user authorization)
**Roadmap position:** Sub-project #4B. Second half of "#4: Snippets + Port Forwarding". #4A (Snippets) shipped already; #4B adds SSH port-forward management. SOCKS5 dynamic forwarding (`-D`) and progress-bar transfers are deferred to a #4C polish sub-project.

## 1. Purpose

Let users save SSH port-forward configurations per host and start/stop them on demand. Two kinds:

- **Local (`-L bind:port → remote:port`)**: bind a local TCP port; each accepted connection is tunneled through the SSH session to a remote endpoint via russh's `direct-tcpip` channels.
- **Remote (`-R remote_port → local:port`)**: ask the SSH server to bind a remote port; russh fires `forwarded-tcpip` channels for each remote-side connection, which we copy to a local endpoint.

Both run independently of any open terminal tab. A user might keep a local forward running for a database tunnel while never opening a shell to that host.

## 2. Out of scope

- **Dynamic (`-D`) SOCKS5 forwarding** — deferred to #4C. Needs a real SOCKS5 handshake implementation; postponed to keep #4B focused on the russh forward APIs.
- **ProxyJump / multi-hop forwarding** — deferred.
- **Auto-restart on connection drop** — defer; MVP requires the user to click Start again if the SSH session breaks.
- **Per-forward bandwidth metrics / connection counts** — defer.
- **Cloud sync of forwards** — sub-project #6.
- **Drag-drop reorder** — defer.

## 3. Stack

| Layer | Choice |
| --- | --- |
| SSH | Existing `russh 0.45` from #2A. |
| Storage | Schema v3 migration adds a `forwards` table; reuse the `Db` wrapper from #4A. |
| Async | Existing tokio runtime via `tauri::async_runtime`. |
| Frontend | React 18 + Zustand. Reuses Sidebar slot pattern from Snippets. |

No new dependencies on either side.

## 4. Schema (migration v3)

```sql
CREATE TABLE forwards (
  id TEXT PRIMARY KEY NOT NULL,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('local', 'remote')),
  bind_addr TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL CHECK (bind_port BETWEEN 1 AND 65535),
  remote_host TEXT NOT NULL,
  remote_port INTEGER NOT NULL CHECK (remote_port BETWEEN 1 AND 65535),
  auto_start INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX forwards_host_id_idx ON forwards(host_id);
```

`bind_addr` semantics:
- For `kind='local'`: the local interface to listen on. Typical values: `127.0.0.1` (loopback only) or `0.0.0.0` (all interfaces).
- For `kind='remote'`: the remote interface the SSH server should bind. The OpenSSH `GatewayPorts` server config governs whether the server honors bind addresses other than loopback; we just pass it through.

`remote_host` / `remote_port`:
- For `kind='local'`: where the SSH server should connect TO when a local port hits.
- For `kind='remote'`: where THIS app connects to when a remote-side connection is forwarded back. Typically `127.0.0.1`.

`auto_start = 1`: when the parent host SSH session opens (whether for a shell or via a saved forward), the forward starts automatically. MVP: a non-zero `auto_start` is informational; auto-trigger fires only when the user explicitly opens a shell tab to the host. Detailed wiring below.

`ON DELETE CASCADE`: removing a host removes its forwards. SQLite needs `PRAGMA foreign_keys = ON` set per connection — we'll set it in `Db::open` for both new and existing schemas.

## 5. File layout (delta)

```
src-tauri/src/
├── store/
│   ├── schema.rs                 (modified — CURRENT_VERSION=3 + migration_v3)
│   ├── db.rs                     (modified — set PRAGMA foreign_keys=ON on each open)
│   ├── forwards.rs               (new — Forward, ForwardInput, ForwardStore CRUD)
│   └── mod.rs                    (modified — re-export)
├── ssh/
│   └── forwards.rs               (new — RunningForward, start_local, start_remote)
├── ssh/manager.rs                (small additions — forward lifecycle helpers)
├── commands.rs                   (modified — forwards_* + forward_{start,stop,status})
└── main.rs                       (modified — manage(ForwardStore), manage(ForwardManager))

src/
├── components/
│   ├── ForwardsPanel.tsx         (new — collapsible section in Sidebar)
│   └── ForwardFormModal.tsx      (new — Add/Edit form)
├── state/forwardStore.ts         (new — Zustand)
├── lib/ipc.ts                    (modified — forward* wrappers)
├── types.ts                      (modified — Forward types)
└── App.tsx                       (modified — mount panel + handlers)
```

`ssh::forwards` (Rust) holds the runtime forward tasks; `store::forwards` holds the persisted configs. Two modules, distinct responsibilities.

## 6. Tauri command surface

```rust
#[tauri::command] fn forwards_list() -> Result<Vec<Forward>, String>;
#[tauri::command] fn forwards_create(input: ForwardInput) -> Result<Forward, String>;
#[tauri::command] fn forwards_update(id: String, input: ForwardInput) -> Result<Forward, String>;
#[tauri::command] fn forwards_delete(id: String) -> Result<(), String>;

#[tauri::command] async fn forward_start(id: String) -> Result<ForwardStatus, String>;
#[tauri::command] async fn forward_stop(id: String) -> Result<ForwardStatus, String>;
#[tauri::command] fn forward_status(id: String) -> Result<ForwardStatus, String>;
#[tauri::command] fn forwards_status_all() -> Result<Vec<ForwardStatus>, String>;
```

Where:

```rust
pub struct ForwardStatus {
    pub id: String,
    pub state: String,    // "stopped" | "starting" | "running" | "error"
    pub error: Option<String>,
}
```

`forward_start` opens its own russh client connection (independent of any terminal tab) using the host's saved auth + Keychain secret. The connection is keyed by `forward.id` in the `ForwardManager`'s registry, separate from `SshManager` (which is for terminal tabs). When the user clicks Stop or the SSH connection drops, the registry entry is removed and the listener task cancelled.

## 7. Forward lifecycle

```rust
impl ForwardManager {
    pub async fn start(&self, app: AppHandle, forward: &Forward, host: &Host, secret: Option<String>)
        -> Result<ForwardStatus, ForwardError>;
    pub async fn stop(&self, id: &str) -> Result<ForwardStatus, ForwardError>;
    pub fn status(&self, id: &str) -> ForwardStatus;
    pub fn statuses(&self) -> Vec<ForwardStatus>;
}
```

### Local forward (`-L`)

1. Open russh client to `host.hostname:host.port`, authenticate.
2. `tokio::net::TcpListener::bind((forward.bind_addr, forward.bind_port))`.
3. Spawn an accept loop:
   ```
   loop {
     accept() → (local_stream, _peer)
     channel = ssh.channel_open_direct_tcpip(remote_host, remote_port, originator_host, originator_port).await?
     stream = channel.into_stream();
     spawn(tokio::io::copy_bidirectional(local_stream, stream))
   }
   ```
4. CancellationToken stops the loop on `forward_stop`.

### Remote forward (`-R`)

1. Open russh client + authenticate.
2. `ssh.tcpip_forward(forward.bind_addr, forward.bind_port).await?` — server starts listening.
3. Inside the russh `Handler`:
   - Implement `server_channel_open_forwarded_tcpip` to accept incoming forwarded channels.
   - For each accepted channel, spawn a tokio task: connect to `(forward.remote_host, forward.remote_port)` locally, then `copy_bidirectional` between channel stream and TcpStream.
4. On stop, call `ssh.cancel_tcpip_forward(...)` and disconnect.

Both kinds share the auth + connection plumbing (basically the same as `SshSession::connect` in #2A, minus the channel-shell-pty step). We extract a small `ssh::handshake` helper that #2A's session and the new forwards module both call. **This is the duplicated-handler refactor flagged at the end of #2A's review.** Doing it now avoids a third copy.

### Auto-start

When the user activates a host (shell or sftp connect from sidebar / cmd-K / etc.), App reads `forwardStore.list().filter(f => f.host_id === host.id && f.auto_start)` and calls `forward_start(id)` for each. Failures are surfaced via the same per-forward error banner as a manual click. Auto-start fires once per session; closing the host's last terminal tab does NOT auto-stop forwards (forwards have their own lifecycle and connections).

## 8. UI

### ForwardsPanel (in Sidebar, below Snippets)

```
▾ Forwards                         +
  ▶ ⬤ db-tunnel       L 5432       ⏵ ✎ ×
  ▶ ⏺ web-staging     R 8080       ⏵ ✎ ×
  ▶ ⏺ logs-tail       L 9200  err  ⏵ ✎ ×
```

Per-row:
- **Status dot**: ⬤ green = running, ⏺ gray = stopped, 🔴 red with `err` text on hover = error.
- **Name** (truncated).
- **Type + bind_port** badge: `L 5432`, `R 8080`.
- **Toggle button**: shows `⏵` (play) when stopped, `⏸` (pause) when running. Click toggles via `forward_start`/`forward_stop`.
- **✎** edit, **×** delete.

Empty state: "No forwards. Click + to add one."

### ForwardFormModal

Fields:
- **Name** (required, ≤ 80)
- **Host** — `<select>` of saved hosts (required; the FK)
- **Kind radio** — `Local | Remote`
- **Bind address** (default `127.0.0.1`)
- **Bind port** (1..65535)
- **Remote host** (required) — the destination endpoint
- **Remote port** (1..65535)
- **Auto-start when host is activated** (checkbox)
- Save / Cancel
- Esc closes

When `kind === 'local'`, the labels read "Local bind" / "Forward to". When `kind === 'remote'`, "Remote bind" / "Forward back to". Same fields, different intent surfaced through label text.

## 9. Status events

`ForwardManager` emits `forward://status/<id>` events with `{ state, error }` so the renderer can render live status without polling. Frontend subscribes once at app start and keeps a `forwardStore.statuses: Record<id, ForwardStatus>` map.

## 10. Error handling

| Failure | Behaviour |
| --- | --- |
| Local bind port already in use | `forward_start` returns `Err`; renderer shows the row in `state: 'error'` with the message. |
| Auth fails on the per-forward SSH connect | Same — emit `state: 'error'`. The user can edit auth via the host's normal HostFormModal; we do NOT pop AuthPrompt for headless forwards in MVP. |
| Server denies remote port (typical: server `GatewayPorts no` rejects bind to 0.0.0.0) | `state: 'error'` with the russh error string. |
| Forward host deleted while a forward is running | host_id FK + cascade delete removes the forward row; the running task is cancelled by ForwardManager (it owns an Arc to the forward record's id and validates against the store before reconnecting; if the row is gone, it stops). |
| App quit while forwards running | tokio tasks die on process exit. No graceful shutdown for MVP. |
| Connection drops mid-forward (network blip) | Listener task notices the SSH stream errored and transitions `state: 'error'`. User must restart manually. |

## 11. Testing

- **Rust unit (`cargo test`):**
  - `schema::migrate v0 → v3` creates hosts + snippets + forwards tables.
  - `schema::migrate v2 → v3` only creates `forwards`.
  - `ForwardStore::create + list + update + delete` round-trip.
  - `ForwardStore::create` validates: name non-empty, bind_port 1..65535, remote_port 1..65535, kind ∈ {local, remote}, host_id refers to existing host.
  - Cascade test: insert host + forward; delete host; forward row disappears.
- **Frontend vitest:**
  - `forwardStore`: load / create / update / delete / setStatus.
  - `ForwardFormModal`: validation; Esc closes; kind toggle re-labels; host `<select>` populated.
  - `ForwardsPanel`: render rows, click ⏵ → onStart, click ⏸ → onStop, click ✎/× → onEdit/onDelete, empty state.
- **Manual smoke** (recorded in plan):
  - Configure a local forward to a known endpoint (e.g., `localhost:5432` on a remote host) → click Start → verify `nc localhost <bindPort>` connects and reaches the remote.
  - Configure a remote forward → click Start → from the remote host, `curl http://127.0.0.1:<bindPort>/` reaches the local target.
  - Stop while running → next connect attempt to bound port fails.
  - Mark a forward as auto-start → connect a shell to its host → forward starts automatically.
  - Delete a host with active forwards → forwards disappear (and tasks are torn down).

## 12. Risks

- **`ssh::handshake` extraction touches #2A code.** The existing `SshSession::connect` will be rewritten to use the helper. Test coverage on the existing flow is minimal beyond manual smoke; we mitigate by keeping the public API of `SshSession` unchanged and asserting a fresh build + a manual reconnect to a saved host before claiming the task done.
- **Port collisions.** Two forwards on the same `(bind_addr, bind_port)` are racy. We don't enforce uniqueness in DB to avoid false negatives across `0.0.0.0` vs `127.0.0.1`; the OS rejects the second `bind()` and we surface that as an error.
- **Remote forward on macOS as the SSH server end.** Most users will SSH OUT from macOS; remote forwards bind on the SERVER side, so this side issue is moot. Documented in the manual-smoke checklist that remote forward verification needs an SSH server with `GatewayPorts` enabled if non-loopback.
- **Listener leak on app quit.** tokio tasks are aborted at process exit; the listening socket goes away. Acceptable. A graceful shutdown signal can come in #5 polish.

## 13. Open questions

None. All decisions are locked.
