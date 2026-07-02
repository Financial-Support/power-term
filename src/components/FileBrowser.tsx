import { useEffect, useMemo, useState } from 'react';
import { FileRow } from './FileRow';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { ConfirmModal } from './ConfirmModal';
import { ArrowLeftIcon, CloseIcon, CopyIcon, DownloadIcon, FolderIcon, FolderPlusIcon, ParentDirectoryIcon, PencilIcon, TrashIcon, UploadIcon, RefreshIcon } from './AppIcons';
import { useSftpStore } from '../state/sftpStore';
import { isSftpTransferCancelledError, sftpDownload, sftpMkdir, sftpRemoveDir, sftpRemoveFile, sftpRename, sftpUpload } from '../lib/ipc';
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
  const [confirmDelete, setConfirmDelete] = useState<SftpEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renameEntry, setRenameEntry] = useState<SftpEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [uploadOverwrite, setUploadOverwrite] = useState<{ local: string; base: string } | null>(null);

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
    if (isSftpTransferCancelledError(err)) return;
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

  const onDelete = (entry: SftpEntry) => {
    // Defer the actual SFTP call to the modal's confirm action so the
    // user always gets the same explicit confirm UX whether they hit the
    // row × button, the context menu, or any future entry point.
    setConfirmDelete(entry);
  };

  const performDelete = async (entry: SftpEntry) => {
    setDeleting(true);
    setError(tabId, null);
    const fullPath = joinPath(tab.cwd, entry.name);
    try {
      if (entry.kind === 'dir') await sftpRemoveDir(tab.sftpId, fullPath);
      else await sftpRemoveFile(tab.sftpId, fullPath);
      setConfirmDelete(null);
    } catch (err) {
      reportOpError('delete', err);
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
      void reload(tabId);
    }
  };

  const onRename = async (entry: SftpEntry) => {
    setRenameEntry(entry);
    setRenameDraft(entry.name);
  };

  const submitRename = async () => {
    if (!renameEntry) return;
    const next = renameDraft.trim();
    if (!next || next === renameEntry.name) {
      setRenameEntry(null);
      setRenameDraft('');
      return;
    }
    setError(tabId, null);
    setRenaming(true);
    try { await sftpRename(tab.sftpId, joinPath(tab.cwd, renameEntry.name), joinPath(tab.cwd, next)); }
    catch (err) { reportOpError('rename', err); }
    finally {
      setRenaming(false);
      setRenameEntry(null);
      setRenameDraft('');
    }
    void reload(tabId);
  };

  const onDownload = async (entry: SftpEntry) => {
    const local = await pickLocalSavePath(entry.name);
    if (!local) return;
    setError(tabId, null);
    try {
      await sftpDownload(tab.sftpId, joinPath(tab.cwd, entry.name), local);
    } catch (err) {
      reportOpError('download', err);
    }
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
      setUploadOverwrite({ local, base });
      return;
    }
    await performUpload(local, base);
  };

  const performUpload = async (local: string, base: string) => {
    setError(tabId, null);
    try {
      await sftpUpload(tab.sftpId, local, joinPath(tab.cwd, base));
    } catch (err) {
      reportOpError('upload', err);
    }
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
    let cancelled = false;
    for (const local of localPaths) {
      const base = local.split('/').pop() ?? 'upload';
      try {
        await sftpUpload(tab.sftpId, local, joinPath(tab.cwd, base));
      } catch (err) {
        if (isSftpTransferCancelledError(err)) {
          cancelled = true;
          break;
        }
        setError(tabId, `upload "${base}" failed: ${String(err)}`);
      }
      done++;
      setUploadProgress({ done, total: localPaths.length });
    }
    if (cancelled) {
      setUploadProgress(null);
      void reload(tabId);
      return;
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
      items.push({ label: 'Open', icon: <FolderIcon size={14} open />, onClick: () => cdInto(entry.name) });
    }
    if (onCopyToLocal && (isDir || entry.kind === 'file')) {
      items.push({
        label: isDir ? 'Copy folder to local' : 'Copy to local',
        icon: <ArrowLeftIcon size={14} />,
        onClick: () => void onCopyToLocal(remotePath, entry.name),
      });
    }
    if (!isDir) {
      items.push({ label: 'Download…', icon: <DownloadIcon size={14} />, onClick: () => void onDownload(entry) });
    }
    items.push({ separator: true });
    items.push({ label: 'Rename', icon: <PencilIcon size={14} />, onClick: () => void onRename(entry) });
    items.push({ label: 'Copy path', icon: <CopyIcon size={14} />, onClick: () => void navigator.clipboard.writeText(remotePath) });
    items.push({ separator: true });
    items.push({ label: 'Delete', icon: <TrashIcon size={14} />, danger: true, onClick: () => void onDelete(entry) });
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
        <button type="button" aria-label="parent dir" className="fb-up" title="Up" disabled={tab.loading} onClick={cdParent}><ArrowLeftIcon size={14} /></button>
        <div className="fb-path-wrap">
          <span className="fb-path-icon" aria-hidden>
            <FolderIcon size={14} open />
          </span>
          <input
            className="fb-breadcrumb"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={onPathKey}
          />
          <span className="fb-pane-label">Remote</span>
        </div>
        <div className="fb-toolbar-actions">
          <button type="button" aria-label="reload" title="Reload" disabled={tab.loading} onClick={() => void reload(tabId)}><RefreshIcon size={14} /></button>
          <button type="button" aria-label="upload" title="Upload" disabled={tab.loading} onClick={() => void onUpload()}><UploadIcon size={14} /></button>
          <button type="button" aria-label="new folder" title="New folder" disabled={tab.loading} onClick={() => setMkdirOpen(true)}><FolderPlusIcon size={14} /></button>
          <label className="fb-toggle">
            <input type="checkbox" aria-label="show hidden files" checked={tab.showHidden} onChange={() => toggleHidden(tabId)} />
            Hidden
          </label>
        </div>
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
            <div className="fb-drop-icon"><UploadIcon size={18} /></div>
            <div className="fb-drop-text">Drop to upload to <code>{tab.cwd}</code></div>
          </div>
        </div>
      )}
      <div className="fb-list">
        {tab.cwd !== '/' && (
          <button type="button" className="file-row pseudo-up" onClick={cdParent}>
            <span className="file-row-name"><span className="file-icon"><ParentDirectoryIcon size={14} /></span><span className="file-name">..</span></span>
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
      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.kind === 'dir' ? 'Delete folder?' : 'Delete file?'}
          message={
            confirmDelete.kind === 'dir'
              ? `Recursively delete folder "${confirmDelete.name}" and all its contents from ${tab.cwd}? This cannot be undone.`
              : `Delete file "${confirmDelete.name}" from ${tab.cwd}? This cannot be undone.`
          }
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          destructive
          onConfirm={() => { if (!deleting) void performDelete(confirmDelete); }}
          onCancel={() => { if (!deleting) setConfirmDelete(null); }}
        />
      )}
      {renameEntry && (
        <div className="modal-backdrop" role="dialog" aria-label="rename item">
          <div className="modal modal-form">
            <div className="modal-title-row">
              <span className="modal-title-icon" aria-hidden>
                <PencilIcon size={14} />
              </span>
              <div className="modal-title-copy">
                <h2>Rename item</h2>
                <p className="form-title-meta">
                  <FolderIcon size={11} open /> {tab.cwd}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close rename"
                title="Close"
                onClick={() => { if (!renaming) { setRenameEntry(null); setRenameDraft(''); } }}
                disabled={renaming}
              >
                <CloseIcon size={14} />
              </button>
            </div>
            <div className="form-grid">
              <label htmlFor="fb-rename">Name</label>
              <input
                id="fb-rename"
                autoFocus
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
                  if (e.key === 'Escape' && !renaming) { e.preventDefault(); setRenameEntry(null); setRenameDraft(''); }
                }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => { setRenameEntry(null); setRenameDraft(''); }} disabled={renaming}>Cancel</button>
              <button type="button" className="primary" onClick={() => void submitRename()} disabled={renaming || renameDraft.trim() === ''}>
                {renaming && <span className="db-spinner inline-spinner" aria-hidden />}
                {renaming ? 'Renaming…' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}
      {uploadOverwrite && (
        <ConfirmModal
          title="Overwrite file"
          message={`Replace "${uploadOverwrite.base}" in ${tab.cwd}?`}
          confirmLabel="Overwrite"
          destructive
          onConfirm={() => {
            const next = uploadOverwrite;
            setUploadOverwrite(null);
            void performUpload(next.local, next.base);
          }}
          onCancel={() => setUploadOverwrite(null)}
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
