import { useEffect, useMemo, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import { useSshKeyStore } from '../state/sshKeyStore';
import type { SshKey } from '../types';

interface Props {
  onAdd: () => void;
  onEdit: (k: SshKey) => void;
  onDelete: (k: SshKey) => void;
}

/**
 * Sidebar list of saved SSH keys. Mirrors the layout of DbConnectionsPanel
 * — collapsible header, add button, hover actions. Captured key contents
 * are stored alongside the metadata so a missing file on disk doesn't
 * break authentication; this panel surfaces the count of hosts referencing
 * each key path so the user knows the blast radius before deleting.
 */
export function KeysPanel({ onAdd, onEdit, onDelete }: Props) {
  const keys = useSshKeyStore((s) => s.keys);
  const error = useSshKeyStore((s) => s.error);
  const load = useSshKeyStore((s) => s.load);
  const hosts = useHostStore((s) => s.hosts);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { void load(); }, [load]);

  const usageByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hosts) {
      if (h.auth_method === 'key' && h.key_path) {
        m.set(h.key_path, (m.get(h.key_path) ?? 0) + 1);
      }
    }
    return m;
  }, [hosts]);

  return (
    <div className="keys-panel">
      <div className="keys-panel-header">
        <button
          type="button"
          className="keys-panel-toggle"
          aria-label="toggle keys section"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="sp-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="keys-panel-title">SSH keys</span>
        </button>
        <button type="button" className="keys-panel-add" aria-label="add key" onClick={onAdd}>+</button>
      </div>
      {error && <p className="sp-error">{error}</p>}
      {!collapsed && (
        <>
          {keys.length === 0 ? (
            <p className="keys-panel-empty">No keys. Click + to add one.</p>
          ) : (
            <ul className="keys-panel-list">
              {keys.map((k) => {
                const usage = usageByPath.get(k.path) ?? 0;
                return (
                  <li key={k.id} className="keys-panel-row" title={k.path}>
                    <button
                      type="button"
                      className="keys-panel-row-name"
                      onClick={() => onEdit(k)}
                    >
                      <span className={`keys-panel-pill${k.content ? ' has-content' : ''}`}>
                        {k.content ? '🔒' : '📄'}
                      </span>
                      <span className="keys-panel-row-label">{k.name}</span>
                      <span className="keys-panel-row-usage">
                        {usage > 0 ? `${usage}` : '—'}
                      </span>
                    </button>
                    <span className="keys-panel-row-actions">
                      <button type="button" aria-label={`edit ${k.name}`} onClick={() => onEdit(k)}>✎</button>
                      <button type="button" aria-label={`delete ${k.name}`} onClick={() => onDelete(k)}>×</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
