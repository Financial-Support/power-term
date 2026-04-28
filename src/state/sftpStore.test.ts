import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/ipc', () => ({
  sftpList: vi.fn(),
  sftpCanonicalize: vi.fn(),
  sftpMkdir: vi.fn(),
  sftpRemoveFile: vi.fn(),
  sftpRemoveDir: vi.fn(),
  sftpRename: vi.fn(),
}));

import { sftpList, sftpCanonicalize } from '../lib/ipc';
import { useSftpStore } from './sftpStore';
import type { SftpEntry } from '../types';

const sample = (overrides: Partial<SftpEntry> = {}): SftpEntry => ({
  name: 'foo.txt', kind: 'file', size: 100, modified_ms: 1700000000000,
  permissions: 420, symlink_target: null, ...overrides,
});

beforeEach(() => {
  useSftpStore.setState({ tabs: {} });
  vi.clearAllMocks();
});

describe('sftpStore', () => {
  it('init() seeds a tab with cwd and loads entries', async () => {
    (sftpCanonicalize as any).mockResolvedValue('/home/alice');
    (sftpList as any).mockResolvedValue([sample({ name: 'a.txt' }), sample({ name: 'b' , kind: 'dir' })]);
    await useSftpStore.getState().init('tab-1', 'sftp-id-1');
    const t = useSftpStore.getState().tabs['tab-1'];
    expect(t.cwd).toBe('/home/alice');
    expect(t.entries.map((e) => e.name)).toEqual(['a.txt', 'b']);
    expect(t.loading).toBe(false);
  });

  it('navigate() sets cwd and reloads', async () => {
    useSftpStore.setState({
      tabs: { 't': { sftpId: 's', cwd: '/home', entries: [], loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false } },
    });
    (sftpList as any).mockResolvedValue([sample({ name: 'x' })]);
    await useSftpStore.getState().navigate('t', '/home/sub');
    expect(useSftpStore.getState().tabs['t'].cwd).toBe('/home/sub');
    expect(useSftpStore.getState().tabs['t'].entries[0].name).toBe('x');
  });

  it('navigate captures error on failure', async () => {
    useSftpStore.setState({
      tabs: { 't': { sftpId: 's', cwd: '/home', entries: [], loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false } },
    });
    (sftpList as any).mockRejectedValue(new Error('boom'));
    await useSftpStore.getState().navigate('t', '/nope');
    expect(useSftpStore.getState().tabs['t'].error).toMatch(/boom/);
  });

  it('toggleSort flips sortAsc when key matches; otherwise sets new key + asc', () => {
    useSftpStore.setState({
      tabs: { 't': { sftpId: 's', cwd: '/', entries: [], loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false } },
    });
    useSftpStore.getState().toggleSort('t', 'name');
    expect(useSftpStore.getState().tabs['t'].sortAsc).toBe(false);
    useSftpStore.getState().toggleSort('t', 'size');
    expect(useSftpStore.getState().tabs['t'].sortKey).toBe('size');
    expect(useSftpStore.getState().tabs['t'].sortAsc).toBe(true);
  });

  it('toggleHidden flips showHidden', () => {
    useSftpStore.setState({
      tabs: { 't': { sftpId: 's', cwd: '/', entries: [], loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false } },
    });
    useSftpStore.getState().toggleHidden('t');
    expect(useSftpStore.getState().tabs['t'].showHidden).toBe(true);
  });

  it('closeTab removes tab state', () => {
    useSftpStore.setState({
      tabs: { 't': { sftpId: 's', cwd: '/', entries: [], loading: false, error: null, sortKey: 'name', sortAsc: true, showHidden: false } },
    });
    useSftpStore.getState().closeTab('t');
    expect(useSftpStore.getState().tabs['t']).toBeUndefined();
  });
});
