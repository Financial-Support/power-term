import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { FileBrowser } from './components/FileBrowser';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { Sidebar } from './components/Sidebar';
import { HostFormModal, type HostFormSaveArgs } from './components/HostFormModal';
import { ConfirmModal } from './components/ConfirmModal';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHostStore } from './state/hostStore';
import { useSftpStore } from './state/sftpStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { useSidebarToggle } from './hooks/useSidebarToggle';
import {
  ptyKill, ptySpawn, secretDelete, secretGet, secretSet,
  sftpClose, sftpOpen, sshConnect, sshKill,
} from './lib/ipc';
import type { AuthRequest, Host, SshTarget } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type TargetKind = 'shell' | 'sftp';

type RemoteFlow =
  | { phase: 'idle' }
  | { phase: 'connecting'; targetKind: TargetKind; target: SshTarget; auth: AuthRequest; acceptFp: string | null; titleOverride?: string; touchHostId?: string }
  | { phase: 'fingerprint'; targetKind: TargetKind; target: SshTarget; auth: AuthRequest; fingerprint: string; keyType: string; mismatch?: { expected: string }; titleOverride?: string; touchHostId?: string }
  | { phase: 'auth'; targetKind: TargetKind; target: SshTarget; tried: string[]; available: string[]; error?: string; titleOverride?: string; touchHostId?: string };

type FormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; host: Host };

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);

  const loadHosts = useHostStore((s) => s.load);
  const createHost = useHostStore((s) => s.create);
  const updateHost = useHostStore((s) => s.update);
  const deleteHost = useHostStore((s) => s.delete);
  const touchHost = useHostStore((s) => s.touch);

  const initSftpTab = useSftpStore((s) => s.init);
  const closeSftpTabState = useSftpStore((s) => s.closeTab);

  const sidebar = useSidebarToggle();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flow, setFlow] = useState<RemoteFlow>({ phase: 'idle' });
  const [form, setForm] = useState<FormMode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Host | null>(null);
  const flowToken = useRef(0);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadHosts(); }, [loadHosts]);

  const newLocalTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultLocalTitle(settings?.shell ?? null), 'local');
    } catch (e) { console.error('pty_spawn failed', e); }
  }, [addTab, settings?.shell]);

  const handleClose = useCallback(async (id: string) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === id);
    if (!tab) return;
    try {
      if (tab.kind === 'sftp') await sftpClose(tab.ptyId);
      else if (tab.kind === 'ssh') await sshKill(tab.ptyId);
      else await ptyKill(tab.ptyId);
    } catch (e) { console.warn('kill failed', e); }
    if (tab.kind === 'sftp') closeSftpTabState(tab.id);
    closeTab(id);
    if (useSessionStore.getState().tabs.length === 0) {
      void getCurrentWindow().close();
    }
  }, [closeTab, closeSftpTabState]);

  const driveConnect = useCallback(async (
    targetKind: TargetKind,
    target: SshTarget,
    auth: AuthRequest,
    acceptFp: string | null,
    titleOverride?: string,
    touchHostId?: string,
  ) => {
    const myToken = ++flowToken.current;
    setFlow({ phase: 'connecting', targetKind, target, auth, acceptFp, titleOverride, touchHostId });
    try {
      const result = targetKind === 'shell'
        ? await sshConnect({ target, auth, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, acceptFingerprint: acceptFp })
        : await sftpOpen({ host: target.host, port: target.port, user: target.user, auth, acceptFingerprint: acceptFp });
      if (myToken !== flowToken.current) return;
      if (result.status === 'connected') {
        const tabId = addTab(result.id, titleOverride ?? `${target.user}@${target.host}`, targetKind === 'shell' ? 'ssh' : 'sftp');
        if (targetKind === 'sftp') void initSftpTab(tabId, result.id);
        if (touchHostId) void touchHost(touchHostId);
        setFlow({ phase: 'idle' });
      } else if (result.status === 'needs_fingerprint') {
        setFlow({ phase: 'fingerprint', targetKind, target, auth, fingerprint: result.fingerprint, keyType: result.key_type, titleOverride, touchHostId });
      } else if (result.status === 'fingerprint_mismatch') {
        setFlow({ phase: 'fingerprint', targetKind, target, auth, fingerprint: result.fingerprint, keyType: 'unknown', mismatch: { expected: result.expected }, titleOverride, touchHostId });
      } else if (result.status === 'needs_auth') {
        setFlow({ phase: 'auth', targetKind, target, tried: result.tried, available: result.available, titleOverride, touchHostId });
      }
    } catch (e) {
      if (myToken !== flowToken.current) return;
      console.error(`${targetKind === 'shell' ? 'ssh_connect' : 'sftp_open'} failed`, e);
      setFlow({ phase: 'auth', targetKind, target, tried: [], available: ['agent', 'publickey', 'password'], error: String(e), titleOverride, touchHostId });
    }
  }, [addTab, touchHost, initSftpTab]);

  const onPaletteSshConnect = useCallback((target: SshTarget) => {
    setPaletteOpen(false);
    void driveConnect('shell', target, { kind: 'agent' }, null);
  }, [driveConnect]);

  const buildAuthFromHost = async (host: Host): Promise<AuthRequest | { phase: 'needs_auth' }> => {
    if (host.auth_method === 'agent') return { kind: 'agent' };
    if (host.auth_method === 'key') {
      const passphrase = (await secretGet(host.id).catch(() => null)) ?? undefined;
      return { kind: 'key', path: host.key_path ?? '', passphrase };
    }
    const password = await secretGet(host.id).catch(() => null);
    if (password === null) return { phase: 'needs_auth' };
    return { kind: 'password', password };
  };

  const connectFromHost = useCallback(async (host: Host) => {
    const target: SshTarget = { user: host.username, host: host.hostname, port: host.port };
    const auth = await buildAuthFromHost(host);
    if ('phase' in auth) {
      setFlow({ phase: 'auth', targetKind: 'shell', target, tried: [], available: ['password'], titleOverride: host.name, touchHostId: host.id });
      return;
    }
    await driveConnect('shell', target, auth, null, host.name, host.id);
  }, [driveConnect]);

  const openSftpFromHost = useCallback(async (host: Host) => {
    const target: SshTarget = { user: host.username, host: host.hostname, port: host.port };
    const auth = await buildAuthFromHost(host);
    if ('phase' in auth) {
      setFlow({ phase: 'auth', targetKind: 'sftp', target, tried: [], available: ['password'], titleOverride: host.name, touchHostId: host.id });
      return;
    }
    await driveConnect('sftp', target, auth, null, host.name, host.id);
  }, [driveConnect]);

  const handleFormSave = useCallback(async (args: HostFormSaveArgs) => {
    const targetId = form.kind === 'edit' ? form.host.id : null;
    const saved = targetId ? await updateHost(targetId, args.input) : await createHost(args.input);
    if (!saved) return;
    if (args.saveSecret && args.secret) {
      try { await secretSet(saved.id, args.secret); }
      catch (e) { console.warn('secret_set failed', e); }
    } else if (args.forgetSecret) {
      try { await secretDelete(saved.id); }
      catch (e) { console.warn('secret_delete failed', e); }
    }
    setForm({ kind: 'closed' });
  }, [form, updateHost, createHost]);

  const handleDelete = useCallback(async (host: Host) => {
    await deleteHost(host.id);
    setConfirmDelete(null);
  }, [deleteHost]);

  useHotkeys({ onNewTab: () => void newLocalTab(), onCloseTab: (id) => void handleClose(id) });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        if (flow.phase !== 'idle' || form.kind !== 'closed' || confirmDelete) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flow.phase, form.kind, confirmDelete]);

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
      <div className="body">
        {sidebar.open && (
          <Sidebar
            onConnect={(h) => void connectFromHost(h)}
            onOpenSftp={(h) => void openSftpFromHost(h)}
            onAdd={() => setForm({ kind: 'create' })}
            onEdit={(h) => setForm({ kind: 'edit', host: h })}
            onDelete={(h) => setConfirmDelete(h)}
          />
        )}
        <main className="terminals">
          {tabs.map((t) =>
            t.kind === 'sftp' ? (
              <div key={t.id} className="sftp-mount" style={{ display: t.id === visibleId ? 'flex' : 'none' }}>
                <FileBrowser tabId={t.id} onClose={() => void handleClose(t.id)} />
              </div>
            ) : (
              <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
            ),
          )}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSshConnect={onPaletteSshConnect} />
      {flow.phase === 'fingerprint' && (
        <HostFingerprintPrompt
          host={flow.target.host}
          fingerprint={flow.fingerprint}
          keyType={flow.keyType}
          isMismatch={!!flow.mismatch}
          expected={flow.mismatch?.expected}
          onAccept={() => driveConnect(flow.targetKind, flow.target, flow.auth, flow.fingerprint, flow.titleOverride, flow.touchHostId)}
          onCancel={() => setFlow({ phase: 'idle' })}
        />
      )}
      {flow.phase === 'auth' && (
        <AuthPrompt
          user={flow.target.user}
          host={flow.target.host}
          triedAgent={flow.tried.includes('agent')}
          errorMessage={flow.error}
          onSubmit={(auth) => driveConnect(flow.targetKind, flow.target, auth, null, flow.titleOverride, flow.touchHostId)}
          onCancel={() => setFlow({ phase: 'idle' })}
        />
      )}
      {form.kind !== 'closed' && (
        <HostFormModal
          mode={form.kind === 'edit' ? 'edit' : 'create'}
          host={form.kind === 'edit' ? form.host : undefined}
          onSave={(args) => void handleFormSave(args)}
          onCancel={() => setForm({ kind: 'closed' })}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete host?"
          message={`Remove "${confirmDelete.name}" from saved hosts? Any saved password / passphrase will also be removed from the Keychain.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
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
