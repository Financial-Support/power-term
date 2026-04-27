import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { ptyKill, ptySpawn, sshConnect, sshKill } from './lib/ipc';
import type { AuthRequest, SshTarget } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type SshFlow =
  | { phase: 'idle' }
  | { phase: 'connecting'; target: SshTarget; auth: AuthRequest; acceptFp: string | null }
  | { phase: 'fingerprint'; target: SshTarget; auth: AuthRequest; fingerprint: string; keyType: string; mismatch?: { expected: string } }
  | { phase: 'auth'; target: SshTarget; tried: string[]; available: string[]; error?: string };

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshFlow, setSshFlow] = useState<SshFlow>({ phase: 'idle' });

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const newLocalTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultLocalTitle(settings?.shell ?? null), 'local');
    } catch (e) {
      console.error('pty_spawn failed', e);
    }
  }, [addTab, settings?.shell]);

  const handleClose = useCallback(async (id: string) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    try {
      if (tab.kind === 'ssh') await sshKill(tab.ptyId);
      else await ptyKill(tab.ptyId);
    } catch (e) { console.warn('kill failed', e); }
    closeTab(id);
    if (useSessionStore.getState().tabs.length === 0) {
      void getCurrentWindow().close();
    }
  }, [closeTab]);

  const driveSshConnect = useCallback(async (target: SshTarget, auth: AuthRequest, acceptFp: string | null) => {
    setSshFlow({ phase: 'connecting', target, auth, acceptFp });
    try {
      const result = await sshConnect({ target, auth, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, acceptFingerprint: acceptFp });
      if (result.status === 'connected') {
        addTab(result.id, `${target.user}@${target.host}`, 'ssh');
        setSshFlow({ phase: 'idle' });
      } else if (result.status === 'needs_fingerprint') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: result.key_type });
      } else if (result.status === 'fingerprint_mismatch') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: 'unknown', mismatch: { expected: result.expected } });
      } else if (result.status === 'needs_auth') {
        setSshFlow({ phase: 'auth', target, tried: result.tried, available: result.available });
      }
    } catch (e) {
      console.error('ssh_connect failed', e);
      setSshFlow({ phase: 'auth', target, tried: [], available: ['agent', 'publickey', 'password'], error: String(e) });
    }
  }, [addTab]);

  const onPaletteSshConnect = useCallback((target: SshTarget) => {
    setPaletteOpen(false);
    void driveSshConnect(target, { kind: 'agent' }, null);
  }, [driveSshConnect]);

  useHotkeys({ onNewTab: () => void newLocalTab(), onCloseTab: (id) => void handleClose(id) });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openedFirstTab = useRef(false);
  useEffect(() => {
    if (settings && tabs.length === 0 && !openedFirstTab.current) {
      openedFirstTab.current = true;
      void newLocalTab();
    }
  }, [settings, tabs.length, newLocalTab]);

  const theme = useTheme();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const visibleId = useMemo(() => activeTabId, [activeTabId]);

  return (
    <div className={`app theme-${theme}`}>
      <TitleBar>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <main className="terminals">
        {tabs.map((t) => (
          <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
        ))}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSshConnect={onPaletteSshConnect} />
      {sshFlow.phase === 'fingerprint' && (
        <HostFingerprintPrompt
          host={sshFlow.target.host}
          fingerprint={sshFlow.fingerprint}
          keyType={sshFlow.keyType}
          isMismatch={!!sshFlow.mismatch}
          expected={sshFlow.mismatch?.expected}
          onAccept={() => driveSshConnect(sshFlow.target, sshFlow.auth, sshFlow.fingerprint)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
      {sshFlow.phase === 'auth' && (
        <AuthPrompt
          user={sshFlow.target.user}
          host={sshFlow.target.host}
          triedAgent={sshFlow.tried.includes('agent')}
          errorMessage={sshFlow.error}
          onSubmit={(auth) => driveSshConnect(sshFlow.target, auth, null)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
    </div>
  );
}

function defaultLocalTitle(shell: string | null): string {
  if (!shell) return 'shell';
  const base = shell.split('/').pop() ?? 'shell';
  return base;
}
