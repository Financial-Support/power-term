# macOS-Native UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor power-term's UI to a borderless warm-charcoal macOS-native design: amber accent, persistent icon-rail + sidebar panel, macOS-appropriate typography and spacing throughout.

**Architecture:** The window already uses `titleBarStyle: "Overlay"` + `hiddenTitle: true` (native traffic lights overlaid on custom chrome) — no Tauri config change needed. The new shell is: `titlebar` (tab strip, 34px) → `body` (icon-rail 44px + sidebar-panel 168px + terminals flex:1). The sidebar is always visible; clicking an icon in the rail switches between Hosts/Snippets/Forwards views. All state management, IPC, and xterm.js internals are untouched.

**Tech Stack:** React 18, TypeScript, plain CSS (single `styles.css`), Tauri 2.x (macOS `titleBarStyle: "Overlay"`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/styles.css` | Rewrite | All visual styles — palette variables, layout, components |
| `src/components/IconRail.tsx` | Create | 44px nav rail: Hosts / Snippets / Forwards + Settings / Sync |
| `src/components/SidebarPanel.tsx` | Create | 168px persistent panel, section-switched view |
| `src/components/Sidebar.tsx` | Delete | Replaced by SidebarPanel |
| `src/components/TitleBar.tsx` | Modify | Remove `sidebarOpen` prop; simplify drag-left width |
| `src/App.tsx` | Modify | Add `sidebarSection` state; wire IconRail + SidebarPanel; remove sidebar toggle |
| `src/hooks/useSidebarToggle.ts` | Delete | No longer needed |

---

### Task 1: New CSS palette and global foundations

**Files:**
- Modify: `src/styles.css` (full rewrite — lines 1–10, the `:root` / theme vars block)

- [ ] **Step 1: Replace the top of styles.css with new variables**

Replace everything from line 1 up to and including the `.app { background: var(--bg)... }` line with:

```css
/* ─── Reset & root ─────────────────────────────────────────────────────── */
:root {
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
html, body, #root { height: 100%; margin: 0; }

/* ─── Warm-charcoal palette (single theme — dark) ───────────────────────
   All components use these variables; avoid hard-coding colours.          */
.app {
  /* surfaces */
  --bg:            #161412;
  --bg-sidebar:    #131210;
  --bg-panel:      #181614;
  --bg-terminal:   #100e0c;
  --bg-elevated:   #221f1c;
  --bg-hover:      rgba(255,240,220,0.06);
  --bg-active:     rgba(245,158,11,0.12);

  /* text */
  --fg:            rgba(255,240,220,0.88);
  --fg-muted:      rgba(255,240,220,0.45);
  --fg-dim:        rgba(255,240,220,0.22);

  /* borders */
  --border:        rgba(255,240,220,0.07);
  --border-med:    rgba(255,240,220,0.12);

  /* accent — amber */
  --accent:        #f59e0b;
  --accent-text:   #fbbf24;
  --accent-dim:    rgba(245,158,11,0.18);
  --accent-ring:   rgba(245,158,11,0.35);

  /* status */
  --online:        #22c55e;
  --online-glow:   rgba(34,197,94,0.45);
  --danger:        #ef4444;

  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}
```

- [ ] **Step 2: Verify build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: warm-charcoal CSS variables"
```

---

### Task 2: Titlebar (tab strip) styles

**Files:**
- Modify: `src/styles.css` — `.titlebar`, `.tabbar`, `.tab`, `.tab-close`, `.tab-new`

- [ ] **Step 1: Replace the titlebar/tab block in styles.css**

Find and replace the block from `.titlebar {` to `.tab-new { ... }` (current lines 9–64) with:

```css
/* ─── Titlebar / tab strip ──────────────────────────────────────────────
   titleBarStyle: "Overlay" overlays native traffic lights at top-left.
   The 78px left spacer keeps tabs clear of the traffic lights.           */
.titlebar {
  display: flex;
  align-items: stretch;
  height: 34px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  user-select: none;
  flex-shrink: 0;
}
.titlebar-drag-left {
  width: 78px;
  flex: 0 0 78px;
}
.titlebar-drag-right { flex: 0 0 8px; }

.tabbar {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  flex: 1;
  min-width: 0;
  padding: 4px 0 0 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.tabbar::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  padding: 0 0 0 10px;
  height: 28px;
  background: transparent;
  border-radius: 6px 6px 0 0;
  cursor: default;
  min-width: 100px;
  max-width: 200px;
  flex-shrink: 0;
  position: relative;
  color: var(--fg-muted);
  font-size: 12px;
  transition: background 0.1s, color 0.1s;
}
.tab:hover { background: var(--bg-hover); color: var(--fg); }
.tab.active {
  background: rgba(255,240,220,0.05);
  color: var(--fg);
}
.tab.active::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 2px 2px 0 0;
}
.tab-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--online);
  flex-shrink: 0;
  margin-right: 6px;
}
.tab-dot.offline { background: var(--fg-dim); }
.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  padding-right: 4px;
}
.tab input {
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--fg);
  width: 100%;
}
.tab-close {
  background: transparent;
  border: 0;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0 8px;
  align-self: stretch;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.1s;
}
.tab:hover .tab-close,
.tab.active .tab-close { opacity: 0.5; }
.tab-close:hover { opacity: 1 !important; }
.tab-new {
  background: transparent;
  border: 0;
  color: var(--fg-dim);
  cursor: pointer;
  padding: 0 10px;
  font-size: 18px;
  line-height: 1;
  align-self: center;
  transition: color 0.1s;
}
.tab-new:hover { color: var(--fg); }
```

- [ ] **Step 2: Build and verify**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: amber-accent tab strip"
```

---

### Task 3: Create IconRail component

**Files:**
- Create: `src/components/IconRail.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/IconRail.tsx
export type SidebarSection = 'hosts' | 'snippets' | 'forwards';

interface Props {
  activeSection: SidebarSection;
  onSection: (s: SidebarSection) => void;
  onSettings: () => void;
  onSync: () => void;
}

export function IconRail({ activeSection, onSection, onSettings, onSync }: Props) {
  return (
    <div className="icon-rail" aria-label="navigation rail">
      <button
        type="button"
        className={`rail-icon${activeSection === 'hosts' ? ' active' : ''}`}
        aria-label="Hosts"
        title="Hosts"
        onClick={() => onSection('hosts')}
      >
        <IconHosts />
      </button>
      <button
        type="button"
        className={`rail-icon${activeSection === 'snippets' ? ' active' : ''}`}
        aria-label="Snippets"
        title="Snippets"
        onClick={() => onSection('snippets')}
      >
        <IconSnippets />
      </button>
      <button
        type="button"
        className={`rail-icon${activeSection === 'forwards' ? ' active' : ''}`}
        aria-label="Port Forwards"
        title="Port Forwards"
        onClick={() => onSection('forwards')}
      >
        <IconForwards />
      </button>

      <div className="rail-spacer" />

      <button
        type="button"
        className="rail-icon rail-icon-bottom"
        aria-label="Sync"
        title="Sync"
        onClick={onSync}
      >
        <IconSync />
      </button>
      <button
        type="button"
        className="rail-icon rail-icon-bottom"
        aria-label="Settings"
        title="Settings (⌘,)"
        onClick={onSettings}
      >
        <IconSettings />
      </button>
    </div>
  );
}

function IconHosts() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="8.5" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="12.5" cy="4.25" r="0.85" fill="currentColor" />
      <circle cx="12.5" cy="10.75" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconSnippets() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 4h10M3 7.5h7M3 11h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconForwards() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 8h12M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7.5 1v1.4M7.5 12.6V14M1 7.5h1.4M12.6 7.5H14M3.05 3.05l1 1M10.95 10.95l1 1M10.95 3.05l-1 1M3.05 10.95l1-1"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
      />
    </svg>
  );
}

