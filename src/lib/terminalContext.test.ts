import { describe, expect, it } from 'vitest';
import { getTerminalContext, registerTerminalContext } from './terminalContext';

describe('terminalContext', () => {
  it('reads a registered terminal and unregisters it safely', () => {
    const stop = registerTerminalContext('pty-test', () => 'last output');
    expect(getTerminalContext('pty-test')).toBe('last output');
    stop();
    expect(getTerminalContext('pty-test')).toBe('');
  });
});
