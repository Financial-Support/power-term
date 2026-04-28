import type { ReactNode } from 'react';

// In Tauri 2 the whole titlebar is a drag region. Interactive children
// (buttons, role="tab" with onClick) capture their own pointerdown events
// and short-circuit the drag, so tabs/buttons remain clickable while empty
// space — including the gap between tabs and the "+" button — drags the
// window. The 78px left spacer reserves room for the macOS traffic lights.
export function TitleBar({ children }: { children: ReactNode }) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-drag-left" />
      {children}
      <div className="titlebar-drag-right" />
    </div>
  );
}
