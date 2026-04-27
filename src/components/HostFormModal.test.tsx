import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HostFormModal } from './HostFormModal';
import type { Host } from '../types';

const sampleHost = (): Host => ({
  id: 'h1', name: 'mac', hostname: 'example.com', port: 22, username: 'alice',
  group_name: 'Personal', tags: ['prod'], auth_method: 'agent',
  key_path: null, notes: null, created_at: 1000, last_used_at: null,
});

describe('HostFormModal', () => {
  it('renders Add title when no host given', () => {
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/add host/i)).toBeInTheDocument();
  });

  it('renders Edit title with prefilled fields', () => {
    render(<HostFormModal mode="edit" host={sampleHost()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/edit host/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('mac')).toBeInTheDocument();
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument();
  });

  it('Cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Save with required fields filled invokes onSave', async () => {
    const onSave = vi.fn();
    render(<HostFormModal mode="create" onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/^name$/i), 'mac');
    await userEvent.type(screen.getByLabelText(/^hostname$/i), 'example.com');
    await userEvent.type(screen.getByLabelText(/^username$/i), 'alice');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0];
    expect(arg.input.name).toBe('mac');
    expect(arg.input.hostname).toBe('example.com');
    expect(arg.input.username).toBe('alice');
    expect(arg.input.port).toBe(22);
    expect(arg.input.auth_method).toBe('agent');
  });

  it('Save is disabled when required fields empty', () => {
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('switching auth to key shows key_path input and requires it', async () => {
    render(<HostFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^name$/i), 'x');
    await userEvent.type(screen.getByLabelText(/^hostname$/i), 'h');
    await userEvent.type(screen.getByLabelText(/^username$/i), 'u');
    await userEvent.click(screen.getByLabelText(/private key/i));

    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/key path/i), '/Users/u/.ssh/id_ed25519');
    expect(save.disabled).toBe(false);
  });
});
