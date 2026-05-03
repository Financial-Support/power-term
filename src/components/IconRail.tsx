// src/components/IconRail.tsx
import type { ReactNode } from 'react';

export type SidebarSection = 'hosts' | 'snippets' | 'forwards';

interface Props {
  activeSection: SidebarSection;
  onSection: (s: SidebarSection) => void;
  onSettings: () => void;
  onSync: () => void;
  expanded: boolean;
  onToggle: () => void;
}

export function IconRail({
  activeSection, onSection, onSettings, onSync, expanded, onToggle,
}: Props) {
  return (
    <div className={`icon-rail${expanded ? ' expanded' : ''}`} aria-label="navigation rail">
      <RailButton
        className="rail-icon-toggle"
        ariaLabel={expanded ? 'Collapse menu' : 'Expand menu'}
        title={expanded ? 'Collapse menu' : 'Expand menu'}
        onClick={onToggle}
        expanded={expanded}
        ariaExpanded={expanded}
        icon={<IconChevron open={expanded} />}
        label="Menu"
      />
      <RailButton
        ariaLabel="Hosts"
        title="Hosts"
        onClick={() => onSection('hosts')}
        active={activeSection === 'hosts'}
        expanded={expanded}
        icon={<IconHosts />}
        label="Hosts"
      />
      <RailButton
        ariaLabel="Snippets"
        title="Snippets"
        onClick={() => onSection('snippets')}
        active={activeSection === 'snippets'}
        expanded={expanded}
        icon={<IconSnippets />}
        label="Snippets"
      />
      <RailButton
        ariaLabel="Port Forwards"
        title="Port Forwards"
        onClick={() => onSection('forwards')}
        active={activeSection === 'forwards'}
        expanded={expanded}
        icon={<IconForwards />}
        label="Forwards"
      />

      <div className="rail-spacer" />

      <RailButton
        className="rail-icon-bottom"
        ariaLabel="Sync"
        title="Sync"
        onClick={onSync}
        expanded={expanded}
        icon={<IconSync />}
        label="Sync"
      />
      <RailButton
        className="rail-icon-bottom"
        ariaLabel="Settings"
        title="Settings (⌘,)"
        onClick={onSettings}
        expanded={expanded}
        icon={<IconSettings />}
        label="Settings"
      />
    </div>
  );
}

interface RailButtonProps {
  icon: ReactNode;
  label: string;
  expanded: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
  active?: boolean;
  className?: string;
  ariaExpanded?: boolean;
}

function RailButton({
  icon, label, expanded, onClick, ariaLabel, title, active, className, ariaExpanded,
}: RailButtonProps) {
  return (
    <button
      type="button"
      className={`rail-icon${active ? ' active' : ''}${className ? ' ' + className : ''}`}
      aria-label={ariaLabel}
      title={expanded ? undefined : title}
      aria-expanded={ariaExpanded}
      onClick={onClick}
    >
      <span className="rail-icon-glyph">{icon}</span>
      {expanded && <span className="rail-icon-label">{label}</span>}
    </button>
  );
}

/** Chevron-left when expanded (clicking it collapses); chevron-right when
 * collapsed (clicking expands). One asset, rotated via CSS. */
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.15s' }}
    >
      <path d="M9 3.5L5 7l4 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHosts() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <rect x="2" y="8.5" width="12" height="4.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="12.5" cy="4.25" r="0.85" fill="currentColor" />
      <circle cx="12.5" cy="10.75" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconSnippets() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 4h10M3 7.5h7M3 11h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconForwards() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 8h12M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
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
