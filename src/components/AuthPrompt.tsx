import { useEffect, useRef, useState } from 'react';
import type { AuthRequest } from '../types';

interface Props {
  user: string;
  host: string;
  triedAgent: boolean;
  errorMessage?: string;
  /** When the previous attempt failed with an actionable input error
   *  (e.g. encrypted key file), pass the auth that was tried so this
   *  prompt can preselect the same method and prefill the key path —
   *  the user usually only needs to type the passphrase. */
  initialAuth?: AuthRequest;
  onSubmit: (auth: AuthRequest) => void;
  onCancel: () => void;
}

type Method = 'agent' | 'key' | 'password';

function methodFromAuth(a?: AuthRequest): Method | null {
  if (!a) return null;
  if (a.kind === 'agent') return 'agent';
  if (a.kind === 'key') return 'key';
  return 'password';
}

export function AuthPrompt({ user, host, triedAgent, errorMessage, initialAuth, onSubmit, onCancel }: Props) {
  const initialMethod: Method = methodFromAuth(initialAuth) ?? (triedAgent ? 'key' : 'agent');
  const [method, setMethod] = useState<Method>(initialMethod);
  const [keyPath, setKeyPath] = useState(
    initialAuth?.kind === 'key' ? initialAuth.path : '',
  );
  const [keyPass, setKeyPass] = useState('');
  const [password, setPassword] = useState('');
  const passInputRef = useRef<HTMLInputElement>(null);

  // When the prompt opens because of an encrypted-key failure, focus the
  // passphrase field directly — the user has nothing else to fix.
  useEffect(() => {
    if (initialMethod === 'key' && keyPath !== '') {
      passInputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => {
    if (method === 'agent') return onSubmit({ kind: 'agent' });
    if (method === 'key') return onSubmit({ kind: 'key', path: keyPath, passphrase: keyPass || undefined });
    return onSubmit({ kind: 'password', password });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="ssh auth">
      <div className="modal">
        <h2>Authenticate to {user}@{host}</h2>
        {errorMessage && <p className="error">{errorMessage}</p>}
        <fieldset className="auth-method">
          <label><input type="radio" name="auth" checked={method === 'agent'} onChange={() => setMethod('agent')} /> SSH agent</label>
          <label><input type="radio" name="auth" checked={method === 'key'} onChange={() => setMethod('key')} /> Private key file</label>
          <label><input type="radio" name="auth" checked={method === 'password'} onChange={() => setMethod('password')} /> Password</label>
        </fieldset>
        {method === 'key' && (
          <div className="auth-fields">
            <input placeholder="/Users/you/.ssh/id_ed25519" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
            <input
              ref={passInputRef}
              type="password"
              placeholder="Passphrase (optional)"
              value={keyPass}
              onChange={(e) => setKeyPass(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </div>
        )}
        {method === 'password' && (
          <div className="auth-fields">
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit}>Connect</button>
        </div>
      </div>
    </div>
  );
}
