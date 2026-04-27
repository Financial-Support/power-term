import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '../state/sessionStore';
import { TabBar } from './TabBar';

beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeTabId: null });
});

const onNew = vi.fn();
const onClose = vi.fn();
beforeEach(() => { onNew.mockClear(); onClose.mockClear(); });

describe('TabBar', () => {
  it('renders tabs and clicking switches active', async () => {
    const { addTab, setActive } = useSessionStore.getState();
    addTab('pty-1', 'one');
    addTab('pty-2', 'two');
    setActive(useSessionStore.getState().tabs[0].id);

    render(<TabBar onNew={onNew} onClose={onClose} />);
    await userEvent.click(screen.getByText('two'));
    const second = useSessionStore.getState().tabs[1].id;
    expect(useSessionStore.getState().activeTabId).toBe(second);
  });

  it('clicking + invokes onNew', async () => {
    render(<TabBar onNew={onNew} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('New tab'));
    expect(onNew).toHaveBeenCalled();
  });

  it('double-click enters rename and Enter commits', async () => {
    useSessionStore.getState().addTab('pty-1', 'old');
    render(<TabBar onNew={onNew} onClose={onClose} />);
    const label = screen.getByText('old');
    await userEvent.dblClick(label);
    const input = screen.getByDisplayValue('old');
    await userEvent.clear(input);
    await userEvent.type(input, 'new{Enter}');
    expect(useSessionStore.getState().tabs[0].title).toBe('new');
  });

  it('clicking × invokes onClose', async () => {
    useSessionStore.getState().addTab('pty-1', 'x');
    render(<TabBar onNew={onNew} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close tab x'));
    expect(onClose).toHaveBeenCalledWith(useSessionStore.getState().tabs[0].id);
  });
});
