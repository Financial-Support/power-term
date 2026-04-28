import { useMemo, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';

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

export function Sidebar({ onConnect, onOpenSftp, onAdd, onEdit, onDelete }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const error = useHostStore((s) => s.error);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
          return (
            <div key={g.name} className="sidebar-group">
              <button type="button" className="sidebar-group-header" onClick={() => toggle(g.name)}>
                <span className="sidebar-caret">{isCollapsed ? '▸' : '▾'}</span>
                <span className="sidebar-group-name">{g.name}</span>
              </button>
              {!isCollapsed && (
                <ul className="sidebar-hosts">
                  {g.hosts.map((host) => (
                    <li key={host.id} className="sidebar-host">
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
