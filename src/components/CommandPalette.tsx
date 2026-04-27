import { useState } from 'react';
import { parseSshTarget } from '../lib/sshTarget';
import type { SshTarget } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSshConnect: (target: SshTarget) => void;
}

export function CommandPalette({ open, onClose, onSshConnect }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed.toLowerCase().startsWith('ssh ')) {
        const arg = trimmed.slice(4).trim();
        try {
          const target = parseSshTarget(arg);
          onSshConnect(target);
          setText('');
          setError(null);
          onClose();
        } catch (err) {
          setError(String((err as Error).message ?? err));
        }
      } else {
        setError('only "ssh user@host[:port]" is supported in this build');
      }
    }
  };

  return (
    <div className="palette-backdrop" role="dialog" aria-label="command palette" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="ssh user@host[:port]"
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={handleKey}
        />
        {error && <p className="palette-error">{error}</p>}
      </div>
    </div>
  );
}
