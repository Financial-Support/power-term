import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { onPtyExit, onPtyOutput, ptyResize, ptyWrite, sshAttach, sshResize, sshWrite } from '../lib/ipc';
import type { Tab } from '../types';
import { useSessionStore } from '../state/sessionStore';
import { useSettingsStore } from '../state/settingsStore';
import { useTheme } from '../hooks/useTheme';
import { PRESET_THEMES } from '../themes';

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
      scrollback: settings.scrollback_lines,
      allowProposedApi: true,
      theme: resolveXtermTheme(settings.terminal_theme, resolvedTheme),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    searchAddon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setSearchInfo({ index: resultIndex, count: resultCount }),
    );
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    try { term.loadAddon(new WebglAddon()); } catch { /* fall back to canvas */ }

    // Cmd+C: if there is a selection, copy to clipboard and swallow.
    // If no selection, fall through (xterm sends ETX / SIGINT).
    // Cmd+V: read clipboard text and paste into the PTY.
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
      if (e.key === 'v') {
        void navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        });
        return false;
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
        markExit(tab.ptyId, p.code);
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

    const onData = term.onData((data) => {
      if (tab.kind === 'ssh') void sshWrite(tab.ptyId, data);
      else void ptyWrite(tab.ptyId, data);
    });
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
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      unsubOutput?.();
      unsubExit?.();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [tab.ptyId, settings, markExit]);

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
      }}
    >
      {searchOpen && (
        <div className="terminal-search" role="search">
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
            title="Previous match (Shift+Enter)"
            onClick={() => searchQuery && searchAddonRef.current?.findPrevious(searchQuery, SEARCH_OPTS)}
          >↑</button>
          <button
            type="button"
            className="terminal-search-btn"
            aria-label="Next match"
            title="Next match (Enter)"
            onClick={() => searchQuery && searchAddonRef.current?.findNext(searchQuery, SEARCH_OPTS)}
          >↓</button>
          <button
            type="button"
            className="terminal-search-btn"
            aria-label="Close search"
            title="Close (Esc)"
            onClick={closeSearch}
          >✕</button>
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
    return { background: '#ffffff', foreground: '#1a1a1a', cursor: '#1a1a1a' };
  }
  return { background: '#0f1115', foreground: '#e6e6e6', cursor: '#e6e6e6' };
}

// xterm.js takes the fontFamily string verbatim — if the requested font is not
// installed it falls back to whatever the WebView decides (often a wide serif
// monospace on macOS, which is unreadable). Append a fallback chain that always
// resolves to something installed on macOS.
function withMonospaceFallback(family: string): string {
  const fallbacks = '"SF Mono", "Menlo", "Monaco", ui-monospace, "Courier New", monospace';
  // If the user's setting already includes commas (its own fallback chain), trust it.
  if (family.includes(',')) return family;
  return `"${family}", ${fallbacks}`;
}
