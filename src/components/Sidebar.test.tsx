import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';

const h = (over: Partial<Host>): Host => ({
  id: 'a', name: 'aname', hostname: 'h', port: 22, username: 'u',
  group_name: null, tags: [], auth_method: 'agent', key_path: null,
  notes: null, created_at: 1, last_used_at: null, ...over,
});

beforeEach(() => {
  useHostStore.setState({ hosts: [], loading: false, error: null });
});

describe('Sidebar', () => {
  it('renders "+ New Host" button and Cmd+K hint', () => {
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new host/i })).toBeInTheDocument();
    expect(screen.getByText(/cmd\+k/i)).toBeInTheDocument();
  });

  it('groups hosts by group_name with synthetic Ungrouped', () => {
    useHostStore.setState({
      hosts: [
        h({ id: 'p1', name: 'mac', group_name: 'Personal' }),
        h({ id: 'p2', name: 'home', group_name: 'Personal' }),
        h({ id: 'w1', name: 'bastion', group_name: 'Work' }),
        h({ id: 'u1', name: 'temp', group_name: null }),
      ],
    });
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    expect(screen.getByText('mac')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('bastion')).toBeInTheDocument();
    expect(screen.getByText('temp')).toBeInTheDocument();
  });

  it('clicking a host row calls onConnect', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac' })] });
    const onConnect = vi.fn();
    render(<Sidebar onConnect={onConnect} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByText('mac'));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0].id).toBe('a');
  });

  it('clicking "+ New Host" calls onAdd', async () => {
    const onAdd = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={onAdd} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /new host/i }));
    expect(onAdd).toHaveBeenCalled();
  });

  it('clicking row × calls onDelete', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac' })] });
    const onDelete = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    await userEvent.click(screen.getByLabelText(/delete host mac/i));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe('a');
  });

  it('group header click toggles expansion', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac', group_name: 'Personal' })] });
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('mac')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Personal'));
    expect(screen.queryByText('mac')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Personal'));
    expect(screen.getByText('mac')).toBeInTheDocument();
  });

  it('shows empty-state hint when hosts empty', () => {
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no saved hosts/i)).toBeInTheDocument();
  });

  it('clicking 📂 calls onOpenSftp', async () => {
    useHostStore.setState({ hosts: [h({ id: 'a', name: 'mac' })] });
    const onOpenSftp = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onOpenSftp={onOpenSftp} onAdd={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/open sftp mac/i));
    expect(onOpenSftp).toHaveBeenCalledTimes(1);
    expect(onOpenSftp.mock.calls[0][0].id).toBe('a');
  });
});
