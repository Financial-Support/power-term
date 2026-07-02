import { useMemo } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Host } from '../types';
import { BrandIcon, ChevronRightIcon, SearchIcon, ServerIcon, SettingsIcon, TerminalIcon } from './AppIcons';

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
          <BrandIcon size={48} />
        </div>
        <h1 className="welcome-title">Power Term</h1>
        <p className="welcome-subtitle">Open a shell or connect to a host.</p>

        <div className="welcome-actions">
          <button type="button" className="welcome-action" onClick={onNewLocal}>
            <span className="welcome-action-icon" aria-hidden><TerminalIcon size={16} /></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">New local tab</span>
              <span className="welcome-action-desc">Local shell</span>
            </span>
            <span className="welcome-action-arrow" aria-hidden><ChevronRightIcon size={14} /></span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenPalette}>
            <span className="welcome-action-icon" aria-hidden><SearchIcon size={16} /></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">Hosts and snippets</span>
              <span className="welcome-action-desc">Search</span>
            </span>
            <span className="welcome-action-arrow" aria-hidden><ChevronRightIcon size={14} /></span>
          </button>
          <button type="button" className="welcome-action" onClick={onOpenSettings}>
            <span className="welcome-action-icon" aria-hidden><SettingsIcon size={16} /></span>
            <span className="welcome-action-label">
              <span className="welcome-action-title">Settings</span>
              <span className="welcome-action-desc">Preferences</span>
            </span>
            <span className="welcome-action-arrow" aria-hidden><ChevronRightIcon size={14} /></span>
          </button>
        </div>

        {recents.length > 0 && (
          <div className="welcome-recents">
            <div className="welcome-recents-heading">Recent</div>
            <div className="welcome-recents-list">
              {recents.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="welcome-recent"
                  onClick={() => onConnectHost(h)}
                >
                  <span className="welcome-recent-dot" aria-hidden><ServerIcon size={12} /></span>
                  <span className="welcome-recent-name">{h.name}</span>
                  <span className="welcome-recent-target">
                    {h.username}@{h.hostname}{h.port !== 22 ? `:${h.port}` : ''}
                  </span>
                  <span className="welcome-recent-arrow" aria-hidden><ChevronRightIcon size={12} /></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
