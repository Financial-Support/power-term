import type { DbConnection } from '../types';
import { RefreshIcon } from './AppIcons';

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
        <div className="modal-title-row">
          <span className="modal-title-icon" aria-hidden><RefreshIcon size={14} /></span>
          <div className="modal-title-copy">
            <span className="modal-eyebrow">Database session</span>
            <div className="db-connecting-header">
              <span className={`db-engine-pill db-engine-${connection.engine}`}>
                {engineShort(connection.engine)}
              </span>
              <span className="db-connecting-name">{connection.name}</span>
            </div>
            <p className="form-title-meta">
              {connection.db_user ? `${connection.db_user}@` : ''}{connection.db_host}
              {connection.db_port ? `:${connection.db_port}` : ''}
              {connection.database ? ` / ${connection.database}` : ''}
            </p>
          </div>
        </div>
        <div className="db-connecting-body">
          <span className="db-spinner" aria-hidden />
          <span className="db-connecting-step">{step ?? 'Connecting…'}</span>
        </div>
        <p className="form-hint db-connecting-hint">
          {connection.engine === 'sqlite' ? 'Opening local SQLite file' : `Opening SSH tunnel and authenticating to ${engineLabel(connection.engine)}`}
          {connection.db_user ? <><span> as</span><code> {connection.db_user}</code></> : null}
          {connection.database ? <> on <code>{connection.database}</code></> : null}.
        </p>
      </div>
    </div>
  );
}

function engineShort(engine: string): string {
  switch (engine) {
    case 'mysql': return 'MY';
    case 'postgres': return 'PG';
    case 'sqlite': return 'SQ';
    case 'mssql': return 'MS';
    case 'redis': return 'RD';
    default: return engine.slice(0, 2).toUpperCase();
  }
}

function engineLabel(engine: string): string {
  switch (engine) {
    case 'mysql': return 'MySQL';
    case 'postgres': return 'PostgreSQL';
    case 'sqlite': return 'SQLite';
    case 'mssql': return 'MSSQL';
    case 'redis': return 'Redis';
    default: return engine;
  }
}
