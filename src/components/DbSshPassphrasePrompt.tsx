import { useEffect, useState } from 'react';
import type { DbConnection, Host } from '../types';

interface Props {
  connection: DbConnection;
  host: Host | null;
  onSubmit: (passphrase: string, saveToKeychain: boolean) => void;
  onCancel: () => void;
}

/**
 * Shown after a DB session open failed because the SSH key file is
 * encrypted and no passphrase was on hand. The user types the
 * passphrase here once; the caller retries the open with the new value
 * and (when the checkbox stays on) writes it to the host's keychain
 * entry so the next open is silent.
 */
export function DbSshPassphrasePrompt({ connection, host, onSubmit, onCancel }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [save, setSave] = useState(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const submit = () => onSubmit(passphrase, save);

  return (
    <div className="modal-backdrop" role="dialog" aria-label="ssh key passphrase">
      <div className="modal modal-form">
        <h2>SSH key passphrase</h2>
        <p className="form-hint">
          Connecting <strong>{connection.name}</strong> requires unlocking the SSH key
          {host ? <> for <code>{host.username}@{host.hostname}</code></> : null}.
        </p>
        <div className="form-grid">
          <label htmlFor="dbssh-pass">Passphrase</label>
          <input
            id="dbssh-pass"
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>
        <label className="checkbox" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {' '}Save passphrase to Keychain so this host opens silently next time
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit}>Unlock & Connect</button>
        </div>
      </div>
    </div>
  );
}
