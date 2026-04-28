import { create } from 'zustand';
import { snippetsCreate, snippetsDelete, snippetsList, snippetsTouch, snippetsUpdate } from '../lib/ipc';
import type { Snippet, SnippetInput } from '../types';

interface State {
  snippets: Snippet[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: SnippetInput) => Promise<Snippet | null>;
  update: (id: string, input: SnippetInput) => Promise<Snippet | null>;
  delete: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
}

export const useSnippetStore = create<State>((set) => ({
  snippets: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const snippets = await snippetsList();
      set({ snippets, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  create: async (input) => {
    try {
      const s = await snippetsCreate(input);
      set((state) => ({ snippets: [s, ...state.snippets], error: null }));
      return s;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  update: async (id, input) => {
    try {
      const s = await snippetsUpdate(id, input);
      set((state) => ({ snippets: state.snippets.map((x) => (x.id === id ? s : x)), error: null }));
      return s;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  delete: async (id) => {
    try {
      await snippetsDelete(id);
      set((state) => ({ snippets: state.snippets.filter((x) => x.id !== id), error: null }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
  touch: async (id) => {
    try {
      await snippetsTouch(id);
      set((state) => ({
        snippets: state.snippets.map((x) => (x.id === id ? { ...x, last_used_at: Date.now() } : x)),
      }));
    } catch (e) {
      console.warn('snippets_touch failed', e);
    }
  },
}));