function IconSync() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M12.5 7.5A5 5 0 0 1 3 10M2.5 7.5A5 5 0 0 1 12 5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 2.5l1 2.5 2.5-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12.5l-1-2.5-2.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 2: Add IconRail styles to styles.css**

Append after the tab styles block:

```css
/* ─── Icon rail ─────────────────────────────────────────────────────────── */
.icon-rail {
  width: 44px;
  flex: 0 0 44px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  user-select: none;
}
.rail-icon {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.rail-icon:hover { background: var(--bg-hover); color: var(--fg); }
.rail-icon.active {
  background: var(--accent-dim);
  color: var(--accent-text);
}
.rail-spacer { flex: 1; }
.rail-icon-bottom { margin-top: 0; }
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add src/components/IconRail.tsx src/styles.css
git commit -m "feat: IconRail component with SVG nav icons"
```

---

### Task 4: Create SidebarPanel (replaces Sidebar)

**Files:**
- Create: `src/components/SidebarPanel.tsx`

- [ ] **Step 1: Create the file**

SidebarPanel is Sidebar.tsx refactored: same hosts logic (groups, drag-drop, rename) but wrapped in a section switcher. Snippets and forwards are passed as `ReactNode` slots and shown when their section is active.

```tsx
// src/components/SidebarPanel.tsx
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host, HostInput } from '../types';
import type { SidebarSection } from './IconRail';

interface Props {
  section: SidebarSection;
  onConnect: (host: Host) => void;
  onOpenSftp: (host: Host) => void;
  onAddHost: () => void;
  onEditHost: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  snippetsSlot: ReactNode;
  forwardsSlot: ReactNode;
}

interface Group {
  name: string;
  rawKey: string | null;
  hosts: Host[];
}

const UNGROUPED = 'Ungrouped';
const HOST_DRAG_MIME = 'application/x-power-term-host-id';

export function SidebarPanel({
  section,
  onConnect, onOpenSftp, onAddHost, onEditHost, onDeleteHost,
  snippetsSlot, forwardsSlot,
}: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const error = useHostStore((s) => s.error);
  const updateHost = useHostStore((s) => s.update);

  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingGroup, setRenamingGroup] = useState<Group | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingHostId, setDraggingHostId] = useState<string | null>(null);

  const filteredHosts = useMemo(
    () => filter.trim()
      ? hosts.filter((h) => h.name.toLowerCase().includes(filter.toLowerCase()) ||
          h.hostname.toLowerCase().includes(filter.toLowerCase()))
      : hosts,
    [hosts, filter],
  );

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const h of filteredHosts) {
      const key = h.group_name ?? UNGROUPED;
      if (!map.has(key)) map.set(key, { name: key, rawKey: h.group_name, hosts: [] });
      map.get(key)!.hosts.push(h);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.rawKey === null) return 1;
      if (b.rawKey === null) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredHosts]);

  const toggle = (name: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const startRenameGroup = (g: Group) => {
    setRenamingGroup(g);
    setRenameDraft(g.rawKey ?? '');
  };

  const commitRenameGroup = async () => {
    const target = renamingGroup;
    const next = renameDraft.trim();
    setRenamingGroup(null);
    if (!target || !next) return;
    if (target.rawKey !== null && next === target.rawKey) return;
    if (target.rawKey === null && next === UNGROUPED) return;
    const targets = hosts.filter((h) => h.group_name === target.rawKey);
    for (const h of targets) {
      await updateHost(h.id, hostToInput(h, { group_name: next }));
    }
  };

  const handleDragStart = (e: React.DragEvent, host: Host) => {
    e.dataTransfer.setData(HOST_DRAG_MIME, host.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingHostId(host.id);
  };

  const handleDragEnd = () => { setDraggingHostId(null); setDragOverGroup(null); };

  const handleGroupDragOver = (e: React.DragEvent, g: Group) => {
    if (!e.dataTransfer.types.includes(HOST_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGroup !== g.name) setDragOverGroup(g.name);
  };

  const handleGroupDrop = async (e: React.DragEvent, g: Group) => {
    e.preventDefault();
    setDragOverGroup(null);
    setDraggingHostId(null);
    const id = e.dataTransfer.getData(HOST_DRAG_MIME);
    if (!id) return;
    const host = hosts.find((h) => h.id === id);
    if (!host) return;
    if ((host.group_name ?? null) === (g.rawKey ?? null)) return;
    await updateHost(id, hostToInput(host, { group_name: g.rawKey }));
  };

  return (
    <aside className="sidebar-panel" aria-label="sidebar panel">
      {/* Hosts section */}
      {section === 'hosts' && (
        <div className="sp-section">
          <div className="sp-search-row">
            <input
              className="sp-search"
              type="text"
              placeholder="Filter hosts…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="filter hosts"
            />
          </div>
          {error && <p className="sp-error">{error}</p>}
          <div className="sp-list">
            {hosts.length === 0 && (
              <p className="sp-empty">No saved hosts.</p>
            )}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.name);
              const isDropActive = dragOverGroup === g.name;
              const isRenaming = renamingGroup?.rawKey === g.rawKey;
              const showGroupHeader = groups.length > 1 || g.rawKey !== null;
              return (
                <div
                  key={g.name}
                  className={`sp-group${isDropActive ? ' drop-active' : ''}`}
                  onDragOver={(e) => handleGroupDragOver(e, g)}
                  onDragLeave={() => { if (dragOverGroup === g.name) setDragOverGroup(null); }}
                  onDrop={(e) => void handleGroupDrop(e, g)}
                >
                  {showGroupHeader && (
                    <div className="sp-group-header">
                      <button
                        type="button"
                        className="sp-group-toggle"
                        onClick={() => toggle(g.name)}
                        onDoubleClick={() => startRenameGroup(g)}
                      >
                        <span className="sp-caret">{isCollapsed ? '▸' : '▾'}</span>
                        {isRenaming ? (
                          <input
                            autoFocus
                            className="sp-group-rename-input"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder={g.rawKey === null ? 'Group name' : ''}
                            onBlur={() => void commitRenameGroup()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitRenameGroup(); }
                              if (e.key === 'Escape') { e.preventDefault(); setRenamingGroup(null); }
                            }}
                          />
                        ) : (
                          <span className="sp-group-name">{g.name}</span>
                        )}
                      </button>
                      {!isRenaming && (
                        <button
                          type="button"
                          className="sp-group-rename-btn"
                          aria-label={`rename group ${g.name}`}
                          onClick={() => startRenameGroup(g)}
                        >✎</button>
                      )}
                    </div>
                  )}
                  {!isCollapsed && (
                    <ul className="sp-host-list">
                      {g.hosts.map((host) => (
                        <li
                          key={host.id}
                          className={`sp-host${draggingHostId === host.id ? ' dragging' : ''}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, host)}
                          onDragEnd={handleDragEnd}
                        >
                          <button
                            type="button"
                            className="sp-host-name"
                            onClick={() => onConnect(host)}
                          >
                            <span className="sp-host-dot" />
                            {host.name}
                          </button>
                          <span className="sp-host-port">{host.port !== 22 ? host.port : ''}</span>
                          <span className="sp-host-actions">
                            <button type="button" aria-label={`sftp ${host.name}`} onClick={() => onOpenSftp(host)}>📂</button>
                            <button type="button" aria-label={`edit ${host.name}`} onClick={() => onEditHost(host)}>✎</button>
                            <button type="button" aria-label={`delete ${host.name}`} onClick={() => onDeleteHost(host)}>×</button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <div className="sp-footer">
            <button type="button" className="sp-add-btn" onClick={onAddHost}>
              <span>+</span> Add Host
            </button>
          </div>
        </div>
      )}

      {/* Snippets section */}
      {section === 'snippets' && (
        <div className="sp-section sp-section-slot">
          {snippetsSlot}
        </div>
      )}

      {/* Forwards section */}
      {section === 'forwards' && (
        <div className="sp-section sp-section-slot">
          {forwardsSlot}
        </div>
      )}
    </aside>
  );
}

