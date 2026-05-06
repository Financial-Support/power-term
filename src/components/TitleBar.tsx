import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore } from '../state/sessionStore';
import { SyncStatus } from './SyncStatus';
import type { LayoutKind } from '../types';

interface Props {
  children: ReactNode;
  onLayoutChange?: (kind: LayoutKind) => void;
  onOpenSyncSettings?: () => void;
}

function LayoutSvg({ kind }: { kind: LayoutKind }) {
  const s = 18;
  const r = 2;
  const stroke = 'currentColor';
  const sw = 1.4;
  switch (kind) {
    case 'solo':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <rect x="2" y="2" width="14" height="14" rx={r} stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    case '2col':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <rect x="2" y="2" width="14" height="14" rx={r} stroke={stroke} strokeWidth={sw} />
          <line x1="9" y1="2" x2="9" y2="16" stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    case '2row':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <rect x="2" y="2" width="14" height="14" rx={r} stroke={stroke} strokeWidth={sw} />
          <line x1="2" y1="9" x2="16" y2="9" stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    case '3col':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <rect x="2" y="2" width="14" height="14" rx={r} stroke={stroke} strokeWidth={sw} />
          <line x1="7" y1="2" x2="7" y2="16" stroke={stroke} strokeWidth={sw} />
          <line x1="11" y1="2" x2="11" y2="16" stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    case '2x2':
      return (
        <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
          <rect x="2" y="2" width="14" height="14" rx={r} stroke={stroke} strokeWidth={sw} />
          <line x1="9" y1="2" x2="9" y2="16" stroke={stroke} strokeWidth={sw} />
          <line x1="2" y1="9" x2="16" y2="9" stroke={stroke} strokeWidth={sw} />
        </svg>
      );
    default:
      return null;
  }
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
    if (target.closest('button, input, [role="tab"], [data-no-drag]')) return;
    if (e.detail >= 2) return;
    void getCurrentWindow().startDragging();
  };

  // Double-click anywhere on the drag region toggles zoom — matches the
  // native macOS title-bar behaviour we lose when titleBarStyle is set
  // to "Overlay" (the title bar is hidden so the OS never sees the
  // double-click). Click-targets that opt out of dragging also opt out
  // of zoom so toolbar buttons aren't accidentally maximizing the
  // window.
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [role="tab"], [data-no-drag]')) return;
    void getCurrentWindow().toggleMaximize();
  };

  const handlePick = (kind: LayoutKind) => {
    setPickerOpen(false);
    onLayoutChange?.(kind);
  };

  return (
    <div
      className={`titlebar${isFullscreen ? ' titlebar-fullscreen' : ''}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="titlebar-drag-left" />
      <div className="brand" aria-label="Power Term" data-no-drag>
        <BrandMark />
        <span className="brand-wordmark">Power<span className="brand-wordmark-gap"> </span>Term</span>
      </div>
      {children}
      <div className="titlebar-drag-right" />
      <SyncStatus onErrorClick={onOpenSyncSettings} />
      <button
        type="button"
        className={`broadcast-btn${broadcast ? ' active' : ''}`}
        data-no-drag
        aria-pressed={broadcast}
        title={broadcast ? 'Broadcast input ON — typing fans out to every visible pane' : 'Broadcast input to all visible panes'}
        onClick={() => setBroadcast(!broadcast)}
      >
        <BroadcastIcon />
      </button>
      <div className="layout-picker-wrap" data-no-drag ref={wrapRef}>
        <button
          type="button"
          className="layout-picker-btn"
          aria-label="layout picker"
          title="Change layout"
          onClick={() => setPickerOpen((o) => !o)}
        >
          <LayoutSvg kind={layoutKind} />
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
                <LayoutSvg kind={kind} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BroadcastIcon() {
  // Sized + viewBox-matched to LayoutSvg (18×18) so the two title-bar
  // buttons read as a balanced pair.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="1.6" fill="currentColor" />
      <path d="M6.4 6.4a3.7 3.7 0 0 0 0 5.2M11.6 6.4a3.7 3.7 0 0 1 0 5.2"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.2 4.2a6.7 6.7 0 0 0 0 9.6M13.8 4.2a6.7 6.7 0 0 1 0 9.6"
            stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
            strokeOpacity="0.55" />
    </svg>
  );
}

/** A stylised lightning bolt enclosed in a rounded square — doubles as the
 * app icon. Uses currentColor so it picks up the accent in the title bar. */
function BrandMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="1" y="1" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.9" />
      <path d="M11.2 4 L6.2 11.2 H10 L8.8 16 L13.8 8.8 H10 Z"
            fill="currentColor" />
    </svg>
  );
}
