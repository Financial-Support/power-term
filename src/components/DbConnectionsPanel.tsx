import { useEffect, useMemo, useState } from 'react';
import { useDbConnectionStore } from '../state/dbConnectionStore';
import { useHostStore } from '../state/hostStore';
import type { DbConnection } from '../types';

interface Props {
  onAdd: () => void;
  onEdit: (c: DbConnection) => void;
  onDelete: (c: DbConnection) => void;
  onOpen: (c: DbConnection) => void;
}

/**
 * Sidebar list of saved DB connections. Mirrors the look of ForwardsPanel
 * (collapsible header + add button + row list) so the IconRail sections
 * feel uniform. The Open action delegates to the App-level handler so it
 * can prompt for the DB password and spin up a session tab.
 */
export function DbConnectionsPanel({ onAdd, onEdit, onDelete, onOpen }: Props) {
  const connections = useDbConnectionStore((s) => s.connections);
  const error = useDbConnectionStore((s) => s.error);
  const load = useDbConnectionStore((s) => s.load);
  const hosts = useHostStore((s) => s.hosts);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { void load(); }, [load]);

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? '?';

  const sorted = useMemo(
    () => [...connections].sort((a, b) => a.name.localeCompare(b.name)),
    [connections],
  );

  return (
    <div className="db-panel">
      <div className="db-panel-header">
        <button
          type="button"
          className="db-panel-toggle"
          aria-label="toggle databases section"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="sp-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="db-panel-title">Databases</span>
        </button>
        <button type="button" className="db-panel-add" aria-label="add db connection" onClick={onAdd}>+</button>
      </div>
      {error && <p className="sp-error">{error}</p>}
      {!collapsed && (
        <>
          {sorted.length === 0 ? (
            <p className="db-panel-empty">No DB connections. Click + to add one.</p>
          ) : (
            <ul className="db-panel-list">
              {sorted.map((c) => (
                <li key={c.id} className="db-row" title={`${c.engine} via ${hostName(c.host_id)}`}>
                  <button
                    type="button"
                    className="db-row-name"
                    onClick={() => onOpen(c)}
                    aria-label={`open ${c.name}`}
                  >
                    <span className={`db-engine-pill db-engine-${c.engine}`}>{c.engine === 'mysql' ? 'MY' : 'PG'}</span>
                    <span className="db-name">{c.name}</span>
                    <span className="db-host">{hostName(c.host_id)}</span>
                  </button>
                  <span className="db-row-actions">
                    <button type="button" aria-label={`edit ${c.name}`} onClick={() => onEdit(c)}>✎</button>
                    <button type="button" aria-label={`delete ${c.name}`} onClick={() => onDelete(c)}>×</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
