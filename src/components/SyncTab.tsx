import { useEffect, useState } from 'react';
import { useSyncStore } from '../state/syncStore';
import { KeyIcon, RefreshIcon } from './AppIcons';

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
        <div className="settings-section-card">
          <div className="settings-section-head">
            <div>
              <div className="settings-section-title-row">
                <span className="settings-section-icon" aria-hidden><RefreshIcon size={13} /></span>
                <h3>Cloud sync</h3>
              </div>
              <p className="sync-tab-desc">Sign in to sync.</p>
            </div>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void signIn()}
            >
              Sign in with GitHub
            </button>
          </div>
        </div>
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
      <div className="settings-section-card">
        <div className="sync-row-between">
          <div className="sync-account">
            <div className="settings-section-title-row">
              <span className="settings-section-icon" aria-hidden><RefreshIcon size={13} /></span>
              <h3>Cloud sync</h3>
            </div>
            <div className="sync-user-email">{user.email ?? user.id}</div>
            {syncState.last_synced != null && (
              <div className="sync-last-synced">
                Last synced: {new Date(syncState.last_synced).toLocaleString()}
              </div>
            )}
          </div>
          <div className="sync-row-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void handlePull()}
              disabled={pulling}
            >
              {pulling ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {syncState.error && <p className="form-error">{syncState.error}</p>}

      <div className="settings-section-card sync-key-section">
        <div className="settings-section-head">
          <div>
            <div className="settings-section-title-row">
              <span className="settings-section-icon" aria-hidden><KeyIcon size={13} /></span>
              <h3>Sync key</h3>
            </div>
            <p className="sync-tab-desc">Encryption key</p>
          </div>
        </div>

        {hasKey ? (
          <div className="sync-key-display">
            <code>{keyVisible ? syncKey : '•'.repeat(20)}</code>
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
            No local key.
          </p>
        )}

        <div className="sync-key-input-block">
          <label htmlFor="sm-sync-key-input" className="sync-tab-sublabel">
            {hasKey ? 'Replace key' : 'Set key'}
          </label>
          <div className="sync-key-input-row">
            <input
              id="sm-sync-key-input"
              type="text"
              placeholder="Base58 sync key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void handleSetKey()}
              disabled={!keyInput.trim() || keyLoading}
            >
              Save
            </button>
          </div>
        </div>
        {keyError && <p className="form-error">{keyError}</p>}
      </div>
    </div>
  );
}
