import type { ReactNode } from 'react';

export function TitleBar({ children }: { children: ReactNode }) {
  return (
    <div className="titlebar">
      <div className="titlebar-drag-left" data-tauri-drag-region />
      {children}
      <div className="titlebar-drag-right" data-tauri-drag-region />
    </div>
  );
}
