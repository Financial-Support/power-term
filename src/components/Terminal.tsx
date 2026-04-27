import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { onPtyExit, onPtyOutput, ptyResize, ptyWrite } from '../lib/ipc';
import type { Tab } from '../types';
import { useSessionStore } from '../state/sessionStore';
import { useSettingsStore } from '../state/settingsStore';

interface Props { tab: Tab; visible: boolean }

export function Terminal({ tab, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const markExit = useSessionStore((s) => s.markExit);

  useEffect(() => {
    if (!containerRef.current || !settings) return;

    const term = new XTerm({
      fontFamily: settings.font_family,
      fontSize: settings.font_size,
      cursorBlink: settings.cursor_blink,
      scrollback: settings.scrollback_lines,
      allowProposedApi: true,
      theme: themeFor(settings.theme),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());
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
      // Let App-level useHotkeys handle Cmd+T/W/1-9/[/].
      if (e.key === 't' || e.key === 'w' || e.key === '{' || e.key === '}') return false;
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) return false;
      return true;
    });

    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    let unsubOutput: (() => void) | null = null;
    let unsubExit: (() => void) | null = null;

    (async () => {
      unsubOutput = await onPtyOutput(tab.ptyId, (bytes) => term.write(bytes));
      unsubExit = await onPtyExit(tab.ptyId, (p) => {
        markExit(tab.ptyId, p.code);
        term.write(`\r\n\x1b[33m[process exited (code ${p.code ?? 'null'})]\x1b[0m\r\n`);
      });
    })();

    const onData = term.onData((data) => { void ptyWrite(tab.ptyId, data); });
    const onResize = term.onResize(({ cols, rows }) => { void ptyResize(tab.ptyId, cols, rows); });

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current);

    return () => {
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
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: visible ? 'block' : 'none' }}
    />
  );
}

function themeFor(name: string): import('@xterm/xterm').ITheme {
  if (name === 'light' || (name === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches)) {
    return { background: '#ffffff', foreground: '#1a1a1a', cursor: '#1a1a1a' };
  }
  return { background: '#0f1115', foreground: '#e6e6e6', cursor: '#e6e6e6' };
}
