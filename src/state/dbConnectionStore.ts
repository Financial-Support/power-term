import { create } from 'zustand';
import {
  dbConnectionsCreate, dbConnectionsDelete, dbConnectionsList, dbConnectionsUpdate,
} from '../lib/ipc';
import type { DbConnection, DbConnectionInput } from '../types';

interface State {
  connections: DbConnection[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: DbConnectionInput) => Promise<DbConnection | null>;
  update: (id: string, input: DbConnectionInput) => Promise<DbConnection | null>;
  delete: (id: string) => Promise<void>;
}

export const useDbConnectionStore = create<State>((set) => ({
  connections: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const connections = await dbConnectionsList();
      set({ connections, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  create: async (input) => {
    try {
      const c = await dbConnectionsCreate(input);
      set((s) => ({ connections: [c, ...s.connections], error: null }));
      return c;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const c = await dbConnectionsUpdate(id, input);
      set((s) => ({ connections: s.connections.map((x) => (x.id === id ? c : x)), error: null }));
      return c;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await dbConnectionsDelete(id);
      set((s) => ({ connections: s.connections.filter((x) => x.id !== id), error: null }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
