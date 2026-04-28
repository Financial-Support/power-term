import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForwardsPanel } from './ForwardsPanel';
import { useForwardStore } from '../state/forwardStore';
import type { Forward, ForwardStatus } from '../types';

const f = (over: Partial<Forward>): Forward => ({
  id: 'a', host_id: 'h1', name: 'tunnel', kind: 'local',
  bind_addr: '127.0.0.1', bind_port: 5432,
  remote_host: 'db.local', remote_port: 5432,
  auto_start: false, created_at: 1, ...over,
});
const status = (id: string, state: ForwardStatus['state']): ForwardStatus =>
  ({ id, state, error: null });

beforeEach(() => {
  useForwardStore.setState({ forwards: [], statuses: {}, loading: false, error: null });
});

describe('ForwardsPanel', () => {
  it('renders header + add', () => {
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /toggle forwards/i })).toHaveTextContent(/forwards/i);
    expect(screen.getByRole('button', { name: /add forward/i })).toBeInTheDocument();
  });

  it('shows empty state', () => {
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no forwards/i)).toBeInTheDocument();
  });

  it('renders forwards with kind + port', () => {
    useForwardStore.setState({
      forwards: [f({ id: 'a', name: 'db', kind: 'local', bind_port: 5432 })],
      statuses: { a: status('a', 'stopped') },
    });
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('db')).toBeInTheDocument();
    expect(screen.getByText(/L 5432/)).toBeInTheDocument();
  });

  it('clicking ⏵ on a stopped forward calls store.start', async () => {
    useForwardStore.setState({
      forwards: [f({ id: 'a', name: 'db' })],
      statuses: { a: status('a', 'stopped') },
    });
    const startSpy = vi.spyOn(useForwardStore.getState(), 'start').mockResolvedValue();
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/start forward db/i));
    expect(startSpy).toHaveBeenCalledWith('a');
    startSpy.mockRestore();
  });

  it('clicking ⏸ on a running forward calls store.stop', async () => {
    useForwardStore.setState({
      forwards: [f({ id: 'a', name: 'db' })],
      statuses: { a: status('a', 'running') },
    });
    const stopSpy = vi.spyOn(useForwardStore.getState(), 'stop').mockResolvedValue();
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/stop forward db/i));
    expect(stopSpy).toHaveBeenCalledWith('a');
    stopSpy.mockRestore();
  });

  it('clicking + calls onAdd', async () => {
    const onAdd = vi.fn();
    render(<ForwardsPanel onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /add forward/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('clicking ✎ calls onEdit', async () => {
    useForwardStore.setState({ forwards: [f({ id: 'a', name: 'db' })] });
    const onEdit = vi.fn();
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={onEdit} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/edit forward db/i));
    expect(onEdit.mock.calls[0][0].id).toBe('a');
  });

  it('clicking × calls onDelete', async () => {
    useForwardStore.setState({ forwards: [f({ id: 'a', name: 'db' })] });
    const onDelete = vi.fn();
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByLabelText(/delete forward db/i));
    expect(onDelete.mock.calls[0][0].id).toBe('a');
  });

  it('clicking ⏸ on a starting forward calls store.stop', async () => {
    useForwardStore.setState({
      forwards: [f({ id: 'a', name: 'db' })],
      statuses: { a: status('a', 'starting') },
    });
    const stopSpy = vi.spyOn(useForwardStore.getState(), 'stop').mockResolvedValue();
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/stop forward db/i));
    expect(stopSpy).toHaveBeenCalledWith('a');
    stopSpy.mockRestore();
  });

  it('toggle button collapses and expands the list', async () => {
    useForwardStore.setState({ forwards: [f({ id: 'a', name: 'db' })] });
    render(<ForwardsPanel onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('db')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /toggle forwards/i }));
    expect(screen.queryByText('db')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /toggle forwards/i }));
    expect(screen.getByText('db')).toBeInTheDocument();
  });
});
