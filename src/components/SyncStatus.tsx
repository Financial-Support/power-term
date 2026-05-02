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

  // Only surface in-progress / error states. The "synced" check used to
  // sit permanently in the top-right and added visual noise without telling
  // the user anything actionable; the spinner / error icon are enough.
  if (status === 'idle' || status === 'synced') return null;

  return (
    <button
      type="button"
      className={`sync-status sync-status--${status}`}
      aria-label={status === 'error' ? 'sync error' : 'syncing'}
      onClick={status === 'error' ? onErrorClick : undefined}
      title={status === 'error' ? (syncState.error ?? 'Sync error') : 'Syncing with Supabase…'}
    >
      {status === 'syncing' && <span className="sync-spinner">↻</span>}
      {status === 'error' && <span>✕</span>}
    </button>
  );
}
