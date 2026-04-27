import { describe, it, expect } from 'vitest';
import { parseSshTarget } from './sshTarget';

describe('parseSshTarget', () => {
  it('parses user@host', () => {
    expect(parseSshTarget('band@example.com')).toEqual({ user: 'band', host: 'example.com', port: 22 });
  });

  it('parses user@host:port', () => {
    expect(parseSshTarget('band@example.com:2222'))
      .toEqual({ user: 'band', host: 'example.com', port: 2222 });
  });

  it('host without user uses fallback', () => {
    expect(parseSshTarget('example.com', 'ndba'))
      .toEqual({ user: 'ndba', host: 'example.com', port: 22 });
  });

  it('rejects empty input', () => { expect(() => parseSshTarget('')).toThrow(); });
  it('rejects empty user', () => { expect(() => parseSshTarget('@host')).toThrow(); });
  it('rejects empty host', () => { expect(() => parseSshTarget('user@')).toThrow(); });
  it('rejects non-numeric port', () => { expect(() => parseSshTarget('a@b:abc')).toThrow(); });
  it('rejects out-of-range port', () => { expect(() => parseSshTarget('a@b:99999')).toThrow(); });

  it('parses bracketed IPv6', () => {
    expect(parseSshTarget('band@[::1]:2222'))
      .toEqual({ user: 'band', host: '::1', port: 2222 });
  });

  it('rejects malformed IPv6 brackets', () => { expect(() => parseSshTarget('band@[::1')).toThrow(); });
});
