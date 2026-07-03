import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ipc', () => ({
  settingsGet: vi.fn(),
  settingsUpdate: vi.fn(),
}));

import { settingsGet, settingsUpdate } from '../lib/ipc';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  useSettingsStore.setState({ settings: null, loading: false, error: null });
  vi.clearAllMocks();
});

describe('settingsStore', () => {
  it('load() fills settings from ipc', async () => {
    (settingsGet as any).mockResolvedValue({
      shell: null, font_family: 'JetBrains Mono', font_size: 14,
      theme: 'auto', cursor_blink: true, cursor_style: 'block', accent_color: 'system', scrollback_lines: 10000,
      quick_theme_panel_open: false,
    });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings?.font_size).toBe(14);
  });

  it('update() merges via ipc and refreshes', async () => {
    (settingsUpdate as any).mockResolvedValue({
      shell: null, font_family: 'JetBrains Mono', font_size: 18,
      theme: 'auto', cursor_blink: true, cursor_style: 'block', accent_color: 'system', scrollback_lines: 10000,
      quick_theme_panel_open: false,
    });
    await useSettingsStore.getState().update({ font_size: 18 });
    expect(useSettingsStore.getState().settings?.font_size).toBe(18);
  });
});
