import { useEffect, useState } from 'react';
import type { Snippet, SnippetInput } from '../types';
import { CloseIcon, SnippetIcon } from './AppIcons';

interface Props {
  mode: 'create' | 'edit';
  snippet?: Snippet;
  onSave: (input: SnippetInput) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function SnippetFormModal({ mode, snippet, onSave, onCancel, saving }: Props) {
  const [name, setName] = useState(snippet?.name ?? '');
  const [content, setContent] = useState(snippet?.content ?? '');
  const [tagsText, setTagsText] = useState((snippet?.tags ?? []).join(', '));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const validForm =
    name.trim() !== '' &&
    content !== '' &&
    name.length <= 80;

  const submit = () => {
    if (!validForm) return;
    const tags = tagsText
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const dedupedTags = Array.from(new Set(tags));
    onSave({
      name: name.trim(),
      content,
      tags: dedupedTags,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="snippet form">
      <div className="modal modal-form">
        <div className="modal-title-row">
          <span className="modal-title-icon" aria-hidden><SnippetIcon size={14} /></span>
          <div className="modal-title-copy">
            <span className="modal-eyebrow">Snippet</span>
            <h2>{mode === 'create' ? 'Add snippet' : 'Edit snippet'}</h2>
          </div>
          <button type="button" className="modal-close-btn" aria-label="Close snippet form" title="Close" onClick={onCancel}>
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="form-grid">
          <label htmlFor="sfm-name">Name</label>
          <input id="sfm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

          <label htmlFor="sfm-tags">Tags</label>
          <input id="sfm-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="fs, ops" />
        </div>

        <label htmlFor="sfm-content">Content</label>
        <textarea
          id="sfm-content"
          className="snippet-content"
          rows={8}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!validForm || saving}>
            {saving && <span className="db-spinner inline-spinner" aria-hidden />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
