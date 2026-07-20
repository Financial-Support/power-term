import { useMemo, useState } from 'react';
import { useForwardStore } from '../state/forwardStore';
import type { Forward, ForwardStatus } from '../types';
import { ChevronDownIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from './AppIcons';

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
        <div className="panel-head-copy">
          <button
            type="button"
            className="forwards-toggle"
            aria-label="toggle forwards section"
            onClick={() => setCollapsed((v) => !v)}
          >
            <span className={`sp-caret${collapsed ? ' collapsed' : ''}`}><ChevronDownIcon size={10} /></span>
            <span className="forwards-title">Forwards</span>
            <span className="panel-count" aria-hidden>{sorted.length}</span>
          </button>
        </div>
        <button type="button" className="forwards-add" aria-label="add forward" onClick={onAdd}><PlusIcon size={13} /></button>
      </div>
      {!collapsed && (
        <>
          {sorted.length === 0 ? (
            <p className="forwards-empty">No forwards.</p>
          ) : (
            <ul className="forwards-list">
              {sorted.map((f) => {
                const s = statusOf(f.id);
                const isOn = s.state === 'running' || s.state === 'starting';
                const dotClass = `fw-dot fw-dot-${s.state}`;
                return (
                  <li key={f.id} className="forward-row" title={s.error ?? undefined}>
                    <span className={dotClass} aria-label={`status ${s.state}`} />
                    <div className="forward-copy">
                      <span className="forward-name">{f.name}</span>
                      <span className="forward-meta">
                        {f.kind === 'local' ? 'L' : 'R'} {f.bind_port}
                        <span aria-hidden> · </span>
                        <span>{f.bind_addr}:{f.bind_port} → {f.remote_host}:{f.remote_port}</span>
                      </span>
                    </div>
                    <span className={`forward-state-pill forward-state-${s.state}`}>
                      {stateLabel(s.state)}
                    </span>
                    <button
                      type="button"
                      className="forward-toggle"
                      aria-label={`${isOn ? 'stop' : 'start'} forward ${f.name}`}
                      onClick={() => onToggle(f)}
                    >{isOn ? <PauseIcon size={12} /> : <PlayIcon size={12} />}</button>
                    <span className="forward-actions">
                      <button type="button" aria-label={`edit forward ${f.name}`} title={`Edit forward ${f.name}`} onClick={() => onEdit(f)}><PencilIcon size={13} /></button>
                      <button type="button" aria-label={`delete forward ${f.name}`} title={`Delete forward ${f.name}`} onClick={() => onDelete(f)}><TrashIcon size={13} /></button>
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

function stateLabel(state: ForwardStatus['state']): string {
  switch (state) {
    case 'running':
      return 'Live';
    case 'starting':
      return 'Starting';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}
