import { useEffect, useState } from 'react';
import { secretGet, secretSet, secretDelete } from '../lib/ipc';
import { KeyIcon, SparklesIcon } from './AppIcons';

const SECRET_KEY = '__ai_anthropic';

/** Settings panel for the AI command bar. The Anthropic API key is held in
 *  the OS keychain via the existing secret_set/get plumbing (keyed under the
 *  reserved id `__ai_anthropic`). It deliberately does not flow through the
 *  sync pipeline — secrets stay local. */
export function AISettingsTab() {
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await secretGet(SECRET_KEY);
        if (cancelled) return;
        setHasKey(!!existing);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await secretSet(SECRET_KEY, key);
      setHasKey(true);
      setKey('');
      setStatus('Saved.');
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`);
    } finally { setSaving(false); }
  };

  const onClear = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await secretDelete(SECRET_KEY);
      setHasKey(false);
      setStatus('Cleared.');
    } catch (e) {
      setStatus(`Clear failed: ${String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="ai-settings">
      <div className="settings-section-card">
        <div className="settings-section-head">
          <div>
            <div className="settings-section-title-row">
              <span className="settings-section-icon" aria-hidden><SparklesIcon size={13} /></span>
              <h3>AI command bar</h3>
            </div>
          </div>
        </div>
        <div className="form-grid">
          <label htmlFor="ai-key">Anthropic API key</label>
          <input
            id="ai-key"
            type="password"
            autoComplete="off"
            placeholder={hasKey ? '•••••••• stored' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={loading || saving}
          />
        </div>
        <div className="ai-settings-meta">
          <span className="settings-inline-pill">
            <KeyIcon size={11} />
            {hasKey ? 'Stored locally' : 'No key saved'}
          </span>
        </div>
        <div className="modal-actions">
          {hasKey && (
            <button type="button" onClick={() => void onClear()} disabled={saving}>
              Remove stored key
            </button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => void onSave()}
            disabled={saving || key.trim() === ''}
          >Save key</button>
        </div>
      </div>
      {status && <p className="ai-settings-status">{status}</p>}
    </div>
  );
}
