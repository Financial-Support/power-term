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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
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
