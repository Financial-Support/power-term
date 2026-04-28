# Power-Term Polish #5 — Settings UI, Preset Themes, Split Panes

**Date:** 2026-04-28
**Status:** Approved (brainstorming)
**Scope:** Sub-project #5 of the Termius-clone roadmap

---

## 1. Purpose

Three independent but complementary improvements to make power-term feel production-quality:

1. **Settings UI** — a Cmd+, modal so users can change font, theme, and terminal options without editing `config.toml`.
2. **Preset themes** — 8 named terminal color palettes shipped in TypeScript, selectable from the Settings modal.
3. **Split panes** — 5 fixed layout presets (Solo, 2-Col, 2-Row, 3-Col, 2×2) switchable from a TitleBar picker.

No new Rust commands are introduced. The only backend change is persisting `terminal_theme` in `config.toml`.

---

## 2. Roadmap context

Builds on sub-projects #1–#4B (Core MVP, SSH, SFTP, Snippets, Port Forwarding). Sub-project #6 (Cloud Sync) and #7 (Advanced protocols) remain out of scope.

---

## 3. In-scope features

### 3.1 Settings Modal

- **Trigger:** Cmd+, opens the modal. Same guard as Cmd+K — suppressed when any other modal is open.
- **Structure:** Tabbed modal with two tabs:
  - **Appearance** — Theme (dropdown), Font Family (text input), Font Size (number), Cursor Blink (checkbox)
  - **Terminal** — Scrollback Lines (number)
- **Behaviour:** Fully controlled form — edits are local state until **Save** is clicked. Save calls `settingsStore.update(patch)` with only the changed fields. Cancel and Esc discard changes and close.
- **Validation:** Font Size must be 6–72. Scrollback Lines must be 100–1,000,000. Font Family accepts any non-empty string (xterm.js falls back gracefully if the font is missing).

### 3.2 Preset Themes

- `src/themes.ts` exports:
  ```ts
  export const PRESET_THEMES: Record<string, ITheme>
  export const THEME_NAMES: string[]   // sorted, human-readable
  ```
- 9 entries: `"default"` (empty object — lets xterm.js inherit CSS light/dark), plus 8 named presets:
  - Dracula, Nord, One Dark, Tokyo Night, Gruvbox Dark, Solarized Dark, Monokai, Catppuccin Mocha
- Each entry is a complete `xterm.js` `ITheme` object (background, foreground, cursor, cursorAccent, selectionBackground, plus all 16 ANSI color slots: black, red, green, yellow, blue, magenta, cyan, white and their bright variants).
- `Terminal.tsx` reads `settings.terminal_theme`, looks up in `PRESET_THEMES`, passes as the `theme` option to xterm.js on mount. When `settings.terminal_theme` changes, the existing xterm.js instance is updated via `terminal.options.theme = ...` (no remount needed).
- Rust `Settings` struct gains `terminal_theme: String` (default `"default"`). `SettingsPatch` gains `terminal_theme: Option<String>`. The field is persisted in `config.toml` like all other settings.

### 3.3 Split Panes

#### Layout kinds

| Kind | Slots | CSS grid |
|---|---|---|
| `solo` | 1 | `1fr` |
| `2col` | 2 | `1fr 1fr` |
| `2row` | 2 | row: `1fr / 1fr` |
| `3col` | 3 | `1fr 1fr 1fr` |
| `2x2` | 4 | `1fr 1fr / 1fr 1fr` |

#### State shape (additions to `sessionStore`)

```ts
layoutKind: LayoutKind          // default 'solo'
layoutSlots: (string | null)[]  // tabId per slot; length = slotCount(layoutKind)
activePaneIndex: number         // focused slot index; default 0
```

`activeTabId` becomes **derived**: `layoutSlots[activePaneIndex] ?? null`. All existing consumers that read `activeTabId` continue to work unchanged.

#### Actions

- `setLayout(kind: LayoutKind)` — resizes `layoutSlots` to the new slot count. Existing tab assignments are preserved for slots that still exist. New empty slots are filled by spawning a new local PTY tab (same logic as the initial `newLocalTab` call in `App.tsx`). `activePaneIndex` is clamped to the new slot count.
- `setActivePane(index: number)` — sets `activePaneIndex`.
- `assignSlot(index: number, tabId: string)` — assigns a tab to a specific slot (used when the user clicks a tab in the tab bar while a non-solo layout is active: it assigns the clicked tab to the currently active pane).

#### Rendering

`App.tsx` replaces the current `.terminals` `<main>` with a CSS-grid container keyed on `layoutKind`. Each slot renders a `<Terminal>` component unconditionally (all panes are always mounted; `visible` prop is removed — `display: none` is replaced by a focus-ring border on the active pane). Each slot has an `onClick` handler that calls `setActivePane(i)`.

