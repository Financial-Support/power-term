import { create } from 'zustand';
import { tagColorDelete, tagColorSet, tagColorsList, tagDelete, tagRename } from '../lib/ipc';
import { useHostStore } from './hostStore';
import type { TagColor } from '../types';

interface State {
  /** name → color (#RRGGBB). Tags missing here use defaultColor(). */
  colors: Record<string, string>;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setColor: (name: string, color: string) => Promise<TagColor | null>;
  clearColor: (name: string) => Promise<void>;
  /** Rename a tag everywhere (color row + every host's tags). */
  renameTag: (oldName: string, newName: string) => Promise<boolean>;
  /** Delete a tag everywhere (color row + strip from every host). */
  deleteTag: (name: string) => Promise<boolean>;
}

export const useTagStore = create<State>((set) => ({
  colors: {},
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const list = await tagColorsList();
      const colors: Record<string, string> = {};
      for (const t of list) colors[t.name] = t.color;
      set({ colors, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
  setColor: async (name, color) => {
    try {
      const t = await tagColorSet(name, color);
      set((state) => ({ colors: { ...state.colors, [name]: t.color }, error: null }));
      return t;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },
  clearColor: async (name) => {
    try {
      await tagColorDelete(name);
      set((state) => {
        const next = { ...state.colors };
        delete next[name];
        return { colors: next, error: null };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  renameTag: async (oldName, newName) => {
    const o = oldName.trim();
    const n = newName.trim();
    if (o === '' || n === '') {
      set({ error: 'tag name cannot be empty' });
      return false;
    }
    if (o === n) return true;
    try {
      await tagRename(o, n);
      set((state) => {
        const next = { ...state.colors };
        // The backend keeps `new`'s color when both rows exist. Mirror that
        // here so the UI matches the persisted state without a refetch.
        const merged = next[n] ?? next[o];
        delete next[o];
        if (merged !== undefined) next[n] = merged;
        return { colors: next, error: null };
      });
      // Hosts now reference the new name; reload to keep filters/chips in sync.
      await useHostStore.getState().load();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },
  deleteTag: async (name) => {
    try {
      await tagDelete(name);
      set((state) => {
        const next = { ...state.colors };
        delete next[name];
        return { colors: next, error: null };
      });
      await useHostStore.getState().load();
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },
}));

/**
 * Deterministic fallback color for tags that don't have an explicit color.
 * Hashes the name so each tag gets a stable hue across renders / reloads.
 * Used by every tag chip when the store has no entry for that name.
 */
export function defaultColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % 360;
  return hslToHex(hue, 55, 55);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60)        [r, g, b] = [c, x, 0];
  else if (h < 120)  [r, g, b] = [x, c, 0];
  else if (h < 180)  [r, g, b] = [0, c, x];
  else if (h < 240)  [r, g, b] = [0, x, c];
  else if (h < 300)  [r, g, b] = [x, 0, c];
  else               [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}
