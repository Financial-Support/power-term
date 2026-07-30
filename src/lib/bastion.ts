import type { Host } from '../types';

export const BASTION_TAG_PREFIX = 'proxyjump:';

export function bastionRef(tags: string[]): string | null {
  const tag = tags.find((value) => value.startsWith(BASTION_TAG_PREFIX));
  const ref = tag?.slice(BASTION_TAG_PREFIX.length).trim();
  return ref ? ref : null;
}

export function resolveBastion(host: Host, hosts: Host[]): Host | null {
  const ref = bastionRef(host.tags);
  if (!ref) return null;
  return hosts.find((candidate) => candidate.id === ref)
    ?? hosts.find((candidate) => candidate.name === ref)
    ?? null;
}

export function withBastionRef(tags: string[], ref: string | null): string[] {
  const visible = tags.filter((value) => !value.startsWith(BASTION_TAG_PREFIX));
  return ref ? [...visible, `${BASTION_TAG_PREFIX}${ref}`] : visible;
}

export function eligibleBastions(hosts: Host[], currentHostId?: string): Host[] {
  return hosts
    .filter((candidate) => candidate.id !== currentHostId && bastionRef(candidate.tags) === null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
