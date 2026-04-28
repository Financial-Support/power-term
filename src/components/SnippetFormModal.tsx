import { useEffect, useRef, useState } from 'react';
import type { Snippet, SnippetInput } from '../types';

interface Props {
  mode: 'create' | 'edit';
  snippet?: Snippet;
  onSave: (input: SnippetInput) => void;
  onCancel: () => void;
}

export function SnippetFormModal({ mode, snippet, onSave, onCancel }: Props) {
  const [name, setName] = useState(snippet?.name ?? '');
  const [contentEmpty, setContentEmpty] = useState((snippet?.content ?? '') === '');
  const [tagsText, setTagsText] = useState((snippet?.tags ?? []).join(', '));
  const contentRef = useRef<HTMLTextAreaElement>(null);

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
    !contentEmpty &&
    name.length <= 80;

  const submit = () => {
    if (!validForm) return;
    const content = contentRef.current?.value ?? '';
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
        <h2>{mode === 'create' ? 'Add snippet' : 'Edit snippet'}</h2>
        <div className="form-grid">
          <label htmlFor="sfm-name">Name</label>
          <input id="sfm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

          <label htmlFor="sfm-tags">Tags</label>
          <input id="sfm-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="fs, ops" />
        </div>

        <label htmlFor="sfm-content">Content</label>
        <textarea
          id="sfm-content"
          ref={contentRef}
          className="snippet-content"
          rows={8}
          defaultValue={snippet?.content ?? ''}
          onChange={(e) => setContentEmpty(e.target.value === '')}
          spellCheck={false}
        />

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!validForm}>Save</button>
        </div>
      </div>
    </div>
  );
}
