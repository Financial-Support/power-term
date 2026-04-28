import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SyncTab } from './SyncTab';

vi.mock('../state/syncStore', () => ({
  useSyncStore: vi.fn(),
}));

import { useSyncStore } from '../state/syncStore';

const makeMockStore = (overrides: Record<string, any> = {}) => ({
  syncState: null as any,
  loading: false,
  error: null as string | null,
  signIn: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue(undefined),
  getKey: vi.fn().mockResolvedValue(''),
  setKey: vi.fn().mockResolvedValue(undefined),
  fetchStatus: vi.fn(),
  _listenForStateEvents: vi.fn().mockResolvedValue(() => {}),
  ...overrides,
});

let mockStore = makeMockStore();

beforeEach(() => {
  mockStore = makeMockStore();
  vi.mocked(useSyncStore).mockImplementation((sel: any) => sel(mockStore));
  vi.clearAllMocks();
});

describe('SyncTab — not signed in', () => {
  it('shows Sign in with GitHub button', () => {
    render(<SyncTab />);
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeTruthy();
  });

  it('calls signIn when button clicked', async () => {
    render(<SyncTab />);
    fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }));
    await waitFor(() => expect(mockStore.signIn).toHaveBeenCalled());
  });
});

describe('SyncTab — signed in', () => {
  beforeEach(() => {
    mockStore = makeMockStore({
      syncState: {
        user: { id: 'u1', email: 'a@b.com' },
        status: 'synced',
        last_synced: 1000,
        pending_count: 0,
        error: null,
      },
      getKey: vi.fn().mockResolvedValue('FAKEKEYBASE58VALUE'),
    });
    vi.mocked(useSyncStore).mockImplementation((sel: any) => sel(mockStore));
  });

  it('shows user email', () => {
    render(<SyncTab />);
    expect(screen.getByText('a@b.com')).toBeTruthy();
  });

  it('shows Sign out button', () => {
    render(<SyncTab />);
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('calls signOut when sign out button clicked', async () => {
    render(<SyncTab />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(mockStore.signOut).toHaveBeenCalled());
  });

  it('shows Show button for sync key', async () => {
    render(<SyncTab />);
    expect(await screen.findByRole('button', { name: /show/i })).toBeTruthy();
  });
});
