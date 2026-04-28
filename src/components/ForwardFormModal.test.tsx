import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForwardFormModal } from './ForwardFormModal';
import { useHostStore } from '../state/hostStore';
import type { Forward, Host } from '../types';

const host = (over: Partial<Host>): Host => ({
  id: 'h1', name: 'mac', hostname: 'example.com', port: 22, username: 'a',
  group_name: null, tags: [], auth_method: 'agent', key_path: null, notes: null,
  created_at: 1, last_used_at: null, ...over,
});

const sample = (): Forward => ({
  id: 'f1', host_id: 'h1', name: 'tunnel', kind: 'local',
  bind_addr: '127.0.0.1', bind_port: 5432,
  remote_host: 'db.local', remote_port: 5432,
  auto_start: false, created_at: 1,
});

beforeEach(() => {
  useHostStore.setState({ hosts: [host({ id: 'h1' }), host({ id: 'h2', name: 'other' })], loading: false, error: null });
});

describe('ForwardFormModal', () => {
  it('renders Add title in create mode', () => {
    render(<ForwardFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/add forward/i)).toBeInTheDocument();
  });

  it('renders Edit title with prefill', () => {
    render(<ForwardFormModal mode="edit" forward={sample()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/edit forward/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('tunnel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('db.local')).toBeInTheDocument();
  });

  it('Save with required fields invokes onSave', async () => {
    const onSave = vi.fn();
    render(<ForwardFormModal mode="create" onSave={onSave} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/^name$/i), 'tunnel');
    await userEvent.selectOptions(screen.getByLabelText(/^host$/i), 'h1');
    await userEvent.clear(screen.getByLabelText(/bind port/i));
    await userEvent.type(screen.getByLabelText(/bind port/i), '5432');
    await userEvent.type(screen.getByLabelText(/remote host/i), 'db.local');
    await userEvent.clear(screen.getByLabelText(/remote port/i));
    await userEvent.type(screen.getByLabelText(/remote port/i), '5432');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0];
    expect(arg.name).toBe('tunnel');
    expect(arg.host_id).toBe('h1');
    expect(arg.kind).toBe('local');
    expect(arg.bind_port).toBe(5432);
  });

  it('Save disabled until required fields filled', () => {
    render(<ForwardFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Esc closes', async () => {
    const onCancel = vi.fn();
    render(<ForwardFormModal mode="create" onSave={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('switching kind to remote re-labels bind/remote sections', async () => {
    render(<ForwardFormModal mode="create" onSave={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/^remote$/i));
    expect(screen.getByText(/remote bind/i)).toBeInTheDocument();
    expect(screen.getByText(/forward back to/i)).toBeInTheDocument();
  });
});
