import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ForwardStatus } from '../types';

export async function onForwardStatusForId(
  id: string,
  cb: (status: ForwardStatus) => void,
): Promise<UnlistenFn> {
  return listen<ForwardStatus>(`forward://status/${id}`, (event) => cb(event.payload));
}
