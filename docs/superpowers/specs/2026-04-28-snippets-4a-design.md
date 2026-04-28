# Power-Term — Sub-project #4A: Snippets

**Date:** 2026-04-28
**Status:** Approved (brainstorming, auto-approved per user authorization)
**Roadmap position:** Sub-project #4A. Splits the original "#4: Snippets + Port Forwarding" into two halves so the smaller feature ships first. Port forwarding is #4B.

## 1. Purpose

Let users save short command strings ("snippets") and one-click insert them into the active terminal tab. Common use cases: deploy commands, log-tailing one-liners, common diagnostic invocations. The user should be able to keep their daily commands within reach without retyping or hunting through shell history.

## 2. Out of scope

- Variable interpolation (`{{host}}`, `{{user}}`, `{{cwd}}`) — defer to a later polish pass; MVP inserts raw text.
- Snippet sharing / sync across devices (sub-project #6).
- Multi-line "scripts" with control flow / conditional execution.
- Auto-complete of snippets while typing in the terminal.
- Per-host snippet libraries — MVP is one global library.
- Snippet folders / nested groups — MVP uses flat tags for organization.
- Drag-drop reorder.

## 3. Stack

| Layer | Choice |
| --- | --- |
| Storage | Reuse `rusqlite` from #2B; add a v2 migration that creates the `snippets` table. |
| Tauri commands | `snippets_*` family mirrors `hosts_*`. |
| Frontend | Existing React 18 + Zustand. Reuses the modal + sidebar patterns from #2B. |

No new dependencies on either side.

## 4. SQLite schema (migration v2)

```sql
CREATE TABLE snippets (
  id TEXT PRIMARY KEY NOT NULL,           -- UUIDv4
  name TEXT NOT NULL,                     -- short label
  content TEXT NOT NULL,                  -- the text inserted into the terminal
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,            -- unix epoch milliseconds
  last_used_at INTEGER                    -- nullable
);
CREATE INDEX snippets_name_idx ON snippets(name);
```

The migration runner from #2B already supports forward migrations via `PRAGMA user_version`. This sub-project bumps `CURRENT_VERSION` to 2 and adds `migration_v2`.

## 5. File layout (delta)

```
src-tauri/src/
├── store/
│   ├── schema.rs                          (modified — CURRENT_VERSION=2 + migration_v2)
│   ├── snippets.rs                        (new — SnippetStore, Snippet, SnippetInput)
│   └── mod.rs                             (modified — pub mod snippets; re-exports)
├── commands.rs                            (modified — snippets_* commands)
└── main.rs                                (modified — manage(SnippetStore))

src/
├── state/snippetStore.ts                  (new — Zustand)
├── components/
│   ├── SnippetFormModal.tsx               (new — Add/Edit form)
│   ├── SnippetsPanel.tsx                  (new — collapsible section in Sidebar)
│   └── Sidebar.tsx                        (modified — mount SnippetsPanel below hosts)
├── lib/ipc.ts                             (modified — snippet* wrappers)
├── types.ts                               (modified — Snippet, SnippetInput)
└── App.tsx                                (modified — onInsertSnippet handler routes write to active tab)
```

`HostStore` and `SnippetStore` share the same SQLite connection via a thin `Db` wrapper that owns one `parking_lot::Mutex<Connection>` and exposes `with_conn(|c| ...)`. Both stores hold an `Arc<Db>`. The migration runner runs once on `Db::open`. This avoids two `open()` calls + duplicate file-locking on the same `hosts.db`.

`HostStore`'s public API is preserved exactly (no breaking changes to its callers); internally it becomes a thin facade over `Db`. `SnippetStore` is built the same way from day one.

## 6. Tauri command surface

```rust
#[tauri::command] fn snippets_list() -> Result<Vec<Snippet>, String>;
#[tauri::command] fn snippets_create(input: SnippetInput) -> Result<Snippet, String>;
#[tauri::command] fn snippets_update(id: String, input: SnippetInput) -> Result<Snippet, String>;
#[tauri::command] fn snippets_delete(id: String) -> Result<(), String>;
#[tauri::command] fn snippets_touch(id: String) -> Result<(), String>;
```

`Snippet` = `SnippetInput` + `id` + `created_at` + `last_used_at`. JSON shape mirrors `Host`.

## 7. Sidebar UX

Below the hosts groups, add a collapsible "Snippets" section:

```
┌──────────────────────────────────┐
│ + New Host                       │
│ ─────────────────────────────────│
│ ▾ Personal                       │
│   • mac-mini                     │
│ ▾ Work                           │
│   • bastion                      │
│ ─────────────────────────────────│
│ ▾ Snippets                ✎  +   │
│   ▶ tail logs                    │
│   ▶ docker ps -a                 │
│   ▶ kubectl get pods             │
│ ─────────────────────────────────│
│ Tip: Cmd+K opens the palette.    │
└──────────────────────────────────┘
```

Behaviour:
- Click a snippet row → `App.onInsertSnippet(snippet)` — writes the snippet's `content` to the active tab's terminal session, then `snippets_touch(id)` for last_used tracking.
- Hover reveals `✎` (edit) and `×` (delete) inline at the right.
- `+` in the section header opens `SnippetFormModal` in create mode.
- Section is collapsible (component state, ephemeral).
- Empty state: "No snippets. Click + to add one."

## 8. SnippetFormModal

Mirrors `HostFormModal`:
- **Name** (required, ≤ 80 chars) — display label
- **Content** (required) — multi-line textarea, `font-family: ui-monospace`
- **Tags** — chip input, comma-separated
- Save / Cancel
- Esc closes
- Save disabled until name + content non-empty

## 9. Insert-into-active-terminal flow

```
Click snippet row
    │
    ▼
App.onInsertSnippet(snippet)
    │
    ▼
const tab = useSessionStore.getState().tabs.find(t => t.id === activeTabId)
if !tab → toast "Open a terminal first" (or no-op silently)
if tab.kind === 'sftp' → toast "Snippets only insert into shells"; no-op
if tab.kind === 'local' → ptyWrite(tab.ptyId, snippet.content)
if tab.kind === 'ssh'   → sshWrite(tab.ptyId, snippet.content)
    │
    ▼
snippetsTouch(snippet.id)
```

`snippet.content` is sent as-is — including a trailing newline if the user wrote one. The shell receives it as if typed. Multi-line snippets work because each `\n` is a regular character that the PTY processes one line at a time.

## 10. Error handling

| Failure | Behaviour |
| --- | --- |
| SQLite migration v2 fails on app startup | App refuses to start; tracing::error + dialog (consistent with #2B's contract). |
| `snippets_*` commands fail | Error string surfaces in `useSnippetStore.error`; sidebar section shows the banner. |
| Insert into a non-shell active tab | Inline toast / hint, no write attempt. |
| No active terminal tab | Same as above. |
| Snippet content is empty | Form's Save button disabled; impossible to create. |

## 11. Testing

- **Rust unit (`cargo test`):**
  - `schema::migrate` from version 0 → 2 creates both `hosts` and `snippets` tables, sets `user_version = 2`.
  - `schema::migrate` from version 1 → 2 creates only `snippets` (idempotent for `hosts`).
  - `SnippetStore::create + list` round-trip.
  - `SnippetStore::update` modifies the row; `created_at` unchanged.
  - `SnippetStore::touch` updates `last_used_at` only.
  - `SnippetStore::delete` removes the row.
  - `SnippetStore::create` validation: empty name / empty content rejected.
- **Frontend vitest:**
  - `snippetStore` actions: load / create / update / delete / touch (mock the IPC layer).
  - `SnippetFormModal` validation: required-fields, Esc closes, Save dispatches the right shape.
  - `SnippetsPanel` interactions: click-row invokes `onInsert`, `+` opens form, ✎ opens edit, × triggers delete, group expand/collapse toggles.
- **Manual smoke:**
  - Create snippet "List files" with content `ls -la\n`. Click in a local shell → output appears.
  - Edit the snippet → re-click → updated text inserts.
  - Delete a snippet → row disappears + SQLite row gone.
  - Click a snippet while an SFTP tab is active → no-op + hint.
  - Restart app → snippets persist.

## 12. Risks

- **Migration ordering**: introducing `migration_v2` runs only once per DB. If a user's DB is at version 1 (post-#2B), the next launch jumps to 2. The plan adds a test that exercises the v1 → v2 path so we don't quietly create a broken combined schema in fresh installs.
- **Sidebar height**: with both hosts and snippets, the sidebar might overflow on small windows. The `.sidebar-list` already has `overflow: auto`, so this is handled.
- **Insert into wrong tab**: the user might click a snippet thinking they have one tab focused but actually a different tab is active. The terminal-write is destructive (paste into a shell). Mitigation: visible feedback that includes the active tab name in the toast, e.g. "Inserted into mac-mini". Defer to a later polish pass.

## 13. Open questions

None. All decisions are locked.
