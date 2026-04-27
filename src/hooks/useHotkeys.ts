import { useEffect } from 'react';
import { useSessionStore } from '../state/sessionStore';

interface Handlers {
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}

export function useHotkeys({ onNewTab, onCloseTab }: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const { tabs, activeTabId, setActive } = useSessionStore.getState();
      if (e.key === 't') { e.preventDefault(); onNewTab(); return; }
      if (e.key === 'w') {
        e.preventDefault();
        if (activeTabId) onCloseTab(activeTabId);
        return;
      }
      if (e.shiftKey && e.key === '{') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        if (prev) setActive(prev.id);
        return;
      }
      if (e.shiftKey && e.key === '}') {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        const next = tabs[(idx + 1) % tabs.length];
        if (next) setActive(next.id);
        return;
      }
      const digit = Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        e.preventDefault();
        const tab = tabs[digit - 1];
        if (tab) setActive(tab.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onNewTab, onCloseTab]);
}
