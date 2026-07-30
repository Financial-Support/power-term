import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

/** Show a native file picker for the user to choose a single local file. */
export async function pickLocalFile(): Promise<string | null> {
  const result = await openDialog({ multiple: false, directory: false });
  if (!result) return null;
  if (Array.isArray(result)) return result[0] ?? null;
  return typeof result === 'string' ? result : null;
}

/** Show a native file picker for one or more local files. */
export async function pickLocalFiles(): Promise<string[]> {
  const result = await openDialog({ multiple: true, directory: false });
  if (!result) return [];
  if (Array.isArray(result)) return result;
  return typeof result === 'string' ? [result] : [];
}

/** Show a native save dialog for the user to choose a destination path. */
export async function pickLocalSavePath(suggested: string): Promise<string | null> {
  const result = await saveDialog({ defaultPath: suggested });
  return result ?? null;
}
