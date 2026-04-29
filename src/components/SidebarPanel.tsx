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
