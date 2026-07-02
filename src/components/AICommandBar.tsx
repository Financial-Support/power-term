import { useEffect, useRef, useState } from 'react';
import { secretGet, ptyWrite, sshWrite } from '../lib/ipc';
import { useSessionStore } from '../state/sessionStore';
import { CloseIcon, CopyIcon, SparklesIcon, TerminalIcon } from './AppIcons';

const SECRET_KEY = '__ai_anthropic';
const MODEL = 'claude-sonnet-4-6';
const SYSTEM = `You are an expert shell assistant. Convert the user's intent into a single shell command they should run, no explanations, no markdown, no code fences. Always prefer POSIX-compatible flags. Never include destructive commands (rm -rf /, dd to /dev/disk*, mkfs, fdisk, > /dev/sda) unless the user explicitly asks. If unsure between several commands, pick the safest one. Output only the command, on one line.`;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Result {
  command: string;
  prompt: string;
}

export function AICommandBar({ open, onClose }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
      // Defer focus until after the overlay paints.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setPrompt('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const apiKey = await secretGet(SECRET_KEY);
      if (!apiKey) {
        setError('Add an Anthropic API key in Settings > AI.');
        return;
      }
      const cmd = await callClaude(apiKey, text);
      setResult({ command: cmd, prompt: text });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = (run: boolean) => {
    if (!result) return;
    const { activeTabId, tabs } = useSessionStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.kind === 'sftp') {
      setError('No active terminal.');
      return;
    }
    // Append a newline only when "run" was clicked; otherwise the user can
    // edit before pressing Enter. Either way we send raw bytes through the
    // PTY so it's indistinguishable from typing.
    const data = run ? result.command + '\r' : result.command;
    if (tab.kind === 'ssh') void sshWrite(tab.ptyId, data);
    else void ptyWrite(tab.ptyId, data);
    onClose();
  };

  return (
    <div className="ai-bar-backdrop" onClick={onClose}>
      <div className="ai-bar" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI command bar">
        <div className="modal-title-row ai-bar-title-row">
          <span className="modal-title-icon" aria-hidden>
            <SparklesIcon size={14} />
          </span>
          <div className="modal-title-copy">
            <h2>AI command</h2>
            <p className="form-title-meta"><TerminalIcon size={11} /> Describe intent, get a shell command</p>
          </div>
          <button type="button" className="modal-close-btn" aria-label="Close AI command bar" title="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
        <textarea
          ref={inputRef}
          rows={2}
          className="ai-bar-input"
          placeholder="e.g. find all js files modified in the last 7 days, sorted by size"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
          disabled={busy}
        />
        <div className="ai-bar-row">
          <span className="ai-bar-hint">Anthropic command generation</span>
          <button type="button" className="primary" onClick={() => void submit()} disabled={busy || !prompt.trim()}>
            {busy ? 'Asking…' : 'Ask Claude'}
          </button>
        </div>

        {error && <div className="ai-bar-error">{error}</div>}

        {result && (
          <div className="ai-bar-result">
            <div className="ai-bar-result-label"><TerminalIcon size={13} /><span>Suggested command</span></div>
            <pre className="ai-bar-cmd"><code>{result.command}</code></pre>
            <div className="ai-bar-actions">
              <button type="button" onClick={() => void navigator.clipboard.writeText(result.command)}><CopyIcon size={13} />Copy</button>
              <button type="button" onClick={() => insert(false)}>Insert</button>
              <button type="button" className="primary" onClick={() => insert(true)}>Insert &amp; run</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
}

async function callClaude(apiKey: string, userPrompt: string): Promise<string> {
  // Direct browser-side call — Anthropic API supports CORS for the messages
  // endpoint when `anthropic-dangerous-direct-browser-access` is set. Acceptable
  // here because the key lives in the OS keychain and never leaves the user's
  // machine; we don't proxy through a server.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${txt.slice(0, 240)}`);
  }
  const data = (await res.json()) as AnthropicMessageResponse;
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  // Strip accidental fences if the model adds them.
  return text.replace(/^```[a-z]*\s*|```\s*$/g, '').trim();
}
