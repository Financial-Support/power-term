import { useEffect, useMemo, useState } from 'react';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, DownloadIcon, FileIcon, FolderIcon, ParentDirectoryIcon, RefreshIcon, RevealIcon } from './AppIcons';
import { localList, localHome, localReveal, type LocalEntry } from '../lib/ipc';

export interface DragPayload {
  kind: 'local' | 'remote';
  path: string;
  name: string;
  /** Only present for remote-side drags. */
  sftpId?: string;
}

const DRAG_MIME = 'application/x-power-term-file';

interface Props {
  /** Stable id used for HTML5 drag/drop conflict resolution. */
  id: string;
  /** Called when a remote drag is dropped onto this local pane. */
  onRemoteDrop: (payload: DragPayload, targetCwd: string) => Promise<void> | void;
  showHidden: boolean;
  /** Bumping this triggers a re-list of the current cwd without resetting it. */
  reloadKey?: number;
  /** "Copy to remote" menu entry for files; receives the absolute local path. */
  onCopyToRemote?: (localPath: string, name: string) => Promise<void> | void;
}

/**
 * Local filesystem browser. Mirrors the existing FileBrowser UX (breadcrumb,
 * sortable list, parent navigation) but reads via the `local_list` Rust
 * command instead of SFTP. Ships drag-source on each row plus a drop-target
 * on the list so the dual SFTP layout can copy in either direction.
 */
