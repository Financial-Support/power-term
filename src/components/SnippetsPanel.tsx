import { useMemo, useState } from 'react';
import { useSnippetStore } from '../state/snippetStore';
import type { Snippet } from '../types';

interface Props {
  onAdd: () => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
  onInsert: (snippet: Snippet) => void;
}

export function SnippetsPanel({ onAdd, onEdit, onDelete, onInsert }: Props) {
  const snippets = useSnippetStore((s) => s.snippets);
  const error = useSnippetStore((s) => s.error);
  const [collapsed, setCollapsed] = useState(false);

  const sorted = useMemo(
    () => [...snippets].sort((a, b) => a.name.localeCompare(b.name)),
    [snippets],
  );

  return (
    <div className="snippets-panel">
      <div className="snippets-header">
        <button
          type="button"
          className="snippets-toggle"
          aria-label="toggle snippets section"
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="sp-caret">{collapsed ? '▸' : '▾'}</span>
          <span className="snippets-title">Snippets</span>
        </button>
        <button
          type="button"
          className="snippets-add"
          aria-label="add snippet"
          onClick={onAdd}
        >+</button>
      </div>
      {error && <p className="sp-error">{error}</p>}
      {!collapsed && (
        sorted.length === 0 ? (
          <p className="snippets-empty">No snippets. Click + to add one.</p>
        ) : (
          <ul className="snippets-list">
            {sorted.map((snip) => (
              <li key={snip.id} className="snippet-row">
                <button type="button" className="snippet-name" onClick={() => onInsert(snip)}>
                  {snip.name}
                </button>
                <span className="snippet-actions">
                  <button type="button" aria-label={`edit snippet ${snip.name}`} onClick={() => onEdit(snip)}>✎</button>
                  <button type="button" aria-label={`delete snippet ${snip.name}`} onClick={() => onDelete(snip)}>×</button>
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
