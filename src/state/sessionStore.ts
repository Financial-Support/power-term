import { create } from 'zustand';
import type { Tab, TabKind, LayoutKind } from '../types';
import { LAYOUT_SLOT_COUNTS as COUNTS } from '../types';

let counter = 0;
const newId = () => `tab-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

/** Split fractions per layout. Values are 0..1 boundaries between panes.
 * - col2/row2: single boundary at fraction (default 0.5)
 * - col3:     two boundaries [a, b] with 0 < a < b < 1 (default [1/3, 2/3])
 * - gridCol/gridRow: 2x2 layout's vertical and horizontal boundaries */
export interface SplitState {
  col2: number;
  row2: number;
  col3: [number, number];
  gridCol: number;
  gridRow: number;
}

const DEFAULT_SPLITS: SplitState = {
  col2: 0.5,
  row2: 0.5,
  col3: [1 / 3, 2 / 3],
  gridCol: 0.5,
  gridRow: 0.5,
};

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  layoutKind: LayoutKind;
  layoutSlots: (string | null)[];
  activePaneIndex: number;
  splits: SplitState;
  broadcast: boolean;
  addTab: (ptyId: string, title: string, kind?: TabKind, hostId?: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  rename: (id: string, title: string) => void;
  markExit: (ptyId: string, code: number | null) => void;
  setLayout: (kind: LayoutKind) => void;
  setActivePane: (index: number) => void;
  assignSlot: (index: number, tabId: string) => void;
  setSplit: (patch: Partial<SplitState>) => void;
  resetSplits: () => void;
  setBroadcast: (on: boolean) => void;
  reorderTab: (sourceId: string, targetId: string, position: 'before' | 'after') => void;
}

export const useSessionStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: null,
  layoutKind: 'solo',
  layoutSlots: [],
  activePaneIndex: 0,
  splits: DEFAULT_SPLITS,
  broadcast: false,

  addTab: (ptyId, title, kind = 'local', hostId) => {
    const tab: Tab = { id: newId(), ptyId, title, kind, hostId };
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

  setSplit: (patch) => set((s) => ({ splits: { ...s.splits, ...patch } })),
  resetSplits: () => set({ splits: DEFAULT_SPLITS }),
  setBroadcast: (on) => set({ broadcast: on }),

  reorderTab: (sourceId, targetId, position) => {
    set((s) => {
      if (sourceId === targetId) return s;
      const from = s.tabs.findIndex((t) => t.id === sourceId);
      const to = s.tabs.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0) return s;
      const next = s.tabs.slice();
      const [moved] = next.splice(from, 1);
      let insertAt = next.findIndex((t) => t.id === targetId);
      if (insertAt < 0) return s;
      if (position === 'after') insertAt += 1;
      next.splice(insertAt, 0, moved);
      return { tabs: next };
    });
  },
}));
