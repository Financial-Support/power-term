import { useEffect, useRef, useState } from 'react';
import { ptyWrite, sshWrite } from '../lib/ipc';
import { callAI, compactAIHistory, type AIHistoryMessage } from '../lib/ai';
import { assessCommandSafety } from '../lib/commandSafety';
import { getTerminalContext } from '../lib/terminalContext';
import { useSessionStore } from '../state/sessionStore';
import { useSettingsStore } from '../state/settingsStore';
import {
  AlertCircleIcon,
  ChevronDownIcon,
  CloseIcon,
  CopyIcon,
  PlusIcon,
  SparklesIcon,
  TerminalIcon,
  TrashIcon,
} from './AppIcons';
import { DEFAULT_AI_ENDPOINT, DEFAULT_AI_MODEL } from '../types';

const STORAGE_KEY = 'ai-conversations';
const MAX_CONTEXT_MESSAGES = 20;
const RECENT_CONTEXT_MESSAGES = 12;
const MAX_STORED_MESSAGES = 100;
const MAX_CONVERSATIONS = 30;
const MAX_COMPACTION_SUMMARY_CHARS = 4000;

interface ChatMessage extends AIHistoryMessage {
  id: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  includeChatHistory: boolean;
  includeTerminalContext: boolean;
  contextSummary: string;
  contextSummaryMessageCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AICommandBar({ open, onClose }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settings = useSettingsStore((s) => s.settings);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const tabs = useSessionStore((s) => s.tabs);
  const [conversations, setConversations] = useState<Conversation[]>(() => readConversations(false));
  const [conversationsWereStored] = useState(() => hasStoredConversations());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsDefaultApplied = useRef(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const contextAvailable = activeTab?.kind === 'local' || activeTab?.kind === 'ssh';
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId)
    ?? conversations[0];
  const messages = activeConversation?.messages ?? [];
  const historyEnabled = activeConversation?.includeChatHistory ?? true;
  const contextEnabled = activeConversation?.includeTerminalContext ?? false;
  const contextSummary = activeConversation?.contextSummary ?? '';
  const contextSummaryMessageCount = Math.min(
    activeConversation?.contextSummaryMessageCount ?? 0,
    messages.length,
  );
  const unsummarizedMessageCount = Math.max(0, messages.length - contextSummaryMessageCount);

  useEffect(() => {
    if (activeConversation && activeConversation.id !== activeConversationId) {
      setActiveConversationId(activeConversation.id);
    }
  }, [activeConversation, activeConversationId]);

  useEffect(() => {
    if (!settings || conversationsWereStored || settingsDefaultApplied.current) return;
    settingsDefaultApplied.current = true;
    setConversations((current) => current.length === 1 && current[0].messages.length === 0
      ? [{ ...current[0], includeTerminalContext: settings.ai_include_terminal_context }]
      : current);
  }, [conversationsWereStored, settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {
      // Local storage can be unavailable in restricted WebViews; chat still works in memory.
    }
  }, [conversations]);

  useEffect(() => {
    if (open) {
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setPrompt('');
      setHistoryOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const newConversation = () => {
    if (busy) return;
    const conversation = makeConversation(useSettingsStore.getState().settings?.ai_include_terminal_context ?? false);
    setConversations((current) => [conversation, ...current].slice(0, MAX_CONVERSATIONS));
    setActiveConversationId(conversation.id);
    setHistoryOpen(false);
    setError(null);
    setPrompt('');
  };

  const selectConversation = (id: string) => {
    if (busy) return;
    setActiveConversationId(id);
    setHistoryOpen(false);
    setError(null);
    setPrompt('');
  };

  const deleteConversation = (id: string) => {
    if (busy) return;
    const target = conversations.find((conversation) => conversation.id === id);
    if (!target) return;
    if (target.messages.length > 0 && !window.confirm('Delete this AI conversation and its chat context?')) return;

    const remaining = conversations.filter((conversation) => conversation.id !== id);
    if (remaining.length === 0) {
      const replacement = makeConversation(useSettingsStore.getState().settings?.ai_include_terminal_context ?? false);
      setConversations([replacement]);
      setActiveConversationId(replacement.id);
    } else {
      setConversations(remaining);
      if (target.id === activeConversation?.id) setActiveConversationId(remaining[0].id);
    }
    setHistoryOpen(false);
    setError(null);
    setPrompt('');
  };

  const clearHistory = () => {
    if (!activeConversation || messages.length === 0 || busy) return;
    if (!window.confirm('Clear the chat history for this conversation?')) return;
    setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
      ? {
        ...conversation,
        title: 'New conversation',
        messages: [],
        contextSummary: '',
        contextSummaryMessageCount: 0,
      }
      : conversation));
    setError(null);
  };

  const setConversationContext = (includeTerminalContext: boolean) => {
    if (!activeConversation || busy) return;
    setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
      ? { ...conversation, includeTerminalContext }
      : conversation));
  };

