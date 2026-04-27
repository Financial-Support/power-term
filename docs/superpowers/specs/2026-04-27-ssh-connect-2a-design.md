# Power-Term — Sub-project #2A: SSH Connect (ad-hoc)

**Date:** 2026-04-27
**Status:** Approved (brainstorming)
**Roadmap position:** Sub-project #2A. Splits the original "SSH + Host Manager" into:

- **#2A (this spec)** — SSH connection layer, three auth methods, known-hosts TOFU, ad-hoc connect via `Cmd+K`. No persistence.
- **#2B (next spec)** — SQLite-backed host store, macOS Keychain for secrets, sidebar host manager UI, connect-from-list.

#2A is independently shippable: at the end of #2A the user can hit `Cmd+K`, type `ssh user@host`, authenticate with their agent / a key file / a password, and get a working remote terminal in a new tab. #2B layers persistence and richer UI on top.

## 1. Purpose

Add SSH protocol support to power-term so a user can connect to remote shells from the same app, with the same xterm.js rendering and tab management already shipped in the Core MVP. The session abstraction must be interchangeable with the local `PtySession` from the renderer's point of view, so `Terminal.tsx` does not need to know whether a tab is local or remote.

## 2. Out of scope

- Saved hosts, host groups, host tags, persistence — deferred to #2B.
- macOS Keychain integration — deferred to #2B.
- Sidebar host manager UI — deferred to #2B.
- SSH key generation in-app — deferred to a later polish sub-project.
- Jump host / `ProxyCommand` / `ProxyJump` — deferred.
- SFTP — sub-project #3.
- Local + remote port forwarding — sub-project #4.
- Snippets, history sync — sub-project #4.
- Cloud sync — sub-project #6.

## 3. Stack

| Layer | Choice |
| --- | --- |
| SSH | `russh` (async tokio) |
| SSH key parsing | `russh-keys` |
| Async runtime | tokio (Tauri already pulls it in) |
| Hashing | `sha2` for SHA256 fingerprints |
| Existing deps | `base64`, `parking_lot`, `tracing`, `serde`, `serde_json`, `thiserror` |
| Frontend | React 18, existing `lib/ipc.ts`, no new libs (fuzzy search written in-tree, ~30 LOC) |

## 4. Architecture

### 4.1 Wire-format compatibility

`SshSession` emits the **same** events as `PtySession`/`PtyManager`:

- `pty://output/<id>` — base64-encoded chunk of session bytes
- `pty://exit/<id>` — `{ code: number | null, signal: string | null }`

That is the explicit reason the original spec broadened `PtyEvent::Exit` to `{ code, signal }` during MVP review: SSH disconnects need a way to signal "network drop" distinct from "shell exited 0", and `signal: "network_error"` (or similar) carries that information without a wire-format break.

A session id is a UUID v4 string regardless of origin (PTY vs SSH). The renderer holds the id and writes/resizes/kills against it; the backend dispatches to the right manager.

### 4.2 Module map (Rust)

```
src-tauri/src/ssh/
├── mod.rs              — re-exports + SshError
├── session.rs          — SshSession: connect, request PTY, exec shell, reader task
├── manager.rs          — SshManager: HashMap<SessionId, Arc<SshSession>>, forwards events
├── auth.rs             — Auth enum (Password / KeyFile / Agent), key loading
└── known_hosts.rs      — parse ~/.ssh/known_hosts, verify by SHA256 fingerprint, append
```

`SshManager` and `PtyManager` are siblings under Tauri-managed state. Commands route to the right manager based on the command name (`ssh_*` vs `pty_*`); ids are partitioned by manager because they were minted by different code paths.

### 4.3 Frontend additions

```
src/components/
├── CommandPalette.tsx           — Cmd+K overlay; for #2A only knows the "ssh ..." verb
├── AuthPrompt.tsx               — modal: pick agent / key file / password
├── HostFingerprintPrompt.tsx    — modal: SHA256 fingerprint, Accept / Reject / (Reset on mismatch)
src/lib/ipc.ts                   — add sshConnect, sshWrite, sshResize, sshKill, knownHostsAccept
src/state/sessionStore.ts        — Tab.kind: 'local' | 'ssh' (purely for display label)
src/App.tsx                      — register Cmd+K hotkey, mount palette + modals
```

## 5. Tauri command surface (added)

