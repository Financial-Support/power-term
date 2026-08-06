import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { UpdateTab } from './UpdateTab';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

beforeEach(() => {
  checkMock.mockReset();
  relaunchMock.mockReset();
  relaunchMock.mockResolvedValue(undefined);
});

describe('UpdateTab', () => {
  it('checks automatically and reports when the app is up to date', async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdateTab />);

    await waitFor(() => expect(screen.getByText('Up to date')).toBeInTheDocument());
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeEnabled();
  });

  it('offers installation and relaunches after downloading an update', async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      onEvent({ event: 'Finished', data: null });
    });
    checkMock.mockResolvedValue({
      version: '0.3.8',
      currentVersion: '0.3.7',
      body: 'Bug fixes',
      date: '2026-08-06T00:00:00Z',
      downloadAndInstall,
    } as never);

    render(<UpdateTab />);
    const installButton = await screen.findByRole('button', { name: /install v0\.3\.8/i });
    await userEvent.click(installButton);

    await waitFor(() => expect(downloadAndInstall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Installing')).toBeInTheDocument();
  });
});
