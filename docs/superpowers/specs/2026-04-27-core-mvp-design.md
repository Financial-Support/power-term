# Power-Term — Core MVP Design

**Date:** 2026-04-27
**Status:** Approved (brainstorming)
**Scope:** Sub-project #1 of the Termius-clone roadmap

## 1. Purpose

Build a desktop terminal app (codename `power-term`) that will eventually replicate Termius Pro features (SSH, SFTP, host manager, snippets, port forwarding, sync). This document specifies the **Core MVP**: the application shell that proves the chosen stack works end-to-end. It must run a local shell inside an `xterm.js` view, support multiple tabs, persist user settings, and respond to standard hotkeys on macOS.

The MVP is the foundation every later sub-project builds on. It does not include any SSH or remote functionality.

## 2. Roadmap context

The Termius-clone is decomposed into sub-projects, each with its own spec → plan → implementation cycle:

1. **Core MVP** (this document) — Tauri shell, local PTY, tabs, settings
2. SSH + Host Manager — `russh`, host CRUD, SSH key management, encrypted credential storage
3. SFTP File Manager — dual-pane browser, drag-drop transfer
4. Snippets + History + Port Forwarding
5. Themes + Polish — theme engine, hotkeys, splits, tab grouping
6. Cloud Sync — backend service, sync hosts/keys/snippets across devices
7. Advanced protocols — Mosh, Telnet, Serial, agent forwarding

Sub-projects 2–7 are out of scope for this spec.

## 3. Stack

| Layer | Choice |
| --- | --- |
| App shell | Tauri 2.x |
| Frontend framework | React 18 + TypeScript |
| Bundler | Vite |
| Terminal renderer | `xterm.js` + addons: `fit`, `web-links`, `search`, `unicode11`, `webgl` |
| State | Zustand |
| Backend language | Rust (stable) |
| PTY | `portable-pty` crate |
| Settings serialization | `serde` + `toml` |
| Test runners | `cargo test` (Rust), `vitest` + `@testing-library/react` (frontend) |

The Tauri + Rust + React choice was made over Electron to get a small bundle, low RAM use, and a Rust core that will host `russh` cleanly in sub-project #2.

## 4. Target platform

- **macOS** (Apple Silicon and Intel) only.
- Linux and Windows are explicit non-goals for MVP. The PTY abstraction (`portable-pty`) keeps a Linux port cheap; Windows ConPTY support is deferred.

## 5. In-scope features

- One main window with a tab bar.
- Each tab owns one local PTY running the user's shell.
- Default shell resolution order: `settings.shell` → `$SHELL` env var → `/bin/zsh`.
- Tab UX: new (`Cmd+T`), close (`Cmd+W`), switch by index (`Cmd+1`..`Cmd+9`), prev/next (`Cmd+Shift+[` / `Cmd+Shift+]`), rename via double-click on tab label.
- xterm.js with the addons listed in §3.
- Closing the last tab quits the app.
- Resizing the tab area syncs PTY winsize.
- `Cmd+C` copies when there is a non-empty selection; otherwise it falls through to the terminal as SIGINT (default xterm.js behaviour). `Cmd+V` pastes.
- Two built-in themes: `light`, `dark`. `auto` follows the macOS system appearance and reacts at runtime to system appearance changes (`prefers-color-scheme` media-query listener in the WebView).
- Native macOS title bar with traffic lights at the top-left; tab strip on the right of the same bar.
- Settings file at `~/Library/Application Support/power-term/config.toml`.

## 6. Out-of-scope (deferred)

- SSH, SFTP, host manager, snippets, history search, port forwarding.
- Splits, multi-window, custom theme engine, plugins.
- Persistence of open tabs across app restarts.
- Cloud sync.
- Linux/Windows builds, code signing, notarization, auto-update.

## 7. Architecture

```
┌─────────────────────────────────────────┐
│ Frontend (React + xterm.js, WebView)    │
│  ┌─────────┐  ┌──────────────────────┐  │
│  │ TabBar  │  │ Terminal (xterm.js)  │  │
│  └─────────┘  └──────────────────────┘  │
│        │               │                │
│        │ invoke()      │ invoke()/event │
│        ▼               ▼                │
├─────────────────────────────────────────┤
│ Tauri IPC (commands + events)           │
├─────────────────────────────────────────┤
│ Backend (Rust)                          │
│  ┌──────────────┐ ┌──────────────────┐  │
│  │ PtyManager   │ │ SettingsStore    │  │
│  │ (portable-pty)│ │ (serde + toml)  │  │
│  └──────────────┘ └──────────────────┘  │
└─────────────────────────────────────────┘
```

