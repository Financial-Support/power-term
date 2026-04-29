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
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const handlePick = (kind: LayoutKind) => {
    setPickerOpen(false);
    onLayoutChange?.(kind);
  };

  return (
    <div className="titlebar" onMouseDown={handleMouseDown}>
      <div className="titlebar-drag-left" />
      {children}
      <div className="titlebar-drag-right" />
      <SyncStatus onErrorClick={onOpenSyncSettings} />
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
