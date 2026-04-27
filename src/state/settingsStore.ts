import { create } from 'zustand';
import { settingsGet, settingsUpdate } from '../lib/ipc';
import type { Settings, SettingsPatch } from '../types';

interface State {
  settings: Settings | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  update: (patch: SettingsPatch) => Promise<void>;
}

export const useSettingsStore = create<State>((set) => ({
  settings: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const s = await settingsGet();
      set({ settings: s, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  update: async (patch) => {
    try {
      const s = await settingsUpdate(patch);
      set({ settings: s });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
