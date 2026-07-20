const C0_DEL = '\x7f';

/**
 * Returns the bytes still needed after xterm handles a WebKit insertText event.
 * macOS IMEs can put a whole committed syllable in InputEvent.data while xterm
 * emits only the first keydown character.
 */
export function reconcileImeInsertText(emitted: string, committed: string): string {
  if (emitted.normalize('NFC') === committed.normalize('NFC')) return '';
  if (!emitted) return committed;
  if (committed.startsWith(emitted)) return committed.slice(emitted.length);
  return C0_DEL.repeat([...emitted].length) + committed;
}
