import { useEffect, useMemo, useState } from 'react';
import { FileRow } from './FileRow';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { useSftpStore } from '../state/sftpStore';
import { sftpDownload, sftpMkdir, sftpRemoveDir, sftpRemoveFile, sftpRename, sftpUpload } from '../lib/ipc';
import { pickLocalFile, pickLocalSavePath } from '../lib/dialog';
import type { SftpEntry } from '../types';

interface Props {
  tabId: string;
  onClose: () => void;
  /** When set, this pane participates in dual-pane drag/drop. The host
   *  component handles cross-pane copies; we only fire callbacks. */
  onRowDragStart?: (e: React.DragEvent, payload: { kind: 'remote'; sftpId: string; path: string; name: string }) => void;
  onLocalDrop?: (payload: { kind: 'local'; path: string; name: string }, targetCwd: string, sftpId: string) => Promise<void> | void;
  /** When dual-pane mode is on, "Copy to local" appears in the row context
   *  menu and calls this with the entry's full remote path. */
  onCopyToLocal?: (remotePath: string, name: string) => Promise<void> | void;
}

const DUAL_DRAG_MIME = 'application/x-power-term-file';

export function FileBrowser({ tabId, onRowDragStart, onLocalDrop, onCopyToLocal }: Props) {
  const tab = useSftpStore((s) => s.tabs[tabId]);
  const navigate = useSftpStore((s) => s.navigate);
  const reload = useSftpStore((s) => s.reload);
  const toggleSort = useSftpStore((s) => s.toggleSort);
  const toggleHidden = useSftpStore((s) => s.toggleHidden);
  const setError = useSftpStore((s) => s.setError);
  const [pathDraft, setPathDraft] = useState(tab?.cwd ?? '');
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirDraft, setMkdirDraft] = useState('');
  const [dropOver, setDropOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);

  // Sync local breadcrumb input when cwd changes externally (after navigate).
  useEffect(() => {
    if (tab && pathDraft !== tab.cwd) {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.classList.contains('fb-breadcrumb')) {
        setPathDraft(tab.cwd);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.cwd]);

  const sorted = useMemo(() => {
    if (!tab) return [] as SftpEntry[];
    const filtered = tab.showHidden
      ? tab.entries
      : tab.entries.filter((entry) => !entry.name.startsWith('.'));
    const cmp = (a: SftpEntry, b: SftpEntry): number => {
      if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
      let v = 0;
      if (tab.sortKey === 'name') v = a.name.localeCompare(b.name);
      else if (tab.sortKey === 'size') v = a.size - b.size;
      else v = (a.modified_ms ?? 0) - (b.modified_ms ?? 0);
      return tab.sortAsc ? v : -v;
    };
    return [...filtered].sort(cmp);
  }, [tab]);

  if (!tab) return null;

  const cdInto = (name: string) => {
    const next = joinPath(tab.cwd, name);
    void navigate(tabId, next);
  };

  const cdParent = () => {
    const parent = parentOf(tab.cwd);
    void navigate(tabId, parent);
  };

  const onPathKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void navigate(tabId, pathDraft.trim() || '/');
    }
  };

  // Surface a per-op failure into the existing tab.error banner so the user sees
  // why a delete/rename/upload/download silently "didn't happen". Spec §9.
  const reportOpError = (verb: string, err: unknown) => {
    console.warn(`${verb} failed`, err);
    setError(tabId, `${verb} failed: ${String(err)}`);
  };

  const submitMkdir = async () => {
    const name = mkdirDraft.trim();
    if (!name) { setMkdirOpen(false); return; }
    setError(tabId, null);
    try { await sftpMkdir(tab.sftpId, joinPath(tab.cwd, name)); }
    catch (err) { reportOpError('mkdir', err); }
    setMkdirDraft('');
    setMkdirOpen(false);
    void reload(tabId);
  };

  const onDelete = async (entry: SftpEntry) => {
    const fullPath = joinPath(tab.cwd, entry.name);
    if (!confirm(`Delete ${entry.kind} "${entry.name}"?`)) return;
    setError(tabId, null);
    try {
      if (entry.kind === 'dir') await sftpRemoveDir(tab.sftpId, fullPath);
      else await sftpRemoveFile(tab.sftpId, fullPath);
    } catch (err) { reportOpError('delete', err); }
    void reload(tabId);
  };

  const onRename = async (entry: SftpEntry) => {
    const next = prompt(`Rename "${entry.name}" to:`, entry.name);
    if (!next || next === entry.name) return;
    setError(tabId, null);
    try { await sftpRename(tab.sftpId, joinPath(tab.cwd, entry.name), joinPath(tab.cwd, next)); }
    catch (err) { reportOpError('rename', err); }
    void reload(tabId);
  };

  const onDownload = async (entry: SftpEntry) => {
    const local = await pickLocalSavePath(entry.name);
    if (!local) return;
    setError(tabId, null);
    try {
      await sftpDownload(tab.sftpId, joinPath(tab.cwd, entry.name), local);
    } catch (err) { reportOpError('download', err); }
  };

  const onUpload = async () => {
    const local = await pickLocalFile();
    if (!local) return;
    const base = local.split('/').pop() ?? 'upload';
    // Spec §9: confirm before overwriting an existing remote file. The current
    // listing is the source of truth; if the entry is stale, the SFTP server's
    // overwrite is still TRUNCATE — we accept that race for MVP.
    const clash = tab.entries.find((e) => e.name === base);
    if (clash) {
      const ok = confirm(`File "${base}" already exists at ${tab.cwd}. Overwrite?`);
      if (!ok) return;
    }
    setError(tabId, null);
    try {
      await sftpUpload(tab.sftpId, local, joinPath(tab.cwd, base));
    } catch (err) { reportOpError('upload', err); }
    void reload(tabId);
  };

  // HTML5 drag-drop. Two source kinds reach this handler:
  //   1. The local pane (intra-webview) sets DUAL_DRAG_MIME with a JSON
  //      payload pointing at an absolute local file path.
  //   2. Finder drags expose file paths via text/uri-list as file:// URLs.
  //
  // Don't gate dragover on dataTransfer.types — WebKit hides custom MIME
  // types during dragover's protected mode, so the check silently fails
  // and preventDefault is never called. Validate at drop time instead.
  const onIntraDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };
  const onIntraDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);

    // Internal local→remote drag (only when dual-pane wires onLocalDrop).
    if (onLocalDrop) {
      const raw = e.dataTransfer.getData(DUAL_DRAG_MIME);
      if (raw) {
        try {
          const payload = JSON.parse(raw);
          if (payload.kind === 'local') {
            await onLocalDrop(payload, tab.cwd, tab.sftpId);
            void reload(tabId);
          }
        } catch (err) { reportOpError('drop', err); }
        return;
      }
    }

    // Finder drop: parse file:// URLs from text/uri-list and upload.
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (!uriList) return;
    const localPaths = uriList
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .map((u) => {
        try { return decodeURIComponent(new URL(u).pathname); }
        catch { return null; }
      })
      .filter((p): p is string => !!p);
    if (!localPaths.length) return;

    setUploadProgress({ done: 0, total: localPaths.length });
    let done = 0;
    for (const local of localPaths) {
      const base = local.split('/').pop() ?? 'upload';
      try {
        await sftpUpload(tab.sftpId, local, joinPath(tab.cwd, base));
      } catch (err) {
        setError(tabId, `upload "${base}" failed: ${String(err)}`);
      }
      done++;
      setUploadProgress({ done, total: localPaths.length });
    }
    setUploadProgress(null);
    void reload(tabId);
  };

  const onRowDragStartLocal = (e: React.DragEvent, entry: SftpEntry) => {
    if (!onRowDragStart) return;
    onRowDragStart(e, {
      kind: 'remote',
      sftpId: tab.sftpId,
      path: joinPath(tab.cwd, entry.name),
      name: entry.name,
    });
  };

  const buildCtxItems = (entry: SftpEntry): MenuEntry[] => {
    const isDir = entry.kind === 'dir';
    const remotePath = joinPath(tab.cwd, entry.name);
    const items: MenuEntry[] = [];
    if (isDir) {
      items.push({ label: 'Open', icon: '▸', onClick: () => cdInto(entry.name) });
    } else {
      if (onCopyToLocal) items.push({
        label: 'Copy to local',
        icon: '⇠',
        onClick: () => void onCopyToLocal(remotePath, entry.name),
      });
      items.push({ label: 'Download…', icon: '⬇', onClick: () => void onDownload(entry) });
    }
    items.push({ separator: true });
    items.push({ label: 'Rename', icon: '✎', onClick: () => void onRename(entry) });
    items.push({ label: 'Copy path', icon: '❏', onClick: () => void navigator.clipboard.writeText(remotePath) });
    items.push({ separator: true });
    items.push({ label: 'Delete', icon: '×', danger: true, onClick: () => void onDelete(entry) });
    return items;
  };

  return (
    <div
      className={`file-browser${dropOver ? ' drop-over' : ''}`}
      onDragOver={onIntraDragOver}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => void onIntraDrop(e)}
    >
      <div className="fb-toolbar">
        <button type="button" aria-label="parent dir" className="fb-up" disabled={tab.loading} onClick={cdParent}>◀</button>
        <input
          className="fb-breadcrumb"
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={onPathKey}
        />
        <button type="button" aria-label="reload" disabled={tab.loading} onClick={() => void reload(tabId)}>⟳</button>
        <button type="button" aria-label="upload" disabled={tab.loading} onClick={() => void onUpload()}>⬆</button>
        <button type="button" aria-label="new folder" disabled={tab.loading} onClick={() => setMkdirOpen(true)}>📁+</button>
        <label className="fb-toggle">
          <input type="checkbox" aria-label="show hidden files" checked={tab.showHidden} onChange={() => toggleHidden(tabId)} />
          show hidden
        </label>
      </div>
      {mkdirOpen && (
        <div className="fb-mkdir">
          <input
            autoFocus
            placeholder="folder name"
            value={mkdirDraft}
            onChange={(e) => setMkdirDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitMkdir();
              if (e.key === 'Escape') setMkdirOpen(false);
            }}
          />
          <button type="button" onClick={() => void submitMkdir()}>Create</button>
        </div>
      )}
      <div className="fb-header">
        <button type="button" className="fb-col fb-col-name" onClick={() => toggleSort(tabId, 'name')}>Name</button>
        <button type="button" className="fb-col fb-col-size" onClick={() => toggleSort(tabId, 'size')}>Size</button>
        <button type="button" className="fb-col fb-col-mod" onClick={() => toggleSort(tabId, 'modified')}>Modified</button>
        <span className="fb-col fb-col-actions" />
      </div>
      {uploadProgress && (
        <div className="fb-upload-progress">
          Uploading {uploadProgress.done} / {uploadProgress.total}…
        </div>
      )}
      {dropOver && (
        <div className="fb-drop-overlay">
          <div className="fb-drop-card">
            <div className="fb-drop-icon">⬇</div>
            <div className="fb-drop-text">Drop to upload to <code>{tab.cwd}</code></div>
          </div>
        </div>
      )}
      <div className="fb-list">
        {tab.cwd !== '/' && (
          <button type="button" className="file-row pseudo-up" onClick={cdParent}>
            <span className="file-row-name"><span className="file-icon">▸</span><span className="file-name">..</span></span>
          </button>
        )}
        {tab.loading && <div className="fb-loading">Loading…</div>}
        {tab.error && <div className="fb-error">{tab.error}</div>}
        {sorted.map((entry) => (
          <FileRow
            key={entry.name}
            entry={entry}
            onCd={(name) => cdInto(name)}
            onDownload={(e) => void onDownload(e)}
            onRename={(e) => void onRename(e)}
            onDelete={(e) => void onDelete(e)}
            onDragStart={onRowDragStart ? onRowDragStartLocal : undefined}
            onContextMenu={(e, entry) => setCtxMenu({ x: e.clientX, y: e.clientY, entry })}
          />
        ))}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

function joinPath(base: string, name: string): string {
  if (name.startsWith('/')) return name;
  if (base.endsWith('/')) return base + name;
  return base + '/' + name;
}

function parentOf(path: string): string {
  if (path === '/' || path === '') return '/';
  const idx = path.replace(/\/+$/, '').lastIndexOf('/');
  if (idx <= 0) return '/';
  return path.slice(0, idx);
}
