import { create } from 'zustand';
import { sftpCanonicalize, sftpList } from '../lib/ipc';
import type { SftpEntry, SortKey } from '../types';

export interface SftpTabState {
  sftpId: string;
  cwd: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string | null;
  sortKey: SortKey;
  sortAsc: boolean;
  showHidden: boolean;
}

interface State {
  tabs: Record<string, SftpTabState>;
  init: (tabId: string, sftpId: string) => Promise<void>;
  navigate: (tabId: string, path: string) => Promise<void>;
  reload: (tabId: string) => Promise<void>;
  toggleSort: (tabId: string, key: SortKey) => void;
  toggleHidden: (tabId: string) => void;
  setError: (tabId: string, error: string | null) => void;
  closeTab: (tabId: string) => void;
}

export const useSftpStore = create<State>((set, get) => ({
  tabs: {},
  init: async (tabId, sftpId) => {
    set((s) => ({
      tabs: {
        ...s.tabs,
        [tabId]: {
          sftpId, cwd: '.', entries: [], loading: true, error: null,
          sortKey: 'name', sortAsc: true, showHidden: false,
        },
      },
    }));
    try {
      const home = await sftpCanonicalize(sftpId, '.');
      const entries = await sftpList(sftpId, home);
      set((s) => ({
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], cwd: home, entries, loading: false } },
      }));
    } catch (e) {
      set((s) => ({
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], loading: false, error: String(e) } },
      }));
    }
  },
  navigate: async (tabId, path) => {
    const t = get().tabs[tabId];
    if (!t) return;
    set((s) => ({
      tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], loading: true, error: null } },
    }));
    try {
      const entries = await sftpList(t.sftpId, path);
      set((s) => ({
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], cwd: path, entries, loading: false } },
      }));
    } catch (e) {
      set((s) => ({
        tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], loading: false, error: String(e) } },
      }));
    }
  },
  reload: async (tabId) => {
    const t = get().tabs[tabId];
    if (!t) return;
    await get().navigate(tabId, t.cwd);
  },
  toggleSort: (tabId, key) => {
    set((s) => {
      const t = s.tabs[tabId];
      if (!t) return s;
      const sortAsc = t.sortKey === key ? !t.sortAsc : true;
      return { tabs: { ...s.tabs, [tabId]: { ...t, sortKey: key, sortAsc } } };
    });
  },
  toggleHidden: (tabId) => {
    set((s) => {
      const t = s.tabs[tabId];
      if (!t) return s;
      return { tabs: { ...s.tabs, [tabId]: { ...t, showHidden: !t.showHidden } } };
    });
  },
  setError: (tabId, error) => {
    set((s) => {
      const t = s.tabs[tabId];
      if (!t) return s;
      return { tabs: { ...s.tabs, [tabId]: { ...t, error } } };
    });
  },
  closeTab: (tabId) => {
    set((s) => {
      const next = { ...s.tabs };
      delete next[tabId];
      return { tabs: next };
    });
  },
}));
