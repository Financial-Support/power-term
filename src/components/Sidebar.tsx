import { useMemo, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host, HostInput } from '../types';

interface Props {
  onConnect: (host: Host) => void;
  onOpenSftp: (host: Host) => void;
  onAdd: () => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
}

interface Group {
  name: string;
  rawKey: string | null;
  hosts: Host[];
}

const UNGROUPED = 'Ungrouped';
const HOST_DRAG_MIME = 'application/x-power-term-host-id';

export function Sidebar({ onConnect, onOpenSftp, onAdd, onEdit, onDelete }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const error = useHostStore((s) => s.error);
  const updateHost = useHostStore((s) => s.update);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [draggingHostId, setDraggingHostId] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const h of hosts) {
      const key = h.group_name ?? UNGROUPED;
      if (!map.has(key)) {
        map.set(key, { name: key, rawKey: h.group_name, hosts: [] });
      }
      map.get(key)!.hosts.push(h);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.rawKey === null) return 1;
      if (b.rawKey === null) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [hosts]);

  const toggle = (name: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // ----- Group rename -----
  const startRenameGroup = (g: Group) => {
    if (g.rawKey === null) return; // can't rename the synthetic Ungrouped
    setRenamingGroup(g.name);
    setRenameDraft(g.name);
  };

  const commitRenameGroup = async (oldName: string) => {
    const next = renameDraft.trim();
    setRenamingGroup(null);
    if (!next || next === oldName) return;
    // Rename every host whose group_name matches the old name. Each call is
    // its own SQLite + Keychain round-trip; sequential to keep error
    // reporting simple. Real-world group sizes are tiny so this is fine.
    const targets = hosts.filter((h) => h.group_name === oldName);
    for (const h of targets) {
      await updateHost(h.id, hostToInput(h, { group_name: next }));
    }
  };

  // ----- Drag & drop -----
  const handleDragStart = (e: React.DragEvent, host: Host) => {
    e.dataTransfer.setData(HOST_DRAG_MIME, host.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingHostId(host.id);
  };

  const handleDragEnd = () => {
    setDraggingHostId(null);
    setDragOverGroup(null);
  };

  const handleGroupDragOver = (e: React.DragEvent, g: Group) => {
    if (!e.dataTransfer.types.includes(HOST_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverGroup !== g.name) setDragOverGroup(g.name);
  };

  const handleGroupDragLeave = (g: Group) => {
    if (dragOverGroup === g.name) setDragOverGroup(null);
  };

  const handleGroupDrop = async (e: React.DragEvent, g: Group) => {
    e.preventDefault();
    setDragOverGroup(null);
    setDraggingHostId(null);
    const id = e.dataTransfer.getData(HOST_DRAG_MIME);
    if (!id) return;
    const host = hosts.find((h) => h.id === id);
    if (!host) return;
    const targetGroupName = g.rawKey; // null for Ungrouped
    if ((host.group_name ?? null) === (targetGroupName ?? null)) return;
    await updateHost(id, hostToInput(host, { group_name: targetGroupName }));
  };

  return (
    <aside className="sidebar" aria-label="hosts sidebar">
      <div className="sidebar-actions">
        <button type="button" className="primary" onClick={onAdd}>+ New Host</button>
      </div>
      {error && <p className="sidebar-error">{error}</p>}
      <div className="sidebar-list">
        {hosts.length === 0 && (
          <p className="sidebar-empty">No saved hosts. Click <strong>+ New Host</strong> to add one.</p>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.name);
          const isDropActive = dragOverGroup === g.name;
          const isRenaming = renamingGroup === g.name;
          return (
            <div
              key={g.name}
              className={`sidebar-group ${isDropActive ? 'drop-active' : ''}`}
              onDragOver={(e) => handleGroupDragOver(e, g)}
              onDragLeave={() => handleGroupDragLeave(g)}
              onDrop={(e) => void handleGroupDrop(e, g)}
            >
              <div className="sidebar-group-header">
                <button
                  type="button"
                  className="sidebar-group-toggle"
                  onClick={() => toggle(g.name)}
                  onDoubleClick={() => startRenameGroup(g)}
                >
                  <span className="sidebar-caret">{isCollapsed ? '▸' : '▾'}</span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="sidebar-group-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => void commitRenameGroup(g.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitRenameGroup(g.name); }
                        if (e.key === 'Escape') { e.preventDefault(); setRenamingGroup(null); }
                      }}
                    />
                  ) : (
                    <span className="sidebar-group-name">{g.name}</span>
                  )}
                </button>
                {!isRenaming && g.rawKey !== null && (
                  <button
                    type="button"
                    className="sidebar-group-rename"
                    aria-label={`rename group ${g.name}`}
                    onClick={() => startRenameGroup(g)}
                  >
                    ✎
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <ul className="sidebar-hosts">
                  {g.hosts.map((host) => (
                    <li
                      key={host.id}
                      className={`sidebar-host ${draggingHostId === host.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, host)}
                      onDragEnd={handleDragEnd}
                    >
                      <button type="button" className="sidebar-host-name" onClick={() => onConnect(host)}>
                        {host.name}
                      </button>
                      <span className="sidebar-host-actions">
                        <button type="button" aria-label={`open sftp ${host.name}`} onClick={() => onOpenSftp(host)}>📂</button>
                        <button type="button" aria-label={`edit host ${host.name}`} onClick={() => onEdit(host)}>✎</button>
                        <button type="button" aria-label={`delete host ${host.name}`} onClick={() => onDelete(host)}>×</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="sidebar-hint">Tip: Cmd+K opens the command palette.</p>
    </aside>
  );
}

function hostToInput(host: Host, override: Partial<HostInput>): HostInput {
  return {
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    group_name: host.group_name,
    tags: host.tags,
    auth_method: host.auth_method,
    key_path: host.key_path,
    notes: host.notes,
    ...override,
  };
}
