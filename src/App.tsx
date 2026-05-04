import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { TitleBar } from './components/TitleBar';
import { TabBar } from './components/TabBar';
import { Terminal } from './components/Terminal';
import { SftpDualBrowser } from './components/SftpDualBrowser';
import { CommandPalette } from './components/CommandPalette';
import { HostFingerprintPrompt } from './components/HostFingerprintPrompt';
import { AuthPrompt } from './components/AuthPrompt';
import { IconRail, type SidebarSection } from './components/IconRail';
import { WelcomePane } from './components/WelcomePane';
import { Splitter } from './components/Splitter';
import { SshConfigImportModal } from './components/SshConfigImportModal';
import { AICommandBar } from './components/AICommandBar';
import { SidebarPanel } from './components/SidebarPanel';
import { HostFormModal, type HostFormSaveArgs } from './components/HostFormModal';
import { ConfirmModal } from './components/ConfirmModal';
import { SnippetsPanel } from './components/SnippetsPanel';
import { SnippetFormModal } from './components/SnippetFormModal';
import { useSnippetStore } from './state/snippetStore';
import { ForwardsPanel } from './components/ForwardsPanel';
import { ForwardFormModal } from './components/ForwardFormModal';
import { SettingsModal } from './components/SettingsModal';
import { useForwardStore } from './state/forwardStore';
import { onForwardStatusForId } from './lib/forwardEvents';
import { useSessionStore } from './state/sessionStore';
import { useSettingsStore } from './state/settingsStore';
import { useHostStore } from './state/hostStore';
import { useSftpStore } from './state/sftpStore';
import { useHotkeys } from './hooks/useHotkeys';
import { useZoom } from './hooks/useZoom';
import { useTheme } from './hooks/useTheme';
import { useSyncStore } from './state/syncStore';
import {
  ptyKill, ptySpawn, ptyWrite, secretDelete, secretGet, secretSet,
  sftpClose, sftpOpen, sshConnect, sshKill, sshWrite, snippetsTouch,
} from './lib/ipc';
import type { AuthRequest, Forward, ForwardInput, Host, LayoutKind, Snippet, SnippetInput, SshTarget } from './types';
import { LAYOUT_SLOT_COUNTS as COUNTS } from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Resolve the user's macOS system accent colour to a hex string. Goes
 * through a Rust IPC because the CSS `AccentColor` keyword is not
 * resolved inside `color-mix()` by WKWebView — the symptom is "I set
 * Purple but the app shows Green" because the mixer falls back to a
 * default. The Rust side reads `AppleAccentColor` from defaults, which
 * is the same source AppKit's controlAccentColor uses.
 */
async function resolveSystemAccent(): Promise<string | null> {
  try {
    const hex = await invoke<string>('system_accent_color');
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

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

type SnippetFormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; snippet: Snippet };

type ForwardFormMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; forward: Forward };

