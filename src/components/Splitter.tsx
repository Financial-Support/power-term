import { useCallback, useRef } from 'react';

interface Props {
  /** "vertical" splits two columns (drag horizontally); "horizontal" splits two rows. */
  orientation: 'vertical' | 'horizontal';
  /** Current boundary fraction in 0..1. */
  value: number;
  /** Called as the user drags; receives clamped 0..1. */
  onChange: (next: number) => void;
  /** The element whose bounding box defines the 0..1 range. Required so the
   *  drag math knows the parent's pixel size. Use a ref to the .terminals div. */
  parentRef: React.RefObject<HTMLElement>;
  /** Min fraction so panes never collapse to 0 — defaults to 0.1. */
  min?: number;
  max?: number;
}

/**
 * Draggable splitter handle. Positioned absolutely over the parent pane grid;
 * does not affect grid layout itself (the parent's grid-template is computed
 * from the same `value`). The handle is intentionally narrow but the
 * mousedown hit zone is wider for ergonomics.
 */
export function Splitter({ orientation, value, onChange, parentRef, min = 0.1, max = 0.9 }: Props) {
  const startRef = useRef<{ origin: number; size: number; startVal: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const parent = parentRef.current;
    if (!parent) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = parent.getBoundingClientRect();
    startRef.current = {
      origin: orientation === 'vertical' ? e.clientX : e.clientY,
      size: orientation === 'vertical' ? rect.width : rect.height,
      startVal: value,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [orientation, parentRef, value]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = startRef.current;
    if (!start) return;
    const cur = orientation === 'vertical' ? e.clientX : e.clientY;
    const delta = (cur - start.origin) / start.size;
    const next = Math.max(min, Math.min(max, start.startVal + delta));
    onChange(next);
  }, [orientation, onChange, min, max]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    startRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  // Keyboard accessibility: arrow keys nudge by 2%.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    const inc = (orientation === 'vertical' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp']);
    if (e.key === inc[0]) { e.preventDefault(); onChange(Math.min(max, value + step)); }
    else if (e.key === inc[1]) { e.preventDefault(); onChange(Math.max(min, value - step)); }
  }, [orientation, value, onChange, min, max]);

  const style: React.CSSProperties = orientation === 'vertical'
    ? { left: `${value * 100}%`, top: 0, bottom: 0, width: 0, transform: 'translateX(-50%)' }
    : { top: `${value * 100}%`, left: 0, right: 0, height: 0, transform: 'translateY(-50%)' };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value * 100)}
      className={`splitter splitter-${orientation}`}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
