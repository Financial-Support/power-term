import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { Sidebar } from './components/Sidebar';
import { HostFormModal, type HostFormSaveArgs } from './components/HostFormModal';
import { ConfirmModal } from './components/ConfirmModal';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHostStore } from './state/hostStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useTheme } from './hooks/useTheme';
import { useSidebarToggle } from './hooks/useSidebarToggle';
import { ptyKill, ptySpawn, secretDelete, secretGet, secretSet, sshConnect, sshKill } from './lib/ipc';
import type { AuthRequest, Host, SshTarget } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

type SshFlow =
  | { phase: 'idle' }
  | { phase: 'connecting'; target: SshTarget; auth: AuthRequest; acceptFp: string | null; titleOverride?: string; touchHostId?: string }
  | { phase: 'fingerprint'; target: SshTarget; auth: AuthRequest; fingerprint: string; keyType: string; mismatch?: { expected: string }; titleOverride?: string; touchHostId?: string }
  | { phase: 'auth'; target: SshTarget; tried: string[]; available: string[]; error?: string; titleOverride?: string; touchHostId?: string };

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

  const sidebar = useSidebarToggle();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sshFlow, setSshFlow] = useState<SshFlow>({ phase: 'idle' });
  const [form, setForm] = useState<FormMode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Host | null>(null);
  const flowToken = useRef(0);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadHosts(); }, [loadHosts]);

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

  const driveSshConnect = useCallback(async (
    target: SshTarget,
    auth: AuthRequest,
    acceptFp: string | null,
    titleOverride?: string,
    touchHostId?: string,
  ) => {
    const myToken = ++flowToken.current;
    setSshFlow({ phase: 'connecting', target, auth, acceptFp, titleOverride, touchHostId });
    try {
      const result = await sshConnect({ target, auth, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, acceptFingerprint: acceptFp });
      if (myToken !== flowToken.current) return;
      if (result.status === 'connected') {
        addTab(result.id, titleOverride ?? `${target.user}@${target.host}`, 'ssh');
        if (touchHostId) void touchHost(touchHostId);
        setSshFlow({ phase: 'idle' });
      } else if (result.status === 'needs_fingerprint') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: result.key_type, titleOverride, touchHostId });
      } else if (result.status === 'fingerprint_mismatch') {
        setSshFlow({ phase: 'fingerprint', target, auth, fingerprint: result.fingerprint, keyType: 'unknown', mismatch: { expected: result.expected }, titleOverride, touchHostId });
      } else if (result.status === 'needs_auth') {
        setSshFlow({ phase: 'auth', target, tried: result.tried, available: result.available, titleOverride, touchHostId });
      }
    } catch (e) {
      if (myToken !== flowToken.current) return;
      console.error('ssh_connect failed', e);
      setSshFlow({ phase: 'auth', target, tried: [], available: ['agent', 'publickey', 'password'], error: String(e), titleOverride, touchHostId });
    }
  }, [addTab, touchHost]);

  const onPaletteSshConnect = useCallback((target: SshTarget) => {
    setPaletteOpen(false);
    void driveSshConnect(target, { kind: 'agent' }, null);
  }, [driveSshConnect]);

  const connectFromHost = useCallback(async (host: Host) => {
    const target: SshTarget = { user: host.username, host: host.hostname, port: host.port };
    let auth: AuthRequest;
    if (host.auth_method === 'agent') {
      auth = { kind: 'agent' };
    } else if (host.auth_method === 'key') {
      const passphrase = (await secretGet(host.id).catch(() => null)) ?? undefined;
      auth = { kind: 'key', path: host.key_path ?? '', passphrase };
    } else {
      const password = await secretGet(host.id).catch(() => null);
      if (password === null) {
        setSshFlow({
          phase: 'auth',
          target,
          tried: [],
          available: ['password'],
          titleOverride: host.name,
          touchHostId: host.id,
        });
        return;
      }
      auth = { kind: 'password', password };
    }
    await driveSshConnect(target, auth, null, host.name, host.id);
  }, [driveSshConnect]);

  const handleFormSave = useCallback(async (args: HostFormSaveArgs) => {
    const targetId = form.kind === 'edit' ? form.host.id : null;
    const saved = targetId
      ? await updateHost(targetId, args.input)
      : await createHost(args.input);
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
        if (sshFlow.phase !== 'idle' || form.kind !== 'closed' || confirmDelete) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sshFlow.phase, form.kind, confirmDelete]);

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
            onAdd={() => setForm({ kind: 'create' })}
            onEdit={(h) => setForm({ kind: 'edit', host: h })}
            onDelete={(h) => setConfirmDelete(h)}
          />
        )}
        <main className="terminals">
          {tabs.map((t) => (
            <Terminal key={t.id} tab={t} visible={t.id === visibleId} />
          ))}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSshConnect={onPaletteSshConnect} />
      {sshFlow.phase === 'fingerprint' && (
        <HostFingerprintPrompt
          host={sshFlow.target.host}
          fingerprint={sshFlow.fingerprint}
          keyType={sshFlow.keyType}
          isMismatch={!!sshFlow.mismatch}
          expected={sshFlow.mismatch?.expected}
          onAccept={() => driveSshConnect(sshFlow.target, sshFlow.auth, sshFlow.fingerprint, sshFlow.titleOverride, sshFlow.touchHostId)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
        />
      )}
      {sshFlow.phase === 'auth' && (
        <AuthPrompt
          user={sshFlow.target.user}
          host={sshFlow.target.host}
          triedAgent={sshFlow.tried.includes('agent')}
          errorMessage={sshFlow.error}
          onSubmit={(auth) => driveSshConnect(sshFlow.target, auth, null, sshFlow.titleOverride, sshFlow.touchHostId)}
          onCancel={() => setSshFlow({ phase: 'idle' })}
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
