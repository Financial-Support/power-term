import { useEffect, useMemo, useState } from 'react';
import { useDbConnectionStore } from '../state/dbConnectionStore';
import { useHostStore } from '../state/hostStore';
import type { DbConnection } from '../types';
import { ChevronDownIcon, ChevronLeftIcon, PencilIcon, PlusIcon, TrashIcon } from './AppIcons';

interface Props {
  onAdd: () => void;
  onEdit: (c: DbConnection) => void;
  onDelete: (c: DbConnection) => void;
  onOpen: (c: DbConnection) => void;
  onHidePanel?: () => void;
}

/**
 * Sidebar list of saved DB connections. Mirrors the look of ForwardsPanel
 * (collapsible header + add button + row list) so the IconRail sections
 * feel uniform. The Open action delegates to the App-level handler so it
 * can prompt for the DB password and spin up a session tab.
 */
export function DbConnectionsPanel({ onAdd, onEdit, onDelete, onOpen, onHidePanel }: Props) {
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
        <div className="panel-head-copy">
          <button
            type="button"
            className="db-panel-toggle"
            aria-label="toggle databases section"
            onClick={() => setCollapsed((v) => !v)}
          >
            <span className={`sp-caret${collapsed ? ' collapsed' : ''}`}><ChevronDownIcon size={10} /></span>
            <span className="db-panel-title">Databases</span>
            <span className="panel-count" aria-hidden>{sorted.length}</span>
          </button>
          <p className="panel-subtitle">Connection profiles and quick launch</p>
        </div>
        {onHidePanel && (
          <button
            type="button"
            className="db-panel-hide"
            onClick={onHidePanel}
            aria-label="Hide database list"
            title="Hide"
          >
            <ChevronLeftIcon size={12} />
          </button>
        )}
      </div>
      {error && <p className="sp-error">{error}</p>}
      {!collapsed && (
        <>
          {sorted.length === 0 ? (
            <p className="db-panel-empty">No connections.</p>
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
                    <span className={`db-engine-pill db-engine-${c.engine}`}>{engineShort(c.engine)}</span>
                    <span className="db-name">{c.name}</span>
                    <span className="db-host">{hostName(c.host_id)}</span>
                  </button>
                  <span className="db-row-actions">
                    <button type="button" aria-label={`edit ${c.name}`} title={`Edit ${c.name}`} onClick={() => onEdit(c)}><PencilIcon size={13} /></button>
                    <button type="button" aria-label={`delete ${c.name}`} title={`Delete ${c.name}`} onClick={() => onDelete(c)}><TrashIcon size={13} /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="sp-footer">
            <div className="sp-add-row" role="group" aria-label="Add database actions">
              <button
                type="button"
                className="sp-add-primary"
                onClick={onAdd}
                title="Add database"
              >
                <span className="sp-add-icon" aria-hidden>
                  <PlusIcon size={14} />
                </span>
                <span>Add database</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function engineShort(engine: string): string {
  switch (engine) {
    case 'mysql': return 'MY';
    case 'postgres': return 'PG';
    case 'sqlite': return 'SQ';
    case 'mssql': return 'MS';
    case 'redis': return 'RD';
    default: return engine.slice(0, 2).toUpperCase();
  }
}
