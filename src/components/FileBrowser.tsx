import { useEffect, useMemo, useState } from 'react';
import { FileRow } from './FileRow';
import { useSftpStore } from '../state/sftpStore';
import { sftpDownload, sftpMkdir, sftpRemoveDir, sftpRemoveFile, sftpRename, sftpUpload } from '../lib/ipc';
import { pickLocalFile, pickLocalSavePath } from '../lib/dialog';
import type { SftpEntry } from '../types';

interface Props {
  tabId: string;
  onClose: () => void;
}

export function FileBrowser({ tabId }: Props) {
  const tab = useSftpStore((s) => s.tabs[tabId]);
  const navigate = useSftpStore((s) => s.navigate);
  const reload = useSftpStore((s) => s.reload);
  const toggleSort = useSftpStore((s) => s.toggleSort);
  const toggleHidden = useSftpStore((s) => s.toggleHidden);
  const setError = useSftpStore((s) => s.setError);
  const [pathDraft, setPathDraft] = useState(tab?.cwd ?? '');
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirDraft, setMkdirDraft] = useState('');

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

  return (
    <div className="file-browser">
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
          />
        ))}
      </div>
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
