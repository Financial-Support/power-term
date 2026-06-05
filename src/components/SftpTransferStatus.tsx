import { useEffect, useMemo, useRef, useState } from 'react';
import { onSftpTransferProgress, sftpCancelTransfer } from '../lib/ipc';
import type { SftpTransferProgress } from '../types';

type TransferRecord = SftpTransferProgress & {
  started_at: number;
  updated_at: number;
};

const STORAGE_KEY = 'sftp.transfer.history.v1';
const MAX_HISTORY = 80;

export function SftpTransferStatus() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<TransferRecord[]>(() => loadHistory());
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onSftpTransferProgress((payload) => {
      setRecords((current) => {
        const now = Date.now();
        const existing = current.find((r) => r.transfer_id === payload.transfer_id);
        const nextRecord: TransferRecord = {
          ...payload,
          started_at: existing?.started_at ?? now,
          updated_at: now,
        };
        const next = [nextRecord, ...current.filter((r) => r.transfer_id !== payload.transfer_id)]
          .slice(0, MAX_HISTORY);
        saveHistory(next);
        return next;
      });
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount = records.filter((r) => r.state === 'running').length;
  const errorCount = records.filter((r) => r.state === 'error').length;
  const buttonTitle = activeCount
    ? `${activeCount} SFTP transfer${activeCount > 1 ? 's' : ''} running`
    : records.length
      ? 'SFTP transfer history'
      : 'No SFTP transfers';
  const sorted = useMemo(() => [...records].sort((a, b) => b.updated_at - a.updated_at), [records]);

  const clearHistory = () => {
    const running = records.filter((r) => r.state === 'running');
    setRecords(running);
    saveHistory(running);
  };

  const cancelTransfer = async (transferId: string) => {
    try {
      await sftpCancelTransfer(transferId);
    } catch (err) {
      console.warn('cancel transfer failed', err);
    }
  };

  return (
    <div className="transfer-status" data-no-drag ref={wrapRef}>
      <button
        type="button"
        className={`transfer-status-btn${activeCount ? ' active' : ''}${errorCount ? ' has-error' : ''}`}
        aria-label="SFTP transfers"
        title={buttonTitle}
        onClick={() => setOpen((v) => !v)}
      >
        <TransferIcon active={activeCount > 0} />
        {(activeCount > 0 || errorCount > 0) && (
          <span className="transfer-status-badge">{activeCount || errorCount}</span>
        )}
      </button>

      {open && (
        <div className="transfer-popover" role="menu" aria-label="SFTP transfer history">
          <div className="transfer-popover-head">
            <span>SFTP transfers</span>
            <button type="button" onClick={clearHistory} disabled={!records.some((r) => r.state !== 'running')}>
              Clear
            </button>
          </div>
          {sorted.length === 0 ? (
            <div className="transfer-empty">No transfer history.</div>
          ) : (
            <div className="transfer-list">
              {sorted.map((r) => (
                <TransferRow key={r.transfer_id} record={r} onCancel={cancelTransfer} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TransferRow({ record, onCancel }: { record: TransferRecord; onCancel: (transferId: string) => Promise<void> }) {
  const pct = record.bytes_total > 0
    ? Math.min(100, Math.round((record.bytes_done / record.bytes_total) * 100))
    : record.state === 'done' ? 100 : 0;
  const name = lastPathPart(record.path);
  const verb = record.direction === 'upload' ? 'Upload' : 'Download';
  const stateText = record.state === 'running'
    ? `${pct}%`
    : record.state === 'done'
      ? 'Done'
      : record.state === 'cancelled'
        ? 'Cancelled'
        : 'Failed';

  return (
    <div className={`transfer-row transfer-row-${record.state}`}>
      <div className="transfer-row-main">
        <span className="transfer-row-icon" aria-hidden>{record.direction === 'upload' ? '↑' : '↓'}</span>
        <span className="transfer-row-name" title={record.path}>{name}</span>
        {record.state === 'running' ? (
          <button type="button" className="transfer-cancel" onClick={() => void onCancel(record.transfer_id)}>
            Cancel
          </button>
        ) : (
          <span className="transfer-row-state">{stateText}</span>
        )}
      </div>
      <div className="transfer-row-sub">
        <span>{verb}</span>
        <span>{formatBytes(record.bytes_done)} / {formatBytes(record.bytes_total || record.bytes_done)}</span>
      </div>
      <div className="transfer-progress-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      {record.error && <div className="transfer-error">{record.error}</div>}
    </div>
  );
}

function TransferIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className={active ? 'spinning-transfer' : ''}>
      <path d="M5 6.2 9 2.5l4 3.7M9 2.8v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 11.8 9 15.5l-4-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
    </svg>
  );
}

function loadHistory(): TransferRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isTransferRecord)
      .map((r): TransferRecord => r.state === 'running' ? { ...r, state: 'error', error: 'Interrupted' } : r)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(records: TransferRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch { /* storage may be unavailable */ }
}

function isTransferRecord(value: unknown): value is TransferRecord {
  const r = value as Partial<TransferRecord>;
  return Boolean(
    r &&
    typeof r.transfer_id === 'string' &&
    (r.direction === 'upload' || r.direction === 'download') &&
    typeof r.path === 'string' &&
    typeof r.bytes_done === 'number' &&
    typeof r.bytes_total === 'number' &&
    (r.state === 'running' || r.state === 'done' || r.state === 'error' || r.state === 'cancelled') &&
    typeof r.started_at === 'number' &&
    typeof r.updated_at === 'number',
  );
}

function lastPathPart(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
