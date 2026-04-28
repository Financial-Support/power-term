import { create } from 'zustand';
import type { Tab, TabKind, LayoutKind } from '../types';
import { LAYOUT_SLOT_COUNTS as COUNTS } from '../types';

let counter = 0;
const newId = () => `tab-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  layoutKind: LayoutKind;
  layoutSlots: (string | null)[];
  activePaneIndex: number;
  addTab: (ptyId: string, title: string, kind?: TabKind) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  rename: (id: string, title: string) => void;
  markExit: (ptyId: string, code: number | null) => void;
  setLayout: (kind: LayoutKind) => void;
  setActivePane: (index: number) => void;
  assignSlot: (index: number, tabId: string) => void;
}

export const useSessionStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,
  layoutKind: 'solo',
  layoutSlots: [],
  activePaneIndex: 0,

  addTab: (ptyId, title, kind = 'local') => {
    const tab: Tab = { id: newId(), ptyId, title, kind };
    set((s) => {
      const slots = [...s.layoutSlots];
      while (slots.length <= s.activePaneIndex) slots.push(null);
      slots[s.activePaneIndex] = tab.id;
      return { tabs: [...s.tabs, tab], layoutSlots: slots, activeTabId: tab.id };
    });
    return tab.id;
  },

  closeTab: (id) => {
    const { tabs, layoutKind, layoutSlots, activePaneIndex } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const nextTabs = tabs.filter((t) => t.id !== id);
    let slots = layoutSlots.map((slotId) => (slotId === id ? null : slotId));

    if (layoutKind === 'solo' && slots[0] === null && nextTabs.length > 0) {
      const neighbour = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
      slots = [neighbour?.id ?? null];
    }

    const activeTabId = slots[activePaneIndex] ?? null;
    set({ tabs: nextTabs, layoutSlots: slots, activeTabId });
  },

  setActive: (id) => {
    set((s) => {
      const slots = [...s.layoutSlots];
      while (slots.length <= s.activePaneIndex) slots.push(null);
      slots[s.activePaneIndex] = id;
      return { layoutSlots: slots, activeTabId: id };
    });
  },

  rename: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),

  markExit: (ptyId, code) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.ptyId === ptyId ? { ...t, exitCode: code } : t)),
    })),

  setLayout: (kind) => {
    set((s) => {
      const count = COUNTS[kind];
      const newSlots: (string | null)[] = Array.from({ length: count }, (_, i) =>
        i < s.layoutSlots.length ? s.layoutSlots[i] : null,
      );
      if (newSlots[0] === null && s.activeTabId) newSlots[0] = s.activeTabId;
      const activePaneIndex = Math.min(s.activePaneIndex, count - 1);
      return {
        layoutKind: kind,
        layoutSlots: newSlots,
        activePaneIndex,
        activeTabId: newSlots[activePaneIndex] ?? null,
      };
    });
  },

  setActivePane: (index) => {
    set((s) => {
      const clamped = Math.max(0, Math.min(index, COUNTS[s.layoutKind] - 1));
      const activeTabId = s.layoutSlots[clamped] ?? null;
      return { activePaneIndex: clamped, activeTabId };
    });
  },

  assignSlot: (index, tabId) => {
    set((s) => {
      if (index < 0 || index >= COUNTS[s.layoutKind]) return s;
      const slots = [...s.layoutSlots];
      slots[index] = tabId;
      const activeTabId = slots[s.activePaneIndex] ?? null;
      return { layoutSlots: slots, activeTabId };
    });
  },
}));
