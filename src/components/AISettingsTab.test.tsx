import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AISettingsTab } from './AISettingsTab';
import { useSettingsStore } from '../state/settingsStore';
import { secretGet, secretSet } from '../lib/ipc';
import type { Settings } from '../types';

vi.mock('../lib/ipc', () => ({
  secretGet: vi.fn(),
  secretSet: vi.fn(),
}));

const defaults: Settings = {
  shell: null,
  font_family: 'JetBrains Mono',
  font_size: 14,
  theme: 'auto',
  cursor_blink: true,
  cursor_style: 'block',
  scrollback_lines: 10000,
  ssh_connect_timeout_secs: 10,
  ssh_keepalive_interval_secs: 30,
  terminal_theme: 'default',
  accent_color: 'system',
  quick_theme_panel_open: false,
  accent_dock_open: true,
  ai_endpoint: 'https://api.anthropic.com/v1/messages',
  ai_model: 'claude-sonnet-4-6',
  ai_include_terminal_context: false,
  updated_at: 0,
};

beforeEach(() => {
  useSettingsStore.setState({ settings: defaults, loading: false, error: null });
  vi.mocked(secretGet).mockResolvedValue(null);
  vi.mocked(secretSet).mockResolvedValue(undefined);
  vi.clearAllMocks();
});

describe('AISettingsTab', () => {
  it('saves provider settings and API key together', async () => {
    const updateSpy = vi.spyOn(useSettingsStore.getState(), 'update').mockResolvedValue();
    render(<AISettingsTab />);

    const endpoint = screen.getByLabelText('Endpoint');
    const model = screen.getByLabelText('Model');
    const key = screen.getByLabelText('API key');
    await userEvent.clear(endpoint);
    await userEvent.type(endpoint, 'http://localhost:8080/v1/chat/completions');
    await userEvent.clear(model);
    await userEvent.type(model, 'qwen2.5');
    await userEvent.type(key, 'sk-test');
    await userEvent.click(screen.getByLabelText(/allow terminal context/i));
    await userEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
      ai_endpoint: 'http://localhost:8080/v1/chat/completions',
      ai_model: 'qwen2.5',
      ai_include_terminal_context: true,
    }));
    expect(secretSet).toHaveBeenCalledWith('__ai_anthropic', 'sk-test');
    expect(screen.queryByRole('button', { name: 'Save API key' })).not.toBeInTheDocument();
    expect(screen.queryByText(/sent directly to the configured endpoint/i)).not.toBeInTheDocument();
    updateSpy.mockRestore();
  });
});