function hostToInput(host: Host, override: Partial<HostInput>): HostInput {
  return {
    name: host.name, hostname: host.hostname, port: host.port,
    username: host.username, group_name: host.group_name, tags: host.tags,
    auth_method: host.auth_method, key_path: host.key_path, notes: host.notes,
    ...override,
  };
}
```

- [ ] **Step 2: Add SidebarPanel styles to styles.css**

Append after the icon-rail styles:

```css
/* ─── Sidebar panel ─────────────────────────────────────────────────────── */
.sidebar-panel {
  width: 168px;
  flex: 0 0 168px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}
.sp-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
.sp-section-slot { padding: 0; }

.sp-search-row {
  padding: 8px 8px 4px;
}
.sp-search {
  width: 100%;
  box-sizing: border-box;
  height: 26px;
  padding: 0 8px;
  background: rgba(255,240,220,0.06);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  font: inherit;
  font-size: 11px;
  outline: none;
  transition: border-color 0.1s;
}
.sp-search::placeholder { color: var(--fg-dim); }
.sp-search:focus { border-color: var(--accent-ring); }

.sp-error { color: var(--danger); padding: 0 10px; font-size: 11px; }
.sp-empty { padding: 10px 12px; font-size: 11px; color: var(--fg-dim); }

.sp-list { flex: 1; overflow-y: auto; padding: 0 4px; scrollbar-width: thin; }
.sp-list::-webkit-scrollbar { width: 4px; }
.sp-list::-webkit-scrollbar-thumb { background: rgba(255,240,220,0.12); border-radius: 2px; }
.sp-list::-webkit-scrollbar-track { background: transparent; }

