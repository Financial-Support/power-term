import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { localReadText } from '../lib/ipc';
import type { SshKey, SshKeyInput } from '../types';
import { CloseIcon, KeyIcon } from './AppIcons';

interface Props {
  mode: 'create' | 'edit';
  initial?: SshKey;
  onSave: (input: SshKeyInput) => void;
  onCancel: () => void;
  saving?: boolean;
}

/**
 * Add / edit a key in the registry. Two ways to provide key content:
 * 1. Pick a file path — content is auto-captured from disk.
 * 2. Paste key content directly into the textarea — no file needed.
 */
export function KeyFormModal({ mode, initial, onSave, onCancel, saving }: Props) {
  const isPastedKey = initial?.path.startsWith('[pasted] ') ?? false;

  const [name, setName] = useState(initial?.name ?? '');
  const [path, setPath] = useState(isPastedKey ? '' : (initial?.path ?? ''));
  const [content, setContent] = useState(initial?.content ?? '');
  const [pastedContent, setPastedContent] = useState(isPastedKey ? (initial?.content ?? '') : '');
  const [pathDirty, setPathDirty] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // When true, use pasted content; path field becomes optional.
  const [pasteMode, setPasteMode] = useState(isPastedKey);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Auto-read file when path changes (file mode only).
  useEffect(() => {
    if (!pathDirty || !path.trim() || pasteMode) return;
    const target = path.trim();
    setReading(true);
    setReadError(null);
    void localReadText(target)
      .then((text) => setContent(text))
      .catch((e) => setReadError(String(e)))
      .finally(() => setReading(false));
  }, [pathDirty, path, pasteMode]);

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
      setPasteMode(false);
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

  const enterPasteMode = () => {
    setPasteMode(true);
    setPathDirty(false);
    setReadError(null);
    setReading(false);
  };

  const valid = name.trim() !== '' && (pasteMode ? pastedContent.trim() !== '' : path.trim() !== '');
  const submit = () => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      path: pasteMode ? '' : path.trim(),
      content: pasteMode ? pastedContent : content,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="key form">
      <div className="modal modal-form">
        <div className="modal-title-row">
          <span className="modal-title-icon" aria-hidden><KeyIcon size={14} /></span>
          <div className="modal-title-copy">
            <span className="modal-eyebrow">Key</span>
            <h2>{mode === 'create' ? 'Add SSH key' : 'Edit SSH key'}</h2>
          </div>
          <button type="button" className="modal-close-btn" aria-label="Close key form" title="Close" onClick={onCancel}>
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="form-grid">
          <label htmlFor="kfm-name">Label</label>
          <input id="kfm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal" />

          <label htmlFor="kfm-path">Path</label>
          <div className="key-path-row">
            <input
              id="kfm-path"
              value={pasteMode ? '' : path}
              onChange={(e) => { setPath(e.target.value); setPathDirty(true); setPasteMode(false); }}
              placeholder="/Users/you/.ssh/id_ed25519"
              disabled={pasteMode}
            />
            <button type="button" className="key-path-browse" onClick={() => void browse()} disabled={pasteMode}>Browse…</button>
          </div>
          <div className="key-mode-toggle">
            <button
              type="button"
              className={`key-mode-btn ${!pasteMode ? 'active' : ''}`}
              onClick={() => setPasteMode(false)}
            >
              File
            </button>
            <button
              type="button"
              className={`key-mode-btn ${pasteMode ? 'active' : ''}`}
              onClick={enterPasteMode}
            >
              Paste
            </button>
          </div>

          {pasteMode && (
            <>
              <label htmlFor="kfm-content">Key content</label>
              <textarea
                id="kfm-content"
                value={pastedContent}
                onChange={(e) => setPastedContent(e.target.value)}
                placeholder="Paste private key content here…&#10;-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
                rows={8}
                className="key-content-textarea"
              />
            </>
          )}
        </div>

        {!pasteMode && (
          <div className="key-content-status">
            {reading && <span className="key-content-reading">Reading file…</span>}
            {!reading && readError && <span className="key-content-error">{readError}</span>}
            {!reading && !readError && content && (
              <span className="key-content-ok">
                Captured {content.length.toLocaleString()} bytes. This key stays available even if the file moves.
              </span>
            )}
            {!reading && !readError && !content && (
              <span className="key-content-warn">
                No captured contents. SSH will read the file from disk.
              </span>
            )}
            {mode === 'edit' && path.trim() !== '' && (
              <button type="button" className="key-recapture" onClick={() => void recapture()} disabled={reading}>
                Capture again
              </button>
            )}
          </div>
        )}

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
