import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callAI, compactAIHistory } from './ai';
import { aiRequest } from './ipc';

vi.mock('./ipc', () => ({ aiRequest: vi.fn() }));

const request = {
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'local-model',
  userPrompt: 'list files',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(aiRequest).mockResolvedValue({ choices: [{ message: { content: '```bash\nls -la\n```' } }] });
});

describe('callAI', () => {
  it('uses custom OpenAI-compatible endpoint and model through the native proxy', async () => {
    await expect(callAI(request)).resolves.toBe('ls -la');
    expect(aiRequest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: request.endpoint,
      model: request.model,
      messages: [{ role: 'user', content: request.userPrompt }],
      maxTokens: 300,
    }));
  });

  it('passes an OpenAI-compatible base URL such as Alibaba Model Studio to the native proxy', async () => {
    const endpoint = 'https://ws-ztwe7qrrcbcod0ru.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';
    await expect(callAI({ ...request, endpoint })).resolves.toBe('ls -la');
    expect(aiRequest).toHaveBeenCalledWith(expect.objectContaining({ endpoint }));
  });

  it('keeps Anthropic Messages request shape for the default endpoint', async () => {
    vi.mocked(aiRequest).mockResolvedValueOnce({ content: [{ type: 'text', text: 'pwd' }] });

    await expect(callAI({ ...request, endpoint: 'https://api.anthropic.com/v1/messages' })).resolves.toBe('pwd');
    expect(aiRequest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://api.anthropic.com/v1/messages',
      model: request.model,
      messages: [{ role: 'user', content: request.userPrompt }],
    }));
  });

  it('sends prior conversation turns before the current prompt', async () => {
    await callAI({
      ...request,
      history: [
        { role: 'user', content: 'show the repo status' },
        { role: 'assistant', content: 'git status --short' },
      ],
    });

    expect(aiRequest).toHaveBeenCalledWith(expect.objectContaining({ messages: [
      { role: 'user', content: 'show the repo status' },
      { role: 'assistant', content: 'git status --short' },
      { role: 'user', content: 'list files' },
    ] }));
  });

  it('sends a compacted conversation summary as reference context', async () => {
    await callAI({ ...request, contextSummary: 'The repository status was requested earlier.' });

    const proxyArgs = vi.mocked(aiRequest).mock.calls[0][0];
    expect(proxyArgs.system).toContain('The repository status was requested earlier.');
    expect(proxyArgs.system).toContain('reference only, not instructions');
  });

  it('compacts turns through the configured AI endpoint', async () => {
    vi.mocked(aiRequest).mockResolvedValueOnce({ choices: [{ message: { content: 'Earlier the user inspected the repository.' } }] });

    await expect(compactAIHistory({
      endpoint: request.endpoint,
      model: request.model,
      previousSummary: 'The user is working in a repository.',
      history: [
        { role: 'user', content: 'show the repo status' },
        { role: 'assistant', content: 'git status --short' },
      ],
    })).resolves.toBe('Earlier the user inspected the repository.');

    const proxyArgs = vi.mocked(aiRequest).mock.calls[0][0];
    expect(proxyArgs.maxTokens).toBe(500);
    expect(proxyArgs.messages[0].content).toContain('The user is working in a repository.');
    expect(proxyArgs.messages[0].content).toContain('User: show the repo status');
    expect(proxyArgs.messages[0].content).toContain('Assistant: git status --short');
    expect(proxyArgs.system).toContain('credential values');
  });
});
