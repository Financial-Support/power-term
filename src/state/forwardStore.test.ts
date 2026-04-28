import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ipc', () => ({
  forwardsList: vi.fn(),
  forwardsCreate: vi.fn(),
  forwardsUpdate: vi.fn(),
  forwardsDelete: vi.fn(),
  forwardStart: vi.fn(),
  forwardStop: vi.fn(),
  forwardsStatusAll: vi.fn(),
}));

import { forwardsList, forwardsCreate, forwardsUpdate, forwardsDelete, forwardStart, forwardStop } from '../lib/ipc';
import { useForwardStore } from './forwardStore';
import type { Forward, ForwardInput, ForwardStatus } from '../types';

const sample = (overrides: Partial<Forward> = {}): Forward => ({
  id: 'f1', host_id: 'h1', name: 'tunnel', kind: 'local',
  bind_addr: '127.0.0.1', bind_port: 5432, remote_host: 'db.local', remote_port: 5432,
  auto_start: false, created_at: 1000, ...overrides,
});
const sampleInput = (): ForwardInput => ({
  host_id: 'h1', name: 'tunnel', kind: 'local',
  bind_addr: '127.0.0.1', bind_port: 5432, remote_host: 'db.local', remote_port: 5432,
  auto_start: false,
});

beforeEach(() => {
  useForwardStore.setState({ forwards: [], statuses: {}, loading: false, error: null });
  vi.clearAllMocks();
});

describe('forwardStore', () => {
  it('load fills forwards', async () => {
    (forwardsList as any).mockResolvedValue([sample({ id: 'a' }), sample({ id: 'b' })]);
    await useForwardStore.getState().load();
    expect(useForwardStore.getState().forwards.map(f => f.id)).toEqual(['a', 'b']);
  });

  it('create prepends', async () => {
    (forwardsCreate as any).mockResolvedValue(sample({ id: 'new' }));
    await useForwardStore.getState().create(sampleInput());
    expect(useForwardStore.getState().forwards[0].id).toBe('new');
  });

  it('update replaces by id', async () => {
    (forwardsUpdate as any).mockResolvedValue(sample({ id: 'a', name: 'changed' }));
    useForwardStore.setState({ forwards: [sample({ id: 'a' })] });
    await useForwardStore.getState().update('a', sampleInput());
    expect(useForwardStore.getState().forwards[0].name).toBe('changed');
  });

  it('delete removes', async () => {
    (forwardsDelete as any).mockResolvedValue(undefined);
    useForwardStore.setState({ forwards: [sample({ id: 'a' }), sample({ id: 'b' })] });
    await useForwardStore.getState().delete('a');
    expect(useForwardStore.getState().forwards.map(f => f.id)).toEqual(['b']);
  });

  it('start updates statuses on success', async () => {
    const ok: ForwardStatus = { id: 'a', state: 'running', error: null };
    (forwardStart as any).mockResolvedValue(ok);
    await useForwardStore.getState().start('a');
    expect(useForwardStore.getState().statuses['a']).toEqual(ok);
  });

  it('stop updates statuses to stopped', async () => {
    const stopped: ForwardStatus = { id: 'a', state: 'stopped', error: null };
    (forwardStop as any).mockResolvedValue(stopped);
    await useForwardStore.getState().stop('a');
    expect(useForwardStore.getState().statuses['a']).toEqual(stopped);
  });

  it('setStatus merges from event', () => {
    useForwardStore.getState().setStatus({ id: 'a', state: 'running', error: null });
    expect(useForwardStore.getState().statuses['a'].state).toBe('running');
  });

  it('start captures error in store on rejection', async () => {
    (forwardStart as any).mockRejectedValue(new Error('bind: address in use'));
    await useForwardStore.getState().start('a');
    expect(useForwardStore.getState().statuses['a'].state).toBe('error');
    expect(useForwardStore.getState().statuses['a'].error).toMatch(/in use/);
  });
});
