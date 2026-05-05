import { useEffect, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import { secretGet } from '../lib/ipc';
import type { DbConnection, DbConnectionInput, DbEngine } from '../types';

interface Props {
  mode: 'create' | 'edit';
  connection?: DbConnection;
  /** Receives the validated input plus a side-channel password command:
   *  the form decided whether to write to / clear from the keychain, but
   *  it doesn't know the new connection's id on create, so the caller must
   *  apply the keychain mutation after the create returns. */
  onSave: (input: DbConnectionInput, password: PasswordIntent) => void;
  onCancel: () => void;
}

export type PasswordIntent =
  | { kind: 'set'; password: string }
  | { kind: 'forget' }
  | { kind: 'noop' };

const KEY_PREFIX = 'db:';
export const dbSecretKey = (id: string) => `${KEY_PREFIX}${id}`;

const DEFAULT_PORTS: Record<DbEngine, number> = { mysql: 3306, postgres: 5432 };

export function DbConnectionFormModal({ mode, connection, onSave, onCancel }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const [name, setName] = useState(connection?.name ?? '');
  const [hostId, setHostId] = useState(connection?.host_id ?? hosts[0]?.id ?? '');
  const [engine, setEngine] = useState<DbEngine>(connection?.engine ?? 'postgres');
  const [dbHost, setDbHost] = useState(connection?.db_host ?? '127.0.0.1');
  const [dbPort, setDbPort] = useState<number>(connection?.db_port ?? DEFAULT_PORTS.postgres);
  const [database, setDatabase] = useState(connection?.database ?? '');
  const [dbUser, setDbUser] = useState(connection?.db_user ?? '');
  const [portTouched, setPortTouched] = useState(mode === 'edit');
  const [password, setPassword] = useState('');
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [savePassword, setSavePassword] = useState(true);
  const [savePasswordDirty, setSavePasswordDirty] = useState(false);
  const [hasStored, setHasStored] = useState(false);

  // On edit, prefill the "saved" indicator if the keychain already has a
  // password for this connection. We never read the password back into the
  // form — only check existence — so the field stays empty until the user
  // chooses to overwrite it.
  useEffect(() => {
    if (mode !== 'edit' || !connection) return;
    void (async () => {
      try {
        const existing = await secretGet(dbSecretKey(connection.id));
        setHasStored(existing !== null);
      } catch { /* ignore — keychain may be unavailable */ }
    })();
  }, [mode, connection]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Auto-fill default port when engine changes if user hasn't touched it.
  useEffect(() => {
    if (!portTouched) setDbPort(DEFAULT_PORTS[engine]);
  }, [engine, portTouched]);

  const portValid = Number.isInteger(dbPort) && dbPort >= 1 && dbPort <= 65535;
  const valid =
    name.trim() !== '' &&
    hostId !== '' &&
    dbHost.trim() !== '' &&
    dbUser.trim() !== '' &&
    portValid;

  const submit = () => {
    if (!valid) return;
    const wantsSet = passwordDirty && password !== '' && savePassword;
    const wantsForget =
      // User unchecked the save-to-keychain box AND there's something to forget,
      // OR they typed a new password without saving it (cleans up stale state).
      (savePasswordDirty && !savePassword && (hasStored || passwordDirty)) ||
      (passwordDirty && password === '' && hasStored);
    let intent: PasswordIntent = { kind: 'noop' };
    if (wantsSet) intent = { kind: 'set', password };
    else if (wantsForget) intent = { kind: 'forget' };
    onSave(
      {
        host_id: hostId,
        name: name.trim(),
        engine,
        db_host: dbHost.trim(),
        db_port: dbPort,
        database: database.trim(),
        db_user: dbUser.trim(),
      },
      intent,
    );
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="db connection form">
      <div className="modal modal-form">
        <h2>{mode === 'create' ? 'Add database connection' : 'Edit database connection'}</h2>
        <div className="form-grid">
          <label htmlFor="dbf-name">Name</label>
          <input id="dbf-name" value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="dbf-host">SSH host</label>
          <select id="dbf-host" value={hostId} onChange={(e) => setHostId(e.target.value)}>
            <option value="" disabled>Select host…</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>{h.name} ({h.username}@{h.hostname}:{h.port})</option>
            ))}
          </select>

          <label htmlFor="dbf-engine">Engine</label>
          <select
            id="dbf-engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value as DbEngine)}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>

          <label htmlFor="dbf-dbhost">DB host (from remote)</label>
          <input
            id="dbf-dbhost"
            value={dbHost}
            onChange={(e) => setDbHost(e.target.value)}
            placeholder="127.0.0.1"
          />

          <label htmlFor="dbf-port">DB port</label>
          <input
            id="dbf-port"
            type="number"
            min={1}
            max={65535}
            value={dbPort}
            onChange={(e) => { setPortTouched(true); setDbPort(Number(e.target.value)); }}
          />

          <label htmlFor="dbf-database">Database</label>
          <input id="dbf-database" value={database} onChange={(e) => setDatabase(e.target.value)} />

          <label htmlFor="dbf-user">DB user</label>
          <input id="dbf-user" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />

          <label htmlFor="dbf-pass">Password</label>
          <input
            id="dbf-pass"
            type="password"
            value={password}
            placeholder={hasStored && !passwordDirty ? '••• stored in Keychain' : ''}
            onChange={(e) => { setPassword(e.target.value); setPasswordDirty(true); }}
          />
        </div>

        <label className="checkbox" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={savePassword}
            onChange={(e) => { setSavePassword(e.target.checked); setSavePasswordDirty(true); }}
          /> Save password to Keychain
        </label>

        <p className="form-hint">
          The DB host is resolved on the remote side, so use 127.0.0.1 for a DB
          running on the SSH host itself. Password is stored in the OS Keychain
          when the box above is checked.
        </p>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!valid}>Save</button>
        </div>
      </div>
    </div>
  );
}
