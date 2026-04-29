// src/components/IconRail.tsx
export type SidebarSection = 'hosts' | 'snippets' | 'forwards';

interface Props {
  activeSection: SidebarSection;
  onSection: (s: SidebarSection) => void;
  onSettings: () => void;
  onSync: () => void;
}

export function IconRail({ activeSection, onSection, onSettings, onSync }: Props) {
  return (
    <div className="icon-rail" aria-label="navigation rail">
      <button
        type="button"
        className={`rail-icon${activeSection === 'hosts' ? ' active' : ''}`}
        aria-label="Hosts"
        title="Hosts"
        onClick={() => onSection('hosts')}
      >
        <IconHosts />
      </button>
      <button
        type="button"
        className={`rail-icon${activeSection === 'snippets' ? ' active' : ''}`}
        aria-label="Snippets"
        title="Snippets"
        onClick={() => onSection('snippets')}
      >
        <IconSnippets />
      </button>
      <button
        type="button"
        className={`rail-icon${activeSection === 'forwards' ? ' active' : ''}`}
        aria-label="Port Forwards"
        title="Port Forwards"
        onClick={() => onSection('forwards')}
      >
        <IconForwards />
      </button>

      <div className="rail-spacer" />

      <button
        type="button"
        className="rail-icon rail-icon-bottom"
        aria-label="Sync"
        title="Sync"
        onClick={onSync}
      >
        <IconSync />
      </button>
      <button
        type="button"
        className="rail-icon rail-icon-bottom"
        aria-label="Settings"
        title="Settings (⌘,)"
        onClick={onSettings}
      >
        <IconSettings />
      </button>
    </div>
  );
}

function IconHosts() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="8.5" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="12.5" cy="4.25" r="0.85" fill="currentColor" />
      <circle cx="12.5" cy="10.75" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconSnippets() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 4h10M3 7.5h7M3 11h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconForwards() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 8h12M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7.5 1v1.4M7.5 12.6V14M1 7.5h1.4M12.6 7.5H14M3.05 3.05l1 1M10.95 10.95l1 1M10.95 3.05l-1 1M3.05 10.95l1-1"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
      />
    </svg>
  );
}

function IconSync() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M12.5 7.5A5 5 0 0 1 3 10M2.5 7.5A5 5 0 0 1 12 5"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M11 2.5l1 2.5 2.5-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12.5l-1-2.5-2.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