export function App() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const tabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const addTab = useSessionStore((s) => s.addTab);
  const closeTab = useSessionStore((s) => s.closeTab);
  const layoutKind = useSessionStore((s) => s.layoutKind);
  const layoutSlots = useSessionStore((s) => s.layoutSlots);
  const activePaneIndex = useSessionStore((s) => s.activePaneIndex);
  const setLayout = useSessionStore((s) => s.setLayout);
  const setActivePane = useSessionStore((s) => s.setActivePane);
  const splits = useSessionStore((s) => s.splits);
  const setSplit = useSessionStore((s) => s.setSplit);
  const broadcast = useSessionStore((s) => s.broadcast);
  const terminalsRef = useRef<HTMLElement>(null);

  const loadHosts = useHostStore((s) => s.load);
  const createHost = useHostStore((s) => s.create);
  const updateHost = useHostStore((s) => s.update);
  const deleteHost = useHostStore((s) => s.delete);
  const touchHost = useHostStore((s) => s.touch);

  const loadSnippets = useSnippetStore((s) => s.load);
  const createSnippet = useSnippetStore((s) => s.create);
  const updateSnippet = useSnippetStore((s) => s.update);
  const deleteSnippet = useSnippetStore((s) => s.delete);
  const touchSnippetLocal = useSnippetStore((s) => s.touch);

  const loadForwards = useForwardStore((s) => s.load);
  const loadForwardStatuses = useForwardStore((s) => s.loadStatuses);
  const createForward = useForwardStore((s) => s.create);
  const updateForward = useForwardStore((s) => s.update);
  const deleteForward = useForwardStore((s) => s.delete);
  const setForwardStatus = useForwardStore((s) => s.setStatus);
  const startForwardLocal = useForwardStore((s) => s.start);
  const forwardsList = useForwardStore((s) => s.forwards);

  const initSftpTab = useSftpStore((s) => s.init);
  const closeSftpTabState = useSftpStore((s) => s.closeTab);

  const [sidebarSection, setSidebarSection] = useState<SidebarSection>('hosts');
  const [railExpanded, setRailExpanded] = useState<boolean>(() => {
    // Persist expanded/collapsed across launches. Default is collapsed
    // (icons only) so the chrome stays compact for users who don't need
    // labels.
    return localStorage.getItem('icon-rail-expanded') === '1';
  });
  useEffect(() => { localStorage.setItem('icon-rail-expanded', railExpanded ? '1' : '0'); }, [railExpanded]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [flow, setFlow] = useState<RemoteFlow>({ phase: 'idle' });
  const [form, setForm] = useState<FormMode>({ kind: 'closed' });
  const [confirmDelete, setConfirmDelete] = useState<Host | null>(null);
  const [snippetForm, setSnippetForm] = useState<SnippetFormMode>({ kind: 'closed' });
  const [confirmDeleteSnippet, setConfirmDeleteSnippet] = useState<Snippet | null>(null);
  const [forwardForm, setForwardForm] = useState<ForwardFormMode>({ kind: 'closed' });
  const [confirmDeleteForward, setConfirmDeleteForward] = useState<Forward | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sshImportOpen, setSshImportOpen] = useState(false);
  const [aiBarOpen, setAiBarOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'appearance' | 'terminal' | 'sync'>('appearance');
  const flowToken = useRef(0);
  const { zoomIn, zoomOut, zoomReset } = useZoom();

  useEffect(() => {
    const { fetchStatus, pull } = useSyncStore.getState();
    fetchStatus().then(() => {
      if (useSyncStore.getState().syncState?.user) {
        void pull();
      }
    });
  }, []);

  useEffect(() => {
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    let u3: (() => void) | undefined;
    let u4: (() => void) | undefined;
    listen('menu:open-settings', () => { setSettingsOpen(true); }).then(fn => { u1 = fn; });
    listen('menu:zoom-in', () => { zoomIn(); }).then(fn => { u2 = fn; });
    listen('menu:zoom-out', () => { zoomOut(); }).then(fn => { u3 = fn; });
    listen('menu:zoom-reset', () => { zoomReset(); }).then(fn => { u4 = fn; });
    return () => { u1?.(); u2?.(); u3?.(); u4?.(); };
  }, [zoomIn, zoomOut, zoomReset]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadHosts(); }, [loadHosts]);
  useEffect(() => { void loadSnippets(); }, [loadSnippets]);
  useEffect(() => {
    void loadForwards();
    void loadForwardStatuses();
  }, [loadForwards, loadForwardStatuses]);

  const forwardIdKey = useMemo(
    () => forwardsList.map((f) => f.id).join(','),
    [forwardsList],
  );

  useEffect(() => {
    const ids = forwardIdKey ? forwardIdKey.split(',') : [];
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      for (const id of ids) {
        if (cancelled) return;
        const un = await onForwardStatusForId(id, (s) => setForwardStatus(s));
        unsubs.push(un);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [forwardIdKey, setForwardStatus]);

  const newLocalTab = useCallback(async () => {
    try {
      const ptyId = await ptySpawn({ cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
      addTab(ptyId, defaultLocalTitle(settings?.shell ?? null), 'local');
    } catch (e) { console.error('pty_spawn failed', e); }
  }, [addTab, settings?.shell]);

  const fillNullSlots = useCallback(async (kind: LayoutKind) => {
    setLayout(kind);
    // After setLayout the store has new slots; read them to find nulls
    const { layoutSlots: slots, activePaneIndex: origPane } = useSessionStore.getState();
    const nullIndices = slots.map((s, i) => (s === null ? i : -1)).filter((i) => i >= 0);
    for (const idx of nullIndices) {
      useSessionStore.getState().setActivePane(idx);
      await newLocalTab();
    }
    useSessionStore.getState().setActivePane(Math.min(origPane, COUNTS[kind] - 1));
  }, [setLayout, newLocalTab]);

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
    // Last tab closed → fall through to the WelcomePane (no auto-quit).
    // Use ⌘Q or the window close button to actually exit.
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
      if (myToken !== flowToken.current) {
        // User cancelled while we were connecting. Reap the session if it
        // succeeded so we don't leak a backend session no one is using.
        if (result.status === 'connected') {
          if (targetKind === 'shell') void sshKill(result.id);
          else void sftpClose(result.id);
        }
        return;
      }
      if (result.status === 'connected') {
        const tabId = addTab(result.id, titleOverride ?? `${target.user}@${target.host}`, targetKind === 'shell' ? 'ssh' : 'sftp', touchHostId);
        if (targetKind === 'sftp') void initSftpTab(tabId, result.id);
        if (touchHostId) void touchHost(touchHostId);
        if (touchHostId) {
          const autos = useForwardStore.getState().forwards.filter(
            (f) => f.host_id === touchHostId && f.auto_start,
          );
          for (const f of autos) {
            void startForwardLocal(f.id);
          }
        }
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
  }, [addTab, touchHost, initSftpTab, startForwardLocal]);

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
    // ProxyJump scaffolding: hosts imported with a `proxyjump:<name>` tag
    // need backend SSH chaining that isn't wired yet. Until that lands,
    // tell the user clearly so they can fall back to ~/.ssh/config.
    const jumpTag = host.tags.find((t) => t.startsWith('proxyjump:'));
    if (jumpTag) {
      const via = jumpTag.slice('proxyjump:'.length);
      const msg = `"${host.name}" requires ProxyJump via "${via}". The backend SSH chain is not yet wired in Power Term — please connect via your shell ~/.ssh/config until this lands.`;
      console.warn(msg);
      alert(msg);
      return;
    }
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

  const onInsertSnippet = useCallback((snip: Snippet) => {
    const tab = useSessionStore.getState().tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (tab.kind === 'sftp') {
      console.warn('Snippets cannot be inserted into an SFTP tab.');
      return;
    }
    if (tab.kind === 'ssh') void sshWrite(tab.ptyId, snip.content);
    else void ptyWrite(tab.ptyId, snip.content);
    void snippetsTouch(snip.id).catch(() => {});
    void touchSnippetLocal(snip.id);
  }, [activeTabId, touchSnippetLocal]);

  const handleSnippetSave = useCallback(async (input: SnippetInput) => {
    const targetId = snippetForm.kind === 'edit' ? snippetForm.snippet.id : null;
    if (targetId) await updateSnippet(targetId, input);
    else await createSnippet(input);
    setSnippetForm({ kind: 'closed' });
  }, [snippetForm, updateSnippet, createSnippet]);

  const handleSnippetDelete = useCallback(async (snip: Snippet) => {
    await deleteSnippet(snip.id);
    setConfirmDeleteSnippet(null);
  }, [deleteSnippet]);

  const handleForwardSave = useCallback(async (input: ForwardInput) => {
    const targetId = forwardForm.kind === 'edit' ? forwardForm.forward.id : null;
    if (targetId) await updateForward(targetId, input);
    else await createForward(input);
    setForwardForm({ kind: 'closed' });
  }, [forwardForm, updateForward, createForward]);

  const handleForwardDelete = useCallback(async (f: Forward) => {
    await deleteForward(f.id);
    setConfirmDeleteForward(null);
  }, [deleteForward]);

  useHotkeys({ onNewTab: () => void newLocalTab(), onCloseTab: (id) => void handleClose(id), onZoomIn: zoomIn, onZoomOut: zoomOut, onZoomReset: zoomReset });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        if (flow.phase !== 'idle' || form.kind !== 'closed' || confirmDelete) return;
        if (snippetForm.kind !== 'closed' || confirmDeleteSnippet) return;
        if (forwardForm.kind !== 'closed' || confirmDeleteForward) return;
        if (settingsOpen) return;
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        if (flow.phase !== 'idle' || form.kind !== 'closed' || confirmDelete) return;
        if (snippetForm.kind !== 'closed' || confirmDeleteSnippet) return;
        if (forwardForm.kind !== 'closed' || confirmDeleteForward) return;
        if (settingsOpen) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
      // ⌘⇧B toggles broadcast input. Avoids ⌘B which xterm treats as
      // a navigation/selection key in many shells (tmux too).
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const { broadcast: cur, setBroadcast: setB } = useSessionStore.getState();
        setB(!cur);
      }
      // ⌘L opens the AI command bar.
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        if (settingsOpen || paletteOpen) return;
        e.preventDefault();
        setAiBarOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flow.phase, form.kind, confirmDelete, snippetForm.kind, confirmDeleteSnippet, forwardForm.kind, confirmDeleteForward, settingsOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.altKey) return;
      const { layoutKind, activePaneIndex } = useSessionStore.getState();
      const count = COUNTS[layoutKind];
      if (count <= 1) return;

      let next = activePaneIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        next = e.key === 'ArrowRight'
          ? (activePaneIndex + 1) % count
          : (activePaneIndex - 1 + count) % count;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (layoutKind !== '2row' && layoutKind !== '2x2') return;
        e.preventDefault();
        if (layoutKind === '2row') {
          next = e.key === 'ArrowDown'
            ? (activePaneIndex + 1) % count
            : (activePaneIndex - 1 + count) % count;
        } else if (layoutKind === '2x2') {
          // 2x2 grid: slot 0=TL, 1=TR, 2=BL, 3=BR
          const cols = 2;
          if (e.key === 'ArrowDown') next = (activePaneIndex + cols) % count;
          else next = (activePaneIndex - cols + count) % count;
        }
      } else {
        return;
      }

      useSessionStore.getState().setActivePane(next);
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
  useEffect(() => {
    const accent = settings?.accent_color ?? 'system';
    const root = document.documentElement;
    if (accent === 'system') {
      void resolveSystemAccent().then((resolved) => {
        if (resolved) root.style.setProperty('--accent', resolved);
        else root.style.removeProperty('--accent');
      });
    } else if (/^#[0-9a-f]{6}$/i.test(accent)) {
      root.style.setProperty('--accent', accent);
    } else {
      root.style.removeProperty('--accent');
    }
  }, [settings?.accent_color]);

  // Re-probe whenever the OS appearance/accent might have changed.
  useEffect(() => {
    if (settings?.accent_color !== 'system' && settings?.accent_color != null) return;
    const apply = async () => {
      const resolved = await resolveSystemAccent();
      if (resolved) document.documentElement.style.setProperty('--accent', resolved);
    };
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onFocus = () => { void apply(); };
    const onMq = () => { void apply(); };
    mq.addEventListener('change', onMq);
    window.addEventListener('focus', onFocus);
    return () => {
      mq.removeEventListener('change', onMq);
      window.removeEventListener('focus', onFocus);
    };
  }, [settings?.accent_color]);

  return (
    <div className="app">
      <TitleBar onLayoutChange={(kind) => void fillNullSlots(kind)} onOpenSyncSettings={() => { setSettingsInitialTab('sync'); setSettingsOpen(true); }}>
        <TabBar onNew={() => void newLocalTab()} onClose={(id) => void handleClose(id)} />
      </TitleBar>
      <div className="body">
        <IconRail
          activeSection={sidebarSection}
          onSection={setSidebarSection}
          expanded={railExpanded}
          onToggle={() => setRailExpanded((o) => !o)}
          onSettings={() => { setSettingsInitialTab('appearance'); setSettingsOpen(true); }}
          onSync={() => { setSettingsInitialTab('sync'); setSettingsOpen(true); }}
        />
        <SidebarPanel
          section={sidebarSection}
          onConnect={(h) => void connectFromHost(h)}
          onOpenSftp={(h) => void openSftpFromHost(h)}
          onAddHost={() => setForm({ kind: 'create' })}
          onImportSshConfig={() => setSshImportOpen(true)}
          onEditHost={(h) => setForm({ kind: 'edit', host: h })}
          onDeleteHost={(h) => setConfirmDelete(h)}
          snippetsSlot={
            <SnippetsPanel
              onAdd={() => setSnippetForm({ kind: 'create' })}
              onEdit={(snip) => setSnippetForm({ kind: 'edit', snippet: snip })}
              onDelete={(snip) => setConfirmDeleteSnippet(snip)}
              onInsert={onInsertSnippet}
            />
          }
          forwardsSlot={
            <ForwardsPanel
              onAdd={() => setForwardForm({ kind: 'create' })}
              onEdit={(f) => setForwardForm({ kind: 'edit', forward: f })}
              onDelete={(f) => setConfirmDeleteForward(f)}
            />
          }
        />
        <main
          ref={terminalsRef}
          className={`terminals layout-${layoutKind}${broadcast ? ' broadcast-on' : ''}`}
          style={terminalsGridStyle(layoutKind, splits)}
        >
          {/* All non-SFTP tabs always mounted at this stable parent so xterm
              state survives slot reassignment. CSS `order` places each visible
              terminal in its layout slot; non-slot tabs are display:none. */}
          {tabs.filter((t) => t.kind !== 'sftp').map((t) => {
            const slotIdx = layoutSlots.indexOf(t.id);
            const inSlot = slotIdx >= 0;
            return (
              <div
                key={t.id}
                className={`pane${inSlot && slotIdx === activePaneIndex ? ' pane-active' : ''}`}
                style={inSlot ? { order: slotIdx } : { display: 'none' }}
                onClick={() => { if (inSlot) setActivePane(slotIdx); }}
              >
                <Terminal tab={t} visible={inSlot} active={inSlot && slotIdx === activePaneIndex} onAutoClose={handleClose} />
              </div>
            );
          })}
          {/* SFTP browsers render only when in a slot. */}
          {layoutSlots.map((tabId, i) => {
            if (!tabId) return null;
            const tab = tabs.find((t) => t.id === tabId);
            if (!tab || tab.kind !== 'sftp') return null;
            return (
              <div
                key={`sftp-${tab.id}`}
                className={`pane${i === activePaneIndex ? ' pane-active' : ''}`}
                style={{ order: i }}
                onClick={() => setActivePane(i)}
              >
                <div className="sftp-mount" style={{ width: '100%', height: '100%', display: 'flex' }}>
                  <SftpDualBrowser tabId={tab.id} onClose={() => void handleClose(tab.id)} />
                </div>
              </div>
            );
          })}
          {/* Empty-slot placeholders. With zero tabs total we render a full
              Welcome pane with quick actions + recent hosts; otherwise it's
              an empty slot in a multi-pane layout, so a compact "+ new"
              placeholder is enough. */}
          {layoutSlots.map((tabId, i) => {
            if (tabId) return null;
            const isWelcome = tabs.length === 0;
            return (
              <div
                key={`empty-${i}`}
                className={`pane${i === activePaneIndex ? ' pane-active' : ''}`}
                style={{ order: i }}
                onClick={() => setActivePane(i)}
              >
                {isWelcome ? (
                  <WelcomePane
                    onNewLocal={() => { setActivePane(i); void newLocalTab(); }}
                    onOpenPalette={() => setPaletteOpen(true)}
                    onOpenSettings={() => { setSettingsInitialTab('appearance'); setSettingsOpen(true); }}
                    onConnectHost={(h) => { setActivePane(i); void connectFromHost(h); }}
                  />
                ) : (
                  <div className="pane-empty">
                    <button type="button" className="pane-empty-btn" onClick={(e) => { e.stopPropagation(); setActivePane(i); void newLocalTab(); }}>
                      +
                    </button>
                    <div className="pane-empty-hints">
                      <div className="pane-empty-hint"><kbd>⌘T</kbd><span>New local tab</span></div>
                      <div className="pane-empty-hint"><kbd>⌘K</kbd><span>Find host or snippet</span></div>
                      <div className="pane-empty-hint"><kbd>⌘,</kbd><span>Settings</span></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* Drag handles between panes (overlaid; do not affect grid). */}
          {layoutKind === '2col' && (
            <Splitter orientation="vertical" value={splits.col2} parentRef={terminalsRef}
              onChange={(v) => setSplit({ col2: v })} />
          )}
          {layoutKind === '2row' && (
            <Splitter orientation="horizontal" value={splits.row2} parentRef={terminalsRef}
              onChange={(v) => setSplit({ row2: v })} />
          )}
          {layoutKind === '3col' && (
            <>
              <Splitter orientation="vertical" value={splits.col3[0]} parentRef={terminalsRef}
                onChange={(v) => setSplit({ col3: [Math.min(v, splits.col3[1] - 0.05), splits.col3[1]] })} />
              <Splitter orientation="vertical" value={splits.col3[1]} parentRef={terminalsRef}
                onChange={(v) => setSplit({ col3: [splits.col3[0], Math.max(v, splits.col3[0] + 0.05)] })} />
            </>
          )}
          {layoutKind === '2x2' && (
            <>
              <Splitter orientation="vertical" value={splits.gridCol} parentRef={terminalsRef}
                onChange={(v) => setSplit({ gridCol: v })} />
              <Splitter orientation="horizontal" value={splits.gridRow} parentRef={terminalsRef}
                onChange={(v) => setSplit({ gridRow: v })} />
            </>
          )}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSshConnect={onPaletteSshConnect}
        onConnectHost={(h) => void connectFromHost(h)}
        onInsertSnippet={onInsertSnippet}
        onNewLocalTab={() => void newLocalTab()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {flow.phase === 'connecting' && (
        <div className="connecting-overlay" role="status" aria-live="polite">
          <div className="connecting-card">
            <div className="spinner" />
            <div className="label">{flow.targetKind === 'sftp' ? 'Opening SFTP…' : 'Connecting…'}</div>
            <div className="target">{flow.target.user}@{flow.target.host}{flow.target.port !== 22 ? `:${flow.target.port}` : ''}</div>
            <button
              type="button"
              className="connecting-cancel"
              onClick={() => { flowToken.current++; setFlow({ phase: 'idle' }); }}
            >Cancel</button>
          </div>
        </div>
      )}
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
      {snippetForm.kind !== 'closed' && (
        <SnippetFormModal
          mode={snippetForm.kind === 'edit' ? 'edit' : 'create'}
          snippet={snippetForm.kind === 'edit' ? snippetForm.snippet : undefined}
          onSave={(input) => void handleSnippetSave(input)}
          onCancel={() => setSnippetForm({ kind: 'closed' })}
        />
      )}
      {confirmDeleteSnippet && (
        <ConfirmModal
          title="Delete snippet?"
          message={`Remove "${confirmDeleteSnippet.name}" from saved snippets?`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void handleSnippetDelete(confirmDeleteSnippet)}
          onCancel={() => setConfirmDeleteSnippet(null)}
        />
      )}
      {forwardForm.kind !== 'closed' && (
        <ForwardFormModal
          mode={forwardForm.kind === 'edit' ? 'edit' : 'create'}
          forward={forwardForm.kind === 'edit' ? forwardForm.forward : undefined}
          onSave={(input) => void handleForwardSave(input)}
          onCancel={() => setForwardForm({ kind: 'closed' })}
        />
      )}
      {confirmDeleteForward && (
        <ConfirmModal
          title="Delete forward?"
          message={`Remove "${confirmDeleteForward.name}" from saved forwards?`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void handleForwardDelete(confirmDeleteForward)}
          onCancel={() => setConfirmDeleteForward(null)}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} initialTab={settingsInitialTab} />}
      {sshImportOpen && <SshConfigImportModal onClose={() => setSshImportOpen(false)} />}
      <AICommandBar open={aiBarOpen} onClose={() => setAiBarOpen(false)} />
    </div>
  );
}

function terminalsGridStyle(
  layoutKind: LayoutKind,
  splits: { col2: number; row2: number; col3: [number, number]; gridCol: number; gridRow: number },
): React.CSSProperties {
  // Convert 0..1 boundary fractions to grid template percentages.
  // We bypass the static `1fr 1fr` rules in styles.css by inlining
  // grid-template-columns/rows here whenever a split is active.
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  switch (layoutKind) {
    case '2col':
      return { gridTemplateColumns: `${pct(splits.col2)} ${pct(1 - splits.col2)}` };
    case '2row':
      return { gridTemplateRows: `${pct(splits.row2)} ${pct(1 - splits.row2)}` };
    case '3col':
      return { gridTemplateColumns: `${pct(splits.col3[0])} ${pct(splits.col3[1] - splits.col3[0])} ${pct(1 - splits.col3[1])}` };
    case '2x2':
      return {
        gridTemplateColumns: `${pct(splits.gridCol)} ${pct(1 - splits.gridCol)}`,
        gridTemplateRows: `${pct(splits.gridRow)} ${pct(1 - splits.gridRow)}`,
      };
    default:
      return {};
  }
}

function defaultLocalTitle(_shell: string | null): string {
  // Fixed label so all local PTY tabs read "Local"; the shell binary
  // (zsh, bash, fish, …) is implementation detail. SSH tabs already
  // show user@host or the saved host name as their title, so "Local"
  // distinguishes the local-PTY tabs at a glance.
  return 'Local';
}
