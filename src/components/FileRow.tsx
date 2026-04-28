import type { SftpEntry } from '../types';

interface Props {
  entry: SftpEntry;
  onCd: (name: string) => void;
  onDownload: (entry: SftpEntry) => void;
  onRename: (entry: SftpEntry) => void;
  onDelete: (entry: SftpEntry) => void;
}

export function FileRow({ entry, onCd, onDownload, onRename, onDelete }: Props) {
  const isDir = entry.kind === 'dir';
  const icon = isDir ? '📁' : entry.kind === 'symlink' ? '🔗' : '📄';
  return (
    <div className={`file-row ${isDir ? 'is-dir' : ''}`}>
      <button
        type="button"
        className="file-row-name"
        onClick={() => isDir && onCd(entry.name)}
      >
        <span className="file-icon">{icon}</span>
        <span className="file-name">{entry.name}</span>
      </button>
      <span className="file-size">{isDir ? '' : formatSize(entry.size)}</span>
      <span className="file-modified">{formatTime(entry.modified_ms)}</span>
      <span className="file-actions">
        {!isDir && (
          <button type="button" aria-label={`download ${entry.name}`} onClick={() => onDownload(entry)}>⬇</button>
        )}
        <button type="button" aria-label={`rename ${entry.name}`} onClick={() => onRename(entry)}>✎</button>
        <button type="button" aria-label={`delete ${entry.name}`} onClick={() => onDelete(entry)}>×</button>
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
