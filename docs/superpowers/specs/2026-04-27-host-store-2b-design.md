# Power-Term — Sub-project #2B: Host Store + Sidebar

**Date:** 2026-04-27
**Status:** Approved (brainstorming)
**Roadmap position:** Sub-project #2B — second half of the original "SSH + Host Manager" sub-project. Builds on #2A's SSH connection layer (`russh`-based `SshSession`/`SshManager`, three auth methods, TOFU known-hosts) by adding persistent storage of saved hosts and a left sidebar UI for managing and connecting from them.

## 1. Purpose

Let users save SSH hosts in a SQLite-backed local database, manage them through a left sidebar, and connect from a row click. Reuses the entire #2A SSH state machine and modals — a connect from a saved host is identical to a Cmd+K ad-hoc connect except the target and a hint of the auth method come pre-filled, and stored secrets (passwords / key passphrases) are pulled from the macOS Keychain instead of prompted.

## 2. Out of scope

- Drag-resize sidebar; reorder hosts; nested groups; favorites list; activity / last-used recency surfacing.
- Bulk import/export of `~/.ssh/config`.
- SSH key generation in app.
- Cloud sync (sub-project #6).
- SFTP, port forwarding, snippets — separate later sub-projects.

## 3. Stack

| Layer | Choice |
| --- | --- |
| SQLite driver | `rusqlite` with `bundled` feature (sync, embedded, no system SQLite needed) |
| Migrations | `PRAGMA user_version`-driven, hand-rolled in Rust (no extra crate) |
| macOS Keychain | `keyring` crate ≥ 3.x |
| Frontend | React 18 + TypeScript + Zustand (existing) |
| Tests | `cargo test` (Rust), `vitest` (frontend) |

No new frontend dependencies.

## 4. File layout (delta on top of #2A)

```
src-tauri/Cargo.toml                  (+ rusqlite, keyring)
src-tauri/src/
├── store/                            (new directory)
│   ├── mod.rs                        (HostStore + StoreError + migrations runner)
│   ├── schema.rs                     (CREATE TABLE statements + version migrations)
│   ├── host.rs                       (Host struct + HostInput + CRUD)
│   └── secrets.rs                    (Keychain wrapper)
├── commands.rs                       (modified — add hosts_* + secret_* commands)
└── main.rs                           (modified — manage(HostStore))

src/
├── components/
│   ├── Sidebar.tsx                   (new — group tree + host list + add button)
│   ├── HostFormModal.tsx             (new — Add/Edit Host form)
│   └── ConfirmModal.tsx              (new — delete confirmation)
├── state/hostStore.ts                (new — Zustand store of saved hosts)
├── lib/ipc.ts                        (modified — hosts*/secret* wrappers)
├── hooks/useSidebarToggle.ts         (new — Cmd+B)
├── App.tsx                           (modified — mount Sidebar, drive flows)
└── styles.css                        (modified — sidebar + modal layout)
```

## 5. SQLite schema

Single `hosts` table. Tags stored as JSON-encoded TEXT in the row to keep #2B small; if performance becomes an issue at thousands of hosts (#6), normalize to a `tags` table in a later migration.

```sql
CREATE TABLE hosts (
  id TEXT PRIMARY KEY NOT NULL,            -- UUIDv4
  name TEXT NOT NULL,                      -- display label
  hostname TEXT NOT NULL,                  -- DNS name or IP
  port INTEGER NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
  username TEXT NOT NULL,
  group_name TEXT,                         -- nullable; NULL = "Ungrouped"
  tags_json TEXT NOT NULL DEFAULT '[]',
  auth_method TEXT NOT NULL CHECK (auth_method IN ('agent', 'key', 'password')),
  key_path TEXT,                           -- nullable; required when auth_method='key'
  notes TEXT,                              -- nullable, free-form
  created_at INTEGER NOT NULL,             -- unix epoch milliseconds
  last_used_at INTEGER                     -- nullable; updated on each successful connect
);
CREATE INDEX hosts_group_idx ON hosts(group_name);
```

`PRAGMA user_version = 1;` is set after the schema is created. The migration runner reads `user_version` on startup, applies any newer migrations in order, then writes the new version. This is a forward-only system; no down-migrations.

DB lives at `~/Library/Application Support/power-term/hosts.db`. Created with `0700` parent directory (already so for `power-term/`).

## 6. Keychain layout

`keyring` crate uses `service` + `account` to address an entry. We use:

- service: `com.band.power-term`
- account: `host:<uuid>` for password/passphrase tied to a saved host
- account: `kh:<host>:<port>` reserved for #2C if we ever want host-key cache outside `~/.ssh/known_hosts`

Single secret per host: when `auth_method = 'password'` the secret is the password; when `auth_method = 'key'` the secret is the optional key passphrase. The application code never persists either to disk.

## 7. Tauri command surface (added)

```rust
#[tauri::command] fn hosts_list() -> Result<Vec<Host>, String>;
#[tauri::command] fn hosts_create(input: HostInput) -> Result<Host, String>;
#[tauri::command] fn hosts_update(id: String, input: HostInput) -> Result<Host, String>;
#[tauri::command] fn hosts_delete(id: String) -> Result<(), String>;
#[tauri::command] fn hosts_touch(id: String) -> Result<(), String>;     // updates last_used_at
#[tauri::command] fn secret_set(host_id: String, secret: String) -> Result<(), String>;
#[tauri::command] fn secret_get(host_id: String) -> Result<Option<String>, String>;
#[tauri::command] fn secret_delete(host_id: String) -> Result<(), String>;
```

`HostInput` is the `Host` shape minus `id`/`created_at`/`last_used_at`. `Host` is `HostInput` plus those fields. Both serialize as JSON for the renderer.

`hosts_delete` cascades to `secret_delete` so a removed host doesn't leave an orphan Keychain entry.

## 8. Sidebar UX

Layout:

```
┌────────────────┬──────── tabs ────────┐
│ + New Host  ⌥B │  ┌─────────────────┐ │
│ ───────────────│  │ Terminal        │ │
│ ▾ Personal     │  │                 │ │
│   • mac-mini   │  │                 │ │
│   • homelab    │  │                 │ │
│ ▾ Work         │  │                 │ │
│   • bastion    │  │                 │ │
│ ▾ (Ungrouped)  │  │                 │ │
│   • temp-vm    │  │                 │ │
│ ───────────────│  │                 │ │
│ Cmd+K palette  │  └─────────────────┘ │
└────────────────┴──────────────────────┘
```

Behaviour:
- 240px fixed-width column on the left, between TitleBar and the terminals area.
- Default visible. `Cmd+B` toggles open/closed (component-state, not persisted).
- Each row displays the host's `name`. Hover reveals a `✎` (edit) and a `×` (delete) inline at the right edge.
- Click a row → `connectFromHost(host)`.
- `+ New Host` button at top → opens `HostFormModal` in create mode.
- Group headers are collapsible (component state, ephemeral). Hosts with `group_name = NULL` live under a synthetic `(Ungrouped)` group.
- A footer hint reminds the user that `Cmd+K` is also available for ad-hoc connects.

Right-click context menu and reorder are deferred.

## 9. HostFormModal

One component serves both Add and Edit. Fields:

- **Name** (required) — display label
- **Hostname** (required)
- **Port** (defaults to 22; integer 1–65535)
- **Username** (required)
- **Group** — combobox / free-text; suggestions from existing distinct `group_name` values
- **Tags** — chip input; comma- or Enter-separated; deduped on submit
- **Auth method** — radio `Agent | Private key | Password`
  - `Agent` — no extra fields
  - `Private key` — text input for `key_path` (file picker button optional, MVP just a text input) + optional `passphrase` (password input) + checkbox **Save passphrase to Keychain** (default ON if the field is non-empty)
  - `Password` — `password` (password input) + checkbox **Save password to Keychain** (default ON)
- **Notes** — multi-line textarea, optional

Submit:
- Add mode: `hosts_create(input)` → if `auth_method` ∈ {`key` with passphrase, `password`} AND save-to-Keychain checked → `secret_set(new_host.id, secret)`
- Edit mode: `hosts_update(id, input)` → `secret_set` only when the secret field was changed (UI keeps a `dirty` flag on the secret input). If the user toggled save-to-Keychain OFF and a stored secret existed, the form calls `secret_delete`.

Validation:
- Required fields non-empty; port numeric in range; if `auth_method='key'` then `key_path` non-empty.
- Modal disables Save while validation fails. Errors are inline next to fields.

## 10. Connect-from-host flow

```
Click host row
    │
    ▼
App.connectFromHost(host)
    │ build target + auth
    ▼
auth_method = "agent"   → AuthRequest { kind: "agent" }
auth_method = "key"     → secret_get(id) → AuthRequest { kind: "key", path, passphrase: secret? }
auth_method = "password"→ secret_get(id) → AuthRequest { kind: "password", password: secret? }
                                            │ (if password missing in Keychain → fall through to AuthPrompt)
    │
    ▼
driveSshConnect(target, auth, null)   (existing #2A state machine)
    │ Connected?
    ▼ yes
hosts_touch(id); addTab; tab title = host.name
```

If `auth_method = 'password'` but Keychain returns `None`, we open the existing `AuthPrompt` with `kind: 'password'` pre-selected so the user can type the password — preserving the same UX for the "I deselected save-to-keychain" case.

If the connect returns `NeedsFingerprint` or `FingerprintMismatch`, the existing #2A `HostFingerprintPrompt` handles it. No #2B-specific work required.

## 11. Error handling

| Failure | Behaviour |
| --- | --- |
| Cannot open SQLite file (permissions, disk full) | `tracing::error` + dialog "Could not open hosts database"; sidebar shows banner; host CRUD disabled; Cmd+K still works |
| Migration to a newer schema fails | App refuses to start; surfaces the failure via dialog; user must manually recover (rename `hosts.db` to `hosts.db.bak`) |
| Keychain access denied (sandbox/CI/locked) | Toast "Keychain access denied"; the affected `secret_set` returns `Err`; the host is still saved without its secret |
| Saved auth method needs Keychain but `secret_get` returns `None` | Open the existing `AuthPrompt` modal with that method pre-selected so the user can supply the secret manually |
| Key file path no longer exists on disk | russh reports the read failure; the existing `SshError::Any("read key file: …")` toast surfaces; user can edit the host to fix the path |
| `hosts_delete` cascade `secret_delete` fails | Log warning; host row is still removed from SQLite (the Keychain entry can become orphaned but is harmless and re-keyed if a new host happens to share the same UUID — which won't, since UUIDs are fresh) |

## 12. Testing

- **Rust unit (`cargo test`):**
  - `HostStore::create_v1_schema` on a `:memory:` connection asserts table + index + `user_version=1`
  - `HostStore::create + list` round-trip
  - `HostStore::update` modifies the row; `last_used_at` untouched
  - `HostStore::touch` updates `last_used_at` only
  - `HostStore::delete` removes the row (and a sibling-test verifies the cascade is wired in the command layer)
  - `secrets::roundtrip` set/get/delete on `:memory:`-equivalent — i.e., a feature flag `mock-keychain` that swaps the real `keyring::Entry` for an in-process map for CI; default is the real Keychain.
- **Frontend vitest:**
  - `hostStore` actions: load / create-then-list / update / delete / touch
  - `HostFormModal` validation: required-fields error, port range, key_path required when auth=key
  - `Sidebar` interactions: row click invokes `onConnect`, `+` opens modal, group expand/collapse toggles
  - `useSidebarToggle` hotkey toggles state on Cmd+B
- **Manual smoke** (recorded in plan):
  - Create a host with each auth method; restart app; sidebar shows it after relaunch
  - Connect via saved agent / key / password (with and without saved passphrase)
  - Edit a host; verify SQLite update + (if changed) Keychain update
  - Delete a host; verify Keychain entry is removed
  - Cmd+B toggles sidebar; Cmd+K still works while sidebar is open
  - Multi-tab: open three hosts; close some; close-last-tab still quits

## 13. Risks

- **Keychain user-prompt fatigue.** macOS prompts "Always Allow" on first read after rebuild. Document the one-time prompt; user clicks "Always Allow" once. Not a code concern.
- **`keyring` crate Linux/Windows behavior.** We're macOS-only for MVP — fine; revisit when other platforms are added.
- **`rusqlite` `bundled` feature compile time.** First build adds ~30s for the C compile; subsequent builds cached.
- **Migration discipline.** Each schema bump adds a `migration_<n>(conn)` function; the runner walks them in order. Out-of-order or skipped migrations are caught by an explicit version-mismatch check.
- **Saved password in JS memory.** Same caveat as #2A: the password sits in renderer JS until the modal closes; not logged, not persisted on disk. Acceptable for MVP.

## 14. Open questions

None. All decisions for #2B's scope are locked.
