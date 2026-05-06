import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { localReadText } from '../lib/ipc';
import type { SshKey, SshKeyInput } from '../types';

interface Props {
  mode: 'create' | 'edit';
  initial?: SshKey;
  onSave: (input: SshKeyInput) => void;
  onCancel: () => void;
  saving?: boolean;
}

/**
 * Add / edit a key in the registry. The form reads the file at the chosen
 * path right when the user picks it (or when they click "Re-capture") and
 * stuffs the bytes into the row, so future SSH attempts authenticate even
 * when the original file is gone. The captured copy is still encrypted
 * with the user's sync key before any remote upload — see push.rs.
 */
export function KeyFormModal({ mode, initial, onSave, onCancel, saving }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [path, setPath] = useState(initial?.path ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [pathDirty, setPathDirty] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Read the file every time the path becomes "dirty" (changed by either
  // typing or browse). We don't auto-read on mount during edit because
  // the captured copy is already in `content`; if the user wants to
  // refresh from disk, they hit "Re-capture from disk" below.
  useEffect(() => {
    if (!pathDirty || !path.trim()) return;
    const target = path.trim();
    setReading(true);
    setReadError(null);
    void localReadText(target)
      .then((text) => setContent(text))
      .catch((e) => setReadError(String(e)))
      .finally(() => setReading(false));
  }, [pathDirty, path]);

  const browse = async () => {
    let defaultPath: string | undefined;
    try {
      const home = await homeDir();
      defaultPath = `${home.replace(/\/$/, '')}/.ssh`;
    } catch { /* fall back to dialog default */ }
    const picked = await openDialog({
      multiple: false,
      directory: false,
      title: 'Select private key',
      defaultPath,
    });
    if (typeof picked === 'string' && picked.length > 0) {
      setPath(picked);
      setPathDirty(true);
    }
  };

  const recapture = async () => {
    if (!path.trim()) return;
    setReading(true);
    setReadError(null);
    try {
      const text = await localReadText(path.trim());
      setContent(text);
    } catch (e) {
      setReadError(String(e));
    } finally {
      setReading(false);
    }
  };

  const valid = name.trim() !== '' && path.trim() !== '';
  // Empty content is allowed but warned — file may have been unreadable
  // (permissions / not yet existing). Auth will fall back to file read
  // at handshake time in that case.
  const submit = () => {
    if (!valid) return;
    onSave({ name: name.trim(), path: path.trim(), content });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="key form">
      <div className="modal modal-form">
        <h2>{mode === 'create' ? 'Add SSH key' : 'Edit SSH key'}</h2>
        <div className="form-grid">
          <label htmlFor="kfm-name">Label</label>
          <input id="kfm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal" />

          <label htmlFor="kfm-path">Path</label>
          <div className="key-path-row">
            <input
              id="kfm-path"
              value={path}
              onChange={(e) => { setPath(e.target.value); setPathDirty(true); }}
              placeholder="/Users/you/.ssh/id_ed25519"
            />
            <button type="button" className="key-path-browse" onClick={() => void browse()}>Browse…</button>
          </div>
        </div>

        <div className="key-content-status">
          {reading && <span className="key-content-reading">Reading file…</span>}
          {!reading && readError && <span className="key-content-error">{readError}</span>}
          {!reading && !readError && content && (
            <span className="key-content-ok">
              Captured {content.length.toLocaleString()} bytes — SSH stays working even if the file is moved or deleted.
            </span>
          )}
          {!reading && !readError && !content && (
            <span className="key-content-warn">
              No captured contents — SSH will read the file at handshake time. Pick a path above to capture.
            </span>
          )}
          {mode === 'edit' && path.trim() !== '' && (
            <button type="button" className="key-recapture" onClick={() => void recapture()} disabled={reading}>
              Re-capture from disk
            </button>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!valid || saving}>
            {saving && <span className="db-spinner inline-spinner" aria-hidden />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
