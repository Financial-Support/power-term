import { create } from 'zustand';
import type { Tab } from '../types';

let counter = 0;
const newId = () => `tab-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (ptyId: string, title: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  rename: (id: string, title: string) => void;
  markExit: (ptyId: string, code: number | null) => void;
}

export const useSessionStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,
  addTab: (ptyId, title) => {
    const tab: Tab = { id: newId(), ptyId, title };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
    return tab.id;
  },
  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const next = tabs.filter((t) => t.id !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      // Closed tab was active: pick right neighbour, else left, else none.
      const neighbour = next[idx] ?? next[idx - 1] ?? null;
      nextActive = neighbour?.id ?? null;
    }
    set({ tabs: next, activeTabId: nextActive });
  },
  setActive: (id) => set({ activeTabId: id }),
  rename: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
  markExit: (ptyId, code) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.ptyId === ptyId ? { ...t, exitCode: code } : t)),
    })),
}));
