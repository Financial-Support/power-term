import { useMemo } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';

interface Props {
  onNewLocal: () => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onConnectHost: (h: Host) => void;
}

export function WelcomePane({
  onNewLocal, onOpenPalette, onOpenSettings, onConnectHost,
}: Props) {
  const hosts = useHostStore((s) => s.hosts);

  const recents = useMemo(() => {
    return [...hosts]
      .sort((a, b) => (b.last_used_at ?? 0) - (a.last_used_at ?? 0))
      .slice(0, 5);
  }, [hosts]);

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark" aria-hidden>
          <svg width="48" height="48" viewBox="0 0 20 20" fill="none">
            <rect x="1" y="1" width="18" height="18" rx="5"
              stroke="currentColor" strokeWidth="1.4" strokeOpacity="0.85" />
            <path d="M11.2 4 L6.2 11.2 H10 L8.8 16 L13.8 8.8 H10 Z" fill="currentColor" />
          </svg>
        </div>
        <h1 className="welcome-title">Power Term</h1>
        <p className="welcome-subtitle">Pick something below or start typing.</p>

        <div className="welcome-actions">
          <button type="button" className="welcome-action" onClick={onNewLocal}>
            <span className="welcome-action-kbd"><kbd>⌘</kbd><kbd>T</kbd></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">New local tab</span>
              <span className="welcome-action-desc">Open a fresh shell</span>
            </span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenPalette}>
            <span className="welcome-action-kbd"><kbd>⌘</kbd><kbd>K</kbd></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">Find host or snippet</span>
              <span className="welcome-action-desc">Open the command palette</span>
            </span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenSettings}>
            <span className="welcome-action-kbd"><kbd>⌘</kbd><kbd>,</kbd></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">Settings</span>
              <span className="welcome-action-desc">Theme, accent, sync &amp; more</span>
            </span>
          </button>
        </div>

        {recents.length > 0 && (
          <div className="welcome-recents">
            <div className="welcome-recents-heading">Recent hosts</div>
            <div className="welcome-recents-list">
              {recents.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="welcome-recent"
                  onClick={() => onConnectHost(h)}
                >
                  <span className="welcome-recent-dot" aria-hidden />
                  <span className="welcome-recent-name">{h.name}</span>
                  <span className="welcome-recent-target">
                    {h.username}@{h.hostname}{h.port !== 22 ? `:${h.port}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