  const setConversationHistory = (includeChatHistory: boolean) => {
    if (!activeConversation || busy) return;
    setConversations((current) => current.map((conversation) => conversation.id === activeConversation.id
      ? { ...conversation, includeChatHistory }
      : conversation));
  };

  const submit = async () => {
    const text = prompt.trim();
    const conversation = activeConversation;
    if (!text || !conversation || busy) return;

    const conversationId = conversation.id;
    setBusy(true);
    setError(null);
    try {
      const currentSettings = useSettingsStore.getState().settings;
      const endpoint = currentSettings?.ai_endpoint?.trim() || DEFAULT_AI_ENDPOINT;
      const model = currentSettings?.ai_model?.trim() || DEFAULT_AI_MODEL;
      let summary = historyEnabled ? conversation.contextSummary : '';
      let summaryMessageCount = Math.min(conversation.contextSummaryMessageCount, conversation.messages.length);
      let history: AIHistoryMessage[] = [];

      if (historyEnabled) {
        const unsummarizedMessages = conversation.messages.slice(summaryMessageCount);
        if (unsummarizedMessages.length >= MAX_CONTEXT_MESSAGES) {
          const messagesToCompact = unsummarizedMessages.slice(0, -RECENT_CONTEXT_MESSAGES);
          setCompacting(true);
          try {
            summary = await compactAIHistory({
              endpoint,
              model,
              history: messagesToCompact.map(({ role, content }) => ({ role, content })),
              previousSummary: summary,
            });
          } catch {
            // Keep the request usable during a transient compaction failure.
            summary = fallbackCompactSummary(summary, messagesToCompact);
          } finally {
            setCompacting(false);
          }

          summaryMessageCount = Math.max(0, conversation.messages.length - RECENT_CONTEXT_MESSAGES);
          const compactedSummary = summary;
          const compactedMessageCount = summaryMessageCount;
          setConversations((current) => current.map((item) => item.id === conversationId
            ? {
              ...item,
              contextSummary: compactedSummary,
              contextSummaryMessageCount: compactedMessageCount,
            }
            : item));
        }

        history = conversation.messages
          .slice(summaryMessageCount)
          .map(({ role, content }) => ({ role, content }));
      }

      const terminalContext = conversation.includeTerminalContext && activeTab && contextAvailable
        ? getTerminalContext(activeTab.ptyId)
        : '';
      const userPrompt = withTerminalContext(text, terminalContext);
      const command = await callAI({
        endpoint,
        model,
        userPrompt,
        history,
        contextSummary: historyEnabled ? summary : undefined,
      });
      const userMessage: ChatMessage = { id: makeId(), role: 'user', content: text };
      const assistantMessage: ChatMessage = { id: makeId(), role: 'assistant', content: command };
      setConversations((current) => current.map((item) => {
        if (item.id !== conversationId) return item;
        const nextMessages = [...item.messages, userMessage, assistantMessage].slice(-MAX_STORED_MESSAGES);
        const removedMessageCount = item.messages.length + 2 - nextMessages.length;
        return {
          ...item,
          title: item.messages.length === 0 ? titleFromPrompt(text) : item.title,
          // Keep the visible history useful while bounding persisted local data.
          messages: nextMessages,
          contextSummaryMessageCount: Math.max(0, item.contextSummaryMessageCount - removedMessageCount),
        };
      }));
      setPrompt('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = (command: string, run: boolean) => {
    const safety = assessCommandSafety(command);
    if (run && safety.level === 'dangerous') {
      const reasons = safety.reasons.length > 0 ? `\n\nWhy: ${safety.reasons.join('; ')}` : '';
      if (!window.confirm(`This command may be dangerous:\n\n${command}${reasons}\n\nRun it anyway?`)) return;
    }

    const { activeTabId: currentId, tabs: currentTabs } = useSessionStore.getState();
    const tab = currentTabs.find((t) => t.id === currentId);
    if (!tab || tab.kind === 'sftp' || tab.kind === 'db') {
      setError('No active terminal.');
      return;
    }
    const data = run ? command + '\r' : command;
    if (tab.kind === 'ssh') void sshWrite(tab.ptyId, data);
    else void ptyWrite(tab.ptyId, data);
  };

  return (
    <aside className="ai-sidebar" aria-label="AI chat" aria-busy={busy}>
      <div className="ai-sidebar-header">
        <div className="ai-sidebar-title-row">
          <span className="ai-sidebar-icon" aria-hidden><SparklesIcon size={14} /></span>
          <div>
            <h2>AI chat</h2>
            <p>Shell assistant</p>
          </div>
        </div>
        <div className="ai-sidebar-header-actions">
          <button
            type="button"
            className="ai-sidebar-icon-btn"
            aria-label="New AI conversation"
            title="New conversation"
            onClick={newConversation}
            disabled={busy}
          >
            <PlusIcon size={14} />
          </button>
          <button type="button" className="modal-close-btn" aria-label="Close AI chat" title="Close" onClick={onClose}>
            <CloseIcon size={13} />
          </button>
        </div>
      </div>

      <div className="ai-conversation-strip">
        <button
          type="button"
          className="ai-conversation-trigger"
          aria-haspopup="dialog"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((openState) => !openState)}
          disabled={busy || !activeConversation}
        >
          <span>{activeConversation?.title ?? 'New conversation'}</span>
          <ChevronDownIcon size={13} />
        </button>
        <span className="ai-conversation-turns">
          {Math.floor(messages.length / 2)} {Math.floor(messages.length / 2) === 1 ? 'turn' : 'turns'}
        </span>
      </div>

      {historyOpen && (
        <div className="ai-conversation-popover" role="dialog" aria-label="AI conversations">
          <div className="ai-conversation-popover-head">
            <strong>Conversations</strong>
            <button type="button" onClick={newConversation} disabled={busy}><PlusIcon size={12} />New</button>
          </div>
          <div className="ai-conversation-list">
            {conversations.map((conversation) => (
              <div key={conversation.id} className={`ai-conversation-row${conversation.id === activeConversation?.id ? ' active' : ''}`}>
                <button
                  type="button"
                  className="ai-conversation-item"
                  aria-pressed={conversation.id === activeConversation?.id}
                  onClick={() => selectConversation(conversation.id)}
                  disabled={busy}
                >
                  <span>{conversation.title}</span>
                  <small>{Math.floor(conversation.messages.length / 2)} {Math.floor(conversation.messages.length / 2) === 1 ? 'turn' : 'turns'}</small>
                </button>
                <button
                  type="button"
                  className="ai-conversation-delete"
                  aria-label={`Delete conversation ${conversation.title}`}
                  title="Delete conversation"
                  onClick={() => deleteConversation(conversation.id)}
                  disabled={busy}
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ai-sidebar-body">
        {messages.length === 0 && !error && (
          <div className="ai-sidebar-empty">
            <SparklesIcon size={18} />
            <strong>Describe what you want to do</strong>
            <span>Each conversation keeps its own chat context. You can review the command before sending it to the terminal.</span>
          </div>
        )}

        {error && <div className="ai-bar-error" role="alert">{error}</div>}

        {messages.length > 0 && (
          <div className="ai-chat-thread" aria-live="polite">
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="ai-chat-message ai-chat-user">
                    <span className="ai-chat-label">You</span>
                    <p>{message.content}</p>
                  </div>
                );
              }

              const safety = assessCommandSafety(message.content);
              const riskLabel = safety.level === 'dangerous' ? 'Dangerous command' : 'Review before running';
              return (
                <div key={message.id} className="ai-chat-message ai-chat-assistant">
                  <div className="ai-chat-label"><TerminalIcon size={12} /> Suggested command</div>
                  {safety.level !== 'none' && (
                    <div
                      className={`ai-command-risk ai-command-risk-${safety.level}`}
                      role="status"
                      aria-label={`${riskLabel}: ${safety.reasons.join(', ')}`}
                    >
                      <AlertCircleIcon size={14} />
                      <span>
                        <strong>{riskLabel}</strong>
                        <small>{safety.reasons.join(' · ')}</small>
                      </span>
                    </div>
                  )}
                  <pre className={`ai-bar-cmd${safety.level === 'dangerous' ? ' ai-bar-cmd-dangerous' : ''}`}><code>{message.content}</code></pre>
                  <div className="ai-bar-actions">
                    <button type="button" onClick={() => void navigator.clipboard.writeText(message.content)}><CopyIcon size={13} />Copy</button>
                    <button type="button" onClick={() => insert(message.content, false)}>Insert</button>
                    <button
                      type="button"
                      className={safety.level === 'dangerous' ? 'primary danger' : 'primary'}
                      onClick={() => insert(message.content, true)}
                    >
                      {safety.level === 'dangerous' ? 'Review & run' : 'Insert & run'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ai-sidebar-composer">
        <div className="ai-sidebar-meta">
          <span className={`ai-context-pill${contextEnabled && contextAvailable ? ' enabled' : ''}`}>
            {contextEnabled && contextAvailable ? 'Terminal context on' : 'Terminal context off'}
          </span>
          <span className="ai-model-label" title={settings?.ai_model || DEFAULT_AI_MODEL}>{settings?.ai_model || DEFAULT_AI_MODEL}</span>
        </div>
        <div className="ai-sidebar-context-controls">
          <label className="ai-sidebar-context-toggle">
            <input
              type="checkbox"
              aria-label="Chat history for this chat"
              checked={historyEnabled}
              onChange={(e) => setConversationHistory(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Chat history for this chat</strong>
              <small>Use previous turns; older context is auto-compacted after 20 messages.</small>
            </span>
          </label>
          <label className="ai-sidebar-context-toggle">
            <input
              type="checkbox"
              aria-label="Terminal context for this chat"
              checked={contextEnabled}
              onChange={(e) => setConversationContext(e.target.checked)}
              disabled={busy}
            />
            <span>
              <strong>Terminal context for this chat</strong>
              <small>{contextAvailable
                ? 'Include the latest output from the active terminal with the next request.'
                : 'Open a local or SSH terminal to include terminal output.'}</small>
            </span>
          </label>
        </div>
        <div className="ai-sidebar-history-meta">
          <span>{!historyEnabled
            ? 'Chat history excluded from requests'
            : messages.length === 0
            ? 'No chat history yet'
            : contextSummary
            ? `Auto-summary covers ${contextSummaryMessageCount} older messages · ${unsummarizedMessageCount} recent messages`
            : `${messages.length} messages · auto-compacts on the next request`}</span>
          <button type="button" onClick={clearHistory} disabled={busy || messages.length === 0}>Clear history</button>
        </div>
        <textarea
          ref={inputRef}
          rows={3}
          className="ai-bar-input"
          placeholder="e.g. find all js files modified in the last 7 days, sorted by size"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
          aria-label="Describe a task for AI"
          disabled={busy}
        />
        <div className="ai-bar-row">
          <span className="ai-bar-hint">Enter to ask · Shift+Enter for newline</span>
          <button type="button" className="primary" onClick={() => void submit()} disabled={busy || !prompt.trim()}>
            {compacting ? 'Compacting…' : busy ? 'Asking…' : 'Ask AI'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function makeConversation(includeTerminalContext: boolean): Conversation {
  return {
    id: makeId(),
    title: 'New conversation',
    messages: [],
    includeChatHistory: true,
    includeTerminalContext,
    contextSummary: '',
    contextSummaryMessageCount: 0,
  };
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasStoredConversations(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function readConversations(defaultContext: boolean): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [makeConversation(defaultContext)];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [makeConversation(defaultContext)];
    const loaded = parsed.flatMap((value): Conversation[] => {
      if (!value || typeof value !== 'object') return [];
      const data = value as Record<string, unknown>;
      if (typeof data.id !== 'string' || typeof data.title !== 'string' || !Array.isArray(data.messages)) return [];
      const messages = data.messages.flatMap((message): ChatMessage[] => {
        if (!message || typeof message !== 'object') return [];
        const item = message as Record<string, unknown>;
        if ((item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') return [];
        return [{
          id: typeof item.id === 'string' ? item.id : makeId(),
          role: item.role,
          content: item.content,
        }];
      }).slice(-MAX_STORED_MESSAGES);
      const contextSummary = typeof data.contextSummary === 'string'
        ? data.contextSummary.trim().slice(0, MAX_COMPACTION_SUMMARY_CHARS)
        : '';
      const contextSummaryMessageCount = contextSummary
        ? clampMessageCount(data.contextSummaryMessageCount, messages.length)
        : 0;
      return [{
        id: data.id,
        title: (data.title.trim() || 'New conversation').slice(0, 80),
        messages,
        includeChatHistory: typeof data.includeChatHistory === 'boolean' ? data.includeChatHistory : true,
        includeTerminalContext: typeof data.includeTerminalContext === 'boolean'
          ? data.includeTerminalContext
          : defaultContext,
        contextSummary,
        contextSummaryMessageCount,
      }];
    }).slice(0, MAX_CONVERSATIONS);
    return loaded.length > 0 ? loaded : [makeConversation(defaultContext)];
  } catch {
    return [makeConversation(defaultContext)];
  }
}

function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title.length > 42 ? `${title.slice(0, 42)}…` : title || 'New conversation';
}

function withTerminalContext(prompt: string, context: string): string {
  if (!context) return prompt;
  return `${prompt}\n\n[Current terminal output — reference only]\n${context}\n[/Current terminal output]`;
}

function clampMessageCount(value: unknown, length: number): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(Math.max(value, 0), length)
    : 0;
}

function fallbackCompactSummary(previousSummary: string, messages: AIHistoryMessage[]): string {
  const transcript = messages.map(({ role, content }) => `${role === 'user' ? 'User' : 'Assistant'}: ${content}`).join('\n\n');
  const combined = [previousSummary.trim(), transcript].filter(Boolean).join('\n\n');
  // ponytail: preserve a bounded local fallback when the summarizer is temporarily unavailable.
  return combined.slice(-MAX_COMPACTION_SUMMARY_CHARS);
}