### 7.1 Rust backend (`src-tauri/src/`)

- `pty/manager.rs` — `PtyManager` owns a `HashMap<PtyId, PtySession>` behind a `Mutex`. Public API:
  - `spawn(shell: Option<String>, cwd: Option<PathBuf>, cols: u16, rows: u16) -> Result<PtyId>`
  - `write(id: &PtyId, data: &[u8]) -> Result<()>`
  - `resize(id: &PtyId, cols: u16, rows: u16) -> Result<()>`
  - `kill(id: &PtyId) -> Result<()>`
  Each `spawn` starts a reader thread that pulls from the PTY master and emits Tauri events.
- `pty/session.rs` — wraps `portable_pty::PtyPair`, the spawned `Child`, and a writer handle. Holds the reader-thread join handle.
- `settings/mod.rs` — `Settings` struct with `serde` derives, plus `load() -> Settings` and `save(&self) -> Result<()>`. `load` falls back to defaults if the file is missing or invalid; on a parse error it copies the bad file to `config.toml.bak` and writes defaults.
- `commands.rs` — Tauri command handlers. Thin: validation + delegation to `PtyManager` / `SettingsStore`. Errors are converted to `String` for the frontend.
- `main.rs` — Tauri builder: registers `PtyManager` and `SettingsStore` via `.manage(...)`, registers the command handlers in §7.3, configures the macOS-style title bar.

### 7.2 React frontend (`src/`)

- `App.tsx` — root; provides theme, mounts `TitleBar`, `TabBar`, and the active `Terminal`.
- `components/TitleBar.tsx` — custom title bar that hosts the tab strip.
- `components/TabBar.tsx` — tab list with new/close/rename affordances.
- `components/Terminal.tsx` — xterm.js wrapper. On mount: call `pty_spawn`, attach addons, subscribe to `pty://output/<id>` and `pty://exit/<id>`, wire `term.onData` → `pty_write` and `term.onResize` → `pty_resize`. On unmount: `pty_kill` and dispose.
- `state/sessionStore.ts` — Zustand store: `tabs: Tab[]`, `activeTabId: string | null`, plus actions `addTab`, `closeTab`, `setActive`, `rename`. A `Tab` holds `{ id, ptyId, title, exitCode? }`.
- `state/settingsStore.ts` — loads via `invoke('settings_get')` at startup; updates via `invoke('settings_update', patch)`.
- `hooks/useHotkeys.ts` — registers the keyboard map in §5 against the active session store.
- `lib/ipc.ts` — typed wrappers around `invoke` and `listen` so the rest of the frontend never imports `@tauri-apps/api` directly.

### 7.3 Tauri command surface

```rust
#[tauri::command] fn pty_spawn(shell: Option<String>, cwd: Option<String>, cols: u16, rows: u16) -> Result<String, String>;
#[tauri::command] fn pty_write(pty_id: String, data: String) -> Result<(), String>;
#[tauri::command] fn pty_resize(pty_id: String, cols: u16, rows: u16) -> Result<(), String>;
#[tauri::command] fn pty_kill(pty_id: String) -> Result<(), String>;
#[tauri::command] fn settings_get() -> Result<Settings, String>;
#[tauri::command] fn settings_update(patch: SettingsPatch) -> Result<Settings, String>;
```

Events emitted by the backend:

- `pty://output/<id>` — payload is a base64-encoded byte string. Base64 keeps the JSON wire format clean and safe for non-UTF8 byte sequences (escape codes, partial UTF-8 boundaries).
- `pty://exit/<id>` — payload is `{ code: number | null, signal: string | null }`. `signal` is reserved (always `null` today; `portable-pty 0.8` does not surface signal info from `child.wait()` on macOS).

`pty_id` is a UUID v4 string generated in Rust on `spawn`.

## 8. Data flow — keystroke to render

1. User presses a key. `xterm.js` raises `onData(data)` with the resulting bytes (already encoded for the terminal).
2. The frontend calls `invoke('pty_write', { ptyId, data })`.
3. Rust looks up the session and writes the bytes to the PTY master writer.
4. The shell processes the bytes and writes to its stdout.
5. The reader thread for that session reads up to 64 KB, base64-encodes it, and emits `pty://output/<id>`.
6. The frontend listener base64-decodes the payload to a `Uint8Array` and calls `term.write(bytes)` (xterm.js accepts `Uint8Array` and handles UTF-8 decoding internally, including across chunk boundaries).

