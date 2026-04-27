import { create } from 'zustand';
import { hostsCreate, hostsDelete, hostsList, hostsTouch, hostsUpdate } from '../lib/ipc';
import type { Host, HostInput } from '../types';

interface State {
  hosts: Host[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: HostInput) => Promise<Host | null>;
  update: (id: string, input: HostInput) => Promise<Host | null>;
  delete: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useHostStore = create<State>((set) => ({
  hosts: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const hosts = await hostsList();
      set({ hosts, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  create: async (input) => {
    try {
      const h = await hostsCreate(input);
      set((s) => ({ hosts: [h, ...s.hosts], error: null }));
      return h;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const h = await hostsUpdate(id, input);
      set((s) => ({ hosts: s.hosts.map((x) => (x.id === id ? h : x)), error: null }));
      return h;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await hostsDelete(id);
      set((s) => ({ hosts: s.hosts.filter((x) => x.id !== id), error: null }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
  touch: async (id) => {
    try {
      await hostsTouch(id);
      set((s) => ({
        hosts: s.hosts.map((x) => (x.id === id ? { ...x, last_used_at: Date.now() } : x)),
      }));
    } catch (e) {
      console.warn('hosts_touch failed', e);
    }
  },
}));
