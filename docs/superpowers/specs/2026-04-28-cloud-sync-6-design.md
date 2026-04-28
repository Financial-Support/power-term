# Power-Term Cloud Sync — Sub-project #6

**Date:** 2026-04-28
**Status:** Approved
**Scope:** Sub-project #6 of the Termius-clone roadmap

---

## 1. Purpose

Sync hosts, snippets, port forwards, and settings across machines via Supabase. Credentials (passwords, passphrases) are encrypted client-side before upload — Supabase never sees plaintext secrets. Auth is GitHub OAuth. Sync model is push-on-change + pull-on-open (no persistent WebSocket).

---

## 2. Roadmap context

Builds on sub-projects #1–#5. Sub-project #7 (Advanced protocols) remains out of scope.

---

## 3. In-scope features

### 3.1 What syncs

| Data | Transport | Notes |
|---|---|---|
| Hosts | Supabase `hosts` table | All fields except credentials |
| Snippets | Supabase `snippets` table | Full row |
| Port forwards | Supabase `forwards` table | Full row |
| Settings | Supabase `settings` table | Full JSON blob |
| Credentials | Supabase `credentials` table | AES-256-GCM ciphertext only |

### 3.2 Sync model

**Push-on-change:** After any successful local CRUD operation (create, update, delete), the Rust command layer spawns a Tokio task to UPSERT the affected row to Supabase. Deletes are soft-deletes: `deleted_at` is set on the remote row, the local row is removed. If the network is unavailable, the operation is held in an in-memory pending queue and retried on next app open.

**Pull-on-open:** On startup (after the app window is ready), if a valid JWT is in the keychain, the sync engine fetches all rows from each Supabase table for the authenticated user and merges them into the local SQLite DB using last-write-wins by `updated_at`. Rows with `deleted_at` set on the remote cause a local delete. Rows present locally but absent remotely (and not in the pending-push queue) are treated as new local items and pushed immediately.

**Conflict resolution:** Last-write-wins on `updated_at` (Unix ms). Remote wins if `remote.updated_at > local.updated_at`; local wins otherwise. No manual conflict UI.

### 3.3 Authentication

- GitHub OAuth via Supabase Auth.
- "Sign in with GitHub" opens the system browser to the Supabase OAuth URL.
- Supabase redirects to `power-term://auth/callback?access_token=...&refresh_token=...`.
- The app catches this via `tauri-plugin-deep-link`, stores `access_token` and `refresh_token` in the system keychain (`com.band.power-term.sync-jwt` and `com.band.power-term.sync-refresh`).
- JWT is automatically refreshed using the refresh token before each sync operation if it is expired.
- Sign-out clears both keychain entries and sets `sync_user` to `null` in the frontend store.

### 3.4 Credential encryption

- On first sign-in the app generates a cryptographically random 32-byte sync key.
- The key is stored in the system keychain under `com.band.power-term.sync-key`.
- Credentials (password or SSH passphrase per host) are encrypted with AES-256-GCM before upload to the `credentials` table. The nonce is prepended to the ciphertext (12 bytes nonce + N bytes ciphertext, base64-encoded).
- The sync key is displayed in Settings → Sync as a 24-character Base58 string (e.g. `K7xP2mNqRvJ8yDw3cBt6L5sA`). The user copies this to any new device via Settings → Sync → "Enter sync key".
- If the sync key is absent on a device, hosts/snippets/settings sync normally; credential rows are uploaded with a sentinel ciphertext `ENCRYPTED:NO_KEY` and are not decrypted locally. The user sees a "Credentials not available — enter sync key" notice in the Sync tab.
- If the sync key is lost permanently, the user can generate a new one; this re-encrypts all credentials on the next push cycle (re-upload all credential rows with new ciphertext).

### 3.5 Supabase schema

