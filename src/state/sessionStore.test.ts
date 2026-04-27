import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';

beforeEach(() => {
  useSessionStore.setState({ tabs: [], activeTabId: null });
});

describe('sessionStore', () => {
  it('addTab creates a tab and sets it active', () => {
    useSessionStore.getState().addTab('pty-1', 'shell');
    const s = useSessionStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].ptyId).toBe('pty-1');
    expect(s.tabs[0].title).toBe('shell');
  });

  it('closeTab removes and reassigns active to neighbour', () => {
    const { addTab, closeTab } = useSessionStore.getState();
    addTab('pty-1', 'a');
    addTab('pty-2', 'b');
    addTab('pty-3', 'c');
    const tabs = useSessionStore.getState().tabs;
    closeTab(tabs[1].id);
    const after = useSessionStore.getState();
    expect(after.tabs.map(t => t.ptyId)).toEqual(['pty-1', 'pty-3']);
    expect(after.activeTabId).toBe(after.tabs[0].id);
  });

  it('setActive switches active tab', () => {
    const { addTab, setActive } = useSessionStore.getState();
    addTab('pty-1', 'a');
    addTab('pty-2', 'b');
    const second = useSessionStore.getState().tabs[1].id;
    setActive(second);
    expect(useSessionStore.getState().activeTabId).toBe(second);
  });

  it('rename updates title', () => {
    const { addTab, rename } = useSessionStore.getState();
    addTab('pty-1', 'old');
    const id = useSessionStore.getState().tabs[0].id;
    rename(id, 'new');
    expect(useSessionStore.getState().tabs[0].title).toBe('new');
  });

  it('markExit stores exit code on tab', () => {
    const { addTab, markExit } = useSessionStore.getState();
    addTab('pty-1', 'a');
    markExit('pty-1', 137);
    expect(useSessionStore.getState().tabs[0].exitCode).toBe(137);
  });
});
