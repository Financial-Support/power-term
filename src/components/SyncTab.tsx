import { useEffect, useState } from 'react';
import { useSyncStore } from '../state/syncStore';

export function SyncTab() {
  const syncState = useSyncStore((s) => s.syncState);
  const signIn = useSyncStore((s) => s.signIn);
  const signOut = useSyncStore((s) => s.signOut);
  const pull = useSyncStore((s) => s.pull);
  const getKey = useSyncStore((s) => s.getKey);
  const setKey = useSyncStore((s) => s.setKey);

  const [syncKey, setSyncKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    if (!syncState?.user) return;
    getKey().then(setSyncKey).catch(() => setSyncKey(''));
  }, [syncState?.user, getKey]);

  if (!syncState?.user) {
    return (
      <div className="sync-tab">
        <p className="sync-tab-desc">
          Sign in to sync your hosts, snippets, and settings across devices.
          Credentials are encrypted on your device before upload.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => void signIn()}
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  const user = syncState.user;
  const hasKey = syncKey.length > 0;

  const handleSetKey = async () => {
    if (!keyInput.trim()) return;
    setKeyError(null);
    setKeyLoading(true);
    try {
      await setKey(keyInput.trim());
      setSyncKey(keyInput.trim());
      setKeyInput('');
    } catch (e) {
      setKeyError(String(e));
    } finally {
      setKeyLoading(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    await pull();
    setPulling(false);
  };

  return (
    <div className="sync-tab">
      <div className="sync-user-row">
        <span className="sync-user-email">{user.email ?? user.id}</span>
        <button type="button" onClick={() => void signOut()} className="sync-sign-out">
          Sign out
        </button>
      </div>

      {syncState.last_synced != null && (
        <p className="sync-last-synced">
          Last synced: {new Date(syncState.last_synced).toLocaleString()}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handlePull()}
        disabled={pulling}
        className="sync-pull-btn"
      >
        {pulling ? 'Syncing…' : 'Sync now'}
      </button>

      {syncState.error && (
        <p className="form-error">{syncState.error}</p>
      )}

      <div className="sync-key-section">
        <h3>Sync key</h3>
        {hasKey ? (
          <div className="sync-key-display">
            <code>{keyVisible ? syncKey : '••••••••••••••••'}</code>
            <button type="button" onClick={() => setKeyVisible((v) => !v)}>
              {keyVisible ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(syncKey)}
            >
              Copy
            </button>
          </div>
        ) : (
          <p className="sync-key-notice">
            Credentials not available — enter sync key from another device.
          </p>
        )}

        <div className="sync-key-input-row">
          <input
            type="text"
            placeholder="Enter sync key from another device"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button
            type="button"
            onClick={() => void handleSetKey()}
            disabled={!keyInput.trim() || keyLoading}
          >
            Save key
          </button>
        </div>
        {keyError && <p className="form-error">{keyError}</p>}
      </div>
    </div>
  );
}
