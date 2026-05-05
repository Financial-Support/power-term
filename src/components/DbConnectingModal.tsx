import type { DbConnection } from '../types';

interface Props {
  connection: DbConnection;
  /** Optional one-line note about which step we're on. Defaults to the
   *  generic "Connecting…". */
  step?: string;
}

/**
 * Indeterminate progress modal shown while `db_session_open` is in
 * flight. SSH handshake + tunnel + DB auth can take several seconds on a
 * cold connection, and the password / passphrase prompts close as soon
 * as the user submits — without this the UI looks frozen.
 */
export function DbConnectingModal({ connection, step }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-label="connecting" aria-busy="true">
      <div className="modal db-connecting">
        <div className="db-connecting-header">
          <span className={`db-engine-pill db-engine-${connection.engine}`}>
            {connection.engine === 'mysql' ? 'MY' : 'PG'}
          </span>
          <span className="db-connecting-name">{connection.name}</span>
        </div>
        <div className="db-connecting-body">
          <span className="db-spinner" aria-hidden />
          <span className="db-connecting-step">{step ?? 'Connecting…'}</span>
        </div>
        <p className="form-hint" style={{ marginTop: 0 }}>
          Opening SSH tunnel and authenticating to {connection.engine === 'mysql' ? 'MySQL' : 'PostgreSQL'} as
          <code> {connection.db_user}</code>
          {connection.database ? <> on <code>{connection.database}</code></> : null}.
        </p>
      </div>
    </div>
  );
}
