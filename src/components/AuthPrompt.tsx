import { useState } from 'react';
import type { AuthRequest } from '../types';

interface Props {
  user: string;
  host: string;
  triedAgent: boolean;
  errorMessage?: string;
  onSubmit: (auth: AuthRequest) => void;
  onCancel: () => void;
}

type Method = 'agent' | 'key' | 'password';

export function AuthPrompt({ user, host, triedAgent, errorMessage, onSubmit, onCancel }: Props) {
  const [method, setMethod] = useState<Method>(triedAgent ? 'key' : 'agent');
  const [keyPath, setKeyPath] = useState('');
  const [keyPass, setKeyPass] = useState('');
  const [password, setPassword] = useState('');

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
            <input type="password" placeholder="Passphrase (optional)" value={keyPass} onChange={(e) => setKeyPass(e.target.value)} />
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
