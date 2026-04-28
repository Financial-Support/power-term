import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ipc', () => ({
  hostsList: vi.fn(),
  hostsCreate: vi.fn(),
  hostsUpdate: vi.fn(),
  hostsDelete: vi.fn(),
  hostsTouch: vi.fn(),
}));

import { hostsList, hostsCreate, hostsUpdate, hostsDelete, hostsTouch } from '../lib/ipc';
import { useHostStore } from './hostStore';
import type { Host, HostInput } from '../types';

const sample = (overrides: Partial<Host> = {}): Host => ({
  id: 'h1', name: 'mac', hostname: 'example.com', port: 22, username: 'alice',
  group_name: 'Personal', tags: ['prod'], auth_method: 'agent',
  key_path: null, notes: null, created_at: 1000, updated_at: 0, last_used_at: null,
  ...overrides,
});

const sampleInput = (): HostInput => ({
  name: 'mac', hostname: 'example.com', port: 22, username: 'alice',
  group_name: 'Personal', tags: ['prod'], auth_method: 'agent',
  key_path: null, notes: null,
});

beforeEach(() => {
  useHostStore.setState({ hosts: [], loading: false, error: null });
  vi.clearAllMocks();
});

describe('hostStore', () => {
  it('load() fills hosts from ipc', async () => {
    (hostsList as any).mockResolvedValue([sample({ id: 'a' }), sample({ id: 'b', name: 'home' })]);
    await useHostStore.getState().load();
    expect(useHostStore.getState().hosts.map(h => h.id)).toEqual(['a', 'b']);
  });

  it('create() prepends and clears error', async () => {
    (hostsCreate as any).mockResolvedValue(sample({ id: 'new' }));
    useHostStore.setState({ hosts: [sample({ id: 'old' })] });
    await useHostStore.getState().create(sampleInput());
    const ids = useHostStore.getState().hosts.map(h => h.id);
    expect(ids).toContain('new');
    expect(ids).toContain('old');
  });

  it('update() replaces in place by id', async () => {
    (hostsUpdate as any).mockResolvedValue(sample({ id: 'a', name: 'changed' }));
    useHostStore.setState({ hosts: [sample({ id: 'a' })] });
    await useHostStore.getState().update('a', sampleInput());
    expect(useHostStore.getState().hosts[0].name).toBe('changed');
  });

  it('delete() removes from hosts', async () => {
    (hostsDelete as any).mockResolvedValue(undefined);
    useHostStore.setState({ hosts: [sample({ id: 'a' }), sample({ id: 'b' })] });
    await useHostStore.getState().delete('a');
    expect(useHostStore.getState().hosts.map(h => h.id)).toEqual(['b']);
  });

  it('touch() optimistically updates last_used_at', async () => {
    (hostsTouch as any).mockResolvedValue(undefined);
    useHostStore.setState({ hosts: [sample({ id: 'a', last_used_at: null })] });
    await useHostStore.getState().touch('a');
    expect(useHostStore.getState().hosts[0].last_used_at).not.toBeNull();
  });

  it('load() captures error on failure', async () => {
    (hostsList as any).mockRejectedValue(new Error('boom'));
    await useHostStore.getState().load();
    expect(useHostStore.getState().error).toMatch(/boom/);
  });
});
