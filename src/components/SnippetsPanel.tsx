import { useMemo, useState } from 'react';
import { useSnippetStore } from '../state/snippetStore';
import type { Snippet } from '../types';
import { ChevronDownIcon, PencilIcon, PlusIcon, TrashIcon } from './AppIcons';

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
        <div className="panel-head-copy">
          <button
            type="button"
            className="snippets-toggle"
            aria-label="toggle snippets section"
            onClick={() => setCollapsed((v) => !v)}
          >
            <span className={`sp-caret${collapsed ? ' collapsed' : ''}`}><ChevronDownIcon size={10} /></span>
            <span className="snippets-title">Snippets</span>
            <span className="panel-count" aria-hidden>{sorted.length}</span>
          </button>
        </div>
        <button
          type="button"
          className="snippets-add"
          aria-label="add snippet"
          onClick={onAdd}
        ><PlusIcon size={13} /></button>
      </div>
      {error && <p className="sp-error">{error}</p>}
      {!collapsed && (
        sorted.length === 0 ? (
          <p className="snippets-empty">No snippets.</p>
        ) : (
          <ul className="snippets-list">
            {sorted.map((snip) => (
              <li key={snip.id} className="snippet-row">
                <button type="button" className="snippet-name" onClick={() => onInsert(snip)}>
                  <span className="snippet-name-text">{snip.name}</span>
                  <span className="snippet-meta">
                    {firstLine(snip.content)}
                    {snip.tags.length > 0 ? ` · ${snip.tags.length} tag${snip.tags.length === 1 ? '' : 's'}` : ''}
                  </span>
                </button>
                <span className="snippet-actions">
                  <button type="button" aria-label={`edit snippet ${snip.name}`} title={`Edit snippet ${snip.name}`} onClick={() => onEdit(snip)}><PencilIcon size={13} /></button>
                  <button type="button" aria-label={`delete snippet ${snip.name}`} title={`Delete snippet ${snip.name}`} onClick={() => onDelete(snip)}><TrashIcon size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function firstLine(value: string): string {
  const line = value.split('\n')[0] ?? '';
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}
