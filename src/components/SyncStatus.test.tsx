import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatus } from './SyncStatus';

vi.mock('../state/syncStore', () => ({
  useSyncStore: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useSyncStore } from '../state/syncStore';

function makeStore(overrides: Record<string, any> = {}) {
  return {
    syncState: null,
    loading: false,
    error: null,
    fetchStatus: vi.fn(),
    _listenForStateEvents: vi.fn().mockResolvedValue(() => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useSyncStore).mockImplementation((sel: any) => sel(makeStore()));
});

describe('SyncStatus', () => {
  it('renders nothing when no user', () => {
    const { container } = render(<SyncStatus />);
    expect(container.firstChild).toBeNull();
  });

  it('shows syncing label when status is syncing', () => {
    vi.mocked(useSyncStore).mockImplementation((sel: any) =>
      sel(makeStore({ syncState: { user: { id: 'u', email: null }, status: 'syncing', last_synced: null, pending_count: 0, error: null } }))
    );
    render(<SyncStatus />);
    expect(screen.getByLabelText('syncing')).toBeTruthy();
  });

  it('shows signed-in avatar when synced', () => {
    vi.mocked(useSyncStore).mockImplementation((sel: any) =>
      sel(makeStore({ syncState: { user: { id: 'u', email: 'alice@example.com' }, status: 'synced', last_synced: 1000, pending_count: 0, error: null } }))
    );
    render(<SyncStatus />);
    const btn = screen.getByLabelText('Signed in as alice@example.com');
    expect(btn.textContent).toBe('A');
  });

  it('shows sync error label when status is error', () => {
    vi.mocked(useSyncStore).mockImplementation((sel: any) =>
      sel(makeStore({ syncState: { user: { id: 'u', email: null }, status: 'error', last_synced: null, pending_count: 0, error: 'timeout' } }))
    );
    render(<SyncStatus />);
    expect(screen.getByLabelText('sync error')).toBeTruthy();
  });
});
