import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { encodeBase64, decodeBase64 } from './base64';
import type { PtyExitPayload, Settings, SettingsPatch } from '../types';

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