.sp-group { margin-bottom: 2px; }
.sp-group.drop-active {
  background: rgba(245,158,11,0.08);
  border-radius: 6px;
  outline: 1px dashed var(--accent-ring);
  outline-offset: -2px;
}
.sp-group-header {
  display: flex;
  align-items: center;
}
.sp-group-toggle {
  flex: 1;
  text-align: left;
  padding: 4px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: transparent;
  border: 0;
  color: var(--fg-dim);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
}
.sp-caret { display: inline-block; width: 10px; opacity: 0.6; }
.sp-group-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-group-rename-btn {
  display: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--fg-dim);
  padding: 2px 5px;
  font-size: 11px;
}
.sp-group:hover .sp-group-rename-btn { display: inline-block; }
.sp-group-rename-btn:hover { color: var(--fg); }
.sp-group-rename-input {
  flex: 1;
  padding: 1px 4px;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-elevated);
  color: var(--fg);
  border: 1px solid var(--accent-ring);
  border-radius: 4px;
  outline: 0;
}

.sp-host-list { list-style: none; margin: 0; padding: 0; }
.sp-host {
  display: flex;
  align-items: center;
  border-radius: 5px;
  padding: 0 4px 0 0;
  cursor: grab;
  transition: background 0.08s;
}
.sp-host:hover { background: var(--bg-hover); }
.sp-host.dragging { opacity: 0.4; }
.sp-host-dot {
  display: inline-block;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--fg-dim);
  flex-shrink: 0;
  margin: 0 6px 0 8px;
}
.sp-host-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 5px 4px 5px 0;
  background: transparent;
  border: 0;
  color: var(--fg);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0;
}
.sp-host-port {
  font-size: 10px;
  color: var(--fg-dim);
  margin-right: 2px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.sp-host-actions { display: none; gap: 1px; }
.sp-host:hover .sp-host-actions { display: flex; }
.sp-host-actions button {
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 2px 4px;
  color: var(--fg-muted);
  font-size: 11px;
  border-radius: 3px;
}
.sp-host-actions button:hover { color: var(--fg); background: var(--bg-hover); }

.sp-footer {
  padding: 6px 8px;
  border-top: 1px solid var(--border);
}
.sp-add-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--fg-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.sp-add-btn:hover { background: var(--bg-hover); color: var(--fg); }
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 4: Commit**

```bash
git add src/components/SidebarPanel.tsx src/styles.css
git commit -m "feat: SidebarPanel with section switcher"
```

---

### Task 5: Wire App.tsx — IconRail + SidebarPanel, remove toggle

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports in App.tsx**

Replace the import block at the top of `src/App.tsx`. Change:
```tsx
import { Sidebar } from './components/Sidebar';
```
to:
```tsx
import { IconRail, type SidebarSection } from './components/IconRail';
import { SidebarPanel } from './components/SidebarPanel';
```

Also remove:
```tsx
import { useSidebarToggle } from './hooks/useSidebarToggle';
```

- [ ] **Step 2: Replace sidebar state in App()**

In the `App` function body, find:
```tsx
const sidebar = useSidebarToggle();
```
Replace with:
```tsx
const [sidebarSection, setSidebarSection] = useState<SidebarSection>('hosts');
```

- [ ] **Step 3: Replace the JSX render**

Find the JSX return. Replace:
```tsx
  return (
    <div className={`app theme-${theme}`}>
      <TitleBar sidebarOpen={sidebar.open} onLayoutChange={(kind) => void fillNullSlots(kind)} onOpenSyncSettings={() => { setSettingsInitialTab('sync'); setSettingsOpen(true); }}>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <div className="body">
        {sidebar.open && (
          <Sidebar
            onConnect={(h) => void connectFromHost(h)}
            onOpenSftp={(h) => void openSftpFromHost(h)}
            onAdd={() => setForm({ kind: 'create' })}
            onEdit={(h) => setForm({ kind: 'edit', host: h })}
            onDelete={(h) => setConfirmDelete(h)}
            snippetsSlot={
              <SnippetsPanel
                onAdd={() => setSnippetForm({ kind: 'create' })}
                onEdit={(snip) => setSnippetForm({ kind: 'edit', snippet: snip })}
                onDelete={(snip) => setConfirmDeleteSnippet(snip)}
                onInsert={onInsertSnippet}
              />
            }
            forwardsSlot={
              <ForwardsPanel
                onAdd={() => setForwardForm({ kind: 'create' })}
                onEdit={(f) => setForwardForm({ kind: 'edit', forward: f })}
                onDelete={(f) => setConfirmDeleteForward(f)}
              />
            }
          />
        )}
```
with:
```tsx
  return (
    <div className="app">
      <TitleBar onLayoutChange={(kind) => void fillNullSlots(kind)} onOpenSyncSettings={() => { setSettingsInitialTab('sync'); setSettingsOpen(true); }}>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <div className="body">
        <IconRail
          activeSection={sidebarSection}
          onSection={setSidebarSection}
          onSettings={() => setSettingsOpen(true)}
          onSync={() => { setSettingsInitialTab('sync'); setSettingsOpen(true); }}
        />
        <SidebarPanel
          section={sidebarSection}
          onConnect={(h) => void connectFromHost(h)}
          onOpenSftp={(h) => void openSftpFromHost(h)}
          onAddHost={() => setForm({ kind: 'create' })}
          onEditHost={(h) => setForm({ kind: 'edit', host: h })}
          onDeleteHost={(h) => setConfirmDelete(h)}
          snippetsSlot={
            <SnippetsPanel
              onAdd={() => setSnippetForm({ kind: 'create' })}
              onEdit={(snip) => setSnippetForm({ kind: 'edit', snippet: snip })}
              onDelete={(snip) => setConfirmDeleteSnippet(snip)}
              onInsert={onInsertSnippet}
            />
          }
          forwardsSlot={
            <ForwardsPanel
              onAdd={() => setForwardForm({ kind: 'create' })}
              onEdit={(f) => setForwardForm({ kind: 'edit', forward: f })}
              onDelete={(f) => setConfirmDeleteForward(f)}
            />
          }
        />
```

- [ ] **Step 4: Remove `theme` class from root div**

The app no longer needs `theme-${theme}` class since we have one theme. Keep the `useTheme` hook call and `document.documentElement.dataset.theme = theme` effect (other components may rely on it), but the root div just needs `className="app"`.

- [ ] **Step 5: Remove `sidebarOpen` prop from TitleBar call**

The updated call from Step 3 already has `sidebarOpen` removed. Verify `TitleBar.tsx` no longer uses it:

In `src/components/TitleBar.tsx`, find the Props interface:
```tsx
interface Props {
  children: ReactNode;
  sidebarOpen?: boolean;
  onLayoutChange?: (kind: LayoutKind) => void;
  onOpenSyncSettings?: () => void;
}
```
Remove the `sidebarOpen?: boolean;` line.

Find the function signature:
```tsx
export function TitleBar({ children, sidebarOpen, onLayoutChange, onOpenSyncSettings }: Props) {
```
Change to:
```tsx
export function TitleBar({ children, onLayoutChange, onOpenSyncSettings }: Props) {
```

Find the JSX:
```tsx
    <div className={`titlebar ${sidebarOpen ? 'sidebar-open' : ''}`} onMouseDown={handleMouseDown}>
```
Change to:
```tsx
    <div className="titlebar" onMouseDown={handleMouseDown}>
```

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 7: Build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/TitleBar.tsx
git commit -m "refactor: wire IconRail + SidebarPanel, remove sidebar toggle"
```

---

### Task 6: Body, pane, and terminal styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace `.body`, `.terminals`, `.pane` blocks**

Find and replace the block from `.terminals {` through `.pane-empty-btn:hover { ... }` (current lines 66–107) with:

```css
/* ─── Body layout ───────────────────────────────────────────────────────── */
.body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* ─── Terminal grid ─────────────────────────────────────────────────────── */
.terminals {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--bg-terminal);
}
.terminals.layout-solo  { display: block; }
.terminals.layout-2col  { display: grid; grid-template-columns: 1fr 1fr; }
.terminals.layout-2row  { display: grid; grid-template-rows: 1fr 1fr; }
.terminals.layout-3col  { display: grid; grid-template-columns: 1fr 1fr 1fr; }
.terminals.layout-2x2   { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

.pane {
  position: relative;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.pane-active {
  outline: 1.5px solid var(--accent-ring);
  outline-offset: -1px;
}
.pane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-terminal);
  height: 100%;
}
.pane-empty-btn {
  font-size: 22px;
  color: var(--fg-dim);
  background: none;
  border: 1px dashed var(--border-med);
  border-radius: 8px;
  width: 46px;
  height: 46px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}
.pane-empty-btn:hover { color: var(--fg-muted); border-color: var(--fg-dim); }
```

- [ ] **Step 2: Update the connecting-overlay block**

Find `.connecting-overlay` through `@keyframes ptm-spin { ... }` and replace with:

```css
/* ─── Connecting overlay ────────────────────────────────────────────────── */
.connecting-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; justify-content: center; align-items: center;
  z-index: 90;
  backdrop-filter: blur(4px);
}
.connecting-card {
  background: var(--bg-elevated);
  color: var(--fg);
  border: 1px solid var(--border-med);
  border-radius: 12px;
  padding: 20px 28px;
  min-width: 260px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.connecting-card .spinner {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--border-med);
  border-top-color: var(--accent);
  animation: ptm-spin 0.8s linear infinite;
}
.connecting-card .target {
  font-size: 12px; color: var(--fg-muted);
  font-family: "SF Mono", Menlo, monospace;
}
.connecting-card .label { font-size: 11px; color: var(--fg-dim); }
@keyframes ptm-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "style: body layout, pane amber outline, terminal bg, connecting overlay"
```

---

### Task 7: Modal styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace modal block**

Find `.palette-backdrop, .modal-backdrop {` through `.modal-actions button.danger { ... }` and replace with:

```css
/* ─── Modals & palette ──────────────────────────────────────────────────── */
.palette-backdrop, .modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(8px);
  display: flex; justify-content: center; align-items: flex-start;
  padding-top: 14vh;
  z-index: 100;
}
.palette {
  width: 560px; max-width: 92vw;
  background: var(--bg-elevated);
  border: 1px solid var(--border-med);
  border-radius: 12px;
  padding: 8px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.65);
}
.palette input {
  width: 100%; padding: 8px 12px;
  font: inherit; font-size: 14px;
  background: transparent; color: var(--fg);
  border: 0; outline: 0;
}
.palette-error { color: #d97706; padding: 6px 12px 0; font-size: 12px; }

.modal {
  width: 460px; max-width: 92vw;
  background: var(--bg-elevated);
  border: 1px solid var(--border-med);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.65);
}
.modal.modal-warning { border-color: var(--danger); }
.modal h2 { margin: 0 0 10px 0; font-size: 15px; font-weight: 600; }
.modal p { font-size: 13px; line-height: 1.5; margin: 0 0 14px 0; color: var(--fg-muted); }
.modal .error { color: var(--danger); font-size: 12px; }
.modal dl.fingerprint {
  display: grid; grid-template-columns: max-content 1fr;
  gap: 4px 12px; font-size: 12px; margin: 0 0 14px 0;
}
.modal dl.fingerprint dt { color: var(--fg-muted); }
.modal dl.fingerprint .mono {
  font-family: "SF Mono", Menlo, monospace;
  word-break: break-all; color: var(--fg);
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.modal-actions button {
  padding: 6px 14px;
  border: 1px solid var(--border-med);
  background: var(--bg-hover);
  color: var(--fg);
  border-radius: 7px;
  cursor: pointer;
  font: inherit; font-size: 13px;
  transition: background 0.1s;
}
.modal-actions button:hover { background: rgba(255,240,220,0.1); }
.modal-actions button.primary {
  background: var(--accent);
  color: #0a0806;
  border-color: var(--accent);
  font-weight: 600;
}
.modal-actions button.primary:hover { background: var(--accent-text); }
.modal-actions button.danger {
  background: var(--danger);
  color: white;
  border-color: var(--danger);
}
.modal-actions button.danger:hover { background: #dc2626; }
```

- [ ] **Step 2: Replace form styles block**

Find `.modal.modal-form {` through `.modal-form .key-path-browse:hover { ... }` and replace with:

```css
.modal.modal-form { width: 520px; max-height: 82vh; overflow-y: auto; }
.modal .form-grid {
  display: grid; grid-template-columns: 110px 1fr;
  gap: 10px 14px; align-items: center; margin: 0 0 14px 0;
}
.modal .form-grid > label { font-size: 12px; color: var(--fg-muted); text-align: left; }
.modal .form-grid > input,
.modal-form .auth-fields input,
.modal-form > textarea,
.modal-form .snippet-content,
.modal-form select {
  padding: 6px 10px;
  border: 1px solid var(--border-med);
  border-radius: 7px;
  background: rgba(255,240,220,0.04);
  color: var(--fg);
  font: inherit; font-size: 13px;
  outline: none;
  transition: border-color 0.1s, box-shadow 0.1s;
}
.modal .form-grid > input:focus,
.modal-form .auth-fields input:focus,
.modal-form > textarea:focus,
.modal-form .snippet-content:focus {
  border-color: var(--accent-ring);
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.modal-form > label:not(.checkbox) {
  display: block; font-size: 12px; color: var(--fg-muted); margin: 0 0 4px 0;
}
.modal-form > textarea {
  display: block; width: 100%; box-sizing: border-box; resize: vertical; margin: 0 0 14px 0;
}
.modal fieldset.auth-method {
  display: flex; flex-direction: column; gap: 6px;
  border: 1px solid var(--border-med); border-radius: 7px;
  padding: 10px 12px 12px; margin: 0 0 14px 0;
}
.modal fieldset.auth-method legend {
  padding: 0 6px; font-size: 11px; color: var(--fg-dim);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.modal fieldset.auth-method label {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; cursor: pointer;
}
.modal fieldset.auth-method label input[type="radio"] { margin: 0; }
.modal-form label.checkbox {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--fg-muted); margin: 4px 0 0 0;
}
.modal-form .auth-fields { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px 0; }
.modal-form .auth-fields > label { display: block; font-size: 12px; color: var(--fg-muted); margin: 0 0 4px 0; }
.modal-form .key-path-row { display: flex; gap: 6px; align-items: center; }
.modal-form .key-path-row input { flex: 1; }
.modal-form .key-path-browse {
  padding: 6px 10px; border: 1px solid var(--border-med); border-radius: 7px;
  background: var(--bg-hover); color: var(--fg); cursor: pointer;
  font: inherit; font-size: 12px; white-space: nowrap;
}
.modal-form .key-path-browse:hover { background: rgba(255,240,220,0.1); }
```

- [ ] **Step 3: Replace settings tabs block**

Find `.settings-tabs {` through `.modal-settings { ... }` and replace with:

```css
.settings-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.settings-tabs button {
  padding: 6px 16px;
  background: none; border: none;
  border-bottom: 2px solid transparent;
  color: var(--fg-muted);
  cursor: pointer; font-size: 13px;
  transition: color 0.1s, border-color 0.1s;
}
.settings-tabs button[aria-selected="true"] {
  border-bottom-color: var(--accent);
  color: var(--fg);
}
.modal-settings { min-width: 380px; }
.form-error { color: #f87171; font-size: 12px; margin: 8px 0 0; }
```

- [ ] **Step 4: Build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "style: modal and form styles — warm charcoal, amber focus rings"
```

---

### Task 8: Snippet & forward panel styles; SFTP styles; misc

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Replace snippets-panel block**

Find `.snippets-panel {` through `.modal-form .snippet-content:focus { ... }` and replace with:

```css
/* ─── Snippets panel (inside SidebarPanel) ──────────────────────────────── */
.snippets-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.snippets-header {
  display: flex; align-items: center;
  padding: 8px 8px 4px;
  border-bottom: 1px solid var(--border);
}
.snippets-toggle {
  flex: 1; text-align: left; padding: 0 4px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  background: transparent; border: 0; color: var(--fg-dim); cursor: pointer;
  display: flex; align-items: center; gap: 3px;
}
.snippets-add {
  background: transparent; border: 0; cursor: pointer;
  color: var(--fg-dim); padding: 2px 6px; font-size: 14px;
  border-radius: 4px; transition: color 0.1s, background 0.1s;
}
.snippets-add:hover { color: var(--fg); background: var(--bg-hover); }
.snippets-empty { padding: 10px 12px; font-size: 11px; color: var(--fg-dim); }
.snippets-list { list-style: none; margin: 0; padding: 0 4px 8px; overflow-y: auto; flex: 1; }
.snippet-row {
  display: flex; align-items: center; padding: 0 4px 0 0; border-radius: 5px;
  transition: background 0.08s;
}
.snippet-row:hover { background: var(--bg-hover); }
.snippet-name {
  flex: 1; text-align: left; padding: 5px 6px; background: transparent; border: 0;
  color: var(--fg); cursor: pointer; font: inherit; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.snippet-actions { display: none; gap: 1px; }
.snippet-row:hover .snippet-actions { display: flex; }
.snippet-actions button {
  background: transparent; border: 0; cursor: pointer; padding: 2px 4px;
  color: var(--fg-muted); font-size: 11px; border-radius: 3px;
}
.snippet-actions button:hover { color: var(--fg); background: var(--bg-hover); }
.modal-form .snippet-content {
  font-family: "SF Mono", Menlo, monospace;
  display: block; width: 100%; box-sizing: border-box; resize: vertical; margin: 0 0 14px 0;
}
.modal-form .forward-section-title {
  font-size: 11px; color: var(--fg-dim); text-transform: uppercase;
  letter-spacing: 0.4px; margin: 6px 0;
}
```

- [ ] **Step 2: Replace forwards-panel block**

Find `.forwards-panel {` through `.fw-dot-stopped { ... }` and replace with:

```css
/* ─── Forwards panel (inside SidebarPanel) ──────────────────────────────── */
.forwards-panel { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
.forwards-header {
  display: flex; align-items: center;
  padding: 8px 8px 4px;
  border-bottom: 1px solid var(--border);
}
.forwards-toggle {
  flex: 1; text-align: left; padding: 0 4px;
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  background: transparent; border: 0; color: var(--fg-dim); cursor: pointer;
  display: flex; align-items: center; gap: 3px;
}
.forwards-add {
  background: transparent; border: 0; cursor: pointer;
  color: var(--fg-dim); padding: 2px 6px; font-size: 14px;
  border-radius: 4px; transition: color 0.1s, background 0.1s;
}
.forwards-add:hover { color: var(--fg); background: var(--bg-hover); }
.forwards-empty { padding: 10px 12px; font-size: 11px; color: var(--fg-dim); }
.forwards-list { list-style: none; margin: 0; padding: 0 4px 8px; overflow-y: auto; flex: 1; }
.forward-row {
  display: flex; align-items: center; padding: 0 4px; border-radius: 5px; gap: 5px;
  transition: background 0.08s;
}
.forward-row:hover { background: var(--bg-hover); }
.forward-name { flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.forward-kind { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: var(--fg-dim); }
.forward-toggle {
  background: transparent; border: 0; cursor: pointer; color: var(--fg-muted);
  padding: 2px 5px; font-size: 13px; border-radius: 3px;
  transition: color 0.1s, background 0.1s;
}
.forward-toggle:hover { color: var(--fg); background: var(--bg-hover); }
.forward-actions { display: none; gap: 1px; }
.forward-row:hover .forward-actions,
.forward-row:focus-within .forward-actions { display: flex; }
.forward-actions button {
  background: transparent; border: 0; cursor: pointer; padding: 2px 4px;
  color: var(--fg-muted); font-size: 11px; border-radius: 3px;
}
.forward-actions button:hover { color: var(--fg); background: var(--bg-hover); }
.fw-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--fg-dim); flex-shrink: 0;
}
.fw-dot-running { background: var(--online); box-shadow: 0 0 5px var(--online-glow); }
.fw-dot-starting { background: var(--accent); }
.fw-dot-error { background: var(--danger); }
.fw-dot-stopped { background: var(--fg-dim); opacity: 0.5; }
```

- [ ] **Step 3: Update SFTP styles**

Find `.sftp-mount {` through `.fb-error { ... }` and replace with:

```css
/* ─── SFTP file browser ─────────────────────────────────────────────────── */
.sftp-mount { width: 100%; height: 100%; display: flex; }
.file-browser {
  display: flex; flex-direction: column; flex: 1; min-height: 0;
  background: var(--bg-terminal); color: var(--fg);
}
.fb-toolbar {
  display: flex; align-items: center; gap: 6px; padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.fb-toolbar button {
  background: transparent; border: 1px solid var(--border-med); border-radius: 6px;
  color: var(--fg); cursor: pointer; padding: 4px 8px; font-size: 12px;
  transition: background 0.1s;
}
.fb-toolbar button:hover { background: var(--bg-hover); }
.fb-toolbar .fb-up { padding: 4px 10px; }
.fb-breadcrumb {
  flex: 1; padding: 4px 8px; font-family: "SF Mono", Menlo, monospace;
  font-size: 12px; background: rgba(255,240,220,0.04); color: var(--fg);
  border: 1px solid var(--border-med); border-radius: 6px; outline: none;
}
.fb-toggle { font-size: 12px; color: var(--fg-muted); display: flex; align-items: center; gap: 4px; }
.fb-mkdir { display: flex; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.fb-mkdir input {
  flex: 1; padding: 4px 8px; border: 1px solid var(--border-med); border-radius: 6px;
  background: rgba(255,240,220,0.04); color: var(--fg); font: inherit; font-size: 13px; outline: none;
}
.fb-header {
  display: grid; grid-template-columns: 1fr 100px 130px 100px;
  font-size: 11px; color: var(--fg-dim); padding: 4px 12px;
  border-bottom: 1px solid var(--border);
}
.fb-header .fb-col {
  background: transparent; border: 0; cursor: pointer; color: var(--fg-muted);
  text-align: left; padding: 0; font-size: 11px;
}
.fb-list { flex: 1; overflow: auto; }
.file-row {
  display: grid; grid-template-columns: 1fr 100px 130px 100px;
  align-items: center; padding: 0 12px; height: 28px; font-size: 13px;
}
.file-row:hover { background: var(--bg-hover); }
.file-row.pseudo-up {
  background: transparent; border: 0; width: 100%; text-align: left;
  cursor: pointer; color: var(--fg);
}
.file-row .file-row-name {
  display: flex; align-items: center; gap: 8px;
  background: transparent; border: 0; cursor: default; color: var(--fg);
  font: inherit; font-size: 13px; text-align: left; padding: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.file-row.is-dir .file-row-name { cursor: pointer; }
.file-row .file-icon { width: 18px; }
.file-row .file-size, .file-row .file-modified { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.file-row .file-actions { display: none; gap: 4px; justify-content: flex-end; }
.file-row:hover .file-actions { display: flex; }
.file-row .file-actions button {
  background: transparent; border: 0; cursor: pointer; color: var(--fg-muted);
  padding: 2px 6px; border-radius: 3px; font-size: 12px;
}
.file-row .file-actions button:hover { color: var(--fg); background: var(--bg-hover); }
.fb-loading, .fb-error { padding: 12px; font-size: 12px; }
.fb-error { color: var(--danger); }
```

- [ ] **Step 4: Build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add src/styles.css
git commit -m "style: snippets, forwards, SFTP panels — warm charcoal"
```

---

### Task 9: Layout picker & sync status styles; cleanup unused files

**Files:**
- Modify: `src/styles.css`
- Delete: `src/components/Sidebar.tsx`, `src/hooks/useSidebarToggle.ts`

- [ ] **Step 1: Update layout-picker and sync-status styles in styles.css**

Find `.layout-picker-wrap {` through the end of `.sync-status { ... }` block and replace with:

```css
/* ─── Layout picker ─────────────────────────────────────────────────────── */
.layout-picker-wrap {
  position: relative;
  display: flex; align-items: center;
  padding-right: 8px;
}
.layout-picker-btn {
  background: none; border: none;
  color: var(--fg-muted);
  cursor: pointer;
  width: 28px; height: 28px;
  padding: 0; border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.1s, color 0.1s;
}
.layout-picker-btn:hover { color: var(--fg); background: var(--bg-hover); }
.layout-picker-popover {
  position: absolute;
  top: calc(100% + 6px); right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-med);
  border-radius: 8px;
  padding: 5px;
  display: flex; flex-direction: row; gap: 3px;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.layout-option {
  background: none;
  border: 1px solid transparent;
  color: var(--fg-muted);
  width: 30px; height: 30px;
  border-radius: 5px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.layout-option:hover { background: var(--bg-hover); color: var(--fg); border-color: var(--border-med); }
.layout-option.active {
  color: var(--accent-text);
  background: var(--accent-dim);
  border-color: var(--accent-ring);
}

/* ─── Sync status ───────────────────────────────────────────────────────── */
.sync-status {
  background: none; border: none; cursor: default;
  padding: 0 6px;
  color: var(--accent-text);
  font-size: 13px; line-height: 1;
  display: flex; align-items: center;
}
```

- [ ] **Step 2: Remove the old `.sidebar {}` block and related old classes**

Find and delete the entire block:
```css
.sidebar {
  width: 240px; flex: 0 0 240px;
  ...
}
.sidebar-actions { ... }
...
.sidebar-hint { ... }
```
(everything from `.sidebar {` to `.sidebar-hint { ... }` — lines 145–203 in original)

These classes are no longer used. `SidebarPanel` uses `.sidebar-panel` and `.sp-*` classes instead.

Also delete:
```css
.titlebar.sidebar-open .titlebar-drag-left { width: 240px; flex-basis: 240px; }
```
(line 21 in original — the `sidebarOpen` dynamic width is gone)

- [ ] **Step 3: Delete unused files**

```bash
rm src/components/Sidebar.tsx
rm src/hooks/useSidebarToggle.ts
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: `TypeScript: No errors found`

- [ ] **Step 5: Full build**

```bash
./node_modules/.bin/vite build 2>&1 | tail -8
```

Expected: `✓ built in ...`

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "style: layout picker, sync status; remove unused Sidebar + useSidebarToggle"
```

---

### Task 10: Full app build and smoke test

**Files:** None (verification only)

- [ ] **Step 1: Full Tauri build**

```bash
PATH="/Users/band/.cargo/bin:$PATH" npx tauri build 2>&1 | tail -10
```

Expected:
```
Finished `release` profile [optimized] target(s) in ...
Bundling power-term.app ...
Finished 2 bundles at:
    .../power-term.app
    .../power-term_0.0.1_aarch64.dmg
```

- [ ] **Step 2: Launch app and verify**

```bash
open /Users/band/Projects/band/power-term/src-tauri/target/release/bundle/macos/power-term.app
```

Check:
- Traffic lights visible at top-left
- Amber tab underline on active tab
- Icon rail visible (44px, 3 nav icons + settings/sync at bottom)
- Sidebar panel (168px) shows hosts list
- Clicking Snippets icon switches panel to snippets
- Clicking Forwards icon switches panel to forwards
- Terminal area shows warm dark background
- Active pane has amber outline (open two panes via layout picker)
- ⌘K opens command palette (dark blurred backdrop)
- ⌘, opens settings modal
- No TypeScript errors, no console errors

- [ ] **Step 3: Final commit if any last tweaks were made**

```bash
git add -A
git commit -m "chore: post-build tweaks"
```