```sql
-- All tables share this pattern: user_id FK, updated_at for LWW, deleted_at for tombstones

CREATE TABLE hosts (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  hostname     TEXT NOT NULL,
  port         INTEGER NOT NULL DEFAULT 22,
  username     TEXT NOT NULL,
  group_name   TEXT,
  tags         JSONB NOT NULL DEFAULT '[]',
  auth_method  TEXT NOT NULL DEFAULT 'agent',
  key_path     TEXT,
  notes        TEXT,
  created_at   BIGINT NOT NULL,
  last_used_at BIGINT,
  updated_at   BIGINT NOT NULL,
  deleted_at   BIGINT
);

CREATE TABLE snippets (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  content      TEXT NOT NULL,
  tags         JSONB NOT NULL DEFAULT '[]',
  created_at   BIGINT NOT NULL,
  last_used_at BIGINT,
  updated_at   BIGINT NOT NULL,
  deleted_at   BIGINT
);

CREATE TABLE forwards (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_id      UUID NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  bind_addr    TEXT NOT NULL,
  bind_port    INTEGER NOT NULL,
  remote_host  TEXT NOT NULL,
  remote_port  INTEGER NOT NULL,
  auto_start   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted_at   BIGINT
);

CREATE TABLE settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL
);

CREATE TABLE credentials (
  id         UUID PRIMARY KEY,  -- equals host_id
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,     -- base64(12-byte nonce || AES-256-GCM ciphertext)
  updated_at BIGINT NOT NULL,
  deleted_at BIGINT
);

-- Row Level Security (same policy on all tables)
ALTER TABLE hosts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE snippets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE forwards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows" ON hosts      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own rows" ON snippets   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own rows" ON forwards   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own rows" ON settings   FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own rows" ON credentials FOR ALL USING (auth.uid() = user_id);
```

### 3.6 New Tauri commands

| Command | Description |
|---|---|
| `sync_sign_in` | Opens system browser to Supabase GitHub OAuth URL |
| `sync_sign_out` | Clears JWT + refresh token from keychain; returns to unsigned state |
| `sync_pull` | Manual pull trigger; returns `SyncResult` |
| `sync_status` | Returns `SyncState` (user, lastSynced, pendingCount, error) |
| `sync_get_key` | Returns the 24-char Base58 sync key (creates one if not present) |
| `sync_set_key` | Accepts a 24-char Base58 key from the user (new device onboarding) |

### 3.7 UI changes

**SettingsModal — new "Sync" tab (third tab)**

- *Not signed in:* "Sign in with GitHub" button (calls `sync_sign_in`), short description.
- *Signed in:* GitHub avatar + username, last-synced timestamp, "Sync key" section (masked key with "Show" / "Copy" buttons), "Sign out" button.
- *Sync key missing:* "Enter sync key" text input + "Save" button (calls `sync_set_key`).
- Errors from failed sync are shown inline.

**TitleBar — sync status icon** (right side, left of layout picker)

| State | Icon | Color |
|---|---|---|
| Not connected | —  | `var(--text-muted)` |
| Syncing | ↻ (animated) | `var(--accent)` |
| Synced | ✓ | `var(--accent)` |
| Error | ✕ | `#f87171` |

Clicking the error icon opens the Sync tab of SettingsModal with the error message visible.

---

## 4. Out of scope

- Windows / Linux sync.
- Realtime sync (WebSocket subscriptions).
- Per-field conflict resolution UI.
- Sharing hosts with other users / team accounts.
- Sync key QR code or auto-distribution.
- Re-encryption on sync key rotation (deferred — currently requires manual credential re-entry on old key loss).

---

## 5. Architecture

### 5.1 File layout

```
src-tauri/src/
  sync/
    mod.rs        ← SyncManager: orchestrates pull-on-open, push queue, status events
    auth.rs       ← Supabase Auth: OAuth URL, deep-link callback, JWT refresh, keychain
    client.rs     ← reqwest HTTP client for Supabase REST API (CRUD + upsert helpers)
    encrypt.rs    ← AES-256-GCM encrypt/decrypt, sync key generation, Base58 encoding
    pull.rs       ← Pull-on-open: fetch remote rows, merge into SQLite, handle tombstones
    push.rs       ← Push-on-change: UPSERT rows, soft-delete, in-memory retry queue

src/
  state/
    syncStore.ts       ← Zustand store: SyncUser | null, SyncStatus, lastSynced, error
  components/
    SyncStatus.tsx     ← TitleBar icon (uses syncStore)
    SyncTab.tsx        ← Content for the Sync tab in SettingsModal

src-tauri/src/settings/mod.rs      ← MODIFY: add `updated_at: u64` to Settings (default 0, set to now_ms() on every apply()); call sync push after apply()
src-tauri/src/hosts/mod.rs         ← MODIFY: call sync push after create/update/delete
src-tauri/src/snippets/mod.rs      ← MODIFY: call sync push after create/update/delete
src-tauri/src/forwards/mod.rs      ← MODIFY: call sync push after create/update/delete
src-tauri/src/lib.rs               ← MODIFY: register new sync commands, deep-link handler
src-tauri/Cargo.toml               ← MODIFY: add `tauri-plugin-deep-link`, `reqwest`, `aes-gcm`, `bs58`, `hkdf`, `sha2`
src-tauri/tauri.conf.json          ← MODIFY: register `power-term` URL scheme for deep-link
src/components/SettingsModal.tsx   ← MODIFY: add Sync tab
src/components/TitleBar.tsx        ← MODIFY: add SyncStatus icon
src/types.ts                       ← MODIFY: add SyncUser, SyncStatus, SyncState types
```

