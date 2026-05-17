import { useEffect } from 'react';
import { useSessionStore } from '../state/sessionStore';

interface Handlers {
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function useHotkeys({ onNewTab, onCloseTab, onZoomIn, onZoomOut, onZoomReset }: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const { tabs, activeTabId, activePaneIndex, setActive } = useSessionStore.getState();
      // Tab navigation is scoped to the focused pane — each pane keeps its
      // own independent strip of tabs.
      const paneTabs = tabs.filter((t) => t.paneIndex === activePaneIndex);
      if (e.key === '=' || e.key === '+') { e.preventDefault(); onZoomIn(); return; }
      if (e.key === '-') { e.preventDefault(); onZoomOut(); return; }
      if (e.key === '0') { e.preventDefault(); onZoomReset(); return; }
      if (e.key === 't') { e.preventDefault(); onNewTab(); return; }
      if (e.key === 'w') {
        e.preventDefault();
        if (activeTabId) onCloseTab(activeTabId);
        return;
      }
      if (e.shiftKey && e.key === '{') {
        e.preventDefault();
        if (paneTabs.length === 0) return;
        const idx = paneTabs.findIndex((t) => t.id === activeTabId);
        const prev = paneTabs[(idx - 1 + paneTabs.length) % paneTabs.length];
        if (prev) setActive(prev.id);
        return;
      }
      if (e.shiftKey && e.key === '}') {
        e.preventDefault();
        if (paneTabs.length === 0) return;
        const idx = paneTabs.findIndex((t) => t.id === activeTabId);
        const next = paneTabs[(idx + 1) % paneTabs.length];
        if (next) setActive(next.id);
        return;
      }
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        e.preventDefault();
        const tab = paneTabs[digit - 1];
        if (tab) setActive(tab.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNewTab, onCloseTab, onZoomIn, onZoomOut, onZoomReset]);
}