```rust
#[tauri::command] async fn ssh_connect(
    app: AppHandle,
    target: SshTarget,                 // { host, port, user }
    auth: AuthRequest,                 // { kind: "agent" | "password" | "key", ... }
    accept_fingerprint: Option<String>,// SHA256:<base64-no-pad> string the user accepted from a prior call (same format as ssh-keygen -lf)
) -> Result<SshConnectResult, String>;

#[tauri::command] fn ssh_write(pty_id: String, data: String) -> Result<(), String>;
#[tauri::command] fn ssh_resize(pty_id: String, cols: u16, rows: u16) -> Result<(), String>;
#[tauri::command] fn ssh_kill(pty_id: String) -> Result<(), String>;

#[tauri::command] fn known_hosts_get(host: String) -> Result<Option<KnownEntry>, String>;
```

`SshConnectResult` is one of:

```rust
enum SshConnectResult {
    Connected { id: String },
    NeedsFingerprint { fingerprint: String, host: String, key_type: String },
    FingerprintMismatch { fingerprint: String, expected: String, host: String },
    NeedsAuth { tried: Vec<String>, available: Vec<String> },
}
```

This single command is callable repeatedly with progressively more inputs, so the renderer can show one modal at a time. The frontend retries with the new info after each modal closes.

`pty_id` is reused as the parameter name on `ssh_write`/`ssh_resize`/`ssh_kill` for renderer simplicity (sessionStore stores `ptyId: string` regardless of origin). Internally the command looks up in `SshManager` (`ssh_*`) or `PtyManager` (`pty_*`).

## 6. Auth model

```rust
pub enum Auth {
    Password { password: String },
    KeyFile { path: PathBuf, passphrase: Option<String> },
    Agent,
}
```

Order tried by `ssh_connect` when no specific method requested:

1. Agent (`SSH_AUTH_SOCK` set + agent has matching identity).
2. Stop and return `NeedsAuth` with the methods the server advertised.

The frontend then shows `AuthPrompt`. The user picks one method and `ssh_connect` is called again with `auth = { kind: ... }`. If that method also fails, the modal reopens with a banner.

