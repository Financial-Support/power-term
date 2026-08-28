type TerminalContextReader = () => string;

const readers = new Map<string, TerminalContextReader>();

export function registerTerminalContext(ptyId: string, reader: TerminalContextReader): () => void {
  readers.set(ptyId, reader);
  return () => {
    if (readers.get(ptyId) === reader) readers.delete(ptyId);
  };
}

export function getTerminalContext(ptyId: string): string {
  try {
    return readers.get(ptyId)?.() ?? '';
  } catch {
    return '';
  }
}
