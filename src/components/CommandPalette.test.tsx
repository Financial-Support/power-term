import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('renders an input', () => {
    render(<CommandPalette open onClose={() => {}} onSshConnect={vi.fn()} />);
    expect(screen.getByPlaceholderText(/ssh user@host/i)).toBeInTheDocument();
  });

  it('typing "ssh user@host" + Enter triggers onSshConnect', async () => {
    const onSshConnect = vi.fn();
    render(<CommandPalette open onClose={() => {}} onSshConnect={onSshConnect} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, 'ssh band@example.com:2222{Enter}');
    expect(onSshConnect).toHaveBeenCalledWith({ user: 'band', host: 'example.com', port: 2222 });
  });

  it('Escape calls onClose', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} onSshConnect={vi.fn()} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a parse error and does not call onSshConnect on bad input', async () => {
    const onSshConnect = vi.fn();
    render(<CommandPalette open onClose={() => {}} onSshConnect={onSshConnect} />);
    const input = screen.getByPlaceholderText(/ssh user@host/i);
    await userEvent.type(input, 'ssh @@@{Enter}');
    expect(onSshConnect).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid|empty/i)).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(<CommandPalette open={false} onClose={() => {}} onSshConnect={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/ssh user@host/i)).not.toBeInTheDocument();
  });
});
