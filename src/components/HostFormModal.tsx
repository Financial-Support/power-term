import { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { useHostStore } from '../state/hostStore';
import { useSshKeyStore } from '../state/sshKeyStore';
import type { AuthMethodKind, Host, HostInput } from '../types';
import { TagsMultiPicker } from './TagsMultiPicker';

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
  /** When true, disable Save and show a spinner — set by App.tsx while
   *  the create/update + sync push round-trip is in flight. */
  saving?: boolean;
}

export function HostFormModal({ mode, host, onSave, onCancel, saving }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const sshKeys = useSshKeyStore((s) => s.keys);
  const loadKeys = useSshKeyStore((s) => s.load);

  const [name, setName] = useState(host?.name ?? '');
  const [hostname, setHostname] = useState(host?.hostname ?? '');
  const [port, setPort] = useState<number>(host?.port ?? 22);
  const [username, setUsername] = useState(host?.username ?? '');
  const [groupName, setGroupName] = useState(host?.group_name ?? '');
  const [tags, setTags] = useState<string[]>(host?.tags ?? []);
  const [authMethod, setAuthMethod] = useState<AuthMethodKind>(host?.auth_method ?? 'agent');
  const [keyPath, setKeyPath] = useState(host?.key_path ?? '');
  const [secret, setSecret] = useState('');
  const [secretDirty, setSecretDirty] = useState(false);
  const [saveSecret, setSaveSecret] = useState(true);
  const [saveSecretDirty, setSaveSecretDirty] = useState(false);
  const [notes, setNotes] = useState(host?.notes ?? '');

  // Lazy-load saved keys the first time the form opens; the store caches
  // the result so reopening the form is instant.
  useEffect(() => { void loadKeys(); }, [loadKeys]);

  // Pre-existing groups derived from the current host list — used as
  // <datalist> suggestions so the user can pick instead of retyping.
  // Includes the currently-edited host's group to keep autocomplete
  // consistent even before the next refresh.
  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) if (h.group_name) set.add(h.group_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [hosts]);

  useEffect(() => {
    setSecret('');
    setSecretDirty(false);
    setSaveSecretDirty(false);
  }, [authMethod]);

  // Esc closes the modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const browseKeyPath = async () => {
    let defaultPath: string | undefined;
    try {
      const home = await homeDir();
      defaultPath = `${home.replace(/\/$/, '')}/.ssh`;
    } catch { /* ignore — dialog will fall back to its default */ }
    const picked = await openDialog({
      multiple: false,
      directory: false,
      title: 'Select private key',
      defaultPath,
    });
    if (typeof picked === 'string' && picked.length > 0) {
      setKeyPath(picked);
    }
  };

  const validatePort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;

  const validForm =
    name.trim() !== '' &&
    hostname.trim() !== '' &&
    username.trim() !== '' &&
    validatePort(port) &&
    (authMethod !== 'key' || keyPath.trim() !== '');

  const submit = () => {
    if (!validForm) return;
    const cleaned = tags
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const dedupedTags = Array.from(new Set(cleaned));
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
          <input
            id="hfm-group"
            list="hfm-groups"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Personal"
          />
          <datalist id="hfm-groups">
            {existingGroups.map((g) => <option key={g} value={g} />)}
          </datalist>

          <label htmlFor="hfm-tags">Tags</label>
          <TagsMultiPicker id="hfm-tags" value={tags} onChange={setTags} />
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
            <label htmlFor="hfm-key-select">Saved keys</label>
            <select
              id="hfm-key-select"
              value={sshKeys.find((k) => k.path === keyPath)?.id ?? ''}
              onChange={(e) => {
                const k = sshKeys.find((x) => x.id === e.target.value);
                if (k) setKeyPath(k.path);
                else setKeyPath('');
              }}
            >
              <option value="">— custom path below —</option>
              {sshKeys.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ({k.path})</option>
              ))}
            </select>

            <label htmlFor="hfm-key-path">Key path</label>
            <div className="key-path-row">
              <input id="hfm-key-path" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} placeholder="/Users/you/.ssh/id_ed25519" />
              <button type="button" className="key-path-browse" onClick={() => void browseKeyPath()}>Browse…</button>
            </div>

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
          <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!validForm || saving}>
            {saving && <span className="db-spinner inline-spinner" aria-hidden />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
