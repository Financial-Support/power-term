import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';

beforeEach(() => {
  useSessionStore.setState({
    tabs: [],
    activeTabId: null,
    layoutKind: 'solo',
    layoutSlots: [],
    activePaneIndex: 0,
  });
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

  it('addTab defaults kind to local; ssh kind is preserved', () => {
    const { addTab } = useSessionStore.getState();
    const localId = addTab('pty-loc', 'a');
    const sshId = addTab('pty-ssh', 'b', 'ssh');
    const tabs = useSessionStore.getState().tabs;
    expect(tabs.find((t) => t.id === localId)!.kind).toBe('local');
    expect(tabs.find((t) => t.id === sshId)!.kind).toBe('ssh');
  });

  describe('layout', () => {
    it('addTab in solo mode assigns the tab to slot 0 and sets activeTabId', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      const s = useSessionStore.getState();
      expect(s.layoutSlots[0]).toBe(s.tabs[0].id);
      expect(s.activeTabId).toBe(s.tabs[0].id);
    });

    it('second addTab in solo mode replaces slot 0 and updates activeTabId', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().addTab('pty-2', 'b');
      const s = useSessionStore.getState();
      expect(s.tabs).toHaveLength(2);
      expect(s.layoutSlots[0]).toBe(s.tabs[1].id); // slot 0 = pty-2
      expect(s.activeTabId).toBe(s.tabs[1].id);
    });

    it('setLayout resizes slots to the correct count', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().setLayout('2col');
      const s = useSessionStore.getState();
      expect(s.layoutKind).toBe('2col');
      expect(s.layoutSlots).toHaveLength(2);
      expect(s.layoutSlots[0]).toBe(s.tabs[0].id);
      expect(s.layoutSlots[1]).toBeNull();
    });

    it('setLayout preserves existing slot assignments when shrinking', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().setLayout('3col');
      useSessionStore.getState().setLayout('2col');
      const s = useSessionStore.getState();
      expect(s.layoutSlots).toHaveLength(2);
    });

    it('setActivePane clamps to valid range', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().setLayout('2col');
      useSessionStore.getState().setActivePane(99);
      expect(useSessionStore.getState().activePaneIndex).toBe(1);
    });

    it('setActivePane updates activeTabId', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().setLayout('2col');
      useSessionStore.getState().setActivePane(0);
      useSessionStore.getState().assignSlot(1, useSessionStore.getState().tabs[0].id);
      useSessionStore.getState().setActivePane(1);
      expect(useSessionStore.getState().activeTabId).toBe(useSessionStore.getState().tabs[0].id);
    });

    it('assignSlot updates the correct slot and syncs activeTabId when it is the active pane', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().addTab('pty-2', 'b');
      useSessionStore.getState().setLayout('2col');
      const tab1Id = useSessionStore.getState().tabs[0].id;
      useSessionStore.getState().assignSlot(1, tab1Id);
      const s = useSessionStore.getState();
      expect(s.layoutSlots[1]).toBe(tab1Id);
    });

    it('closeTab nulls its slot and picks neighbour for solo mode', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().addTab('pty-2', 'b');
      const tab2Id = useSessionStore.getState().tabs[1].id;
      const tab1Id = useSessionStore.getState().tabs[0].id;
      useSessionStore.getState().closeTab(tab2Id);
      const s = useSessionStore.getState();
      expect(s.tabs).toHaveLength(1);
      expect(s.layoutSlots[0]).toBe(tab1Id);
      expect(s.activeTabId).toBe(tab1Id);
    });

    it('closeTab in multi-pane mode nulls the slot without changing other slots', () => {
      useSessionStore.getState().addTab('pty-1', 'a');
      useSessionStore.getState().addTab('pty-2', 'b');
      const { tabs } = useSessionStore.getState();
      useSessionStore.getState().setLayout('2col');
      useSessionStore.getState().assignSlot(1, tabs[0].id);
      useSessionStore.getState().closeTab(tabs[1].id); // tab in slot 0
      const s = useSessionStore.getState();
      expect(s.layoutSlots[0]).toBeNull();
      expect(s.layoutSlots[1]).toBe(tabs[0].id);
    });
  });
});