Server-rejected attempts log via `tracing::warn!` (no per-attempt count for #2A; can add lockout in #2B).

## 7. Known-hosts (TOFU)

- Path: `~/.ssh/known_hosts` (configurable in `Settings` later; #2A uses `dirs::home_dir().join(".ssh/known_hosts")`).
- Read-only support for hashed entries (`|1|...`), but only verify; never write hashed entries.
- Plain entry format on append: `<hostname> <keytype> <base64key>` (one per line, OpenSSH-compatible).
- Fingerprint format displayed to the user: `SHA256:<base64-no-pad>`, matching `ssh-keygen -lf`.

Verification flow:

1. After TCP+SSH handshake, russh hands us the server's host key.
2. We compute the SHA256 fingerprint, look it up in `~/.ssh/known_hosts` for the connection's hostname (or hostname:port if non-standard).
3. **No match for hostname** → return `NeedsFingerprint` to the renderer.
4. **Hostname known but key differs** → return `FingerprintMismatch`. Renderer shows a red warning modal. User can choose Reset (overwrite the entry) or cancel.
5. **Match** → continue to auth.
6. The renderer re-invokes `ssh_connect` with `accept_fingerprint = Some(fingerprint)`. Backend writes the entry, then proceeds. (Mismatch path also writes — but only after the user explicitly chose Reset.)

Concurrent writes to `~/.ssh/known_hosts` are serialized with a process-wide `tokio::sync::Mutex` (cheap, only acquired during accept).

## 8. Session lifecycle

`SshSession::connect(target, auth)` is async:

1. `tokio::net::TcpStream::connect((host, port))` with 10s timeout.
2. `russh::client::connect_stream(...)` builds the handshake.
3. `Client::check_server_key` — caller provides the verified fingerprint via channel; if mismatch, return error.
4. Authenticate (one method).
5. Open a session channel (`channel_open_session`).
6. `request_pty(...)` with cols/rows.
7. `request_shell()`.
8. Spawn a tokio task that reads `channel.wait()` data events → forwards `PtyEvent::Output(bytes)` to a `tokio::sync::mpsc::UnboundedSender<PtyEvent>`. On channel close → `PtyEvent::Exit { code, signal }`.
9. Manager wires that receiver into the same forwarder pattern as `PtyManager` (translate to Tauri events).

`write` writes to the channel; `resize` sends `window-change`; `kill` closes the channel and cancels the task.

Drop semantics mirror `PtySession`:

```rust
impl Drop for SshSession {
    fn drop(&mut self) {
        // Cancel the reader task and let russh close the channel.
        self.cancel_token.cancel();
    }
}
```

## 9. Settings additions

Append to `Settings` (#2A only adds two fields; defaults safe for absent values):

```toml
ssh_connect_timeout_secs = 10
ssh_keepalive_interval_secs = 30
```

These get included in TOML defaults; old config files (without these keys) fall back to defaults via `#[serde(default)]` already on `Settings`.

## 10. Error handling

| Failure | Behaviour |
| --- | --- |
| TCP connect fail (DNS, refused, timeout) | `Err("connect failed: <kind>")` → toast |
| TLS / SSH handshake fail | `Err("ssh handshake failed: ...")` |
| Unknown host fingerprint | `Ok(NeedsFingerprint { ... })` — renderer shows modal |
| Host fingerprint mismatch | `Ok(FingerprintMismatch { ... })` — renderer shows red warning modal |
| `accept_fingerprint` does not match what server presented | `Err("fingerprint did not match server")` (defends against TOCTOU) |
| Auth method rejected | `Ok(NeedsAuth { tried, available })` — renderer reopens AuthPrompt with banner |
| `request_pty` / `request_shell` fail | session is closed, return `Err` |
| Network drop mid-session | `PtyEvent::Exit { code: None, signal: Some("network_error") }` — banner inline in terminal pane |
| `ssh_write` with unknown `pty_id` | `Err("unknown ssh id")` |

## 11. Testing

- **Rust unit (`cargo test`):**
  - `known_hosts::parse` round-trip on a small static fixture covering plain entries, multi-host lines (`host1,host2 ...`), and hashed entries (verify-only).
  - `known_hosts::verify` returns `Match` / `MismatchExpected(<key>)` / `Unknown` correctly.
  - `known_hosts::append` writes a plain entry; subsequent `verify` matches.
  - `auth::load_key_from_file` round-trips a passphrase-protected ed25519 key against a fixture (`tests/fixtures/id_ed25519` generated at build time inside `tempfile`).
- **Rust integration (`#[ignore]` by default):**
  - `connect_password` against a containerised sshd if available; skipped in CI.
- **Frontend (vitest):**
  - `CommandPalette` parses `ssh band@dev.example.com:2222` into `{ user: 'band', host: 'dev.example.com', port: 2222 }`. Edge cases: missing user, missing port, IPv6 in brackets.
  - `AuthPrompt` selects one method and calls back with the right shape.
- **Manual smoke:**
  - Connect via agent to a known-hosts-known host.
  - Connect via key file (passphrase-protected).
  - Connect via password.
  - Connect to a brand-new host → Accept fingerprint → reconnect persists in `known_hosts`.
  - Simulate fingerprint mismatch by editing `known_hosts` → red modal → Reset → connect.
  - Disconnect cable mid-session → terminal banner shows network drop.

E2E (Tauri WebDriver) explicitly deferred.

## 12. File structure (delta)

```
src-tauri/Cargo.toml                  (+ russh, russh-keys, sha2; tokio already present)
src-tauri/src/ssh/                    (new directory)
src-tauri/src/commands.rs             (modified — add ssh_*, known_hosts_*)
src-tauri/src/main.rs                 (modified — manage(SshManager))
src-tauri/src/settings/mod.rs         (modified — two new optional fields)
src/components/CommandPalette.tsx     (new)
src/components/AuthPrompt.tsx         (new)
src/components/HostFingerprintPrompt.tsx (new)
src/lib/ipc.ts                        (modified — ssh* wrappers)
src/lib/sshTarget.ts                  (new — pure parser for "user@host:port")
src/state/sessionStore.ts             (modified — Tab.kind: 'local' | 'ssh', defaults 'local')
src/App.tsx                           (modified — Cmd+K, mount palette + modals)
src/styles.css                        (modified — palette + modal styling)
```

## 13. Risks

- **russh API churn.** The crate has had breaking minor releases. Pin a known-good version in `Cargo.toml` and re-test on bumps.
- **tokio runtime sharing with Tauri.** Tauri 2 already runs a tokio runtime; russh sessions must run on it (`tauri::async_runtime::spawn` rather than `std::thread::spawn`). The `SshManager` forwarder thread can stay on a regular OS thread, identical to `PtyManager`.
- **`signal: "network_error"` is a string contract.** It's a one-way addition — nothing currently consumes the value as a discriminator. The frontend just renders whatever string arrives. Document the well-known values (`network_error`, future: `auth_revoked`, `idle_timeout`) in this file as they are added so the frontend stays consistent.
- **`~/.ssh/known_hosts` has hashed entries.** OpenSSH writes hashed-by-default since 2008-ish. For verification we must support reading hashed entries; for writing we use plain entries (matches what most other SSH clients do when adding via UI). Document the asymmetry.
- **Password modal in plaintext over IPC.** Tauri 2 IPC is in-process (renderer → main, no network), but the password is still a string that lives in JS memory until the modal closes. We do not log it; we do not persist it (#2A — that's #2B's Keychain job). Acceptable for MVP.

## 14. Open questions

None. All decisions for #2A's scope are locked above.
