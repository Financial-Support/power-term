import { useEffect } from 'react';
import { useSyncStore } from '../state/syncStore';
import type { SyncStatusKind } from '../types';

interface Props {
  onErrorClick?: () => void;
}

export function SyncStatus({ onErrorClick }: Props) {
  const syncState = useSyncStore((s) => s.syncState);
  const listenForStateEvents = useSyncStore((s) => s._listenForStateEvents);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenForStateEvents().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [listenForStateEvents]);

  if (!syncState?.user) return null;

  const status: SyncStatusKind = syncState.status;

  if (status === 'idle') return null;

  return (
    <button
      type="button"
      className={`sync-status sync-status--${status}`}
      aria-label={status === 'error' ? 'sync error' : status === 'syncing' ? 'syncing' : 'synced'}
      onClick={status === 'error' ? onErrorClick : undefined}
      title={
        status === 'error' ? (syncState.error ?? 'Sync error')
        : status === 'syncing' ? 'Syncing with Supabase…'
        : 'All changes synced'
      }
    >
      {status === 'syncing' && <span className="sync-spinner">↻</span>}
      {status === 'synced' && <span>✓</span>}
      {status === 'error' && <span>✕</span>}
    </button>
  );
}
