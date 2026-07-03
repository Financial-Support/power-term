import { useMemo } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { ChevronDownIcon, ChevronRightIcon, SettingsIcon } from './AppIcons';

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
  onExpand: () => void;
  onCollapse: () => void;
  onOpenSettings?: () => void;
}

export function AccentDock({ collapsed, onExpand, onCollapse, onOpenSettings }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const value = settings?.accent_color ?? 'system';
  const isPreset = useMemo(
    () => ACCENT_PRESETS.some((preset) => preset.id === value),
    [value],
  );
  const customValue = !isPreset && /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888';

  const currentPreset = ACCENT_PRESETS.find((p) => p.id === value);
  const swatchColor = value === 'system' ? undefined : value;

  const setAccent = async (accent: string) => {
    if (accent === value) return;
    await updateSettings({ accent_color: accent });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="accent-dock-reveal"
        onClick={onExpand}
        aria-label="Show accent colors"
        title="Accent colors"
      >
        <span
          className="accent-dock-reveal-dot"
          style={swatchColor ? { background: swatchColor } : undefined}
        />
        <span className="accent-dock-reveal-label">{currentPreset?.label ?? 'Custom'}</span>
        <ChevronRightIcon size={12} />
      </button>
    );
  }

  return (
    <div className="accent-dock" aria-label="Quick accent colors">
      <button
        type="button"
        className="accent-dock-collapse"
        aria-label="Collapse accent dock"
        title="Collapse"
        onClick={onCollapse}
      >
        <ChevronDownIcon size={14} />
      </button>
      <button
        type="button"
        className="accent-dock-settings"
        aria-label="Open appearance settings"
        title="Open appearance settings"
        onClick={onOpenSettings}
      >
        <SettingsIcon size={13} />
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
  );
}
