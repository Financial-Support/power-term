import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AICommandBar } from './AICommandBar';
import { callAI, compactAIHistory } from '../lib/ai';
import { getTerminalContext } from '../lib/terminalContext';
import { ptyWrite, secretGet } from '../lib/ipc';
import { useSessionStore } from '../state/sessionStore';
import { useSettingsStore } from '../state/settingsStore';
import type { Settings } from '../types';

vi.mock('../lib/ipc', () => ({
  ptyWrite: vi.fn(),
  secretGet: vi.fn(),
  sshWrite: vi.fn(),
}));
vi.mock('../lib/ai', () => ({ callAI: vi.fn(), compactAIHistory: vi.fn() }));
vi.mock('../lib/terminalContext', () => ({ getTerminalContext: vi.fn() }));

const settings = {
  ai_endpoint: 'http://localhost:8080/v1/chat/completions',
  ai_model: 'local-model',
  ai_include_terminal_context: false,
} as Settings;

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ settings, loading: false, error: null });
  useSessionStore.setState({
    tabs: [{ id: 'tab-1', ptyId: 'pty-1', title: 'shell', kind: 'local', paneIndex: 0 }],
    activeTabId: 'tab-1',
  });
  vi.mocked(secretGet).mockResolvedValue(null);
  vi.mocked(getTerminalContext).mockReturnValue('');
  vi.mocked(callAI).mockReset();
  vi.mocked(compactAIHistory).mockReset();
});

describe('AICommandBar', () => {
  it('keeps chat history scoped to each conversation and sends it on later turns', async () => {
    const user = userEvent.setup();
    vi.mocked(callAI)
      .mockResolvedValueOnce('ls')
      .mockResolvedValueOnce('pwd')
      .mockResolvedValueOnce('git status')
      .mockResolvedValueOnce('echo fresh');
    render(<AICommandBar open onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Describe a task for AI' });

    await user.type(input, 'list files');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({ history: [], userPrompt: 'list files' }));

    await user.click(screen.getByRole('button', { name: 'New AI conversation' }));
    await user.type(input, 'show current directory');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(2));
    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({ history: [], userPrompt: 'show current directory' }));

    await user.click(screen.getByRole('button', { name: /show current directory/ }));
    await user.click(screen.getByRole('button', { name: /list files 1 turn/ }));
    await user.type(input, 'what next');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(3));

    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({
      history: [
        { role: 'user', content: 'list files' },
        { role: 'assistant', content: 'ls' },
      ],
      userPrompt: 'what next',
    }));
    expect(screen.getByText('git status')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Chat history for this chat' }));
    await user.type(input, 'start without history');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(4));
    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({ history: [] }));
  });

  it('keeps terminal context preference per conversation', async () => {
    const user = userEvent.setup();
    vi.mocked(getTerminalContext).mockReturnValue('terminal output');
    vi.mocked(callAI).mockResolvedValue('pwd');
    render(<AICommandBar open onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Describe a task for AI' });

    const terminalContextToggle = screen.getByRole('checkbox', { name: 'Terminal context for this chat' });
    await user.click(terminalContextToggle);
    await user.type(input, 'inspect this shell');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({
      userPrompt: expect.stringContaining('terminal output'),
    }));

    await user.click(screen.getByRole('button', { name: 'New AI conversation' }));
    expect(screen.getByRole('checkbox', { name: 'Terminal context for this chat' })).not.toBeChecked();
  });

  it('compacts older turns into conversation context before the next request', async () => {
    const user = userEvent.setup();
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `${index % 2 === 0 ? 'request' : 'command'} ${index}`,
    }));
    localStorage.setItem('ai-conversations', JSON.stringify([{
      id: 'long-chat',
      title: 'Long chat',
      messages,
      includeChatHistory: true,
      includeTerminalContext: false,
    }]));
    vi.mocked(compactAIHistory).mockResolvedValue('Older turns summary');
    vi.mocked(callAI).mockResolvedValue('echo current');

    render(<AICommandBar open onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Describe a task for AI' });
    await user.type(input, 'continue the task');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    await waitFor(() => expect(callAI).toHaveBeenCalledTimes(1));
    expect(compactAIHistory).toHaveBeenCalledWith(expect.objectContaining({
      history: messages.slice(0, 8).map(({ role, content }) => ({ role, content })),
    }));
    expect(callAI).toHaveBeenLastCalledWith(expect.objectContaining({
      contextSummary: 'Older turns summary',
      history: messages.slice(8).map(({ role, content }) => ({ role, content })),
    }));

    const stored = JSON.parse(localStorage.getItem('ai-conversations') ?? '[]');
    expect(stored[0].contextSummary).toBe('Older turns summary');
    expect(stored[0].contextSummaryMessageCount).toBe(8);
  });

  it('marks dangerous commands and confirms before running them', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(callAI).mockResolvedValue('sudo rm -rf /');
    render(<AICommandBar open onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Describe a task for AI' });

    await user.type(input, 'clean everything');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(screen.getByText('Dangerous command')).toBeInTheDocument());

    expect(screen.getByRole('status', { name: /Recursively deletes a broad or root path/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review & run' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('sudo rm -rf /'));
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it('keeps the sidebar open after inserting a command', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(callAI).mockResolvedValue('ls -la');
    render(<AICommandBar open onClose={onClose} />);
    const input = screen.getByRole('textbox', { name: 'Describe a task for AI' });

    await user.type(input, 'list files');
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));
    await waitFor(() => expect(screen.getByText('ls -la')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Insert' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(ptyWrite).toHaveBeenCalledWith('pty-1', 'ls -la');
  });
});
