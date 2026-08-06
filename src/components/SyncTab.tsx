import { useEffect, useState } from 'react';
import { useSyncStore } from '../state/syncStore';
import { debugLogPath } from '../lib/ipc';
import { KeyIcon, RefreshIcon } from './AppIcons';

function isNotConfigured(msg: string | null): boolean {
  return msg != null && msg.toLowerCase().includes('not configured');
}

function DiagnosticsCard() {
  const [logPath, setLogPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    void debugLogPath()
      .then((path) => { if (mounted) setLogPath(path); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const copyLogPath = async () => {
    if (!logPath) return;
    try {
      await navigator.clipboard.writeText(logPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // The path remains visible so it can still be copied manually.
    }
  };

  return (
    <div className="settings-section-card sync-debug-section">
      <div className="settings-section-head">
        <div>
          <div className="settings-section-title-row">
            <span className="settings-section-icon" aria-hidden><KeyIcon size={13} /></span>
            <h3>Diagnostics</h3>
          </div>
          <p className="sync-debug-description">
            If Windows sign-in or tab closing fails, send this log file to support.
            OAuth tokens are not written to it.
          </p>
        </div>
      </div>
      {logPath && <code className="sync-debug-path">{logPath}</code>}
      <div className="sync-debug-actions">
        <button type="button" onClick={() => void copyLogPath()} disabled={!logPath}>
          {copied ? 'Copied' : 'Copy log path'}
        </button>
      </div>
    </div>
  );
}

export function SyncTab() {
  const syncState = useSyncStore((s) => s.syncState);
  const signIn = useSyncStore((s) => s.signIn);
  const signOut = useSyncStore((s) => s.signOut);
  const pull = useSyncStore((s) => s.pull);
  const getKey = useSyncStore((s) => s.getKey);
  const setKey = useSyncStore((s) => s.setKey);
  const error = useSyncStore((s) => s.error);

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

  if (isNotConfigured(error)) {
    return (
      <div className="sync-tab">
        <div className="settings-section-card">
          <div className="settings-section-head">
            <div>
              <div className="settings-section-title-row">
                <span className="settings-section-icon" aria-hidden><RefreshIcon size={13} /></span>
                <h3>Cloud sync</h3>
              </div>
            </div>
          </div>
        </div>
        <DiagnosticsCard />
      </div>
    );
  }

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
        <DiagnosticsCard />
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

      <DiagnosticsCard />
    </div>
  );
}
