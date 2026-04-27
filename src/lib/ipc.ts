import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { encodeBase64, decodeBase64 } from './base64';
import type { PtyExitPayload, Settings, SettingsPatch, AuthRequest, SshConnectResult, SshTarget, Host, HostInput } from '../types';

export async function ptySpawn(args: {
  shell?: string | null;
  cwd?: string | null;
  cols: number;
  rows: number;
}): Promise<string> {
  return invoke<string>('pty_spawn', {
    shell: args.shell ?? null,
    cwd: args.cwd ?? null,
    cols: args.cols,
    rows: args.rows,
  });
}

export async function ptyWrite(ptyId: string, data: string | Uint8Array): Promise<void> {
  await invoke('pty_write', { ptyId, data: encodeBase64(data) });
}

export async function ptyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  await invoke('pty_resize', { ptyId, cols, rows });
}

export async function ptyKill(ptyId: string): Promise<void> {
  await invoke('pty_kill', { ptyId });
}

export async function settingsGet(): Promise<Settings> {
  return invoke<Settings>('settings_get');
}

export async function settingsUpdate(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>('settings_update', { patch });
}

export async function onPtyOutput(
  ptyId: string,
  cb: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${ptyId}`, (event) => {
    cb(decodeBase64(event.payload));
  });
}

export async function onPtyExit(
  ptyId: string,
  cb: (payload: PtyExitPayload) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitPayload>(`pty://exit/${ptyId}`, (event) => cb(event.payload));
}

export async function sshConnect(args: {
  target: SshTarget;
  auth: AuthRequest;
  cols: number;
  rows: number;
  acceptFingerprint?: string | null;
}): Promise<SshConnectResult> {
  return invoke<SshConnectResult>('ssh_connect', {
    target: args.target,
    auth: args.auth,
    cols: args.cols,
    rows: args.rows,
    acceptFingerprint: args.acceptFingerprint ?? null,
  });
}

export async function sshWrite(ptyId: string, data: string | Uint8Array): Promise<void> {
  await invoke('ssh_write', { ptyId, data: encodeBase64(data) });
}

export async function sshResize(ptyId: string, cols: number, rows: number): Promise<void> {
  await invoke('ssh_resize', { ptyId, cols, rows });
}

export async function sshKill(ptyId: string): Promise<void> {
  await invoke('ssh_kill', { ptyId });
}

export async function knownHostsGet(host: string, port: number): Promise<{ fingerprint: string | null; key_type: string | null }> {
  return invoke('known_hosts_get', { host, port });
}

export async function hostsList(): Promise<Host[]> {
  return invoke<Host[]>('hosts_list');
}

export async function hostsCreate(input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_create', { input });
}

export async function hostsUpdate(id: string, input: HostInput): Promise<Host> {
  return invoke<Host>('hosts_update', { id, input });
}

export async function hostsDelete(id: string): Promise<void> {
  await invoke('hosts_delete', { id });
}

export async function hostsTouch(id: string): Promise<void> {
  await invoke('hosts_touch', { id });
}

export async function secretSet(hostId: string, secret: string): Promise<void> {
  await invoke('secret_set', { hostId, secret });
}

export async function secretGet(hostId: string): Promise<string | null> {
  return invoke<string | null>('secret_get', { hostId });
}

export async function secretDelete(hostId: string): Promise<void> {
  await invoke('secret_delete', { hostId });
}