### 5.2 Data flow — first sign-in

1. User opens Settings → Sync tab → clicks "Sign in with GitHub".
2. `sync_sign_in` opens system browser to Supabase OAuth URL.
3. User authorises → Supabase redirects to `power-term://auth/callback?access_token=...&refresh_token=...`.
4. `tauri-plugin-deep-link` fires an event; `auth.rs` extracts tokens, stores in keychain.
5. `sync_status` emits event updating `syncStore` to `{ user: { id, github_username }, status: 'syncing' }`.
6. Pull-on-open runs; local DB is populated with remote data.
7. `syncStore` transitions to `{ status: 'synced', lastSynced: <timestamp> }`.

### 5.3 Data flow — push-on-change (host create example)

1. Frontend calls `hosts_create(patch)`.
2. Rust inserts into local SQLite, returns new host.
3. `hosts_create` command calls `SyncManager::push_host(host)` as a detached Tokio task.
4. `push.rs` calls `client.upsert("hosts", row)` — HTTP POST to Supabase REST with `Prefer: resolution=merge-duplicates`.
5. On success: no state change needed. On failure: row added to `PushQueue` (in-memory `Vec<PendingOp>`).

### 5.4 Data flow — pull-on-open (merge)

```
For each table in [hosts, snippets, forwards]:
  remote_rows = client.select(table, "deleted_at=is.null")
  tombstones  = client.select(table, "deleted_at=not.is.null")
  
  for row in remote_rows:
    local = sqlite.get(table, row.id)
    if local is None:
      sqlite.insert(row)
    elif row.updated_at > local.updated_at:
      sqlite.update(row)
    // else: local is newer, skip (will push on next change)
  
  for tomb in tombstones:
    if sqlite.exists(table, tomb.id):
      sqlite.delete(table, tomb.id)

// Settings: single-row merge
remote_settings = client.select_one("settings", user_id)
if remote_settings.updated_at > local_settings.updated_at:
  apply remote_settings.data to config.toml

// Credentials: decrypt and store in keychain
remote_creds = client.select("credentials", "deleted_at=is.null")
for cred in remote_creds:
  if sync_key is available:
    plaintext = decrypt(cred.ciphertext, sync_key)
    keychain.set(cred.id, plaintext)
```

---

## 6. Error handling

| Failure | Behaviour |
|---|---|
| No internet on push | Add to `PushQueue`; retry on next app open |
| No internet on pull | Skip pull; show last-synced timestamp; work offline |
| JWT expired | Auto-refresh using `refresh_token` before request |
| Refresh token expired | Clear keychain; transition to signed-out state |
| Supabase 5xx | Log error; set `syncStore.error`; show error icon in TitleBar |
| Sync key absent on pull | Credential rows skipped; user shown inline notice in Sync tab |
| Sync key incorrect (GCM tag mismatch) | Skip credential; show per-host warning on connect |
| Duplicate ID conflict | Server `updated_at` wins if newer; otherwise local kept and pushed |

---

## 7. Testing

### Rust (cargo test)

- `encrypt`: key generation, AES-256-GCM round-trip, wrong-key returns error, Base58 encode/decode.
- `pull`: merge algorithm — remote newer wins, local newer kept, tombstone deletes local, new remote row inserted.
- `push`: UPSERT constructs correct payload; failed push enqueues to `PushQueue`.
- `auth`: JWT expiry detection triggers refresh path (mock HTTP).

### Frontend (vitest)

- `syncStore`: status transitions (idle → syncing → synced, idle → error).
- `SyncStatus`: renders correct icon for each status.
- `SyncTab`: shows sign-in when no user; shows account + key section when signed in; shows key input when key missing.
- `SettingsModal`: Sync tab appears as third tab.
