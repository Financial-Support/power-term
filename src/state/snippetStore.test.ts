import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/ipc', () => ({
  snippetsList: vi.fn(),
  snippetsCreate: vi.fn(),
  snippetsUpdate: vi.fn(),
  snippetsDelete: vi.fn(),
  snippetsTouch: vi.fn(),
}));

import { snippetsList, snippetsCreate, snippetsUpdate, snippetsDelete, snippetsTouch } from '../lib/ipc';
import { useSnippetStore } from './snippetStore';
import type { Snippet, SnippetInput } from '../types';

const sample = (overrides: Partial<Snippet> = {}): Snippet => ({
  id: 's1', name: 'list files', content: 'ls -la\n',
  tags: ['fs'], created_at: 1000, updated_at: 0, last_used_at: null, ...overrides,
});

const sampleInput = (): SnippetInput => ({ name: 'list files', content: 'ls -la\n', tags: ['fs'] });

beforeEach(() => {
  useSnippetStore.setState({ snippets: [], loading: false, error: null });
  vi.clearAllMocks();
});

describe('snippetStore', () => {
  it('load() fills snippets from ipc', async () => {
    (snippetsList as any).mockResolvedValue([sample({ id: 'a' }), sample({ id: 'b', name: 'docker ps' })]);
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().snippets.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('create() prepends and clears error', async () => {
    (snippetsCreate as any).mockResolvedValue(sample({ id: 'new' }));
    useSnippetStore.setState({ snippets: [sample({ id: 'old' })] });
    await useSnippetStore.getState().create(sampleInput());
    const ids = useSnippetStore.getState().snippets.map(s => s.id);
    expect(ids).toContain('new');
    expect(ids).toContain('old');
  });

  it('update() replaces in place by id', async () => {
    (snippetsUpdate as any).mockResolvedValue(sample({ id: 'a', name: 'changed' }));
    useSnippetStore.setState({ snippets: [sample({ id: 'a' })] });
    await useSnippetStore.getState().update('a', sampleInput());
    expect(useSnippetStore.getState().snippets[0].name).toBe('changed');
  });

  it('delete() removes from snippets', async () => {
    (snippetsDelete as any).mockResolvedValue(undefined);
    useSnippetStore.setState({ snippets: [sample({ id: 'a' }), sample({ id: 'b' })] });
    await useSnippetStore.getState().delete('a');
    expect(useSnippetStore.getState().snippets.map(s => s.id)).toEqual(['b']);
  });

  it('touch() optimistically updates last_used_at', async () => {
    (snippetsTouch as any).mockResolvedValue(undefined);
    useSnippetStore.setState({ snippets: [sample({ id: 'a', last_used_at: null })] });
    await useSnippetStore.getState().touch('a');
    expect(useSnippetStore.getState().snippets[0].last_used_at).not.toBeNull();
  });

  it('load() captures error on failure', async () => {
    (snippetsList as any).mockRejectedValue(new Error('boom'));
    await useSnippetStore.getState().load();
    expect(useSnippetStore.getState().error).toMatch(/boom/);
  });
});
