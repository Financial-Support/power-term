import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const moveTabTo = useSessionStore((s) => s.moveTabTo);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** Insertion index in the post-removal array (0..tabs.length-1). */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastRects = useRef<Map<string, DOMRect>>(new Map());

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

  /** Tabs as the user would see them right now: when a drag is in progress
   * we splice the dragged tab out and re-insert it at `previewIndex` so the
   * surrounding tabs slide aside to open a slot. The dragged tab itself is
   * still rendered at its preview slot but with `visibility: hidden` — that
   * keeps the slot's width while the native HTML5 drag image follows the
   * cursor. */
  const displayTabs = useMemo(() => {
    if (draggingId == null || previewIndex == null) return tabs;
    const from = tabs.findIndex((t) => t.id === draggingId);
    if (from < 0) return tabs;
    const arr = tabs.slice();
    const [moved] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(previewIndex, arr.length)), 0, moved);
    return arr;
  }, [tabs, draggingId, previewIndex]);

  // FLIP: after each render, compare new positions with the previous frame
  // and animate any tab whose left edge moved. Skips the tab being dragged
  // because it's invisible during drag and would re-snap on drop.
  useLayoutEffect(() => {
    const newRects = new Map<string, DOMRect>();
    for (const [id, el] of tabRefs.current) {
      newRects.set(id, el.getBoundingClientRect());
    }
    for (const [id, el] of tabRefs.current) {
      const next = newRects.get(id);
      const prev = lastRects.current.get(id);
      if (!next || !prev) continue;
      if (id === draggingId) continue;
      const dx = prev.left - next.left;
      if (Math.abs(dx) < 0.5) continue;
      el.classList.remove('slide');
      el.style.transform = `translateX(${dx}px)`;
      void el.offsetWidth;
      el.classList.add('slide');
      el.style.transform = '';
    }
    lastRects.current = newRects;
  });

  /** Compute the insertion index for the post-removal array given the
   * drag-over event on the tab at `displayIndex`. Cursor in the left half →
   * insert before; right half → insert after. Hovering the dragged tab
   * itself keeps the current preview (no snap-back). */
  const computePreviewIndex = (
    e: React.DragEvent<HTMLDivElement>,
    displayIndex: number,
  ): number => {
    if (draggingId == null) return displayIndex;
    const fromIdx = tabs.findIndex((t) => t.id === draggingId);
    const fallback = previewIndex ?? fromIdx;
    const targetTab = displayTabs[displayIndex];
    if (!targetTab || targetTab.id === draggingId) return fallback;
    const rect = e.currentTarget.getBoundingClientRect();
    const before = e.clientX - rect.left < rect.width / 2;
    const postRemoval = tabs.filter((t) => t.id !== draggingId);
    const targetPost = postRemoval.findIndex((t) => t.id === targetTab.id);
    if (targetPost < 0) return fallback;
    return before ? targetPost : targetPost + 1;
  };

  return (
    <div className="tabbar" role="tablist">
      {displayTabs.map((tab, displayIndex) => {
        const isActive = tab.id === activeTabId;
        const isEditing = tab.id === editingId;
        const exited = tab.exitCode != null;
        const isRemote = tab.kind === 'ssh' || tab.kind === 'sftp';
        const dotClass = exited ? 'exited' : (isRemote ? 'connected' : '');
        const isDragging = tab.id === draggingId;
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
            draggable={!isEditing}
            onClick={() => !isEditing && setActive(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
            onDragStart={(e) => {
              setDraggingId(tab.id);
              const fromIdx = tabs.findIndex((t) => t.id === tab.id);
              setPreviewIndex(fromIdx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', tab.id);
            }}
            onDragOver={(e) => {
              if (draggingId == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const next = computePreviewIndex(e, displayIndex);
              if (next !== previewIndex) setPreviewIndex(next);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const sourceId = draggingId;
              const target = previewIndex;
              setDraggingId(null);
              setPreviewIndex(null);
              if (sourceId && target != null) moveTabTo(sourceId, target);
            }}
            onDragEnd={() => {
              // Fires after drop OR when the user cancels (Esc / off-target).
              // moveTabTo already ran on drop; this just clears state for the
              // cancel path.
              setDraggingId(null);
              setPreviewIndex(null);
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
