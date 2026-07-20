import { describe, expect, it } from 'vitest';
import { reconcileImeInsertText } from './imeInput';

describe('reconcileImeInsertText', () => {
  it.each([
    ['i', 'iệt', 'ệt'],
    ['t', 'tiếng', 'iếng'],
    ['e', 'ếng', '\x7fếng'],
    ['a', 'ắn', '\x7fắn'],
    ['o', 'ồng', '\x7fồng'],
    ['u', 'ưởi', '\x7fưởi'],
    ['d', 'đ', '\x7fđ'],
    ['', 'ế', 'ế'],
    ['Việt', 'Việt', ''],
  ])('reconciles %j with %j', (emitted, committed, expected) => {
    expect(reconcileImeInsertText(emitted, committed)).toBe(expected);
  });

  it('treats canonically equivalent Unicode as already committed', () => {
    expect(reconcileImeInsertText('ế', 'e\u0302\u0301')).toBe('');
  });
});
