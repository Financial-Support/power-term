import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from '@tauri-apps/api/core';
import { useSyncStore } from './syncStore';

describe('syncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({
      syncState: null,
      loading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('has null initial syncState', () => {
    expect(useSyncStore.getState().syncState).toBeNull();
  });

  it('fetchStatus populates syncState', async () => {
    const mockState = {
      user: { id: 'u1', email: 'a@b.com' },
      status: 'synced',
      last_synced: 1000,
      pending_count: 0,
      error: null,
    };
    vi.mocked(invoke).mockResolvedValueOnce(mockState);
    await useSyncStore.getState().fetchStatus();
    expect(useSyncStore.getState().syncState?.status).toBe('synced');
  });

  it('signOut clears user in local state', async () => {
    useSyncStore.setState({
      syncState: { user: { id: 'u1', email: null }, status: 'synced', last_synced: null, pending_count: 0, error: null },
      loading: false,
      error: null,
    });
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await useSyncStore.getState().signOut();
    expect(useSyncStore.getState().syncState?.user).toBeNull();
  });

  it('pull sets syncState from invoke result', async () => {
    const syncedState = { user: null, status: 'synced', last_synced: 9999, pending_count: 0, error: null };
    vi.mocked(invoke).mockResolvedValueOnce(syncedState);
    await useSyncStore.getState().pull();
    expect(useSyncStore.getState().syncState?.status).toBe('synced');
  });

  it('getKey calls sync_get_key', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('ABC123XYZ');
    const key = await useSyncStore.getState().getKey();
    expect(key).toBe('ABC123XYZ');
    expect(invoke).toHaveBeenCalledWith('sync_get_key');
  });

  it('setKey calls sync_set_key with keyB58', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await useSyncStore.getState().setKey('MYKEY');
    expect(invoke).toHaveBeenCalledWith('sync_set_key', { keyB58: 'MYKEY' });
  });
});
