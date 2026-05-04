import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  /** Icon glyph or emoji shown left of the label. Optional. */
  icon?: string;
  onClick: () => void;
  /** Renders the item in destructive (red) styling. */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuSeparator { separator: true }

export type MenuEntry = MenuItem | MenuSeparator;

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

/**
 * Floating context menu pinned to (x, y). Closes on outside click, Escape,
 * window blur, or after an item runs. Positioning clamps to the viewport so
 * a menu near the bottom-right edge doesn't overflow.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onBlur = () => onClose();
    // Defer attach by one frame so the right-click that opened this menu
    // doesn't immediately fire mousedown and close it.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('keydown', onKey);
      window.addEventListener('blur', onBlur);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  // Clamp position to viewport edges so menus near the bottom-right never
  // get clipped. The naïve clamp uses an estimated 220×N size; when the menu
  // mounts we re-clamp using the real bounding box.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - 4) nx = Math.max(4, vw - rect.width - 4);
    if (ny + rect.height > vh - 4) ny = Math.max(4, vh - rect.height - 4);
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [x, y, items.length]);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu">
      {items.map((it, i) => {
        if ('separator' in it) return <div key={`sep-${i}`} className="ctx-sep" />;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
          >
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            <span className="ctx-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
