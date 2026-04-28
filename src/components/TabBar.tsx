import { useState } from 'react';
import { useSessionStore } from '../state/sessionStore';

interface Props {
  onNew: () => void;
  onClose: (id: string) => void;
}

export function TabBar({ onNew, onClose }: Props) {
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const setActive = useSessionStore((s) => s.setActive);
  const rename = useSessionStore((s) => s.rename);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = tab.id === editingId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => !isEditing && setActive(tab.id)}
          >
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => { rename(tab.id, draft.trim() || tab.title); setEditingId(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { rename(tab.id, draft.trim() || tab.title); setEditingId(null); }
                  if (e.key === 'Escape') { setEditingId(null); }
                }}
              />
            ) : (
              <span
                className="tab-title"
                onDoubleClick={() => { setDraft(tab.title); setEditingId(tab.id); }}
              >
                {tab.kind === 'sftp' ? `SFTP - ${tab.title}` : tab.title}
              </span>
            )}
            <button
              type="button"
              className="tab-close"
              aria-label={`Close tab ${tab.title}`}
              onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="tab-new" aria-label="New tab" onClick={onNew}>+</button>
    </div>
  );
}
