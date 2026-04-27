import { useEffect, useState } from 'react';
import type { AuthMethodKind, Host, HostInput } from '../types';

export interface HostFormSaveArgs {
  input: HostInput;
  secret: string | null;
  saveSecret: boolean;
  forgetSecret: boolean;
}

interface Props {
  mode: 'create' | 'edit';
  host?: Host;
  onSave: (args: HostFormSaveArgs) => void;
  onCancel: () => void;
}

export function HostFormModal({ mode, host, onSave, onCancel }: Props) {
  const [name, setName] = useState(host?.name ?? '');
  const [hostname, setHostname] = useState(host?.hostname ?? '');
  const [port, setPort] = useState<number>(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? '');
  const [groupName, setGroupName] = useState(host?.group_name ?? '');
  const [tagsText, setTagsText] = useState((host?.tags ?? []).join(', '));
  const [authMethod, setAuthMethod] = useState<AuthMethodKind>(host?.auth_method ?? 'agent');
  const [keyPath, setKeyPath] = useState(host?.key_path ?? '');
  const [secret, setSecret] = useState('');
  const [secretDirty, setSecretDirty] = useState(false);
  const [saveSecret, setSaveSecret] = useState(true);
  const [saveSecretDirty, setSaveSecretDirty] = useState(false);
  const [notes, setNotes] = useState(host?.notes ?? '');

  useEffect(() => {
    setSecret('');
    setSecretDirty(false);
    setSaveSecretDirty(false);
  }, [authMethod]);

  const validatePort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;

  const validForm =
    name.trim() !== '' &&
    hostname.trim() !== '' &&
    username.trim() !== '' &&
    validatePort(port) &&
    (authMethod !== 'key' || keyPath.trim() !== '');

  const submit = () => {
    if (!validForm) return;
    const tags = tagsText.split(/[,\n]/).map((t) => t.trim()).filter((t) => t.length > 0);
    const dedupedTags = Array.from(new Set(tags));
    const input: HostInput = {
      name: name.trim(),
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      group_name: groupName.trim() === '' ? null : groupName.trim(),
      tags: dedupedTags,
      auth_method: authMethod,
      key_path: authMethod === 'key' ? keyPath.trim() : null,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    const wantsSecret =
      (authMethod === 'password' && secret !== '') ||
      (authMethod === 'key' && secret !== '');
    // forgetSecret fires when the user explicitly turned off "Save to Keychain"
    // (saveSecretDirty) and isn't writing a new secret. The Keychain wrapper's
    // delete is idempotent, so this safely no-ops if no secret was stored.
    onSave({
      input,
      secret: wantsSecret ? secret : null,
      saveSecret: wantsSecret && saveSecret,
      forgetSecret: !saveSecret && !wantsSecret && (saveSecretDirty || secretDirty),
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="host form">
      <div className="modal modal-form">
        <h2>{mode === 'create' ? 'Add host' : 'Edit host'}</h2>
        <div className="form-grid">
          <label htmlFor="hfm-name">Name</label>
          <input id="hfm-name" value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="hfm-hostname">Hostname</label>
          <input id="hfm-hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} />

          <label htmlFor="hfm-port">Port</label>
          <input id="hfm-port" type="number" min={1} max={65535} value={port}
            onChange={(e) => setPort(Number(e.target.value))} />

          <label htmlFor="hfm-username">Username</label>
          <input id="hfm-username" value={username} onChange={(e) => setUsername(e.target.value)} />

          <label htmlFor="hfm-group">Group</label>
          <input id="hfm-group" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Personal" />

          <label htmlFor="hfm-tags">Tags</label>
          <input id="hfm-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="prod, db" />
        </div>

        <fieldset className="auth-method">
          <legend>Authentication</legend>
          <label>
            <input type="radio" name="auth" checked={authMethod === 'agent'} onChange={() => setAuthMethod('agent')} /> SSH agent
          </label>
          <label>
            <input type="radio" id="hfm-auth-key" name="auth" checked={authMethod === 'key'} onChange={() => setAuthMethod('key')} /> Private key
          </label>
          <label>
            <input type="radio" name="auth" checked={authMethod === 'password'} onChange={() => setAuthMethod('password')} /> Password
          </label>
        </fieldset>

        {authMethod === 'key' && (
          <div className="auth-fields">
            <label htmlFor="hfm-key-path">Key path</label>
            <input id="hfm-key-path" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="/Users/you/.ssh/id_ed25519" />

            <label htmlFor="hfm-passphrase">Passphrase (optional)</label>
            <input id="hfm-passphrase" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }} />

            <label className="checkbox">
              <input type="checkbox" checked={saveSecret} onChange={(e) => { setSaveSecret(e.target.checked); setSaveSecretDirty(true); }} /> Save passphrase to Keychain
            </label>
          </div>
        )}

        {authMethod === 'password' && (
          <div className="auth-fields">
            <label htmlFor="hfm-password">Password</label>
            <input id="hfm-password" type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSecretDirty(true); }} />

            <label className="checkbox">
              <input type="checkbox" checked={saveSecret} onChange={(e) => { setSaveSecret(e.target.checked); setSaveSecretDirty(true); }} /> Save password to Keychain
            </label>
          </div>
        )}

        <label htmlFor="hfm-notes">Notes</label>
        <textarea id="hfm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!validForm}>Save</button>
        </div>
      </div>
    </div>
  );
}
