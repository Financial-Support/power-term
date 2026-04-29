import { useEffect, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { THEME_NAMES, THEME_KEY_FOR_NAME, THEME_DISPLAY_NAME } from '../themes';
import { SyncTab } from './SyncTab';
import type { SettingsPatch } from '../types';

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = 'appearance' | 'terminal' | 'sync';

export function SettingsModal({ onClose, initialTab }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'appearance');
  const [terminalTheme, setTerminalTheme] = useState(settings?.terminal_theme ?? 'default');
  const [fontFamily, setFontFamily] = useState(settings?.font_family ?? 'SF Mono');
  const [fontSize, setFontSize] = useState(settings?.font_size ?? 14);
  const [cursorBlink, setCursorBlink] = useState(settings?.cursor_blink ?? true);
  const [scrollback, setScrollback] = useState(settings?.scrollback_lines ?? 10000);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const fontSizeValid = fontSize >= 6 && fontSize <= 72;
  const scrollbackValid = scrollback >= 100 && scrollback <= 1_000_000;
  const fontFamilyValid = fontFamily.trim() !== '';
  const valid = fontSizeValid && scrollbackValid && fontFamilyValid;

  const handleSave = async () => {
    if (!valid || !settings) return;
    const patch: SettingsPatch = {};
    if (terminalTheme !== settings.terminal_theme) patch.terminal_theme = terminalTheme;
    if (fontFamily !== settings.font_family) patch.font_family = fontFamily;
    if (fontSize !== settings.font_size) patch.font_size = fontSize;
    if (cursorBlink !== settings.cursor_blink) patch.cursor_blink = cursorBlink;
    if (scrollback !== settings.scrollback_lines) patch.scrollback_lines = scrollback;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setSaving(true);
    setLocalError(null);
    await updateSettings(patch);
    setSaving(false);
    const currentError = useSettingsStore.getState().error;
    if (!currentError) onClose();
    else setLocalError(currentError);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="settings" aria-modal="true">
      <div className="modal modal-form modal-settings">
        <div className="modal-settings-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close-btn" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'appearance'}
            onClick={() => setActiveTab('appearance')}
          >Appearance</button>
          <button
            role="tab"
            aria-selected={activeTab === 'terminal'}
            onClick={() => setActiveTab('terminal')}
          >Terminal</button>
          <button role="tab" aria-selected={activeTab === 'sync'} onClick={() => setActiveTab('sync')}>Sync</button>
        </div>

        {activeTab === 'appearance' && (
          <div className="form-grid">
            <label htmlFor="sm-theme">Theme</label>
            <select
              id="sm-theme"
              value={THEME_DISPLAY_NAME[terminalTheme] ?? 'Default'}
              onChange={(e) => setTerminalTheme(THEME_KEY_FOR_NAME[e.target.value] ?? 'default')}
            >
              {THEME_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            <label htmlFor="sm-font-family">Font family</label>
            <input
              id="sm-font-family"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
            />

            <label htmlFor="sm-font-size">Font size</label>
            <input
              id="sm-font-size"
              type="number"
              min={6}
              max={72}
              step={1}
              value={fontSize}
              onChange={(e) => { const n = parseInt(e.target.value, 10); setFontSize(isNaN(n) ? 0 : n); }}
            />

            <label htmlFor="sm-cursor-blink">Cursor blink</label>
            <input
              id="sm-cursor-blink"
              type="checkbox"
              checked={cursorBlink}
              onChange={(e) => setCursorBlink(e.target.checked)}
            />
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="form-grid">
            <label htmlFor="sm-scrollback">Scrollback lines</label>
            <input
              id="sm-scrollback"
              type="number"
              min={100}
              max={1000000}
              step={100}
              value={scrollback}
              onChange={(e) => { const n = parseInt(e.target.value, 10); setScrollback(isNaN(n) ? 0 : n); }}
            />
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="sync-tab-panel">
            <SyncTab />
          </div>
        )}

        {localError && <p className="form-error">{localError}</p>}

        {activeTab !== 'sync' && (
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="primary"
              onClick={() => void handleSave()}
              disabled={!valid || saving}
            >Save</button>
          </div>
        )}
      </div>
    </div>
  );
}