The active pane gets a 1px accent-color border (`var(--accent)`) to indicate focus.

#### Tab bar interaction with layouts

In non-solo layouts, clicking a tab in the tab bar assigns it to the currently focused pane (calls `assignSlot(activePaneIndex, tabId)`). Closing a tab via Cmd+W or the × button removes it; its slot becomes `null` (renders an empty dark pane with a "+" prompt to open a new tab).

#### Layout picker

A new icon button in `TitleBar` (right side, before the existing sidebar toggle) opens a small popover with 5 layout icons (matching the previews). Clicking a layout icon calls `setLayout(kind)` and closes the popover. The current layout's icon is highlighted.

#### Keyboard navigation

- `Cmd+Opt+←` / `Cmd+Opt+→` — move focus to the previous/next pane (wraps).
- `Cmd+Opt+↑` / `Cmd+Opt+↓` — move focus up/down (meaningful in 2-row and 2×2 layouts; wraps).

---

## 4. Out-of-scope

- Custom theme creation or import.
- Resizable pane dividers (fixed equal splits only).
- Per-pane working directory or shell override.
- Persistent layout across app restarts (deferred to #6 cloud sync).
- Linux/Windows builds, code signing, notarization.

---

## 5. Architecture

### 5.1 File layout

```
src/
  themes.ts                         ← NEW: 8 preset ITheme definitions
  components/
    SettingsModal.tsx                ← NEW: tabbed settings modal
    SettingsModal.test.tsx           ← NEW: tests
    TitleBar.tsx                     ← MODIFY: add layout picker button + popover
  state/
    sessionStore.ts                  ← MODIFY: add layout fields + actions
    sessionStore.test.ts             ← MODIFY: add layout action tests
  App.tsx                            ← MODIFY: layout grid, Cmd+, handler, layout actions
  styles.css                         ← MODIFY: layout grid classes, pane focus ring

src-tauri/src/settings/mod.rs        ← MODIFY: add terminal_theme field
```

### 5.2 Data flow — theme change

1. User opens Settings (Cmd+,), picks "Dracula" from the Theme dropdown, clicks Save.
2. `SettingsModal` calls `settingsStore.update({ terminal_theme: 'dracula' })`.
3. `settingsStore` calls `invoke('settings_update', { patch })` → Rust writes to `config.toml`.
4. Zustand store updates; `Terminal.tsx` re-renders, reads new `settings.terminal_theme`, looks up `PRESET_THEMES['dracula']`, sets `terminal.options.theme`.

### 5.3 Data flow — layout switch

1. User clicks the "2-Col" icon in the TitleBar popover.
2. `setLayout('2col')` is called: `layoutSlots` becomes `[currentTabId, null]`. The null slot triggers `newLocalTab()` which spawns a PTY and fills the slot.
3. `App.tsx` re-renders with a `grid-template-columns: 1fr 1fr` container. Both `<Terminal>` components mount (or were already mounted) and are fully visible.
4. User clicks the right pane — `setActivePane(1)` runs, right pane gets the accent border, tab bar operations now target slot 1.

---

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Unknown `terminal_theme` value in config | `PRESET_THEMES[name]` returns `undefined`; fall back to `"default"` silently. |
| `newLocalTab()` fails during layout switch | Slot stays `null`; empty pane shows error hint. Layout switch still completes. |
| Font Family not installed | xterm.js falls back to its default monospace font silently. |
| Settings save fails (IPC error) | `settingsStore.error` is set; modal shows inline error, stays open. |

---

## 7. Testing

### Rust (cargo test)
- `settings::tests`: `terminal_theme` round-trips through `config.toml`; `SettingsPatch` with `terminal_theme: None` leaves existing value unchanged.

### Frontend (vitest + @testing-library/react)
- `themes.ts`: all 9 entries in `PRESET_THEMES` have the required `ITheme` fields (background, foreground, all 16 ANSI colors).
- `SettingsModal`: renders with current settings pre-filled; Save calls `settingsStore.update` with only changed fields; Cancel discards; Esc closes; Save disabled when Font Size out of range.
- `sessionStore`: `setLayout` resizes slots correctly for each kind; `setActivePane` clamps to valid range; `assignSlot` updates correct index; `activeTabId` is derived correctly from `layoutSlots[activePaneIndex]`.
- `TitleBar` (layout picker): clicking a layout icon calls `setLayout`; active layout icon is highlighted.
- `App.tsx` integration: Cmd+, opens settings modal; Cmd+, is suppressed when forward form is open.

---

## 8. Open questions

None. All decisions are locked above.
