import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore } from '../state/sessionStore';
import { SyncStatus } from './SyncStatus';
import { SftpTransferStatus } from './SftpTransferStatus';
import { BrandIcon, BroadcastIcon, LayoutIcon } from './AppIcons';
import type { LayoutKind } from '../types';

interface Props {
  children: ReactNode;
  onLayoutChange?: (kind: LayoutKind) => void;
  onOpenSyncSettings?: () => void;
}

const LAYOUT_ICONS: { kind: LayoutKind; label: string }[] = [
  { kind: 'solo',  label: 'Solo' },
  { kind: '2col',  label: '2 columns' },
  { kind: '2row',  label: '2 rows' },
  { kind: '3col',  label: '3 columns' },
  { kind: '2x2',   label: '2×2 grid' },
];

export function TitleBar({ children, onLayoutChange, onOpenSyncSettings }: Props) {
  const layoutKind = useSessionStore((s) => s.layoutKind);
  const broadcast = useSessionStore((s) => s.broadcast);
  const setBroadcast = useSessionStore((s) => s.setBroadcast);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ x: 0, y: 0, dragging: false });

  // Track macOS native fullscreen so we can collapse the 78px spacer that
  // otherwise leaves a hole where the (now-hidden) traffic lights used to be.
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const refresh = async () => {
      try {
        const fs = await win.isFullscreen();
        if (!cancelled) setIsFullscreen(fs);
      } catch { /* ignore */ }
    };

    void refresh();
    void win.onResized(() => { void refresh(); }).then((fn) => {
      if (cancelled) fn(); else unlisten = fn;
    });

    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [pickerOpen]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;

    // Double-click toggles zoom (macOS standard).
    if (e.detail === 2) {
      if (!target.closest('button, input, [role="tab"]')) {
        void getCurrentWindow().toggleMaximize();
      }
      return;
    }

    // Don't initiate drag from interactive elements. Mark this gesture as
    // already-dragging so mousemove short-circuits and lets the underlying
    // element (e.g. an HTML5 draggable tab) own the gesture.
    if (target.closest('button, input, [role="tab"], [data-no-drag]')) {
      dragRef.current = { x: 0, y: 0, dragging: true };
      return;
    }

    // Record mousedown position; drag starts only after mouse movement.
    dragRef.current = { x: e.clientX, y: e.clientY, dragging: false };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const d = dragRef.current;
    if (d.dragging) return;
    // Start dragging after 3px movement (avoids accidental drags).
    if (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3) {
      d.dragging = true;
      void getCurrentWindow().startDragging();
    }
  };

  const handlePick = (kind: LayoutKind) => {
    setPickerOpen(false);
    onLayoutChange?.(kind);
  };

  return (
    <div
      className={`titlebar${isFullscreen ? ' titlebar-fullscreen' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      <div className="titlebar-drag-left" />
      <div className="brand" aria-label="Power Term" data-no-drag>
        <BrandIcon size={18} />
        <span className="brand-wordmark">Power<span className="brand-wordmark-gap"> </span>Term</span>
      </div>
      {children}
      <div className="titlebar-drag-right" />
      <SftpTransferStatus />
      <SyncStatus onErrorClick={onOpenSyncSettings} onClick={onOpenSyncSettings} />
      <button
        type="button"
        className={`broadcast-btn${broadcast ? ' active' : ''}`}
        data-no-drag
        aria-pressed={broadcast}
        title={broadcast ? 'Broadcast input ON — typing fans out to every visible pane' : 'Broadcast input to all visible panes'}
        onClick={() => setBroadcast(!broadcast)}
      >
        <BroadcastIcon size={18} />
      </button>
      <div className="layout-picker-wrap" data-no-drag ref={wrapRef}>
        <button
          type="button"
          className="layout-picker-btn"
          aria-label="layout picker"
          title="Change layout"
          onClick={() => setPickerOpen((o) => !o)}
        >
          <LayoutIcon kind={layoutKind} />
        </button>
        {pickerOpen && (
          <div className="layout-picker-popover" role="menu">
            {LAYOUT_ICONS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                aria-label={label}
                aria-pressed={layoutKind === kind}
                className={`layout-option${layoutKind === kind ? ' active' : ''}`}
                onClick={() => handlePick(kind)}
                title={label}
              >
                <LayoutIcon kind={kind} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
