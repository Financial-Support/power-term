import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  dbDeleteRow,
  dbDescribeTable,
  dbExecuteSchema,
  dbInsertRow,
  dbListTables,
  dbListDatabases,
  dbSwitchDatabase,
  dbQuery,
  dbQueryCancel,
  dbSessionClose,
  dbExportDump,
  dbUpdateRow,
} from '../lib/ipc';
import { readTextFile, writeTextFile } from '../lib/ipc';
import { pickLocalFile, pickLocalSavePath } from '../lib/dialog';
import type { DbCell, DbColumn, DbConnection, QueryResult, TableMeta } from '../types';

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

type DbBrowserView = 'data' | 'structure' | 'indexes';
type DirtyCells = Record<string, string | null>;

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
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [currentDatabase, setCurrentDatabase] = useState(connection.database || '');
  const [switchingDb, setSwitchingDb] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'options' | 'running'>('idle');
  const [exportIncludeData, setExportIncludeData] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [tableMeta, setTableMeta] = useState<TableMeta | null>(null);
  const [view, setView] = useState<DbBrowserView>('data');
  const [dirtyCells, setDirtyCells] = useState<DirtyCells>({});
  const [editing, setEditing] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertValues, setInsertValues] = useState<Record<string, string>>({});
  const [insertError, setInsertError] = useState<string | null>(null);
  const [schemaSql, setSchemaSql] = useState<string | null>(null);
  const [schemaBusy, setSchemaBusy] = useState(false);
  const [deleteRowConfirm, setDeleteRowConfirm] = useState<(string | null)[] | null>(null);
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
    setActiveTable(null);
    setTableMeta(null);
    setDirtyCells({});
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

  const handleExportClick = () => {
    setExportState('options');
  };

  const handleExportStart = async () => {
    setExportState('idle');
    const path = await pickLocalSavePath(`${connection.name}-dump.sql`);
    if (!path) return;
    setExportState('running');
    setExportError(null);
    try {
      const sql = await dbExportDump(sessionId, exportIncludeData);
      await writeTextFile(path, sql);
      setExportState('idle');
    } catch (e) {
      setExportError(String(e));
    }
  };

  const handleImportSelect = async () => {
    const path = await pickLocalFile();
    if (path) {
      setImportPath(path);
      setImportConfirm(true);
    }
  };

  const handleImportConfirm = async () => {
    if (!importPath) return;
    setImportConfirm(false);
    setImporting(true);
    try {
      const sql = await readTextFile(importPath);
      setError(null);
      const r = await dbQuery(sessionId, sql);
      setResult(r);
      void loadTables();
    } catch (e) {
      setError(`Import failed: ${e}`);
    } finally {
      setImporting(false);
      setImportPath(null);
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

  const loadDatabases = useCallback(async () => {
    if (connection.engine === 'sqlite') {
      setDatabases(['main']);
      setCurrentDatabase('main');
      return;
    }
    setDatabasesLoading(true);
    try {
      const list = await dbListDatabases(sessionId, connection.engine);
      setDatabases(list);
      // If connection already had a database and it's in the list, keep it.
      // Otherwise pick the first available database.
      if (connection.database && list.includes(connection.database)) {
        setCurrentDatabase(connection.database);
      } else if (!currentDatabase && list.length > 0) {
        setCurrentDatabase(list[0]);
      }
    } catch { /* ignore */ }
    finally { setDatabasesLoading(false); }
  }, [sessionId, connection.engine, connection.database]);

  const switchDb = useCallback(async (db: string) => {
    if (db === currentDatabase) return;
    setSwitchingDb(true);
    setTables(null);
    setTablesError(null);
    try {
      await dbSwitchDatabase(sessionId, db);
      setCurrentDatabase(db);
      // Automatically reload tables after switching.
      const list = await dbListTables(sessionId, connection.engine);
      setTables(list);
    } catch (e) {
      setTablesError(String(e));
    } finally {
      setSwitchingDb(false);
    }
  }, [sessionId, connection.engine, currentDatabase]);

  // Auto-load databases on first mount, then tables if a database is already set.
  useEffect(() => {
    void (async () => {
      await loadDatabases();
    })();
  }, [loadDatabases]);

  useEffect(() => {
    if (currentDatabase) {
      const load = async () => {
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
      };
      void load();
    }
  }, [sessionId, connection.engine, currentDatabase]);

  const goToPage = useCallback(async (next: Pagination) => {
    const sqlText = connection.engine === 'redis' ? `GET ${next.table}` : buildPaginatedSql(next, connection.engine);
    setPagination(next);
    setActiveTable(next.table);
    setView('data');
    setDirtyCells({});
    setEditorDoc(sqlText);
    try {
      setTableMeta(await dbDescribeTable(sessionId, next.table));
    } catch (e) {
      setTableMeta(null);
      setError(String(e));
    }
    await runSql(sqlText);
  }, [connection.engine, runSql, setEditorDoc, sessionId]);

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

  const keyForRow = useCallback((row: (string | null)[]): DbCell[] => {
    if (!tableMeta || !result) return [];
    return tableMeta.primary_key.map((column) => {
      const idx = result.columns.indexOf(column);
      return { column, value: idx >= 0 ? row[idx] : null };
    });
  }, [result, tableMeta]);

  const saveDirtyRows = useCallback(async () => {
    if (!activeTable || !tableMeta || !result || tableMeta.primary_key.length === 0) return;
    const byRow = new Map<number, DbCell[]>();
    for (const [cellKey, value] of Object.entries(dirtyCells)) {
      const [rowRaw, colRaw] = cellKey.split(':');
      const rowIndex = Number(rowRaw);
      if (!Number.isInteger(rowIndex)) continue;
      const column = result.columns[Number(colRaw)];
      if (!column || tableMeta.primary_key.includes(column)) continue;
      const next = byRow.get(rowIndex) ?? [];
      next.push({ column, value });
      byRow.set(rowIndex, next);
    }
    if (byRow.size === 0) return;
    setEditing(true);
    setError(null);
    try {
      for (const [rowIndex, changes] of byRow) {
        const row = result.rows[rowIndex];
        if (!row) continue;
        await dbUpdateRow(sessionId, activeTable, keyForRow(row), changes);
      }
      setDirtyCells({});
      if (pagination) await goToPage(pagination);
    } catch (e) {
      setError(String(e));
    } finally {
      setEditing(false);
    }
  }, [activeTable, dirtyCells, goToPage, keyForRow, pagination, result, sessionId, tableMeta]);

  const deleteResultRow = useCallback(async (row: (string | null)[]) => {
    if (!activeTable || !tableMeta || tableMeta.primary_key.length === 0) return;
    setEditing(true);
    setError(null);
    try {
      await dbDeleteRow(sessionId, activeTable, keyForRow(row));
      setDeleteRowConfirm(null);
      if (pagination) await goToPage(pagination);
    } catch (e) {
      setError(String(e));
    } finally {
      setEditing(false);
    }
  }, [activeTable, goToPage, keyForRow, pagination, sessionId, tableMeta]);

  const openInsert = useCallback(() => {
    if (!tableMeta) return;
    const initial: Record<string, string> = {};
    for (const c of tableMeta.columns) initial[c.name] = '';
    setInsertValues(initial);
    setInsertError(null);
    setInsertOpen(true);
  }, [tableMeta]);

  const submitInsert = useCallback(async () => {
    if (!activeTable || !tableMeta) return;
    setInsertError(null);
    const values = tableMeta.columns
      .filter((c) => insertValues[c.name] !== '')
      .map((c) => ({ column: c.name, value: insertValues[c.name] === '<NULL>' ? null : insertValues[c.name] }));
    if (values.length === 0) {
      setInsertError('Enter at least one value, or cancel the insert.');
      return;
    }
    setEditing(true);
    setError(null);
    try {
      await dbInsertRow(sessionId, activeTable, values);
      setInsertOpen(false);
      setInsertError(null);
      if (pagination) await goToPage(pagination);
    } catch (e) {
      setInsertError(String(e));
    } finally {
      setEditing(false);
    }
  }, [activeTable, goToPage, insertValues, pagination, sessionId, tableMeta]);

  const runSchemaSql = useCallback(async () => {
    if (!schemaSql) return;
    setSchemaBusy(true);
    setError(null);
    try {
      await dbExecuteSchema(sessionId, schemaSql);
      setSchemaSql(null);
      if (activeTable) {
        setTableMeta(await dbDescribeTable(sessionId, activeTable));
        await loadTables();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSchemaBusy(false);
    }
  }, [activeTable, loadTables, schemaSql, sessionId]);

  const filteredTables = tables
    ? tables.filter((t) => tableFilter === '' || t.toLowerCase().includes(tableFilter.toLowerCase()))
    : [];

  return (
    <div className="db-browser" data-tab-id={tabId} onKeyDown={onKeyDown}>
      <div className="db-browser-toolbar">
        <div className="db-connection-summary">
          <span className={`db-engine-pill db-engine-${connection.engine}`}>
            {engineShort(connection.engine)}
          </span>
          <div className="db-connection-text">
            <span className="db-browser-name">{connection.name}</span>
            <span className="db-browser-meta">
              {connection.db_user}@{connection.db_host}:{connection.db_port}
              {connection.database ? ` / ${connection.database}` : ''}
            </span>
          </div>
        </div>
        <div className="db-browser-actions">
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
          <button
            type="button"
            className="db-export"
            onClick={() => void handleExportClick()}
            disabled={exportState !== 'idle'}
            title="Export database as SQL dump"
          >Export</button>
          <button
            type="button"
            className="db-import"
            onClick={() => void handleImportSelect()}
            disabled={importing}
            title="Import SQL file"
          >{importing ? 'Importing…' : 'Import'}</button>
        </div>
      </div>

      {importConfirm && (
        <div className="modal-backdrop" role="dialog" aria-label="import confirmation">
          <div className="modal modal-warning">
            <h2>⚠ Import SQL file</h2>
            <p>
              This will execute all SQL statements from the selected file.
              Make sure you have a backup before proceeding.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => { setImportConfirm(false); setImportPath(null); }}>Cancel</button>
              <button type="button" className="danger" onClick={() => void handleImportConfirm()}>Import</button>
            </div>
          </div>
        </div>
      )}

      {exportState === 'options' && (
        <div className="modal-backdrop" role="dialog" aria-label="export options">
          <div className="modal">
            <h2>Export SQL Dump</h2>
            <p>Choose what to include in the dump:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="export-mode"
                  checked={!exportIncludeData}
                  onChange={() => setExportIncludeData(false)}
                />
                Structure only (CREATE TABLE)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="radio"
                  name="export-mode"
                  checked={exportIncludeData}
                  onChange={() => setExportIncludeData(true)}
                />
                Structure + Data (CREATE TABLE + INSERT)
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setExportState('idle')}>Cancel</button>
              <button type="button" className="primary" onClick={() => void handleExportStart()}>Next</button>
            </div>
          </div>
        </div>
      )}

      {exportState === 'running' && (
        <div className="modal-backdrop" role="dialog" aria-label="exporting">
          <div className="modal" style={{ textAlign: 'center' }}>
            {exportError ? (
              <>
                <h2>Export Failed</h2>
                <p className="error">{exportError}</p>
                <div className="modal-actions">
                  <button type="button" onClick={() => { setExportState('idle'); setExportError(null); }}>Close</button>
                </div>
              </>
            ) : (
              <>
                <h2>Exporting…</h2>
                <p>Generating SQL dump, please wait.</p>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
                  <span className="db-spinner" />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="db-body">
        <aside className="db-schema">
          <div className="db-schema-block">
            <div className="db-schema-header">
              <span>Database</span>
            </div>
            <select
              className="db-schema-select"
              value={currentDatabase}
              onChange={(e) => { void switchDb(e.target.value); }}
              disabled={switchingDb || databasesLoading || databases === null || databases.length === 0}
            >
              {!currentDatabase && <option value="">Select database…</option>}
              {(databases ?? []).map((db) => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>
          <div className="db-schema-block grow">
            <div className="db-schema-header">
              <span>Tables</span>
              <span className="db-schema-count">{filteredTables.length}</span>
              <button
                type="button"
                className="db-schema-refresh"
                aria-label="Refresh tables"
                onClick={() => void loadTables()}
                disabled={tablesLoading || switchingDb}
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
          </div>
        </aside>

        <div className="db-main">
          {activeTable && tableMeta && (
            <div className="db-table-toolbar">
              <div className="db-table-tabs" role="tablist" aria-label="table view">
                <button type="button" className={view === 'data' ? 'active' : ''} onClick={() => setView('data')}>Data</button>
                {connection.engine !== 'redis' && (
                  <>
                    <button type="button" className={view === 'structure' ? 'active' : ''} onClick={() => setView('structure')}>Structure</button>
                    <button type="button" className={view === 'indexes' ? 'active' : ''} onClick={() => setView('indexes')}>Indexes</button>
                  </>
                )}
              </div>
              <span className="db-table-current">{activeTable}</span>
              {view === 'data' && connection.engine !== 'redis' && (
                <div className="db-table-actions">
                  <button type="button" onClick={openInsert} disabled={editing}>Insert row</button>
                  <button type="button" className="primary" onClick={() => void saveDirtyRows()} disabled={editing || Object.keys(dirtyCells).length === 0}>
                    {editing ? 'Saving…' : Object.keys(dirtyCells).length ? `Save ${Object.keys(dirtyCells).length}` : 'Save'}
                  </button>
                  <button type="button" onClick={() => setDirtyCells({})} disabled={editing || Object.keys(dirtyCells).length === 0}>Revert</button>
                </div>
              )}
            </div>
          )}

          <div className="db-editor-host" ref={editorHostRef} style={{ display: view === 'data' ? undefined : 'none' }} />
          {view === 'data' && (
            <>
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
                {!error && result && (
                  <ResultGrid
                    result={result}
                    meta={activeTable && tableMeta ? tableMeta : null}
                    dirtyCells={dirtyCells}
                    onCellChange={(row, col, value) => setDirtyCells((m) => ({ ...m, [`${row}:${col}`]: value }))}
                    onDeleteRow={(row) => setDeleteRowConfirm(row)}
                    editing={editing}
                  />
                )}
                {!error && !result && !running && (
                  <div className="db-result-empty">
                    Run a query (⌘⏎) to see results. Click a table on the left to paginate it.
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'structure' && tableMeta && connection.engine !== 'redis' && (
            <StructurePanel
              meta={tableMeta}
              engine={connection.engine}
              onPreview={setSchemaSql}
            />
          )}

          {view === 'indexes' && tableMeta && connection.engine !== 'redis' && (
            <IndexesPanel
              meta={tableMeta}
              engine={connection.engine}
              onPreview={setSchemaSql}
            />
          )}

          {insertOpen && tableMeta && (
            <div className="modal-backdrop" role="dialog" aria-label="insert row">
              <div className="modal modal-form">
                <h2>Insert row</h2>
                <div className="db-insert-grid">
                  {tableMeta.columns.map((c) => (
                    <label key={c.name} className="db-insert-field">
                      <span className="db-insert-label">{c.name}</span>
                      <input
                        value={insertValues[c.name] ?? ''}
                        placeholder={c.default_value ? `default: ${c.default_value}` : c.nullable ? '<NULL>' : c.data_type}
                        onChange={(e) => setInsertValues((m) => ({ ...m, [c.name]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <p className="form-hint">Leave a field empty to let the database default apply. Type &lt;NULL&gt; to insert SQL NULL.</p>
                {insertError && <div className="db-insert-error">{insertError}</div>}
                <div className="modal-actions">
                  <button type="button" onClick={() => { setInsertOpen(false); setInsertError(null); }} disabled={editing}>Cancel</button>
                  <button type="button" className="primary" onClick={() => void submitInsert()} disabled={editing}>Insert</button>
                </div>
              </div>
            </div>
          )}

          {deleteRowConfirm && activeTable && tableMeta && (
            <div className="modal-backdrop" role="dialog" aria-label="confirm delete row">
              <div className="modal modal-warning">
                <h2>Delete row</h2>
                <p>
                  Delete this row from <code>{activeTable}</code>? This cannot be undone.
                </p>
                <dl className="db-delete-row-preview">
                  {keyForRow(deleteRowConfirm).map((cell) => (
                    <div key={cell.column}>
                      <dt>{cell.column}</dt>
                      <dd>{cell.value ?? 'NULL'}</dd>
                    </div>
                  ))}
                </dl>
                <div className="modal-actions">
                  <button type="button" onClick={() => setDeleteRowConfirm(null)} disabled={editing}>Cancel</button>
                  <button type="button" className="danger" onClick={() => void deleteResultRow(deleteRowConfirm)} disabled={editing}>
                    {editing ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {schemaSql && (
            <div className="modal-backdrop" role="dialog" aria-label="confirm schema change">
              <div className="modal modal-warning">
                <h2>Confirm schema change</h2>
                <p>This will run the SQL below against the live database.</p>
                <pre className="db-schema-preview"><code>{schemaSql}</code></pre>
                <div className="modal-actions">
                  <button type="button" onClick={() => setSchemaSql(null)} disabled={schemaBusy}>Cancel</button>
                  <button type="button" className="danger" onClick={() => void runSchemaSql()} disabled={schemaBusy}>
                    {schemaBusy ? 'Running…' : 'Run SQL'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {view !== 'data' && error && <div className="db-error">{error}</div>}
          {view !== 'data' && !tableMeta && (
            <div className="db-result-empty">Select a table to inspect or edit its schema.</div>
          )}
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

function buildPaginatedSql(p: Pagination, engine: DbConnection['engine']): string {
  const offset = p.page * p.pageSize;
  if (engine === 'mssql') {
    return `SELECT * FROM ${p.table} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${p.pageSize} ROWS ONLY`;
  }
  // Naïve interpolation — the table name comes from the schema list which
  // we trust (it was returned by the server itself), so no quoting / escape
  // is needed here. If the backend ever surfaces user-supplied table
  // strings, revisit this.
  return `SELECT * FROM ${p.table} LIMIT ${p.pageSize} OFFSET ${offset}`;
}

function ResultGrid({
  result,
  meta,
  dirtyCells,
  onCellChange,
  onDeleteRow,
  editing,
}: {
  result: QueryResult;
  meta: TableMeta | null;
  dirtyCells: DirtyCells;
  onCellChange: (row: number, col: number, value: string | null) => void;
  onDeleteRow: (row: (string | null)[]) => void;
  editing: boolean;
}) {
  const { columns, rows, rows_affected, took_ms, statements } = result;
  const stmts = statements > 1 ? ` · ${statements} statements` : '';
  const pk = new Set(meta?.primary_key ?? []);
  const editable = Boolean(meta && meta.primary_key.length > 0);
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
              {columns.map((c) => <th key={c}>{c}{pk.has(c) ? ' *' : ''}</th>)}
              {meta && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="db-grid-rownum">{i + 1}</td>
                {r.map((v, j) => {
                  const dirtyKey = `${i}:${j}`;
                  const isDirty = Object.prototype.hasOwnProperty.call(dirtyCells, dirtyKey);
                  const display = isDirty ? dirtyCells[dirtyKey] : v;
                  const readOnly = !editable || pk.has(columns[j]);
                  return (
                  <td key={j} className={`${display === null ? 'db-grid-null' : ''}${isDirty ? ' dirty' : ''}${readOnly ? '' : ' editable'}`}>
                    {readOnly ? (
                      display === null ? 'NULL' : display
                    ) : (
                      <input
                        className="db-cell-input"
                        value={display ?? ''}
                        placeholder={v === null ? 'NULL' : undefined}
                        disabled={editing}
                        onChange={(e) => onCellChange(i, j, e.target.value === '<NULL>' ? null : e.target.value)}
                        onBlur={(e) => {
                          if (e.target.value === '') onCellChange(i, j, '');
                        }}
                      />
                    )}
                  </td>
                  );
                })}
                {meta && (
                  <td>
                    <button type="button" className="danger" disabled={!editable || editing} onClick={() => onDeleteRow(r)}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StructurePanel({
  meta,
  engine,
  onPreview,
}: {
  meta: TableMeta;
  engine: DbConnection['engine'];
  onPreview: (sql: string) => void;
}) {
  const qTable = quoteTable(meta.table, engine);
  const addColumn = () => {
    const name = prompt('Column name');
    if (!name) return;
    const type = prompt('Column type', engine === 'mysql' ? 'varchar(255)' : 'text');
    if (!type) return;
    const nullable = confirm('Allow NULL values?');
    const def = prompt('Default value SQL expression (blank for none)', '');
    const columnSql = `${quoteIdent(name, engine)} ${type}${nullable ? '' : ' NOT NULL'}${def ? ` DEFAULT ${def}` : ''}`;
    onPreview(engine === 'mssql'
      ? `ALTER TABLE ${qTable} ADD ${columnSql};`
      : `ALTER TABLE ${qTable} ADD COLUMN ${columnSql};`);
  };
  const renameTable = () => {
    const next = prompt('New table name', lastIdent(meta.table));
    if (!next) return;
    if (engine === 'postgres') onPreview(`ALTER TABLE ${qTable} RENAME TO ${quoteIdent(next, engine)};`);
    else if (engine === 'mssql') onPreview(`EXEC sp_rename ${sqlStringLiteral(meta.table, true)}, ${sqlStringLiteral(next, true)}, 'OBJECT';`);
    else onPreview(`RENAME TABLE ${qTable} TO ${quoteIdent(next, engine)};`);
  };
  const dropTable = () => {
    if (!confirm(`Drop table ${meta.table}? This can destroy data.`)) return;
    onPreview(`DROP TABLE ${qTable};`);
  };
  return (
    <div className="db-structure">
      <div className="db-structure-actions">
        <button type="button" onClick={addColumn}>Add column</button>
        <button type="button" onClick={renameTable}>Rename table</button>
        <button type="button" className="danger" onClick={dropTable}>Drop table</button>
      </div>
      <table className="db-grid">
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>PK</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {meta.columns.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.data_type}</td>
              <td>{c.nullable ? 'YES' : 'NO'}</td>
              <td>{c.default_value ?? ''}</td>
              <td>{c.primary_key ? 'YES' : ''}</td>
              <td>
                <ColumnActions column={c} table={meta.table} engine={engine} onPreview={onPreview} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnActions({
  column,
  table,
  engine,
  onPreview,
}: {
  column: DbColumn;
  table: string;
  engine: DbConnection['engine'];
  onPreview: (sql: string) => void;
}) {
  const qTable = quoteTable(table, engine);
  const qCol = quoteIdent(column.name, engine);
  const rename = () => {
    const next = prompt('New column name', column.name);
    if (!next || next === column.name) return;
    if (engine === 'mssql') {
      onPreview(`EXEC sp_rename ${sqlStringLiteral(`${table}.${column.name}`, true)}, ${sqlStringLiteral(next, true)}, 'COLUMN';`);
      return;
    }
    onPreview(`ALTER TABLE ${qTable} RENAME COLUMN ${qCol} TO ${quoteIdent(next, engine)};`);
  };
  const setDefault = () => {
    const def = prompt('Default value SQL expression (blank to drop default)', column.default_value ?? '');
    if (def === null) return;
    if (engine === 'postgres') {
      onPreview(def ? `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET DEFAULT ${def};` : `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} DROP DEFAULT;`);
    } else if (engine === 'mssql') {
      const dropDefault = mssqlDropDefaultSql(table, column.name, engine);
      if (!def) {
        onPreview(dropDefault);
        return;
      }
      const constraintName = `df_${lastIdent(table)}_${column.name}`;
      onPreview(`${dropDefault}\nALTER TABLE ${qTable} ADD CONSTRAINT ${quoteIdent(constraintName, engine)} DEFAULT ${def} FOR ${qCol};`);
    } else {
      onPreview(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET DEFAULT ${def || 'NULL'};`);
    }
  };
  const toggleNull = () => {
    if (engine === 'postgres') {
      onPreview(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} ${column.nullable ? 'SET NOT NULL' : 'DROP NOT NULL'};`);
      return;
    }
    const nullable = column.nullable ? 'NOT NULL' : 'NULL';
    onPreview(engine === 'mssql'
      ? `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} ${column.data_type} ${nullable};`
      : `ALTER TABLE ${qTable} MODIFY COLUMN ${qCol} ${column.data_type} ${nullable};`);
  };
  const drop = () => {
    if (!confirm(`Drop column ${column.name}? This can destroy data.`)) return;
    onPreview(`ALTER TABLE ${qTable} DROP COLUMN ${qCol};`);
  };
  return (
    <div className="db-row-actions">
      <button type="button" onClick={rename}>Rename</button>
      <button type="button" onClick={toggleNull}>{column.nullable ? 'Set NOT NULL' : 'Allow NULL'}</button>
      <button type="button" onClick={setDefault}>Default</button>
      <button type="button" className="danger" onClick={drop}>Drop</button>
    </div>
  );
}

function IndexesPanel({
  meta,
  engine,
  onPreview,
}: {
  meta: TableMeta;
  engine: DbConnection['engine'];
  onPreview: (sql: string) => void;
}) {
  const qTable = quoteTable(meta.table, engine);
  const createIndex = () => {
    const colsRaw = prompt('Columns, comma separated');
    if (!colsRaw) return;
    const cols = colsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (cols.length === 0) return;
    const name = prompt('Index name', `idx_${lastIdent(meta.table)}_${cols.join('_')}`);
    if (!name) return;
    const unique = confirm('Create UNIQUE index?');
    onPreview(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(name, engine)} ON ${qTable} (${cols.map((c) => quoteIdent(c, engine)).join(', ')});`);
  };
  return (
    <div className="db-structure">
      <div className="db-structure-actions">
        <button type="button" onClick={createIndex}>Create index</button>
      </div>
      <table className="db-grid">
        <thead><tr><th>Name</th><th>Columns</th><th>Unique</th><th>Primary</th><th>Actions</th></tr></thead>
        <tbody>
          {meta.indexes.map((idx) => (
            <tr key={idx.name}>
              <td>{idx.name}</td>
              <td>{idx.columns.join(', ')}</td>
              <td>{idx.unique ? 'YES' : 'NO'}</td>
              <td>{idx.primary ? 'YES' : 'NO'}</td>
              <td>
                <button
                  type="button"
                  className="danger"
                  disabled={idx.primary}
                  onClick={() => {
                    if (!confirm(`Drop index ${idx.name}?`)) return;
                    onPreview(engine === 'postgres'
                      ? `DROP INDEX ${quoteIdent(idx.name, engine)};`
                      : `DROP INDEX ${quoteIdent(idx.name, engine)} ON ${qTable};`);
                  }}
                >Drop</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function quoteIdent(ident: string, engine: DbConnection['engine']): string {
  if (engine === 'mssql') return `[${ident.replace(/]/g, ']]')}]`;
  return engine === 'mysql'
    ? `\`${ident.replace(/`/g, '``')}\``
    : `"${ident.replace(/"/g, '""')}"`;
}

function quoteTable(table: string, engine: DbConnection['engine']): string {
  return table.split('.').map((p) => quoteIdent(p, engine)).join('.');
}

function sqlStringLiteral(value: string, unicode = false): string {
  return `${unicode ? 'N' : ''}'${value.replace(/'/g, "''")}'`;
}

function mssqlDropDefaultSql(table: string, column: string, engine: DbConnection['engine']): string {
  const qTable = quoteTable(table, engine);
  return [
    'DECLARE @constraint nvarchar(128);',
    'SELECT @constraint = dc.name',
    'FROM sys.default_constraints dc',
    'JOIN sys.columns c ON c.default_object_id = dc.object_id',
    `WHERE dc.parent_object_id = OBJECT_ID(${sqlStringLiteral(table, true)}) AND c.name = ${sqlStringLiteral(column, true)};`,
    `IF @constraint IS NOT NULL EXEC('ALTER TABLE ${qTable} DROP CONSTRAINT ' + QUOTENAME(@constraint));`,
  ].join('\n');
}

function lastIdent(table: string): string {
  const parts = table.split('.');
  return parts[parts.length - 1] || table;
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
