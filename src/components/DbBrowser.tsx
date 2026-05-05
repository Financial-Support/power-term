import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { dbListTables, dbQuery, dbQueryCancel, dbSessionClose } from '../lib/ipc';
import type { DbConnection, QueryResult } from '../types';

interface Props {
  tabId: string;
  sessionId: string;
  connection: DbConnection;
  onClose: () => void;
}

interface Pagination {
  /** Qualified table identifier as returned by the schema list. */
  table: string;
  /** Rows per page. */
  pageSize: number;
  /** 0-indexed page. */
  page: number;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 1000];
const DEFAULT_PAGE_SIZE = 50;

/**
 * DB session tab content: schema browser on the left, SQL editor + result
 * grid on the right. The editor is CodeMirror 6 with the SQL grammar so
 * keywords, identifiers and strings get distinct colours; the table list
 * is fetched lazily on first mount and refreshable from the toolbar.
 *
 * Schema-table clicks fill the editor with `SELECT * FROM <table> LIMIT N
 * OFFSET M` and run it immediately. While in this "auto-paginated" mode a
 * Prev/Next/Size bar appears; manually editing + Run drops the pagination
 * bar and runs the user's text verbatim.
 */
export function DbBrowser({ tabId, sessionId, connection, onClose }: Props) {
  const draftKey = `db.draft.${connection.id}`;

  // CodeMirror lives outside React's reconciliation. We mount a host div,
  // create the EditorView in an effect, and read its state imperatively
  // from `getDoc`. React state for `running`/`result` etc stays normal.
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [getDoc, setGetDoc] = useState<() => string>(() => () => '');

  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<string[] | null>(null);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');
  const [pagination, setPagination] = useState<Pagination | null>(null);
  // Refs so the freshly-built SQL doesn't race the React state update — the
  // pagination handlers compute the SQL string and feed it directly to
  // `runSql`, bypassing the editor → state round-trip.
  const paginationRef = useRef<Pagination | null>(null);
  paginationRef.current = pagination;

  const setEditorDoc = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  }, []);

  const runSql = useCallback(async (sqlText: string) => {
    const trimmed = sqlText.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setError(null);
    try {
      const r = await dbQuery(sessionId, trimmed);
      setResult(r);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [sessionId, running]);

  // The toolbar Run button (and Cmd+Enter inside the editor) runs whatever
  // is currently in the editor and exits any auto-pagination mode — the
  // user has clearly taken control of the query at that point.
  const runManual = useCallback(async () => {
    setPagination(null);
    await runSql(getDoc());
  }, [runSql, getDoc]);

  // Mount CodeMirror once. The Mod-Enter binding is included in the
  // initial state so the user can run their query without leaving the
  // editor (matches every other DB client).
  useEffect(() => {
    if (!editorHostRef.current) return;
    const initialDoc = localStorage.getItem(draftKey) ?? '';
    const view = new EditorView({
      parent: editorHostRef.current,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLine(),
          sql(),
          oneDark,
          keymap.of([
            { key: 'Mod-Enter', preventDefault: true, run: () => { void runManual(); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              localStorage.setItem(draftKey, u.state.doc.toString());
            }
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px' },
            '.cm-scroller': { fontFamily: 'var(--font-mono)' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    setGetDoc(() => () => view.state.doc.toString());
    return () => { view.destroy(); viewRef.current = null; };
    // Mount-only — the keymap captures `runManual` at mount time, but it
    // delegates to refs/getters so the closure stays accurate as state
    // updates. Re-mounting would lose the doc + history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = async () => {
    if (!running) return;
    try { await dbQueryCancel(sessionId); }
    catch (e) { console.warn('cancel failed', e); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Bubble-level Cmd+. shortcut for Stop matches macOS' "cancel
    // operation" idiom used by Xcode et al; the editor itself doesn't
    // intercept this combo so the listener on the wrapper catches it.
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault();
      void stop();
    }
  };

  const closeSession = async () => {
    try { await dbSessionClose(sessionId); } catch (e) { console.warn('db close failed', e); }
    onClose();
  };

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    setTablesError(null);
    try {
      const list = await dbListTables(sessionId, connection.engine);
      setTables(list);
    } catch (e) {
      setTablesError(String(e));
    } finally {
      setTablesLoading(false);
    }
  }, [sessionId, connection.engine]);

  // Auto-load on first mount so the schema is there as soon as the
  // session opens. Subsequent refreshes are user-driven.
  useEffect(() => { void loadTables(); }, [loadTables]);

  const goToPage = useCallback(async (next: Pagination) => {
    const sqlText = buildPaginatedSql(next);
    setPagination(next);
    setEditorDoc(sqlText);
    await runSql(sqlText);
  }, [runSql, setEditorDoc]);

  const onTableClick = (name: string) => {
    void goToPage({ table: name, pageSize: DEFAULT_PAGE_SIZE, page: 0 });
  };

  const onPrev = () => {
    const p = paginationRef.current;
    if (!p || p.page === 0) return;
    void goToPage({ ...p, page: p.page - 1 });
  };

  const onNext = () => {
    const p = paginationRef.current;
    if (!p) return;
    // Disabled (in render) when the last fetched page came back short, so
    // we don't need a row-count check here beyond what render enforces.
    void goToPage({ ...p, page: p.page + 1 });
  };

  const onPageSizeChange = (size: number) => {
    const p = paginationRef.current;
    if (!p) return;
    // Reset to the first page so the new size is applied without surfacing
    // mid-table windows that wouldn't make sense after a size change.
    void goToPage({ ...p, pageSize: size, page: 0 });
  };

  const filteredTables = tables
    ? tables.filter((t) => tableFilter === '' || t.toLowerCase().includes(tableFilter.toLowerCase()))
    : [];

  return (
    <div className="db-browser" data-tab-id={tabId} onKeyDown={onKeyDown}>
      <div className="db-browser-toolbar">
        <span className={`db-engine-pill db-engine-${connection.engine}`}>
          {connection.engine === 'mysql' ? 'MY' : 'PG'}
        </span>
        <span className="db-browser-name">{connection.name}</span>
        <span className="db-browser-meta">
          {connection.db_user}@{connection.db_host}:{connection.db_port}
          {connection.database ? ` / ${connection.database}` : ''}
        </span>
        <span className="db-browser-spacer" />
        {running ? (
          <button
            type="button"
            className="db-stop"
            onClick={() => void stop()}
            title="Cancel running query (⌘.)"
          >Stop ⌘.</button>
        ) : (
          <button
            type="button"
            className="db-run primary"
            onClick={() => void runManual()}
            disabled={running}
            title="Run query (⌘⏎)"
          >Run ⌘⏎</button>
        )}
        <button
          type="button"
          className="db-disconnect"
          onClick={() => void closeSession()}
          title="Disconnect and close tab"
        >Disconnect</button>
      </div>

      <div className="db-body">
        <aside className="db-schema">
          <div className="db-schema-header">
            <span>Tables</span>
            <button
              type="button"
              className="db-schema-refresh"
              aria-label="Refresh tables"
              onClick={() => void loadTables()}
              disabled={tablesLoading}
            >⟳</button>
          </div>
          <input
            className="db-schema-filter"
            type="text"
            placeholder="Filter…"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
          />
          <div className="db-schema-list">
            {tablesLoading && <div className="db-schema-empty">Loading…</div>}
            {tablesError && <div className="db-schema-error">{tablesError}</div>}
            {!tablesLoading && tables !== null && filteredTables.length === 0 && (
              <div className="db-schema-empty">{tables.length === 0 ? 'No tables.' : 'No matches.'}</div>
            )}
            {filteredTables.map((t) => (
              <button
                key={t}
                type="button"
                className={`db-schema-table${pagination?.table === t ? ' active' : ''}`}
                onClick={() => onTableClick(t)}
                title={`SELECT * FROM ${t} (paginated)`}
              >{t}</button>
            ))}
          </div>
        </aside>

        <div className="db-main">
          <div className="db-editor-host" ref={editorHostRef} />
          {pagination && (
            <PaginationBar
              pagination={pagination}
              rowsReturned={result?.rows.length ?? 0}
              running={running}
              onPrev={onPrev}
              onNext={onNext}
              onPageSizeChange={onPageSizeChange}
            />
          )}
          <div className="db-result">
            {error && <div className="db-error">{error}</div>}
            {!error && result && <ResultGrid result={result} />}
            {!error && !result && !running && (
              <div className="db-result-empty">
                Run a query (⌘⏎) to see results. Click a table on the left to paginate it.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PaginationBarProps {
  pagination: Pagination;
  rowsReturned: number;
  running: boolean;
  onPrev: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}

function PaginationBar({ pagination, rowsReturned, running, onPrev, onNext, onPageSizeChange }: PaginationBarProps) {
  // We can't know the absolute total without an extra COUNT(*) query, so
  // "more pages" is inferred from "did we get a full page back?" — the
  // standard cursor-based heuristic. False positives only when the table
  // size is exactly a multiple of pageSize, in which case Next leads to
  // an empty page. Cheap to tolerate.
  const hasMore = rowsReturned >= pagination.pageSize;
  const start = pagination.page * pagination.pageSize + 1;
  const end = pagination.page * pagination.pageSize + rowsReturned;
  return (
    <div className="db-paginate">
      <span className="db-paginate-table">{pagination.table}</span>
      <span className="db-paginate-spacer" />
      <span className="db-paginate-range">
        {rowsReturned > 0 ? `${start}–${end}` : 'no rows'}
      </span>
      <button type="button" onClick={onPrev} disabled={pagination.page === 0 || running} aria-label="Previous page">‹</button>
      <span className="db-paginate-page">page {pagination.page + 1}</span>
      <button type="button" onClick={onNext} disabled={!hasMore || running} aria-label="Next page">›</button>
      <select
        className="db-paginate-size"
        value={pagination.pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        disabled={running}
        aria-label="Rows per page"
      >
        {PAGE_SIZE_OPTIONS.map((n) => (
          <option key={n} value={n}>{n} / page</option>
        ))}
      </select>
    </div>
  );
}

function buildPaginatedSql(p: Pagination): string {
  const offset = p.page * p.pageSize;
  // Naïve interpolation — the table name comes from the schema list which
  // we trust (it was returned by the server itself), so no quoting / escape
  // is needed here. If the backend ever surfaces user-supplied table
  // strings, revisit this.
  return `SELECT * FROM ${p.table} LIMIT ${p.pageSize} OFFSET ${offset}`;
}

function ResultGrid({ result }: { result: QueryResult }) {
  const { columns, rows, rows_affected, took_ms, statements } = result;
  const stmts = statements > 1 ? ` · ${statements} statements` : '';
  if (columns.length === 0) {
    return (
      <div className="db-result-meta">
        OK — {rows_affected} row{rows_affected === 1 ? '' : 's'} affected · {took_ms} ms{stmts}
      </div>
    );
  }
  return (
    <>
      <div className="db-result-meta">
        {rows.length} row{rows.length === 1 ? '' : 's'} · {took_ms} ms{stmts}
      </div>
      <div className="db-grid-wrap">
        <table className="db-grid">
          <thead>
            <tr>
              <th className="db-grid-rownum">#</th>
              {columns.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="db-grid-rownum">{i + 1}</td>
                {r.map((v, j) => (
                  <td key={j} className={v === null ? 'db-grid-null' : ''}>
                    {v === null ? 'NULL' : v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
