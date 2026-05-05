import { create } from 'zustand';
import { sshKeysCreate, sshKeysDelete, sshKeysList, sshKeysUpdate } from '../lib/ipc';
import type { SshKey, SshKeyInput } from '../types';

interface State {
  keys: SshKey[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: SshKeyInput) => Promise<SshKey | null>;
  update: (id: string, input: SshKeyInput) => Promise<SshKey | null>;
  delete: (id: string) => Promise<void>;
}

export const useSshKeyStore = create<State>((set) => ({
  keys: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const keys = await sshKeysList();
      set({ keys, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  create: async (input) => {
    try {
      const k = await sshKeysCreate(input);
      set((s) => ({ keys: [...s.keys, k].sort((a, b) => a.name.localeCompare(b.name)), error: null }));
      return k;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const k = await sshKeysUpdate(id, input);
      set((s) => ({ keys: s.keys.map((x) => (x.id === id ? k : x)), error: null }));
      return k;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await sshKeysDelete(id);
      set((s) => ({ keys: s.keys.filter((x) => x.id !== id), error: null }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
