import { describe, expect, it } from 'vitest';
import { nextFileSelection } from './fileSelection';

const keys = ['a', 'b', 'c', 'd'];

describe('nextFileSelection', () => {
  it('replaces the selection on a plain click', () => {
    const result = nextFileSelection(keys, new Set(['a', 'b']), 'a', 'c', { toggle: false, range: false });
    expect([...result.selected]).toEqual(['c']);
    expect(result.anchor).toBe('c');
  });

  it('toggles one item with the platform modifier', () => {
    const added = nextFileSelection(keys, new Set(['a']), 'a', 'c', { toggle: true, range: false });
    expect([...added.selected]).toEqual(['a', 'c']);
    const removed = nextFileSelection(keys, added.selected, added.anchor, 'a', { toggle: true, range: false });
    expect([...removed.selected]).toEqual(['c']);
  });

  it('selects a contiguous range with shift', () => {
    const result = nextFileSelection(keys, new Set(['b']), 'b', 'd', { toggle: false, range: true });
    expect([...result.selected]).toEqual(['b', 'c', 'd']);
  });

  it('adds a range when shift and the platform modifier are held', () => {
    const result = nextFileSelection(keys, new Set(['a']), 'b', 'd', { toggle: true, range: true });
    expect([...result.selected]).toEqual(['a', 'b', 'c', 'd']);
  });
});
