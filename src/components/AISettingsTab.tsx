import { useEffect, useState } from 'react';
import { secretGet, secretSet } from '../lib/ipc';
import { DEFAULT_AI_ENDPOINT, DEFAULT_AI_MODEL } from '../types';
import { useSettingsStore } from '../state/settingsStore';
import { SparklesIcon } from './AppIcons';
import { SecretInput } from './SecretInput';

const SECRET_KEY = '__ai_anthropic';

export function AISettingsTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const [endpoint, setEndpoint] = useState(DEFAULT_AI_ENDPOINT);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [includeContext, setIncludeContext] = useState(false);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEndpoint(settings.ai_endpoint || DEFAULT_AI_ENDPOINT);
    setModel(settings.ai_model || DEFAULT_AI_MODEL);
    setIncludeContext(settings.ai_include_terminal_context);
  }, [settings?.ai_endpoint, settings?.ai_model, settings?.ai_include_terminal_context, settings]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const existing = await secretGet(SECRET_KEY);
        if (cancelled) return;
        setHasKey(!!existing);
        // Never put an existing credential back into an editable text field.
        setKey('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const endpointValid = isHttpEndpoint(endpoint);
  const modelValid = model.trim() !== '';

  const onSave = async () => {
    if (!endpointValid || !modelValid) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateSettings({
        ai_endpoint: endpoint.trim(),
        ai_model: model.trim(),
        ai_include_terminal_context: includeContext,
      });
      const currentError = useSettingsStore.getState().error;
      if (currentError) {
        setStatus(`Save failed: ${currentError}`);
        return;
      }
      if (key.trim()) {
        await secretSet(SECRET_KEY, key.trim());
        setHasKey(true);
        setKey('');
      }
      setStatus('AI settings saved.');
    } catch (e) {
      setStatus(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-settings">
      <div className="settings-section-card">
        <div className="settings-section-head">
          <div>
            <div className="settings-section-title-row">
              <span className="settings-section-icon" aria-hidden><SparklesIcon size={13} /></span>
              <h3>AI provider</h3>
            </div>
            <p className="ai-settings-description">Use Anthropic Messages or an OpenAI-compatible endpoint. Base URLs ending in /v1 automatically call /chat/completions. The terminal-context checkbox is the default for new conversations; each chat can override it.</p>
          </div>
        </div>

        <div className="form-grid ai-settings-grid">
          <label htmlFor="ai-endpoint">Endpoint</label>
          <div>
            <input
              id="ai-endpoint"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              aria-invalid={!endpointValid}
              placeholder={DEFAULT_AI_ENDPOINT}
              disabled={saving}
            />
            {!endpointValid && <p className="ai-field-error">Enter a valid HTTP(S) endpoint.</p>}
          </div>

          <label htmlFor="ai-model">Model</label>
          <input
            id="ai-model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-invalid={!modelValid}
            placeholder={DEFAULT_AI_MODEL}
            disabled={saving}
          />

          <label htmlFor="ai-key">API key</label>
          <SecretInput
            id="ai-key"
            autoComplete="new-password"
            placeholder={hasKey ? '•••••••• stored · enter a new key to replace' : 'Optional for local endpoints'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={loading || saving}
          />
        </div>

        <label className="ai-context-toggle" htmlFor="ai-context">
          <input
            id="ai-context"
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            disabled={saving}
          />
          <span>
            <strong>Allow terminal context</strong>
            <small>Include the latest terminal output with requests. It may contain passwords or tokens.</small>
          </span>
        </label>

        <div className="modal-actions">
          <button type="button" className="primary" onClick={() => void onSave()} disabled={saving || !endpointValid || !modelValid}>
            Save AI settings
          </button>
        </div>
      </div>
      {status && <p className="ai-settings-status" role="status">{status}</p>}
    </div>
  );
}

function isHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.host;
  } catch {
    return false;
  }
}
