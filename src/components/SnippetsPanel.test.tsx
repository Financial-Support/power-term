import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnippetsPanel } from './SnippetsPanel';
import { useSnippetStore } from '../state/snippetStore';
import type { Snippet } from '../types';

const s = (over: Partial<Snippet>): Snippet => ({
  id: 'a', name: 'ls', content: 'ls -la\n', tags: [],
  created_at: 1, last_used_at: null, ...over,
});

beforeEach(() => {
  useSnippetStore.setState({ snippets: [], loading: false, error: null });
});

describe('SnippetsPanel', () => {
  it('renders header with + button and Snippets label', () => {
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={vi.fn()} />);
    // Disambiguate from the empty-state hint by scoping to the toggle button.
    expect(screen.getByRole('button', { name: /toggle snippets section/i })).toHaveTextContent(/snippets/i);
    expect(screen.getByRole('button', { name: /add snippet/i })).toBeInTheDocument();
  });

  it('shows empty state when there are no snippets', () => {
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByText(/no snippets/i)).toBeInTheDocument();
  });

  it('renders all snippets sorted by name', () => {
    useSnippetStore.setState({
      snippets: [s({ id: 'a', name: 'zeta' }), s({ id: 'b', name: 'alpha' })],
    });
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={vi.fn()} />);
    const alpha = screen.getByText('alpha');
    const zeta = screen.getByText('zeta');
    // Both visible. The DOM order matters: alpha should appear before zeta.
    expect(alpha.compareDocumentPosition(zeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clicking a snippet calls onInsert', async () => {
    useSnippetStore.setState({ snippets: [s({ id: 'a', name: 'ls' })] });
    const onInsert = vi.fn();
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={onInsert} />);
    await userEvent.click(screen.getByText('ls'));
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0].id).toBe('a');
  });

  it('clicking + calls onAdd', async () => {
    const onAdd = vi.fn();
    render(<SnippetsPanel onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /add snippet/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('clicking ✎ calls onEdit', async () => {
    useSnippetStore.setState({ snippets: [s({ id: 'a', name: 'ls' })] });
    const onEdit = vi.fn();
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={onEdit} onDelete={vi.fn()} onInsert={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/edit snippet ls/i));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe('a');
  });

  it('clicking × calls onDelete', async () => {
    useSnippetStore.setState({ snippets: [s({ id: 'a', name: 'ls' })] });
    const onDelete = vi.fn();
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} onInsert={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/delete snippet ls/i));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe('a');
  });

  it('header click toggles section collapse', async () => {
    useSnippetStore.setState({ snippets: [s({ id: 'a', name: 'ls' })] });
    render(<SnippetsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onInsert={vi.fn()} />);
    expect(screen.getByText('ls')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /toggle snippets/i }));
    expect(screen.queryByText('ls')).not.toBeInTheDocument();
  });
});
