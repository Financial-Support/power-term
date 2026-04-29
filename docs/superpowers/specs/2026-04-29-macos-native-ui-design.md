# macOS-Native UI Redesign — Design Spec

## Goal

Refactor power-term's UI from its current dark-slate web-app aesthetic to a borderless, immersive macOS-native design: frameless window, amber warm-charcoal palette, icon-rail navigation, persistent sidebar panel, and macOS-appropriate typography and spacing throughout.

## Architecture

The app shell is restructured from `TitleBar + Sidebar + Terminal grid` into four horizontal zones:

```
┌─────────────────────────────────────────────────────┐
│  traffic-row (22px)  — native drag, traffic lights  │
│  tabstrip (34px)     — session tabs + new tab btn   │
├────┬──────────┬────────────────────────────────────┤
│ 44 │  168px   │  terminal area (flex: 1)            │
│ px │ sidebar  │  pane-bar + xterm content           │
│ ir │  panel   │                                     │
│ a  │          │                                     │
│ i  │          │                                     │
│ l  │          │                                     │
└────┴──────────┴────────────────────────────────────┘
```

## Color Palette

```css
--bg:           #161412   /* warm charcoal — app chrome */
--bg-sidebar:   #131210   /* slightly darker — icon rail + tabstrip */
--bg-panel:     #181614   /* sidebar panel */
--bg-terminal:  #100e0c   /* terminal pane background */
--bg-elevated:  #221f1c   /* modals, popovers, tooltips */
--bg-hover:     rgba(255,240,220,0.06)
--bg-active:    rgba(245,158,11,0.12)

--fg:           rgba(255,240,220,0.88)   /* primary text */
--fg-muted:     rgba(255,240,220,0.45)   /* secondary text */
--fg-dim:       rgba(255,240,220,0.25)   /* tertiary / placeholders */

--border:       rgba(255,240,220,0.07)   /* subtle separators */
--border-med:   rgba(255,240,220,0.11)   /* modal borders */

--accent:       #f59e0b   /* amber — active tab underline, active rail icon bg */
--accent-text:  #fbbf24   /* amber text on dark bg */
--accent-dim:   rgba(245,158,11,0.18)   /* icon rail active bg */
--accent-ring:  rgba(245,158,11,0.35)   /* focus rings, active borders */

--online:       #22c55e   /* connected host dot */
--online-glow:  rgba(34,197,94,0.45)

--selection-bg: rgba(245,158,11,0.18)   /* terminal text selection */
```

Light theme keeps the same structure but maps to macOS light surface colors (white/gray sidebar, black text). The app currently defaults to dark; light theme support is a stretch goal and not in scope here.

## Typography

```css
font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

Monospace for terminal: `"SF Mono", "Menlo", "Consolas", monospace`

## Window Chrome

- **`decorations: false`** in `tauri.conf.json` — removes native title bar
- **Traffic-lights row** (22px): `-webkit-app-region: drag`, padding-left 14px, contains only the three macOS dot buttons (rendered as plain colored circles — actual window controls are still native, positioned by the OS)
- **Tab strip** (34px): also draggable, contains session tabs and + button
- All interactive elements inside drag zones must carry `-webkit-app-region: no-drag`

## Component Structure

### IconRail (new component — 44px wide)
- Three nav icons at top: Hosts, Snippets, Port Forwards
- SVG icons, 32×32px touch target, 7px border-radius
- Active icon: amber tinted bg + amber color
- Two pinned icons at bottom: Settings (⚙), Sync (↻)
- Clicking a nav icon switches the sidebar panel content

### SidebarPanel (refactored from Sidebar — 168px wide)
Three views, switched by IconRail:

**Hosts view** (default):
- 24px search/filter input at top
- "Connected" section header + list of online hosts
- "Saved" section header + list of offline hosts
- Each host row: 6px status dot + name + port badge (right-aligned, dim)
- Active host row: amber tinted background
- "Add Host" button at bottom

**Snippets view**:
- Search filter input
- Flat list of snippets with name
- "Add Snippet" button at bottom

**Forwards view**:
- Flat list of port forwards with name + status dot
- "Add Forward" button at bottom

### TitleBar (refactored — now only manages tab strip)
- Session tabs with: status dot + tab title + close (×) on hover
- Active tab: amber 2px underline, slightly lighter background
- Inactive tabs: dim text, no underline
- New tab (+) button at far left of strip after last tab
- Layout picker moved to pane-bar (inside terminal area)
- Sync status icon at right of tabstrip

### PaneBar (new component — 28px, inside terminal area)
- Left: active host name (amber) · session user@host · current path (dim)
- Right: layout picker button (shows active layout SVG) + split controls
- Replaces the old TitleBar layout picker position

### Modals
All modals updated with:
- `--bg-elevated` background
- `--border-med` border + `border-radius: 12px`
- `box-shadow: 0 24px 64px rgba(0,0,0,0.6)`
- Backdrop: `rgba(0,0,0,0.5)` blur(8px)
- No structural changes to form fields or logic

### Terminal Pane
- Background `--bg-terminal` (#100e0c)
- Active pane outline: 1.5px amber instead of green
- xterm.js theme updated to match warm charcoal palette

## Files Changed

| File | Action |
|------|--------|
| `src-tauri/tauri.conf.json` | Add `"decorations": false` |
| `src/styles.css` | Full rewrite with new variables and components |
| `src/App.tsx` | Add traffic-row, restructure body to use IconRail + SidebarPanel |
| `src/components/TitleBar.tsx` | Tab strip only, remove drag logic (moved to App) |
| `src/components/Sidebar.tsx` | Replace with SidebarPanel (3-view switcher) |
| `src/components/IconRail.tsx` | New component |
| `src/components/PaneBar.tsx` | New component (layout picker + pane info) |
| `src/components/SettingsModal.tsx` | Style update only |
| `src/components/HostFormModal.tsx` | Style update only |
| `src/components/SnippetFormModal.tsx` | Style update only |
| `src/components/ForwardFormModal.tsx` | Style update only |
| `src/components/ConfirmModal.tsx` | Style update only |
| `src/components/CommandPalette.tsx` | Style update only |
| `src/components/AuthPrompt.tsx` | Style update only |
| `src/components/HostFingerprintPrompt.tsx` | Style update only |

## What Does NOT Change

- All Tauri commands and state management (Zustand stores)
- xterm.js Terminal component internals
- SSH / SFTP logic
- Sync logic
- Keyboard shortcuts
- The layout grid system (solo/2col/2row/3col/2x2) — only layout picker UI moves
