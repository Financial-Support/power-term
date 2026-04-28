import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSessionStore } from '../state/sessionStore';
import type { LayoutKind } from '../types';

interface Props {
  children: ReactNode;
  sidebarOpen?: boolean;
  onLayoutChange?: (kind: LayoutKind) => void;
}

const LAYOUT_ICONS: { kind: LayoutKind; label: string }[] = [
  { kind: 'solo',  label: 'Solo' },
  { kind: '2col',  label: '2 Col' },
  { kind: '2row',  label: '2 Row' },
  { kind: '3col',  label: '3 Col' },
  { kind: '2x2',   label: '2×2' },
];

export function TitleBar({ children, sidebarOpen, onLayoutChange }: Props) {
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
    <div className={`titlebar ${sidebarOpen ? 'sidebar-open' : ''}`} onMouseDown={handleMouseDown}>
      <div className="titlebar-drag-left" />
      {children}
      <div className="titlebar-drag-right" />
      <div className="layout-picker-wrap" data-no-drag ref={wrapRef}>
        <button
          type="button"
          className="layout-picker-btn"
          aria-label="layout picker"
          onClick={() => setPickerOpen((o) => !o)}
        >
          ⊞
        </button>
        {pickerOpen && (
          <div className="layout-picker-popover" role="menu">
            {LAYOUT_ICONS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                role="menuitem"
                aria-label={`layout ${label}`}
                aria-pressed={layoutKind === kind}
                className={`layout-option${layoutKind === kind ? ' active' : ''}`}
                onClick={() => handlePick(kind)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
