import { create } from 'zustand';
import {
  forwardsList, forwardsCreate, forwardsUpdate, forwardsDelete,
  forwardStart, forwardStop, forwardsStatusAll,
} from '../lib/ipc';
import type { Forward, ForwardInput, ForwardStatus } from '../types';

interface State {
  forwards: Forward[];
  statuses: Record<string, ForwardStatus>;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  loadStatuses: () => Promise<void>;
  create: (input: ForwardInput) => Promise<Forward | null>;
  update: (id: string, input: ForwardInput) => Promise<Forward | null>;
  delete: (id: string) => Promise<void>;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  setStatus: (status: ForwardStatus) => void;
}

export const useForwardStore = create<State>((set) => ({
  forwards: [],
  statuses: {},
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const forwards = await forwardsList();
      set({ forwards, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  loadStatuses: async () => {
    try {
      const statuses = await forwardsStatusAll();
      set({ statuses: Object.fromEntries(statuses.map((s) => [s.id, s])) });
    } catch { /* ignore */ }
  },
  create: async (input) => {
    try {
      const f = await forwardsCreate(input);
      set((s) => ({ forwards: [f, ...s.forwards], error: null }));
      return f;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const f = await forwardsUpdate(id, input);
      set((s) => ({ forwards: s.forwards.map((x) => (x.id === id ? f : x)), error: null }));
      return f;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await forwardsDelete(id);
      set((s) => {
        const next = { ...s.statuses };
        delete next[id];
        return { forwards: s.forwards.filter((x) => x.id !== id), statuses: next, error: null };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  start: async (id) => {
    try {
      const status = await forwardStart(id);
      set((s) => ({ statuses: { ...s.statuses, [id]: status } }));
    } catch (e) {
      set((s) => ({
        statuses: { ...s.statuses, [id]: { id, state: 'error', error: String(e) } },
      }));
    }
  },
  stop: async (id) => {
    try {
      const status = await forwardStop(id);
      set((s) => ({ statuses: { ...s.statuses, [id]: status } }));
    } catch (e) {
      set((s) => ({
        statuses: { ...s.statuses, [id]: { id, state: 'error', error: String(e) } },
      }));
    }
  },
  setStatus: (status) => {
    set((s) => ({ statuses: { ...s.statuses, [status.id]: status } }));
  },
}));
