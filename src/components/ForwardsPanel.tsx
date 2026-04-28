import { useMemo, useState } from 'react';
import { useForwardStore } from '../state/forwardStore';
import type { Forward, ForwardStatus } from '../types';

interface Props {
  onAdd: () => void;
  onEdit: (forward: Forward) => void;
  onDelete: (forward: Forward) => void;
}

export function ForwardsPanel({ onAdd, onEdit, onDelete }: Props) {
  const forwards = useForwardStore((s) => s.forwards);
  const statuses = useForwardStore((s) => s.statuses);
  const startStore = useForwardStore((s) => s.start);
  const stopStore = useForwardStore((s) => s.stop);
  const [collapsed, setCollapsed] = useState(false);

  const sorted = useMemo(
    () => [...forwards].sort((a, b) => a.name.localeCompare(b.name)),
    [forwards],
  );

  const statusOf = (id: string): ForwardStatus =>
    statuses[id] ?? { id, state: 'stopped', error: null };

  const onToggle = (f: Forward) => {
    const s = statusOf(f.id);
    if (s.state === 'running' || s.state === 'starting') void stopStore(f.id);
    else void startStore(f.id);
  };

  return (
    <div className="forwards-panel">
      <div className="forwards-header">
        <button
          type="button"
          className="forwards-toggle"
          aria-label="toggle forwards section"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="sidebar-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="forwards-title">Forwards</span>
        </button>
        <button type="button" className="forwards-add" aria-label="add forward" onClick={onAdd}>+</button>
      </div>
      {!collapsed && (
        <>
          {sorted.length === 0 ? (
            <p className="forwards-empty">No forwards. Click + to add one.</p>
          ) : (
            <ul className="forwards-list">
              {sorted.map((f) => {
                const s = statusOf(f.id);
                const isOn = s.state === 'running' || s.state === 'starting';
                const dotClass = `fw-dot fw-dot-${s.state}`;
                return (
                  <li key={f.id} className="forward-row" title={s.error ?? undefined}>
                    <span className={dotClass} aria-label={`status ${s.state}`} />
                    <span className="forward-name">{f.name}</span>
                    <span className="forward-kind">
                      {f.kind === 'local' ? 'L' : 'R'} {f.bind_port}
                    </span>
                    <button
                      type="button"
                      className="forward-toggle"
                      aria-label={`${isOn ? 'stop' : 'start'} forward ${f.name}`}
                      onClick={() => onToggle(f)}
                    >{isOn ? '⏸' : '⏵'}</button>
                    <span className="forward-actions">
                      <button type="button" aria-label={`edit forward ${f.name}`} onClick={() => onEdit(f)}>✎</button>
                      <button type="button" aria-label={`delete forward ${f.name}`} onClick={() => onDelete(f)}>×</button>
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
