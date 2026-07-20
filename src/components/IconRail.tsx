// src/components/IconRail.tsx
import type { ReactNode } from 'react';
import { ChevronLeftIcon, DatabaseIcon, ForwardIcon, KeyIcon, RefreshIcon, ServerIcon, SettingsIcon, SidebarPanelIcon, SnippetIcon } from './AppIcons';

export type SidebarSection = 'hosts' | 'snippets' | 'forwards' | 'databases' | 'keys';

interface Props {
  activeSection: SidebarSection;
  onSection: (s: SidebarSection) => void;
  onSettings: () => void;
  onSync: () => void;
  expanded: boolean;
  onToggle: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function IconRail({
  activeSection, onSection, onSettings, onSync, expanded, onToggle, sidebarOpen, onToggleSidebar,
}: Props) {
  return (
    <div className={`icon-rail${expanded ? ' expanded' : ''}`} aria-label="navigation rail">
      <RailButton
        className="rail-icon-toggle"
        ariaLabel={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        title={sidebarOpen ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
        onClick={onToggleSidebar}
        expanded={expanded}
        icon={<SidebarPanelIcon size={16} />}
        label="Panel"
      />
      <RailButton
        className="rail-icon-toggle"
        ariaLabel={expanded ? 'Collapse menu' : 'Expand menu'}
        title={expanded ? 'Collapse menu' : 'Expand menu'}
        onClick={onToggle}
        expanded={expanded}
        ariaExpanded={expanded}
        icon={<span className={`rail-chevron-icon${expanded ? '' : ' collapsed'}`}><ChevronLeftIcon size={14} /></span>}
        label="Menu"
      />
      <RailButton
        ariaLabel="Hosts"
        title="Hosts"
        onClick={() => onSection('hosts')}
        active={activeSection === 'hosts'}
        expanded={expanded}
        icon={<ServerIcon size={18} />}
        label="Hosts"
      />
      <RailButton
        ariaLabel="Snippets"
        title="Snippets"
        onClick={() => onSection('snippets')}
        active={activeSection === 'snippets'}
        expanded={expanded}
        icon={<SnippetIcon size={18} />}
        label="Snippets"
      />
      <RailButton
        ariaLabel="Port Forwards"
        title="Port Forwards"
        onClick={() => onSection('forwards')}
        active={activeSection === 'forwards'}
        expanded={expanded}
        icon={<ForwardIcon size={18} />}
        label="Forwards"
      />
      <RailButton
        ariaLabel="Databases"
        title="Databases"
        onClick={() => onSection('databases')}
        active={activeSection === 'databases'}
        expanded={expanded}
        icon={<DatabaseIcon size={18} />}
        label="Databases"
      />
      <RailButton
        ariaLabel="SSH keys"
        title="SSH keys"
        onClick={() => onSection('keys')}
        active={activeSection === 'keys'}
        expanded={expanded}
        icon={<KeyIcon size={18} />}
        label="Keys"
      />

      <div className="rail-spacer" />

      <RailButton
        className="rail-icon-bottom"
        ariaLabel="Sync"
        title="Sync"
        onClick={onSync}
        expanded={expanded}
        icon={<RefreshIcon size={15} />}
        label="Sync"
      />
      <RailButton
        className="rail-icon-bottom"
        ariaLabel="Settings"
        title="Settings"
        onClick={onSettings}
        expanded={expanded}
        icon={<SettingsIcon size={18} />}
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
