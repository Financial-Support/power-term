import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSessionStore } from '../state/sessionStore';
import type { Tab } from '../types';
import { ChevronRightIcon, CloseIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from './AppIcons';
import { ContextMenu, type MenuEntry } from './ContextMenu';

interface Props {
  /** Which split pane this strip belongs to. The strip only shows tabs
   * that live in this pane; a tab can be dragged into another pane's strip. */
  paneIndex: number;
  onNew: (paneIndex: number) => void;
  onClose: (id: string) => void;
  onReconnect?: (id: string) => void;
}

interface CtxMenu {
  tabId: string;
  x: number;
  y: number;
}

interface SortableTabProps {
  tab: Tab;
  displayTitle: string;
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
  onReconnect?: () => void;
}

function SortableTab({
  tab,
  displayTitle,
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
  onReconnect,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id, disabled: isEditing, data: { type: 'tab', paneIndex: tab.paneIndex } });

  // Any termination — clean exit code OR a signal like "network_error" —
  // counts as "no longer connected". The previous check was exitCode-only,
  // which missed signal-killed channels (their code stays null).
  const dead = tab.exitCode != null || tab.exitSignal != null;
  const isRemote = tab.kind === 'ssh' || tab.kind === 'sftp';
  const dotClass = dead
    ? (tab.exitSignal != null ? 'disconnected' : 'exited')
    : (isRemote ? 'connected' : 'local');
  const canReconnect = dead && isRemote && !!tab.hostId && !!onReconnect;

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
      <span className={`tab-status-dot tab-status-${dotClass}`} aria-hidden />
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
          {tab.kind === 'sftp' ? `SFTP - ${displayTitle}` : displayTitle}
        </span>
      )}
      {canReconnect && (
        <button
          type="button"
          className="tab-reconnect"
          aria-label={`Reconnect ${displayTitle}`}
          title="Reconnect"
          onClick={(e) => { e.stopPropagation(); onReconnect?.(); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <RefreshIcon size={12} />
        </button>
      )}
      <button
        type="button"
        className="tab-close"
        aria-label={`Close tab ${displayTitle}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <CloseIcon size={10} />
      </button>
    </div>
  );
}

/** Append " 2", " 3", ... to titles that collide so the user can tell two
 * tabs named "Local" apart. Singletons keep their original name.
 *
 * Numbers are assigned in *creation order* (parsed from the id's monotonic
 * counter prefix, e.g. "tab-7-…") — NOT the current store order — so
 * dragging a tab to a new slot or pane never swaps "Local 1" ↔ "Local 2".
 * Collisions are resolved across *all* tabs (every pane) so two panes
 * never both show a bare "Local". */
function buildDisplayTitles(tabs: Tab[]): Map<string, string> {
  const totals = new Map<string, number>();
  for (const t of tabs) totals.set(t.title, (totals.get(t.title) ?? 0) + 1);

  const counter = (id: string) => {
    const m = id.match(/^tab-(\d+)-/);
    return m ? Number(m[1]) : 0;
  };
  const stable = [...tabs].sort((a, b) => counter(a.id) - counter(b.id));

  const numbers = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const t of stable) {
    const total = totals.get(t.title) ?? 1;
    if (total <= 1) continue;
    const n = (seen.get(t.title) ?? 0) + 1;
    seen.set(t.title, n);
    numbers.set(t.id, n);
  }

  const out = new Map<string, string>();
  for (const t of tabs) {
    const num = numbers.get(t.id);
    out.set(t.id, num ? `${t.title} ${num}` : t.title);
  }
  return out;
}

export function TabBar({ paneIndex, onNew, onClose, onReconnect }: Props) {
  const allTabs = useSessionStore((s) => s.tabs);
  const slotTabId = useSessionStore((s) => s.layoutSlots[paneIndex] ?? null);
  const setActive = useSessionStore((s) => s.setActive);
  const rename = useSessionStore((s) => s.rename);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  // Tabs that belong to *this* pane, in their strip order.
  const tabs = allTabs.filter((t) => t.paneIndex === paneIndex);

  // The whole strip is a drop target so a tab can be dragged onto a pane
  // with no tabs (or empty area past the last tab).
  const { setNodeRef: setDropRef } = useDroppable({
    id: `pane-drop-${paneIndex}`,
    data: { type: 'pane', paneIndex },
  });

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

  const displayTitles = buildDisplayTitles(allTabs);

  return (
    <div ref={setDropRef} className="pane-tabbar" role="tablist">
      <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab) => {
          const isActive = tab.id === slotTabId;
          const isEditing = tab.id === editingId;
          return (
            <SortableTab
              key={tab.id}
              tab={tab}
              displayTitle={displayTitles.get(tab.id) ?? tab.title}
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
              onReconnect={onReconnect ? () => onReconnect(tab.id) : undefined}
            />
          );
        })}
      </SortableContext>
      <button
        type="button"
        className="tab-new"
        aria-label="New tab"
        title="New tab"
        onClick={() => onNew(paneIndex)}
      ><PlusIcon size={12} /></button>

      {ctxMenu && (() => {
        const menuTab = tabs.find((t) => t.id === ctxMenu.tabId);
        if (!menuTab) return null;
        const idx = tabs.findIndex((t) => t.id === ctxMenu.tabId);
        const hasOthers = tabs.length > 1;
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const items: MenuEntry[] = [
          {
            label: 'Rename',
            icon: <PencilIcon size={14} />,
            onClick: () => beginRename(ctxMenu.tabId),
          },
          {
            label: 'Close',
            icon: <CloseIcon size={14} />,
            onClick: () => onClose(ctxMenu.tabId),
          },
          {
            label: 'Close Others',
            icon: <CloseIcon size={14} />,
            disabled: !hasOthers,
            onClick: () => closeOthers(ctxMenu.tabId),
          },
          {
            label: 'Close to the Right',
            icon: <ChevronRightIcon size={14} />,
            disabled: !hasRight,
            onClick: () => closeToRight(ctxMenu.tabId),
          },
          {
            label: 'Close All',
            icon: <TrashIcon size={14} />,
            danger: true,
            onClick: closeAll,
          },
        ];
        return (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            items={items}
            onClose={() => setCtxMenu(null)}
          />
        );
      })()}
    </div>
  );
}
