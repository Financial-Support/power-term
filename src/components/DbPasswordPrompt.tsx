import { useEffect, useState } from 'react';
import type { DbConnection } from '../types';

interface Props {
  connection: DbConnection;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * One-shot password prompt before opening a DB session. Passwords are not
 * persisted anywhere — once submitted they go straight to the backend
 * which forwards them to the engine driver and forgets them.
 */
export function DbPasswordPrompt({ connection, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const submit = () => onSubmit(password);

  return (
    <div className="modal-backdrop" role="dialog" aria-label="db password">
      <div className="modal modal-form">
        <h2>Connect to {connection.name}</h2>
        <p className="form-hint">
          {connection.engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} as <code>{connection.db_user}</code>
          {connection.database ? <> on <code>{connection.database}</code></> : null}.
        </p>
        <div className="form-grid">
          <label htmlFor="dbp-pass">Password</label>
          <input
            id="dbp-pass"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          />
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit}>Connect</button>
        </div>
      </div>
    </div>
  );
}
