import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import { useSettingsStore } from '../state/settingsStore';
import type { Settings } from '../types';

const defaults: Settings = {
  shell: null, font_family: 'SF Mono', font_size: 14, theme: 'auto',
  cursor_blink: true, scrollback_lines: 10000,
  ssh_connect_timeout_secs: 10, ssh_keepalive_interval_secs: 30,
  terminal_theme: 'default', updated_at: 0,
};

beforeEach(() => {
  useSettingsStore.setState({ settings: defaults, loading: false, error: null });
});

describe('SettingsModal', () => {
  it('renders with current settings pre-filled', () => {
    render(<SettingsModal onClose={vi.fn()} />);
    expect((screen.getByLabelText(/font family/i) as HTMLInputElement).value).toBe('SF Mono');
    expect((screen.getByLabelText(/font size/i) as HTMLInputElement).value).toBe('14');
  });

  it('Save calls settingsStore.update with only changed fields', async () => {
    const updateSpy = vi.spyOn(useSettingsStore.getState(), 'update').mockResolvedValue();
    render(<SettingsModal onClose={vi.fn()} />);
    const fontSizeInput = screen.getByLabelText(/font size/i);
    await userEvent.clear(fontSizeInput);
    await userEvent.type(fontSizeInput, '18');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ font_size: 18 }));
    updateSpy.mockRestore();
  });

  it('Save is disabled when font size is out of range', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    const fontSizeInput = screen.getByLabelText(/font size/i);
    await userEvent.clear(fontSizeInput);
    await userEvent.type(fontSizeInput, '5');
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save is disabled when scrollback lines is out of range', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /terminal/i }));
    const scrollbackInput = screen.getByLabelText(/scrollback/i);
    await userEvent.clear(scrollbackInput);
    await userEvent.type(scrollbackInput, '50');
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Cancel calls onClose without saving', async () => {
    const onClose = vi.fn();
    const updateSpy = vi.spyOn(useSettingsStore.getState(), 'update').mockResolvedValue();
    render(<SettingsModal onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    updateSpy.mockRestore();
  });

  it('Esc calls onClose', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('switching to Terminal tab shows Scrollback input', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /terminal/i }));
    expect(screen.getByLabelText(/scrollback/i)).toBeInTheDocument();
  });
});
