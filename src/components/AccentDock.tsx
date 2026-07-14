import { useMemo } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { ChevronDownIcon, ChevronRightIcon } from './AppIcons';

const ACCENT_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'system', label: 'System accent' },
  { id: '#f59e0b', label: 'Amber' },
  { id: '#3b82f6', label: 'Blue' },
  { id: '#a855f7', label: 'Purple' },
  { id: '#22c55e', label: 'Green' },
  { id: '#ef4444', label: 'Red' },
  { id: '#ec4899', label: 'Pink' },
];

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSettings?: () => void;
}

type Appearance = 'auto' | 'light' | 'dark';

const APPEARANCE_LABEL: Record<Appearance, string> = {
  auto: 'System',
  light: 'Light',
  dark: 'Dark',
};

function currentAppearance(theme: string | undefined): Appearance {
  if (theme === 'light' || theme === 'dark') return theme;
  return 'auto';
}

export function AccentDock({ collapsed, onToggle, onOpenSettings }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const value = settings?.accent_color ?? 'system';
  const isPreset = useMemo(
    () => ACCENT_PRESETS.some((preset) => preset.id === value),
    [value],
  );
  const customValue = !isPreset && /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888';

  const swatchColor = value === 'system' ? undefined : value;
  const appearance = currentAppearance(settings?.theme);

  const setAccent = async (accent: string) => {
    if (accent === value) return;
    await updateSettings({ accent_color: accent });
  };

  const setAppearance = async (theme: Appearance) => {
    if (theme === appearance) return;
    await updateSettings({ theme });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="accent-dock-reveal"
        onClick={onToggle}
        aria-label="Show appearance controls"
        aria-expanded={false}
        title="Appearance"
      >
        <span
          className="accent-dock-reveal-dot"
          style={swatchColor ? { background: swatchColor } : undefined}
        />
        <span className="accent-dock-reveal-label">Appearance</span>
        <ChevronRightIcon size={12} />
      </button>
    );
  }

  return (
    <div className="accent-dock" aria-label="Quick appearance controls">
      <section className="accent-dock-theme" aria-label="Quick theme switcher">
        <span className="accent-dock-theme-title">Theme</span>
        <div className="accent-dock-appearance" role="radiogroup" aria-label="Appearance">
          {(['auto', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              role="radio"
              aria-checked={appearance === theme}
              className={`accent-dock-appearance-option${appearance === theme ? ' active' : ''}`}
              onClick={() => void setAppearance(theme)}
            >
              {APPEARANCE_LABEL[theme]}
            </button>
          ))}
        </div>
        <div className="accent-dock-theme-row">
          <span>Current</span>
          <span>{APPEARANCE_LABEL[appearance]}</span>
        </div>
        <button
          type="button"
          className="accent-dock-more-btn"
          onClick={onOpenSettings}
          title="Open full theme settings"
        >
          More settings
          <ChevronRightIcon size={12} />
        </button>
      </section>

      <div className="accent-dock-divider" />
      <div className="accent-dock-colors">
        <button
          type="button"
          className="accent-dock-toggle"
          aria-label="Collapse appearance controls"
          aria-expanded={true}
          title="Collapse appearance controls"
          onClick={onToggle}
        >
          <ChevronDownIcon size={14} />
        </button>
        <div className="accent-dock-swatches" role="radiogroup" aria-label="Accent presets">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={value === preset.id}
              aria-label={preset.label}
              title={preset.label}
              className={`accent-swatch accent-dock-swatch${value === preset.id ? ' active' : ''}${preset.id === 'system' ? ' accent-swatch-system' : ''}`}
              style={preset.id === 'system' ? undefined : { background: preset.id }}
              onClick={() => void setAccent(preset.id)}
            >
              {preset.id === 'system' ? 'A' : ''}
            </button>
          ))}
          <label
            className={`accent-swatch accent-swatch-custom accent-dock-swatch${!isPreset ? ' active' : ''}`}
            title="Custom accent color"
          >
            <input
              type="color"
              aria-label="Custom accent color"
              value={customValue}
              onChange={(e) => void setAccent(e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
