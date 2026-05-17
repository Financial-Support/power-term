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

/** Tab ids belonging to pane `p`, in their global array order. Each pane
 * keeps its own independent group of tabs; this is the per-pane tab strip. */
const paneIds = (tabs: Tab[], p: number) =>
  tabs.filter((t) => t.paneIndex === p).map((t) => t.id);

interface State {
  tabs: Tab[];
  activeTabId: string | null;
  layoutKind: LayoutKind;
  /** Per pane: the id of the tab currently shown in that pane (or null). */
  layoutSlots: (string | null)[];
  activePaneIndex: number;
  splits: SplitState;
  broadcast: boolean;
  addTab: (ptyId: string, title: string, kind?: TabKind, hostId?: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  rename: (id: string, title: string) => void;
  markExit: (ptyId: string, code: number | null, signal: string | null) => void;
  setLayout: (kind: LayoutKind) => void;
  setActivePane: (index: number) => void;
  assignSlot: (index: number, tabId: string) => void;
  setSplit: (patch: Partial<SplitState>) => void;
  resetSplits: () => void;
  setBroadcast: (on: boolean) => void;
  /** Move a tab to `targetPane`, inserting it at `index` within that pane's
   * own tab strip (drag-reorder within a pane, or drag across panes). */
  moveTabToPane: (tabId: string, targetPane: number, index: number) => void;
}

export const useSessionStore = create<State>((set) => ({
  tabs: [],
  activeTabId: null,
  layoutKind: 'solo',
  layoutSlots: [],
  activePaneIndex: 0,
  splits: DEFAULT_SPLITS,
  broadcast: false,

  addTab: (ptyId, title, kind = 'local', hostId) => {
    const id = newId();
    set((s) => {
      const paneIndex = s.activePaneIndex;
      const tab: Tab = { id, ptyId, title, kind, hostId, paneIndex };
      const slots = [...s.layoutSlots];
      while (slots.length <= paneIndex) slots.push(null);
      slots[paneIndex] = id;
      return { tabs: [...s.tabs, tab], layoutSlots: slots, activeTabId: id };
    });
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const p = tab.paneIndex;
      const idxInPane = paneIds(s.tabs, p).indexOf(id);
      const nextTabs = s.tabs.filter((t) => t.id !== id);
      const slots = [...s.layoutSlots];
      // Closing a pane's visible tab reveals its neighbour *within that
      // pane* (next tab, else previous) — like closing a browser tab.
      if (slots[p] === id) {
        const remaining = paneIds(nextTabs, p);
        slots[p] = remaining[idxInPane] ?? remaining[idxInPane - 1] ?? null;
      }
      const activeTabId = slots[s.activePaneIndex] ?? null;
      return { tabs: nextTabs, layoutSlots: slots, activeTabId };
    });
  },

  setActive: (id) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      const p = tab.paneIndex;
      const slots = [...s.layoutSlots];
      while (slots.length <= p) slots.push(null);
      slots[p] = id;
      // Activating a tab also focuses the pane it lives in.
      return { layoutSlots: slots, activePaneIndex: p, activeTabId: id };
    });
  },

  rename: (id, title) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),

  markExit: (ptyId, code, signal) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.ptyId === ptyId ? { ...t, exitCode: code, exitSignal: signal } : t,
      ),
    })),

  setLayout: (kind) => {
    set((s) => {
      const count = COUNTS[kind];
      // Tabs in panes that no longer exist merge into the last surviving
      // pane (e.g. collapsing to solo gathers every tab into pane 0). No
      // tab is ever lost when the layout shrinks.
      const tabs = s.tabs.map((t) =>
        t.paneIndex >= count ? { ...t, paneIndex: count - 1 } : t,
      );
      const slots: (string | null)[] = [];
      for (let i = 0; i < count; i++) {
        const old = s.layoutSlots[i];
        const stillValid =
          old != null && tabs.some((t) => t.id === old && t.paneIndex === i);
        slots[i] = stillValid ? old : (paneIds(tabs, i)[0] ?? null);
      }
      // Keep the previously-active tab on screen in whatever pane it
      // ended up in after the merge.
      if (s.activeTabId) {
        const act = tabs.find((t) => t.id === s.activeTabId);
        if (act) slots[act.paneIndex] = s.activeTabId;
      }
      const activePaneIndex = Math.min(s.activePaneIndex, count - 1);
      return {
        tabs,
        layoutKind: kind,
        layoutSlots: slots,
        activePaneIndex,
        activeTabId: slots[activePaneIndex] ?? null,
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
      // Reassigning a tab to a slot also moves it into that pane's group
      // and clears it from any other slot so a tab is never in two panes.
      const tabs = s.tabs.map((t) =>
        t.id === tabId ? { ...t, paneIndex: index } : t,
      );
      const slots = s.layoutSlots.map((sid) => (sid === tabId ? null : sid));
      slots[index] = tabId;
      const activeTabId = slots[s.activePaneIndex] ?? null;
      return { tabs, layoutSlots: slots, activeTabId };
    });
  },

  setSplit: (patch) => set((s) => ({ splits: { ...s.splits, ...patch } })),
  resetSplits: () => set({ splits: DEFAULT_SPLITS }),
  setBroadcast: (on) => set({ broadcast: on }),

  moveTabToPane: (tabId, targetPane, index) => {
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab) return s;
      const count = COUNTS[s.layoutKind];
      if (targetPane < 0 || targetPane >= count) return s;
      const sourcePane = tab.paneIndex;

      const without = s.tabs.filter((t) => t.id !== tabId);
      const targetExisting = paneIds(without, targetPane);
      const clamped = Math.max(0, Math.min(index, targetExisting.length));

      // Translate the within-pane index into a splice position in the
      // flat array (per-pane order is just the filtered array order).
      let pos: number;
      if (targetExisting.length === 0) {
        pos = without.length;
      } else if (clamped >= targetExisting.length) {
        const ref = targetExisting[targetExisting.length - 1];
        pos = without.findIndex((t) => t.id === ref) + 1;
      } else {
        const ref = targetExisting[clamped];
        pos = without.findIndex((t) => t.id === ref);
      }

      const prevSrcIdx = paneIds(s.tabs, sourcePane).indexOf(tabId);
      const next = without.slice();
      next.splice(pos, 0, { ...tab, paneIndex: targetPane });

      const slots = [...s.layoutSlots];
      slots[targetPane] = tabId;
      if (sourcePane !== targetPane && slots[sourcePane] === tabId) {
        const srcRemaining = paneIds(next, sourcePane);
        slots[sourcePane] =
          srcRemaining[Math.min(prevSrcIdx, srcRemaining.length - 1)] ?? null;
      }
      return {
        tabs: next,
        layoutSlots: slots,
        activePaneIndex: targetPane,
        activeTabId: tabId,
      };
    });
  },
}));
