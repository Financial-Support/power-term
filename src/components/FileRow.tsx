import type { SftpEntry } from '../types';
import { DownloadIcon, FileIcon, FolderIcon, LinkIcon, PencilIcon, TrashIcon } from './AppIcons';

interface Props {
  entry: SftpEntry;
  selected: boolean;
  onSelect: (e: React.MouseEvent, entry: SftpEntry) => void;
  onCd: (name: string) => void;
  onDownload: (entry: SftpEntry) => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
  /** When set, rows (files AND directories) become draggable; called to
   *  fill dataTransfer. Directory drags trigger a recursive download on
   *  the receiving pane. Symlinks stay non-draggable to keep the copy
   *  tree well-defined. */
  onDragStart?: (e: React.DragEvent, entry: SftpEntry) => void;
  onContextMenu?: (e: React.MouseEvent, entry: SftpEntry) => void;
}

export function FileRow({ entry, selected, onSelect, onCd, onDownload, onRename, onDelete, onDragStart, onContextMenu }: Props) {
  const isDir = entry.kind === 'dir';
  const isSymlink = entry.kind === 'symlink';
  const icon = isDir ? <FolderIcon size={14} /> : isSymlink ? <LinkIcon size={14} /> : <FileIcon size={14} />;
  const draggable = !!onDragStart && !isSymlink;
  return (
    <div
      className={`file-row${isDir ? ' is-dir' : ''}${selected ? ' selected' : ''}`}
      role="option"
      aria-selected={selected}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart!(e, entry) : undefined}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.file-actions')) return;
        onSelect(e, entry);
      }}
      onDoubleClick={() => {
        if (isDir) onCd(entry.name);
      }}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, entry); } : undefined}
    >
      <div className="file-row-name">
        <input
          type="checkbox"
          className="file-select-checkbox"
          checked={selected}
          readOnly
          aria-label={`Select ${entry.name}`}
        />
        <span className="file-icon">{icon}</span>
        <span className="file-name">{entry.name}</span>
      </div>
      <span className="file-size">{isDir ? '' : formatSize(entry.size)}</span>
      <span className="file-modified">{formatTime(entry.modified_ms)}</span>
      <span className="file-actions">
        {!isDir && (
          <button type="button" aria-label={`download ${entry.name}`} title={`Download ${entry.name}`} onClick={() => onDownload(entry)}><DownloadIcon size={13} /></button>
        )}
        <button type="button" aria-label={`rename ${entry.name}`} title={`Rename ${entry.name}`} onClick={() => onRename(entry)}><PencilIcon size={13} /></button>
        <button type="button" aria-label={`delete ${entry.name}`} title={`Delete ${entry.name}`} onClick={() => onDelete(entry)}><TrashIcon size={13} /></button>
      </span>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}
