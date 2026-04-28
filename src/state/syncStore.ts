import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SyncState } from '../types';

interface SyncStoreState {
  syncState: SyncState | null;
  loading: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  pull: () => Promise<void>;
  getKey: () => Promise<string>;
  setKey: (keyB58: string) => Promise<void>;
  _listenForStateEvents: () => Promise<() => void>;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  syncState: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const state = await invoke<SyncState>('sync_status');
      set({ syncState: state, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  signIn: async () => {
    try {
      await invoke('sync_sign_in');
    } catch (e) {
      set({ error: String(e) });
    }
  },

  signOut: async () => {
    try {
      await invoke('sync_sign_out');
      set((s) => ({
        syncState: s.syncState ? { ...s.syncState, user: null, status: 'idle' as const } : null,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  pull: async () => {
    set({ loading: true });
    try {
      const state = await invoke<SyncState>('sync_pull');
      set({ syncState: state, loading: false, error: null });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  getKey: async () => {
    return invoke<string>('sync_get_key');
  },

  setKey: async (keyB58: string) => {
    await invoke('sync_set_key', { keyB58 });
  },

  _listenForStateEvents: async () => {
    return listen<SyncState>('sync:state', (event) => {
      set({ syncState: event.payload });
    });
  },
}));
