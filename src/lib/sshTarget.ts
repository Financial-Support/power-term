import type { SshTarget } from '../types';

export function parseSshTarget(input: string, defaultUser?: string): SshTarget {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('empty target');

  let user = defaultUser ?? '';
  let rest = trimmed;
  const at = trimmed.indexOf('@');
  if (at >= 0) {
    user = trimmed.slice(0, at);
    rest = trimmed.slice(at + 1);
    if (!user) throw new Error('empty user');
  }
  if (!user) throw new Error('user required');
  if (!rest) throw new Error('empty host');

  let host: string;
  let port = 22;
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) throw new Error('unterminated [bracket]');
    host = rest.slice(1, end);
    const after = rest.slice(end + 1);
    if (after.startsWith(':')) {
      port = parsePort(after.slice(1));
    } else if (after.length > 0) {
      throw new Error('unexpected chars after bracket');
    }
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon >= 0) {
      host = rest.slice(0, colon);
      port = parsePort(rest.slice(colon + 1));
    } else {
      host = rest;
    }
  }
  if (!host) throw new Error('empty host');
  return { user, host, port };
}

function parsePort(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid port: ${s}`);
  return n;
}
