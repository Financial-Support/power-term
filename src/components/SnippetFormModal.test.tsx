import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnippetFormModal } from './SnippetFormModal';
import type { Snippet } from '../types';

const sample = (): Snippet => ({
  id: 's1', name: 'ls', content: 'ls -la\n', tags: ['fs'],
  created_at: 1000, last_used_at: null,
});

describe('SnippetFormModal', () => {
  it('renders Add title in create mode', () => {
    render(<SnippetFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/add snippet/i)).toBeInTheDocument();
  });

  it('renders Edit title with prefilled fields', () => {
    render(<SnippetFormModal mode="edit" snippet={sample()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/edit snippet/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('ls')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ls -la\n')).toBeInTheDocument();
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(<SnippetFormModal mode="create" onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Save with required fields filled invokes onSave', async () => {
    const onSave = vi.fn();
    render(<SnippetFormModal mode="create" onSave={onSave} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^name$/i), 'list files');
    await userEvent.type(screen.getByLabelText(/^content$/i), 'ls -la');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0];
    expect(arg.name).toBe('list files');
    expect(arg.content).toBe('ls -la');
  });

  it('Save is disabled when required fields empty', () => {
    render(<SnippetFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('Esc closes the modal', async () => {
    const onCancel = vi.fn();
    render(<SnippetFormModal mode="create" onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });
});
