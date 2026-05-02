import { useEffect, useState } from 'react';
import { useSessionStore } from '../state/sessionStore';

interface Props {
  onNew: () => void;
  onClose: (id: string) => void;
}

interface CtxMenu {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ onNew, onClose }: Props) {
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const setActive = useSessionStore((s) => s.setActive);
  const rename = useSessionStore((s) => s.rename);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  // Dismiss the context menu on Esc or any click outside it.
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.tab-ctx-menu')) setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const closeOthers = (keepId: string) => {
    for (const t of tabs) if (t.id !== keepId) onClose(t.id);
  };
  const closeToRight = (afterId: string) => {
    const idx = tabs.findIndex((t) => t.id === afterId);
    if (idx < 0) return;
    for (const t of tabs.slice(idx + 1)) onClose(t.id);
  };
  const closeAll = () => { for (const t of tabs) onClose(t.id); };

  const beginRename = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setDraft(tab.title);
    setEditingId(tabId);
  };

  return (
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isEditing = tab.id === editingId;
        const exited = tab.exitCode != null;
        const isRemote = tab.kind === 'ssh' || tab.kind === 'sftp';
        const dotClass = exited ? 'exited' : (isRemote ? 'connected' : '');
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'active' : ''}`}
            onClick={() => !isEditing && setActive(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
          >
            {dotClass && <span className={`tab-status-dot tab-status-${dotClass}`} aria-hidden />}
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
                onDoubleClick={() => beginRename(tab.id)}
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
      <button type="button" className="tab-new" aria-label="New tab" title="New tab (⌘T)" onClick={onNew}>+</button>

      {ctxMenu && (() => {
        const menuTab = tabs.find((t) => t.id === ctxMenu.tabId);
        if (!menuTab) return null;
        const idx = tabs.findIndex((t) => t.id === ctxMenu.tabId);
        const hasOthers = tabs.length > 1;
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        return (
          <div
            className="tab-ctx-menu"
            role="menu"
            style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y }}
            data-no-drag
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { beginRename(ctxMenu.tabId); setCtxMenu(null); }}
            >Rename</button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { onClose(ctxMenu.tabId); setCtxMenu(null); }}
            >Close</button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasOthers}
              onClick={() => { closeOthers(ctxMenu.tabId); setCtxMenu(null); }}
            >Close Others</button>
            <button
              type="button"
              role="menuitem"
              disabled={!hasRight}
              onClick={() => { closeToRight(ctxMenu.tabId); setCtxMenu(null); }}
            >Close to the Right</button>
            <button
              type="button"
              role="menuitem"
              className="tab-ctx-danger"
              onClick={() => { closeAll(); setCtxMenu(null); }}
            >Close All</button>
          </div>
        );
      })()}
    </div>
  );
}
