import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { ptyKill, ptySpawn } from './lib/ipc';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const newTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultTitle(settings?.shell ?? null));
    } catch (e) {
      console.error('pty_spawn failed', e);
    }
  }, [addTab, settings?.shell]);

  const handleClose = useCallback(async (id: string) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    try { await ptyKill(tab.ptyId); } catch (e) { console.warn('kill failed', e); }
    closeTab(id);
    if (useSessionStore.getState().tabs.length === 0) {
      void getCurrentWindow().close();
    }
  }, [closeTab]);

  useHotkeys({ onNewTab: () => void newTab(), onCloseTab: (id) => void handleClose(id) });

  // Open the first tab once settings load.
  // Guard against React 18 StrictMode double-mount in dev: without the ref,
  // the effect would dispatch two ptySpawn calls before the first one settles.
  const openedFirstTab = useRef(false);
  useEffect(() => {
    if (settings && tabs.length === 0 && !openedFirstTab.current) {
      openedFirstTab.current = true;
      void newTab();
    }
  }, [settings, tabs.length, newTab]);

  const theme = useTheme();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const visibleId = useMemo(() => activeTabId, [activeTabId]);

  return (
    <div className={`app theme-${theme}`}>
      <TitleBar>
        <TabBar onNew={() => void newTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <main className="terminals">
        {tabs.map((t) => (
          <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
        ))}
      </main>
    </div>
  );
}

function defaultTitle(shell: string | null): string {
  if (!shell) return 'shell';
  const base = shell.split('/').pop() ?? 'shell';
  return base;
}
