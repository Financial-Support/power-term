import { describe, expect, it } from 'vitest';
import type { Host } from '../types';
import { bastionRef, eligibleBastions, resolveBastion, withBastionRef } from './bastion';

const host = (overrides: Partial<Host>): Host => ({
  id: 'host-1',
  name: 'Host',
  hostname: 'host.example.com',
  port: 22,
  username: 'ops',
  group_name: null,
  tags: [],
  auth_method: 'agent',
  key_path: null,
  notes: null,
  created_at: 0,
  updated_at: 0,
  last_used_at: null,
  ...overrides,
});

describe('bastion metadata', () => {
  it('replaces internal bastion metadata without changing visible tags', () => {
    expect(withBastionRef(['prod', 'proxyjump:old'], 'jump-2'))
      .toEqual(['prod', 'proxyjump:jump-2']);
    expect(withBastionRef(['prod', 'proxyjump:old'], null)).toEqual(['prod']);
  });

  it('resolves both stable host ids and legacy imported names', () => {
    const jump = host({ id: 'jump-1', name: 'gateway' });
    expect(resolveBastion(host({ tags: ['proxyjump:jump-1'] }), [jump])).toBe(jump);
    expect(resolveBastion(host({ tags: ['proxyjump:gateway'] }), [jump])).toBe(jump);
  });

  it('only offers direct hosts and excludes the host being edited', () => {
    const direct = host({ id: 'direct', name: 'Direct' });
    const chained = host({ id: 'chained', name: 'Chained', tags: ['proxyjump:direct'] });
    expect(eligibleBastions([direct, chained], 'chained')).toEqual([direct]);
    expect(bastionRef(chained.tags)).toBe('direct');
  });
});
