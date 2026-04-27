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

  it('closeTab on non-active tab keeps active unchanged', () => {
    const { addTab, closeTab } = useSessionStore.getState();
    addTab('pty-1', 'a');
    addTab('pty-2', 'b');
    addTab('pty-3', 'c');
    // active is pty-3 (last addTab sets active)
    const tabs = useSessionStore.getState().tabs;
    const activeBefore = useSessionStore.getState().activeTabId;
    closeTab(tabs[1].id); // close pty-2 (not active)
    const after = useSessionStore.getState();
    expect(after.tabs.map(t => t.ptyId)).toEqual(['pty-1', 'pty-3']);
    expect(after.activeTabId).toBe(activeBefore); // still pty-3
  });

  it('closeTab on active tab picks right neighbour, else left', () => {
    const { addTab, closeTab, setActive } = useSessionStore.getState();
    addTab('pty-1', 'a');
    addTab('pty-2', 'b');
    addTab('pty-3', 'c');
    const tabs = useSessionStore.getState().tabs;
    setActive(tabs[1].id); // active = pty-2 (middle)
    closeTab(tabs[1].id);
    // tabs=[pty-1, pty-3]; active should jump to pty-3 (right neighbour at same idx)
    let after = useSessionStore.getState();
    expect(after.tabs.map(t => t.ptyId)).toEqual(['pty-1', 'pty-3']);
    expect(after.activeTabId).toBe(after.tabs[1].id);

    // Close active pty-3 (last): falls back to left neighbour pty-1
    closeTab(after.tabs[1].id);
    after = useSessionStore.getState();
    expect(after.tabs.map(t => t.ptyId)).toEqual(['pty-1']);
    expect(after.activeTabId).toBe(after.tabs[0].id);
  });

  it('closeTab on the only tab clears activeTabId', () => {
    const { addTab, closeTab } = useSessionStore.getState();
    addTab('pty-1', 'a');
    const id = useSessionStore.getState().tabs[0].id;
    closeTab(id);
    const after = useSessionStore.getState();
    expect(after.tabs).toHaveLength(0);
    expect(after.activeTabId).toBeNull();
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
