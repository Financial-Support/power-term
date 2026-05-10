import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSessionStore } from '../state/sessionStore';
import type { Tab } from '../types';

interface Props {
  onNew: () => void;
  onClose: (id: string) => void;
}

interface CtxMenu {
  tabId: string;
  x: number;
  y: number;
}

interface SortableTabProps {
  tab: Tab;
  isActive: boolean;
  isEditing: boolean;
  draft: string;
  setDraft: (s: string) => void;
  onActivate: () => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onBeginRename: () => void;
  onContextMenu: (x: number, y: number) => void;
  onClose: () => void;
}

function SortableTab({
  tab,
  isActive,
  isEditing,
  draft,
  setDraft,
  onActivate,
  onCommitRename,
  onCancelRename,
  onBeginRename,
  onContextMenu,
  onClose,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id, disabled: isEditing });

  const exited = tab.exitCode != null;
  const isRemote = tab.kind === 'ssh' || tab.kind === 'sftp';
  const dotClass = exited ? 'exited' : (isRemote ? 'connected' : '');

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
    zIndex: isDragging ? 2 : undefined,
  };

  // dnd-kit's `attributes` sets role="button" by default; we want role="tab".
  const { role: _role, ...restAttributes } = attributes;

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="tab"
      aria-selected={isActive}
      className={`tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => { if (!isEditing) onActivate(); }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
      {...restAttributes}
      {...listeners}
    >
      {dotClass && <span className={`tab-status-dot tab-status-${dotClass}`} aria-hidden />}
      {isEditing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommitRename(draft.trim() || tab.title)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename(draft.trim() || tab.title);
            if (e.key === 'Escape') onCancelRename();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="tab-title"
          onDoubleClick={onBeginRename}
        >
          {tab.kind === 'sftp' ? `SFTP - ${tab.title}` : tab.title}
        </span>
      )}
      <button
        type="button"
        className="tab-close"
        aria-label={`Close tab ${tab.title}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        ×
      </button>
    </div>
  );
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

  // 4px activation distance: a plain click stays a click; intentional drags
  // only start once the cursor has moved enough.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    if (newIndex < 0) return;
    moveTabTo(String(active.id), newIndex);
  };

  return (
    <div className="tabbar" role="tablist">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isEditing = tab.id === editingId;
            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={isActive}
                isEditing={isEditing}
                draft={draft}
                setDraft={setDraft}
                onActivate={() => setActive(tab.id)}
                onCommitRename={(title) => { rename(tab.id, title); setEditingId(null); }}
                onCancelRename={() => setEditingId(null)}
                onBeginRename={() => beginRename(tab.id)}
                onContextMenu={(x, y) => setCtxMenu({ tabId: tab.id, x, y })}
                onClose={() => onClose(tab.id)}
              />
            );
          })}
        </SortableContext>
      </DndContext>
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