export function LocalBrowser({ id, onRemoteDrop, showHidden, reloadKey, onCopyToRemote }: Props) {
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState('');
  const [dropOver, setDropOver] = useState(false);
  const [downloading, setDownloading] = useState<{ done: number; total: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: LocalEntry } | null>(null);

  // Resolve home on first mount; bootstrap cwd there.
  useEffect(() => {
    void (async () => {
      try {
        const home = await localHome();
        setCwd(home);
        setPathDraft(home);
      } catch (e) { setError(String(e)); }
    })();
  }, []);

  const reload = async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await localList(target);
      setEntries(list);
    } catch (e) {
      setError(String(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (cwd) void reload(cwd); }, [cwd]);
  // External reload trigger (e.g. after a download landed in cwd). Skip
  // the initial render so we don't double-fire alongside the cwd effect.
  useEffect(() => {
    if (cwd && reloadKey !== undefined && reloadKey > 0) void reload(cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const sorted = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'));
    return [...filtered].sort((a, b) => {
      if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [entries, showHidden]);

  const navigate = (next: string) => {
    setCwd(next);
    setPathDraft(next);
  };

  const cdInto = (name: string) => {
    if (!cwd) return;
    navigate(joinPath(cwd, name));
  };

  const cdParent = () => {
    if (!cwd) return;
    navigate(parentOf(cwd));
  };

  const onPathKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigate(pathDraft.trim() || '/');
    }
  };

  const onDragStart = (e: React.DragEvent, entry: LocalEntry) => {
    if (!cwd) return;
    if (entry.kind !== 'file' && entry.kind !== 'dir') {
      // Symlinks and special files stay non-draggable — recursive copy
      // would either silently follow them out of the intended subtree
      // or raise unhelpful errors mid-walk.
      e.preventDefault();
      return;
    }
    const payload: DragPayload = {
      kind: 'local',
      path: joinPath(cwd, entry.name),
      name: entry.name,
    };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Don't gate on dataTransfer.types — WebKit hides custom MIME types in
  // dragover's protected mode, so the check silently fails and the pane
  // never becomes a drop target. The MIME check happens in onDrop instead.
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw || !cwd) return;
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.kind === 'local') return; // dropping local→local is a no-op for now
      setDownloading({ done: 0, total: 1 });
      await onRemoteDrop(payload, cwd);
      setDownloading({ done: 1, total: 1 });
      await reload(cwd);
    } catch (err) {
      setError(`drop: ${String(err)}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div
      className={`file-browser local-browser${dropOver ? ' drop-over' : ''}`}
      data-pane-id={id}
      data-cwd={cwd ?? undefined}
      onDragOver={onDragOver}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="fb-toolbar">
        <button type="button" aria-label="parent dir" className="fb-up" title="Up" disabled={loading || !cwd} onClick={cdParent}><ArrowLeftIcon size={14} /></button>
        <div className="fb-path-wrap">
          <span className="fb-path-icon" aria-hidden>
            <FolderIcon size={14} open />
          </span>
          <input
            className="fb-breadcrumb"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={onPathKey}
            placeholder="/Users/you"
          />
          <span className="fb-pane-label">Local</span>
        </div>
        <div className="fb-toolbar-actions">
          <button type="button" aria-label="reload" title="Reload" disabled={loading || !cwd} onClick={() => cwd && void reload(cwd)}><RefreshIcon size={14} /></button>
        </div>
      </div>
      {downloading && (
        <div className="fb-upload-progress">
          Downloading {downloading.done} / {downloading.total}…
        </div>
      )}
      {dropOver && (
        <div className="fb-drop-overlay">
          <div className="fb-drop-card">
            <div className="fb-drop-icon"><DownloadIcon size={18} /></div>
            <div className="fb-drop-text">Download to <code>{cwd}</code></div>
          </div>
        </div>
      )}
      <div className="fb-header">
        <span className="fb-col fb-col-name">Name</span>
        <span className="fb-col fb-col-size">Size</span>
        <span className="fb-col fb-col-mod">Modified</span>
      </div>
      <div className="fb-list">
        {cwd && cwd !== '/' && (
          <button type="button" className="file-row pseudo-up" onClick={cdParent}>
            <span className="file-row-name"><span className="file-icon"><ParentDirectoryIcon size={14} /></span><span className="file-name">..</span></span>
          </button>
        )}
        {loading && <div className="fb-loading">Loading…</div>}
        {error && <div className="fb-error">{error}</div>}
        {sorted.map((entry) => (
          <div
            key={entry.name}
            className={`file-row local-row${entry.kind === 'dir' ? ' is-dir' : ''}`}
            draggable={entry.kind === 'file' || entry.kind === 'dir'}
            onDragStart={(e) => onDragStart(e, entry)}
            onDoubleClick={() => entry.kind === 'dir' && cdInto(entry.name)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }); }}
          >
            <span className="file-row-name">
              <span className="file-icon">{entry.kind === 'dir' ? <FolderIcon size={14} /> : <FileIcon size={14} />}</span>
              <span className="file-name">{entry.name}</span>
            </span>
            <span className="file-row-size">{entry.kind === 'file' ? formatSize(entry.size) : ''}</span>
            <span className="file-row-mod">{formatTime(entry.modified_ms)}</span>
          </div>
        ))}
      </div>
      {ctxMenu && cwd && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildLocalCtxItems(ctxMenu.entry, cwd, { onCopyToRemote, cdInto })}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

function buildLocalCtxItems(
  entry: LocalEntry,
  cwd: string,
  cb: { onCopyToRemote?: (p: string, n: string) => Promise<void> | void; cdInto: (n: string) => void },
): MenuEntry[] {
  const fullPath = joinPath(cwd, entry.name);
  const isDir = entry.kind === 'dir';
  const items: MenuEntry[] = [];
  if (isDir) {
    items.push({ label: 'Open', icon: <FolderIcon size={14} open />, onClick: () => cb.cdInto(entry.name) });
  }
  if (cb.onCopyToRemote && (isDir || entry.kind === 'file')) {
    items.push({
      label: isDir ? 'Copy folder to remote' : 'Copy to remote',
      icon: <ArrowRightIcon size={14} />,
      onClick: () => void cb.onCopyToRemote!(fullPath, entry.name),
    });
  }
  items.push({ label: 'Reveal in Finder', icon: <RevealIcon size={14} />, onClick: () => void localReveal(fullPath) });
  items.push({ label: 'Copy path', icon: <CopyIcon size={14} />, onClick: () => void navigator.clipboard.writeText(fullPath) });
  return items;
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

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} K`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} M`;
  return `${(n / 1024 ** 3).toFixed(1)} G`;
}

function formatTime(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
