import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext, MouseSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useSessionStore } from '../state/sessionStore';
import { TabBar } from './TabBar';

beforeEach(() => {
  useSessionStore.setState({
    tabs: [],
    activeTabId: null,
    layoutKind: 'solo',
    layoutSlots: [],
    activePaneIndex: 0,
  });
});

const onNew = vi.fn();
const onClose = vi.fn();
beforeEach(() => { onNew.mockClear(); onClose.mockClear(); });

// The strip's sortable/droppable hooks require a DndContext ancestor — in
// the app a single context spans every pane. An activation distance keeps a
// plain click a click (the sensor only starts a drag after movement).
function Harness({ paneIndex }: { paneIndex: number }) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
  );
  return (
    <DndContext sensors={sensors}>
      <TabBar paneIndex={paneIndex} onNew={onNew} onClose={onClose} />
    </DndContext>
  );
}

const renderBar = (paneIndex = 0) => render(<Harness paneIndex={paneIndex} />);

describe('TabBar', () => {
  it('renders this pane\'s tabs and clicking switches active', async () => {
    const { addTab, setActive } = useSessionStore.getState();
    addTab('pty-1', 'one');
    addTab('pty-2', 'two');
    setActive(useSessionStore.getState().tabs[0].id);

    renderBar(0);
    await userEvent.click(screen.getByText('two'));
    const second = useSessionStore.getState().tabs[1].id;
    expect(useSessionStore.getState().activeTabId).toBe(second);
  });

  it('only shows tabs that belong to the pane', () => {
    const { addTab, setActivePane } = useSessionStore.getState();
    useSessionStore.getState().setLayout('2col');
    addTab('pty-1', 'pane-zero');
    setActivePane(1);
    addTab('pty-2', 'pane-one');

    renderBar(0);
    expect(screen.getByText('pane-zero')).toBeTruthy();
    expect(screen.queryByText('pane-one')).toBeNull();
  });

  it('clicking + invokes onNew with the pane index', async () => {
    renderBar(0);
    await userEvent.click(screen.getByLabelText('New tab'));
    expect(onNew).toHaveBeenCalledWith(0);
  });

  it('double-click enters rename and Enter commits', async () => {
    useSessionStore.getState().addTab('pty-1', 'old');
    renderBar(0);
    const label = screen.getByText('old');
    await userEvent.dblClick(label);
    const input = screen.getByDisplayValue('old');
    await userEvent.clear(input);
    await userEvent.type(input, 'new{Enter}');
    expect(useSessionStore.getState().tabs[0].title).toBe('new');
  });

  it('clicking × invokes onClose', async () => {
    useSessionStore.getState().addTab('pty-1', 'x');
    renderBar(0);
    await userEvent.click(screen.getByLabelText('Close tab x'));
    expect(onClose).toHaveBeenCalledWith(useSessionStore.getState().tabs[0].id);
  });
});
