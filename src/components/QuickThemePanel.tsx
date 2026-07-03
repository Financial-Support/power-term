import type { Settings } from '../types';
import { ChevronDownIcon, ChevronRightIcon } from './AppIcons';

type Appearance = 'auto' | 'light' | 'dark';

const APPEARANCE_LABEL: Record<Appearance, string> = {
  auto: 'System',
  light: 'Light',
  dark: 'Dark',
};

interface Props {
  settings: Settings;
  onAppearance: (a: Appearance) => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
}

function currentAppearance(settings: Settings): Appearance {
  const t = settings.theme;
  if (t === 'light') return 'light';
  if (t === 'dark') return 'dark';
  return 'auto';
}

export function QuickThemePanel(props: Props) {
  const settings = props.settings;
  const appearance = currentAppearance(settings);

  const setAppearance = (a: Appearance) => {
    props.onAppearance(a);
  };

  return (
    <section
      className={`quick-theme-panel${appearance ? ' is-active' : ''}`}
      aria-label="Quick theme switcher"
      aria-expanded={true}
    >
      <header className="quick-theme-panel-head">
        <span className="quick-theme-panel-title">Theme</span>
        <button
          type="button"
          className="quick-theme-collapse-btn"
          aria-label="Collapse quick theme panel"
          title="Collapse"
          onClick={() => props.onCollapse()}
        >
          <ChevronDownIcon size={14} />
        </button>
      </header>

      <div className="quick-theme-appearance" role="radiogroup" aria-label="appearance">
        {(['auto', 'light', 'dark'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={appearance === a}
            className={`quick-theme-appearance-option${appearance === a ? ' active' : ''}`}
            onClick={() => void setAppearance(a)}
          >
            {APPEARANCE_LABEL[a]}
          </button>
        ))}
      </div>

      <div className="quick-theme-panel-row">
        <span className="quick-theme-current-label">Current</span>
        <span className="quick-theme-current-label">{APPEARANCE_LABEL[appearance]}</span>
      </div>

      <button
        type="button"
        className="quick-theme-more-btn"
        onClick={() => props.onOpenSettings()}
        title="Open full theme settings"
      >
        More settings
        <ChevronRightIcon size={12} />
      </button>
    </section>
  );
}

interface FloatingProps {
  /** When collapsed, this renders the small button that re-opens the panel. */
  collapsed: boolean;
  onExpand: () => void;
  settings: Settings;
  onAppearance: (a: Appearance) => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
}

export function QuickThemeFloater(props: FloatingProps) {
  if (props.collapsed) {
    const apt = currentAppearance(props.settings);
    return (
      <button
        type="button"
        className="quick-theme-reveal"
        onClick={() => props.onExpand()}
        aria-label="Show quick theme panel"
        title="Quick theme"
      >
        <span className="quick-theme-reveal-label">{APPEARANCE_LABEL[apt]}</span>
        <ChevronRightIcon size={12} />
      </button>
    );
  }
  return (
    <QuickThemePanel
      settings={props.settings}
      onAppearance={props.onAppearance}
      onCollapse={props.onCollapse}
      onOpenSettings={props.onOpenSettings}
    />
  );
}
