import { useEffect } from 'react';
import { useSyncStore } from '../state/syncStore';

interface Props {
  onErrorClick?: () => void;
  onClick?: () => void;
}

/** Top-right indicator of the sync session. The behaviour depends on state:
 * - signed out → render nothing
 * - syncing    → spinner
 * - error      → red ✕ that opens sync settings
 * - idle/synced → subtle avatar pill (email initial) so the user can see at a
 *   glance which account this app is signed into without us having to lay out
 *   a full account chip in the title bar. */
export function SyncStatus({ onErrorClick, onClick }: Props) {
  const syncState = useSyncStore((s) => s.syncState);
  const listenForStateEvents = useSyncStore((s) => s._listenForStateEvents);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listenForStateEvents().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [listenForStateEvents]);

  if (!syncState?.user) return null;
  const { status, user } = syncState;

  if (status === 'syncing') {
    return (
      <button
        type="button"
        className="sync-status sync-status--syncing"
        aria-label="syncing"
        title="Syncing with Supabase…"
      >
        <span className="sync-spinner">↻</span>
      </button>
    );
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        className="sync-status sync-status--error"
        aria-label="sync error"
        title={syncState.error ?? 'Sync error'}
        onClick={onErrorClick}
      >
        ✕
      </button>
    );
  }
  // idle / synced — show signed-in avatar.
  const initial = (user.email ?? '?').charAt(0).toUpperCase();
  return (
    <button
      type="button"
      className="sync-status sync-status--user"
      aria-label={user.email ? `Signed in as ${user.email}` : 'Signed in'}
      title={user.email ?? 'Signed in'}
      onClick={onClick}
    >
      {initial}
    </button>
  );
}
