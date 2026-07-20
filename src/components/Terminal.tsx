import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { onPtyExit, onPtyOutput, openExternalUrl, ptyResize, ptyWrite, sshAttach, sshResize, sshWrite } from '../lib/ipc';
import { reconcileImeInsertText } from '../lib/imeInput';
import type { Tab } from '../types';
import { useSessionStore } from '../state/sessionStore';
import { useSettingsStore } from '../state/settingsStore';
import { useTheme } from '../hooks/useTheme';
import { PRESET_THEMES } from '../themes';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from './AppIcons';

interface Props { tab: Tab; visible: boolean; active?: boolean; onAutoClose?: (id: string) => void }

export function Terminal({ tab, visible, active, onAutoClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const markExit = useSessionStore((s) => s.markExit);
  const resolvedTheme = useTheme();
  const onAutoCloseRef = useRef(onAutoClose);
  useEffect(() => { onAutoCloseRef.current = onAutoClose; }, [onAutoClose]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInfo, setSearchInfo] = useState<{ index: number; count: number }>({ index: -1, count: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!containerRef.current || !settings) return;

    const term = new XTerm({
      fontFamily: withMonospaceFallback(settings.font_family),
      fontSize: settings.font_size,
      cursorBlink: settings.cursor_blink,
      cursorStyle: settings.cursor_style,
      scrollback: settings.scrollback_lines,
      allowProposedApi: true,
      theme: resolveXtermTheme(settings.terminal_theme, resolvedTheme),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // xterm's default handler calls window.open(), which is not connected to
    // the system browser from a Tauri WebView. Delegate to the native side so
    // Ctrl/Cmd+Click links open in the user's default browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      void openExternalUrl(uri).catch((error) => console.error('failed to open terminal link', error));
    }));
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setSearchInfo({ index: resultIndex, count: resultCount }),
    );
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    // Keep xterm's DOM renderer on macOS. WKWebView's WebGL text atlas can
    // fail to paint IME-composed grapheme clusters (such as Vietnamese Telex),
    // making otherwise-correct input look like it disappeared.

    // Cmd+C: if there is a selection, copy to clipboard and swallow.
    // If no selection, fall through (xterm sends ETX / SIGINT).
    // Cmd+V is intentionally NOT handled here — xterm registers its own
    // `paste` listener on the textarea (Terminal.ts: addDisposableDomListener
    // (this.textarea, 'paste', …)). Catching the keydown and calling
    // term.paste() in addition pasted the clipboard twice on every Cmd+V.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.metaKey) return true;
      if (e.key === 'c') {
        const sel = term.getSelection();
        if (sel.length > 0) {
          void navigator.clipboard.writeText(sel);
          return false;
        }
        return true;
      }
      if (e.key === 'f') {
        // Open in-terminal search overlay. Focus is moved to the input by
        // the autoFocus prop on render, so the keystroke is consumed here.
        setSearchOpen(true);
        return false;
      }
      // Let App-level useHotkeys handle Cmd+T/W/1-9/[/].
      // Let App-level Cmd+K open the command palette.
      if (e.key === 't' || e.key === 'w' || e.key === '{' || e.key === '}' || e.key.toLowerCase() === 'k') return false;
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) return false;
      return true;
    });

    term.open(containerRef.current);

    xtermRef.current = term;
    fitRef.current = fit;

    // The WebView frequently reports the container as 0×0 on the first
    // useEffect after a freshly-added tab — calling fit() at 0×0 locks
    // xterm at 0 cols × 0 rows AND fires onResize(0, 0) which corrupts
    // the remote shell. Defer all fit() calls behind a "container has
    // real dimensions" check, retried every animation frame until it
    // actually has size.
    let initialFitFrame = 0;
    const tryInitialFit = () => {
      const container = containerRef.current;
      if (!container) return;
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        fitRef.current?.fit();
        xtermRef.current?.refresh(0, (xtermRef.current.rows ?? 1) - 1);
        if (visible) xtermRef.current?.focus();
        return; // ResizeObserver below will pick up any later resizes.
      }
      initialFitFrame = requestAnimationFrame(tryInitialFit);
    };
    initialFitFrame = requestAnimationFrame(tryInitialFit);

    let unsubOutput: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;

    (async () => {
      unsubOutput = await onPtyOutput(tab.ptyId, (bytes) => term.write(bytes));
      unsubExit = await onPtyExit(tab.ptyId, (p) => {
        markExit(tab.ptyId, p.code, p.signal);
        // Shell exited cleanly (e.g. `exit`, Ctrl-D, even with a non-zero
        // status inherited from the last command): auto-close the tab. Only
        // keep it open when the channel died on a signal — network_error,
        // kill, etc. — so the user can read what went wrong.
        if (!p.signal && onAutoCloseRef.current) {
          onAutoCloseRef.current(tab.id);
          return;
        }
        const codeStr = p.code !== null ? p.code.toString() : 'null';
        term.write(`\r\n\x1b[33m[process exited (code ${codeStr} signal=${p.signal})]\x1b[0m\r\n`);
      });
      // SSH sessions buffer output server-side until we explicitly attach,
      // so the MOTD / login banner / first prompt aren't lost to the race
      // between `ssh_connect` returning and this listener binding.
      if (tab.kind === 'ssh') {
        try { await sshAttach(tab.ptyId); } catch (e) { console.error('ssh_attach failed', e); }
      }
    })();

    // IMEs such as Vietnamese Telex often emit a short sequence of edits
    // (for example, backspace followed by the composed character). Tauri
    // invokes are asynchronous, so firing them without awaiting can reorder
    // those edits at the PTY and make characters appear to jump or vanish.
    // Serialize every input event for this terminal to preserve xterm's order.
    let inputWriteQueue = Promise.resolve();
    const writeInput = async (data: string) => {
      // Broadcast: when toggled on, route input from the focused pane to
      // every other visible pane (skip SFTP). Always include self so the
      // origin pane echoes its own keystrokes the same as before.
      const { broadcast, tabs: allTabs, layoutSlots } = useSessionStore.getState();
      if (broadcast) {
        const seen = new Set<string>();
        for (const id of layoutSlots) {
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const t = allTabs.find((x) => x.id === id);
          if (!t || t.kind === 'sftp') continue;
          if (t.kind === 'ssh') await sshWrite(t.ptyId, data);
          else await ptyWrite(t.ptyId, data);
        }
        return;
      }
      if (tab.kind === 'ssh') await sshWrite(tab.ptyId, data);
      else await ptyWrite(tab.ptyId, data);
    };
    const enqueueInput = (data: string) => {
      inputWriteQueue = inputWriteQueue
        .then(() => writeInput(data))
        // Keep later key events flowing even if an individual IPC call fails.
        .catch((error) => console.error('failed to write terminal input', error));
    };

    // xterm normally commits IME text by reading its hidden textarea in a
    // zero-delay timer after `compositionend`. WKWebView can clear/change that
    // textarea first, causing xterm to emit nothing (or only the following
    // space). Keep the authoritative CompositionEvent.data as a fallback.
    // Our listener is registered after xterm's, so its timer runs first.
    let latestCompositionData = '';
    let keydownEmittedData: string[] = [];
    let pendingComposition: { data: string; xtermData: string[] } | null = null;
    const compositionTimers = new Set<number>();
    const scheduleCompositionCommit = (data: string) => {
      if (!data) return;
      if (pendingComposition) {
        pendingComposition.data = data;
        return;
      }
      const pending = { data, xtermData: [] as string[] };
      pendingComposition = pending;
      const timer = window.setTimeout(() => {
        compositionTimers.delete(timer);
        if (pendingComposition === pending) pendingComposition = null;

        const emitted = pending.xtermData.join('');
        const xtermCommittedComposition = emitted
          .normalize('NFC')
          .includes(pending.data.normalize('NFC'));
        if (xtermCommittedComposition) {
          enqueueInput(emitted);
          return;
        }

        // xterm missed the composition. Commit it before any trailing data
        // (commonly the space that ended Vietnamese Telex composition).
        enqueueInput(pending.data);
        if (emitted) enqueueInput(emitted);
      }, 0);
      compositionTimers.add(timer);
    };
    const onCompositionStart = () => { latestCompositionData = ''; };
    const onCompositionUpdate = (event: CompositionEvent) => {
      if (event.data) latestCompositionData = event.data;
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      scheduleCompositionCommit(event.data || latestCompositionData);
      latestCompositionData = '';
    };
    const onImeInput = (rawEvent: Event) => {
      const event = rawEvent as InputEvent;
      if (event.data && event.isComposing) latestCompositionData = event.data;

      if (event.inputType === 'insertText' && event.data) {
        const emitted = keydownEmittedData.join('');
        keydownEmittedData = [];
        const correction = reconcileImeInsertText(emitted, event.data);
        if (correction) enqueueInput(correction);
      }

      // WebKit uses these input types when committing IME/replacement text.
      // xterm 6's input handler only accepts `insertText`, so without this
      // bridge the committed Vietnamese syllable never reaches onData.
      const isWebKitCommit = event.inputType === 'insertFromComposition'
        || event.inputType === 'insertReplacementText'
        || (event.inputType === 'insertCompositionText' && !event.isComposing);
      if (isWebKitCommit && event.data) scheduleCompositionCommit(event.data);
    };

    const onData = term.onData((data) => {
      if (pendingComposition) {
        pendingComposition.xtermData.push(data);
        return;
      }
      keydownEmittedData.push(data);
      enqueueInput(data);
    });
    const onTerminalKeyDown = () => { keydownEmittedData = []; };
    containerRef.current.addEventListener('keydown', onTerminalKeyDown, true);
    term.textarea?.addEventListener('compositionstart', onCompositionStart);
    term.textarea?.addEventListener('compositionupdate', onCompositionUpdate);
    term.textarea?.addEventListener('compositionend', onCompositionEnd);
    term.textarea?.addEventListener('input', onImeInput);
    const onResize = term.onResize(({ cols, rows }) => {
      // Drop bogus 0×0 resizes that can leak through during initial
      // mount before the container has dimensions.
      if (cols < 1 || rows < 1) return;
      if (tab.kind === 'ssh') void sshResize(tab.ptyId, cols, rows);
      else void ptyResize(tab.ptyId, cols, rows);
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // Only fit when the container actually has dimensions — prevents the
      // 0×0 feedback loop when a tab is being hidden via display:none.
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) fitRef.current?.fit();
    });
    ro.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(initialFitFrame);
      containerRef.current?.removeEventListener('keydown', onTerminalKeyDown, true);
      term.textarea?.removeEventListener('compositionstart', onCompositionStart);
      term.textarea?.removeEventListener('compositionupdate', onCompositionUpdate);
      term.textarea?.removeEventListener('compositionend', onCompositionEnd);
      term.textarea?.removeEventListener('input', onImeInput);
      for (const timer of compositionTimers) window.clearTimeout(timer);
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      unsubOutput?.();
      unsubExit?.();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // `settings` is intentionally not in the dep array. We seed the xterm
    // instance with the current snapshot at construction time and let the
    // dedicated effects below (theme / cursor / font / scrollback) push
    // subsequent changes onto the live instance. Otherwise every Save in
    // the Settings dialog would tear down the terminal and wipe the user's
    // scrollback. `!!settings` is included so the effect runs once when
    // settings load for the first time after a fresh start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.ptyId, markExit, !!settings]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      const container = containerRef.current;
      // Only fit when the container actually has dimensions; otherwise
      // fit() locks xterm at 0×0 and dispatches a bogus resize event.
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        fitRef.current?.fit();
      }
      // Auto-focus the xterm so the user can type immediately on tab switch.
      // Without this, switching tabs leaves focus on the previously-focused
      // element (typically the TabBar button) and the user has to click
      // inside the terminal area before typing reaches the shell.
      xtermRef.current?.focus();
    });
  }, [visible]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        fitRef.current?.fit();
      }
      xtermRef.current?.focus();
    });
  }, [active]);

  // React to runtime theme changes (auto-mode following macOS appearance, or
  // settings.theme being toggled) without tearing down the whole xterm instance.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = resolveXtermTheme(settings?.terminal_theme ?? 'default', resolvedTheme);
  }, [resolvedTheme, settings?.terminal_theme]);

  // Cursor shape / blink can be tweaked live so the Settings panel reflects
  // changes without forcing the user to reopen tabs.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (settings?.cursor_style) term.options.cursorStyle = settings.cursor_style;
    if (typeof settings?.cursor_blink === 'boolean') term.options.cursorBlink = settings.cursor_blink;
  }, [settings?.cursor_style, settings?.cursor_blink]);

  // Font / scrollback updates are also live. fit() reflows after a font
  // change so the cell grid lines back up with the container.
  useEffect(() => {
    const term = xtermRef.current;
    if (!term || !settings) return;
    term.options.fontFamily = withMonospaceFallback(settings.font_family);
    term.options.fontSize = settings.font_size;
    fitRef.current?.fit();
  }, [settings?.font_family, settings?.font_size]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term || !settings) return;
    term.options.scrollback = settings.scrollback_lines;
  }, [settings?.scrollback_lines]);

  // Compute what xterm itself will paint so we can colour the wrapper to
  // match. xterm only fills `rows × cellHeight` pixels — fractional pixels
  // at the bottom otherwise show through to whatever sits behind, which
  // depending on theme is a different shade of dark and looks like a black
  // strip under each pane.
  const xtermBg = resolveXtermTheme(settings?.terminal_theme ?? 'default', resolvedTheme).background ?? undefined;

  const SEARCH_OPTS: ISearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchInfo({ index: -1, count: 0 });
    searchAddonRef.current?.clearDecorations();
    requestAnimationFrame(() => xtermRef.current?.focus());
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: visible ? 'block' : 'none',
        background: xtermBg,
      }}
    >
      {searchOpen && (
        <div className="terminal-search" role="search">
          <span className="terminal-search-icon" aria-hidden>
            <SearchIcon size={12} />
          </span>
          <input
            ref={searchInputRef}
            autoFocus
            placeholder="Find"
            value={searchQuery}
            onChange={(e) => {
              const q = e.target.value;
              setSearchQuery(q);
              if (q) searchAddonRef.current?.findNext(q, SEARCH_OPTS);
              else { searchAddonRef.current?.clearDecorations(); setSearchInfo({ index: -1, count: 0 }); }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!searchQuery) return;
                if (e.shiftKey) searchAddonRef.current?.findPrevious(searchQuery, SEARCH_OPTS);
                else searchAddonRef.current?.findNext(searchQuery, SEARCH_OPTS);
              }
            }}
          />
          <span className="terminal-search-count">
            {searchInfo.count > 0 ? `${searchInfo.index + 1}/${searchInfo.count}` : (searchQuery ? '0/0' : '')}
          </span>
          <button
            type="button"
            className="terminal-search-btn"
            aria-label="Previous match"
            title="Previous match"
            onClick={() => searchQuery && searchAddonRef.current?.findPrevious(searchQuery, SEARCH_OPTS)}
          ><ChevronUpIcon size={12} /></button>
          <button
            type="button"
            className="terminal-search-btn"
            aria-label="Next match"
            title="Next match"
            onClick={() => searchQuery && searchAddonRef.current?.findNext(searchQuery, SEARCH_OPTS)}
          ><ChevronDownIcon size={12} /></button>
          <button
            type="button"
            className="terminal-search-btn"
            aria-label="Close search"
            title="Close"
            onClick={closeSearch}
          ><CloseIcon size={12} /></button>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

function resolveXtermTheme(
  terminalTheme: string,
  resolvedLightDark: 'light' | 'dark',
): import('@xterm/xterm').ITheme {
  const preset = PRESET_THEMES[terminalTheme];
  if (preset && Object.keys(preset).length > 0) return preset;
  return themeForResolved(resolvedLightDark);
}

function themeForResolved(theme: 'light' | 'dark'): import('@xterm/xterm').ITheme {
  if (theme === 'light') {
    return { background: '#f8fafc', foreground: '#0f172a', cursor: '#0f172a' };
  }
  return { background: '#0f1118', foreground: '#f8fafc', cursor: '#f8fafc' };
}

// xterm.js takes the fontFamily string verbatim — if the requested font is not
// installed it falls back to whatever the WebView decides (often a wide serif
// monospace on macOS, which is unreadable). Append a fallback chain that always
// resolves to something installed on macOS.
function withMonospaceFallback(family: string): string {
  const fallbacks = '"JetBrains Mono", "SF Mono", "Menlo", "Monaco", ui-monospace, "Courier New", monospace';
  // If the user's setting already includes commas (its own fallback chain), trust it.
  if (family.includes(',')) return family;
  return `"${family}", ${fallbacks}`;
}
