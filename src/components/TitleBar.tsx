import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Tauri 2's `data-tauri-drag-region` attribute did not start the window drag
// on this build — likely because the implicit drag-region script was not
// active. Use an explicit onMouseDown handler that calls startDragging() and
// short-circuits when the click landed on an interactive element. This works
// across Tauri 2 versions regardless of the implicit attribute pipeline.
interface Props {
  children: ReactNode;
  /** When true, the left spacer expands to align tabs with the right edge of
   *  the open sidebar. Otherwise the spacer is the minimum reserved area for
   *  the macOS traffic lights. */
  sidebarOpen?: boolean;
  onLayoutChange?: (kind: import('../types').LayoutKind) => void;
}

export function TitleBar({ children, sidebarOpen, onLayoutChange }: Props) {
  // onLayoutChange will be wired to layout selection UI in a future task
  void onLayoutChange;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only react to primary mouse button; skip if it was a synthetic re-fire.
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't drag when the user clicked anything interactive in the titlebar
    // (tab buttons, the rename input, the +/× buttons).
    if (target.closest('button, input, [role="tab"], [data-no-drag]')) return;
    // Double-click toggles maximize on macOS — let the native handler take it.
    if (e.detail >= 2) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div className={`titlebar ${sidebarOpen ? 'sidebar-open' : ''}`} onMouseDown={handleMouseDown}>
      <div className="titlebar-drag-left" />
      {children}
      <div className="titlebar-drag-right" />
    </div>
  );
}