Resize follows the same pattern via `pty_resize` and `PtySession::resize`. Exit is detected by the reader thread (read returns 0 / EOF), which then waits on the child and emits `pty://exit/<id>`.

## 9. Settings

File: `~/Library/Application Support/power-term/config.toml` (resolved via `dirs::config_dir()`).

Schema:

```toml
shell = "/bin/zsh"        # null/missing = use $SHELL, then /bin/zsh
font_family = "JetBrains Mono"
font_size = 14
theme = "auto"            # "light" | "dark" | "auto"
cursor_blink = true
scrollback_lines = 10000
```

- Missing file: defaults are written on first save.
- Parse error: existing file copied to `config.toml.bak`, defaults applied, warning logged.
- Updates are partial (`SettingsPatch`); the backend merges and rewrites the file atomically (write to `config.toml.tmp`, then rename).
- Live reload of file edits made outside the app is **not** in MVP scope.

## 10. Error handling

| Failure | Behaviour |
| --- | --- |
| Shell does not exist on `pty_spawn` | Command returns `Err`. Frontend shows a toast and does not add the tab. |
| PTY exits unexpectedly | Terminal shows an inline "[process exited (code N)]" message in yellow ANSI. **Deferred to a follow-up:** banner UI with a "Restart" button that re-spawns with the same shell + cwd. |
| Settings file corrupt | Backed up to `.bak`, defaults applied, warning logged via `tracing`. |
| IPC output queue saturated | Reader thread coalesces reads into ≤ 64 KB chunks; emit failures break the forwarder cleanly so a torn-down webview cannot back up the queue. **Deferred to sub-project #2 prep:** the bounded "drop oldest after 1000 pending chunks" policy noted in the original draft is not yet implemented. Tauri's emit currently provides the natural backpressure for MVP local-PTY traffic. |
| `pty_write` / `pty_resize` for unknown id | Command returns `Err("unknown pty id")`. Frontend logs and ignores. |

## 11. Testing

- **Rust unit tests** (`cargo test`):
  - `PtyManager::spawn` then write `printf hello\n` and assert output channel receives `hello`.
  - `PtyManager::resize` updates winsize without panic.
  - `Settings::load` round-trip: write defaults → load → equal.
  - `Settings::load` corrupt file → backup created, defaults returned.
- **Frontend unit tests** (`vitest`):
  - `sessionStore` actions: `addTab`, `closeTab` (active reassignment), `setActive`, `rename`.
  - `TabBar` interactions: click switches active, double-click enters rename, Enter commits.
- **Manual smoke checklist** (recorded in the implementation plan):
  - App launches; one tab opens to default shell.
  - `ls`, `vim`, `htop` render correctly; resize is smooth.
  - Multiple tabs; hotkeys work; close last tab quits the app.
  - Light/dark/auto themes apply.
  - Edit `config.toml`, restart app, settings take effect.

E2E tests (Tauri WebDriver) are explicitly deferred.

## 12. File layout

```
power-term/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── commands.rs
│       ├── pty/
│       │   ├── mod.rs
│       │   ├── manager.rs
│       │   └── session.rs
│       └── settings/
│           └── mod.rs
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── TitleBar.tsx
│   │   ├── TabBar.tsx
│   │   └── Terminal.tsx
│   ├── state/
│   │   ├── sessionStore.ts
│   │   └── settingsStore.ts
│   ├── hooks/
│   │   └── useHotkeys.ts
│   └── lib/
│       └── ipc.ts
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── docs/superpowers/specs/
```

## 13. Risks & mitigations

- **Event flooding from chatty programs (`yes`, `cat /dev/urandom`)** — Reader thread coalesces into ≤ 64 KB chunks and emits at most ~60 Hz per session. The drop-oldest backpressure in §10 prevents unbounded queuing.
- **Webview repaint cost on dense output** — Use xterm's `webgl` addon by default; fall back to canvas if WebGL is unavailable.
- **PTY thread leaks** — Each `PtySession` owns its reader thread and joins it on drop / kill.
- **Code signing / notarization** — Out of scope for MVP; dev builds only. Will be addressed in a later "polish" sub-project.

## 14. Open questions

None. All decisions for the MVP scope are locked above.
