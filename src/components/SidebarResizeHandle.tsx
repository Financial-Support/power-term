import { useCallback, useRef } from 'react';

interface Props {
  /** Fired with the X-axis delta in pixels each pointer-move tick. The
   *  parent applies the delta to its persisted width and clamps it. */
  onResize: (deltaPx: number) => void;
  /** Optional hook for the end of a drag — useful for committing a debounced
   *  persistence step or analytics. */
  onCommit?: () => void;
}

/**
 * Thin vertical drag handle that lives between the sidebar panel and the
 * terminals area. Width is fixed at 4px in CSS but the pointer-down hit-area
 * spans the full visual width; the parent owns the actual width state so
 * nothing in this component knows the clamp range.
 */
export function SidebarResizeHandle({ onResize, onCommit }: Props) {
  const lastX = useRef<number | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (lastX.current === null) return;
    const dx = e.clientX - lastX.current;
    if (dx !== 0) {
      onResize(dx);
      lastX.current = e.clientX;
    }
  }, [onResize]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (lastX.current !== null) onCommit?.();
    lastX.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }, [onCommit]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={-1}
      className="sidebar-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
