import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useHostStore } from '../state/hostStore';
import { defaultColor, useTagStore } from '../state/tagStore';
import { THEME_NAMES, THEME_KEY_FOR_NAME, THEME_DISPLAY_NAME } from '../themes';
import { SyncTab } from './SyncTab';
import { AISettingsTab } from './AISettingsTab';
import { TagChip } from './TagChip';
import { ConfirmModal } from './ConfirmModal';
import type { CursorStyle, SettingsPatch, Theme } from '../types';
import { CloseIcon, PencilIcon, RefreshIcon, SettingsIcon, TrashIcon } from './AppIcons';

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = 'appearance' | 'terminal' | 'tags' | 'sync' | 'ai';

export function SettingsModal({ onClose, initialTab }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'appearance');
  const [terminalTheme, setTerminalTheme] = useState(settings?.terminal_theme ?? 'default');
  const [fontFamily, setFontFamily] = useState(settings?.font_family ?? 'JetBrains Mono');
  const [fontSize, setFontSize] = useState(settings?.font_size ?? 14);
  const [cursorBlink, setCursorBlink] = useState(settings?.cursor_blink ?? true);
  const [cursorStyle, setCursorStyle] = useState<CursorStyle>(settings?.cursor_style ?? 'block');
  const [accentColor, setAccentColor] = useState(settings?.accent_color ?? 'system');
  const [theme, setTheme] = useState<Theme>(settings?.theme ?? 'auto');
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
    if (cursorStyle !== settings.cursor_style) patch.cursor_style = cursorStyle;
    if (accentColor !== settings.accent_color) patch.accent_color = accentColor;
    if (theme !== settings.theme) patch.theme = theme;
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
        <div className="modal-title-row">
          <span className="modal-title-icon" aria-hidden><SettingsIcon size={14} /></span>
          <div className="modal-title-copy">
            <span className="modal-eyebrow">Settings</span>
            <h2>Preferences</h2>
            <p className="form-title-meta">Appearance, terminal, sync, tags, and AI</p>
          </div>
          <button type="button" className="modal-close-btn" aria-label="Close settings" title="Close" onClick={onClose}><CloseIcon size={14} /></button>
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
          <button role="tab" aria-selected={activeTab === 'tags'} onClick={() => setActiveTab('tags')}>Tags</button>
          <button role="tab" aria-selected={activeTab === 'sync'} onClick={() => setActiveTab('sync')}>Sync</button>
          <button role="tab" aria-selected={activeTab === 'ai'} onClick={() => setActiveTab('ai')}>AI</button>
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

            <label>Appearance</label>
            <div className="theme-picker" role="radiogroup" aria-label="appearance">
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  className={`theme-option${theme === t ? ' active' : ''}`}
                  onClick={() => setTheme(t)}
                >{t === 'auto' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</button>
              ))}
            </div>

            <label>Accent color</label>
            <AccentPicker value={accentColor} onChange={setAccentColor} />

            <label htmlFor="sm-cursor-style">Cursor style</label>
            <div className="cursor-style-picker" role="radiogroup" aria-labelledby="sm-cursor-style">
              {(['block', 'underline', 'bar'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={cursorStyle === style}
                  className={`cursor-style-option${cursorStyle === style ? ' active' : ''}`}
                  onClick={() => setCursorStyle(style)}
                  title={style}
                >
                  <CursorPreview style={style} />
                  <span className="cursor-style-label">{cursorStyleLabel(style)}</span>
                </button>
              ))}
            </div>

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

        {activeTab === 'tags' && <TagsTab />}

        {activeTab === 'sync' && (
          <div className="sync-tab-panel">
            <SyncTab />
          </div>
        )}

        {activeTab === 'ai' && <AISettingsTab />}

        {localError && <p className="form-error">{localError}</p>}

        {activeTab !== 'sync' && activeTab !== 'ai' && activeTab !== 'tags' && (
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

function cursorStyleLabel(style: CursorStyle): string {
  switch (style) {
    case 'block': return 'Block';
    case 'underline': return 'Underline';
    case 'bar': return 'Bar';
  }
}

const ACCENT_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'system',  label: 'System (macOS accent)' },
  { id: '#f59e0b', label: 'Amber' },
  { id: '#3b82f6', label: 'Blue' },
  { id: '#a855f7', label: 'Purple' },
  { id: '#22c55e', label: 'Green' },
  { id: '#ef4444', label: 'Red' },
  { id: '#ec4899', label: 'Pink' },
];

function AccentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = ACCENT_PRESETS.some((p) => p.id === value);
  // Custom hex picker shows the user's own colour; default to amber when
  // they haven't picked anything yet so the swatch is always visible.
  const customValue = !isPreset && /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888';
  return (
    <div className="accent-picker">
      {ACCENT_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          aria-label={p.label}
          title={p.label}
          className={`accent-swatch${value === p.id ? ' active' : ''}${p.id === 'system' ? ' accent-swatch-system' : ''}`}
          style={p.id === 'system' ? undefined : { background: p.id }}
          onClick={() => onChange(p.id)}
        >{p.id === 'system' ? 'A' : ''}</button>
      ))}
      <label className={`accent-swatch accent-swatch-custom${!isPreset ? ' active' : ''}`} title="Custom color">
        <input
          type="color"
          aria-label="Custom accent color"
          value={customValue}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

/**
 * Tag CRUD manager. Tag *names* live on `hosts.tags_json`; this tab keeps
 * the colour side-table in sync and offers create / rename / delete that
 * cascade across every host. Internal `kind:value` markers such as
 * `proxyjump:gateway` are filtered out — they aren't user-facing labels.
 *
 * Create here writes a colour row even if no host uses the tag yet, so the
 * tag is immediately offered by the host-form picker. Delete strips the
 * tag from every host that has it (and bumps their `updated_at` for sync).
 */
function TagsTab() {
  const hosts = useHostStore((s) => s.hosts);
  const colors = useTagStore((s) => s.colors);
  const setColor = useTagStore((s) => s.setColor);
  const clearColor = useTagStore((s) => s.clearColor);
  const renameTag = useTagStore((s) => s.renameTag);
  const deleteTag = useTagStore((s) => s.deleteTag);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);

  const tagNames = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) {
      for (const t of h.tags) {
        if (t && !t.includes(':')) set.add(t);
      }
    }
    for (const k of Object.keys(colors)) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [hosts, colors]);

  const tagSet = useMemo(() => new Set(tagNames), [tagNames]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (trimmed === '') {
      setCreateError('Tag name cannot be empty.');
      return;
    }
    if (trimmed.includes(':')) {
      setCreateError('":" is reserved for internal markers.');
      return;
    }
    if (tagSet.has(trimmed)) {
      setCreateError(`Tag "${trimmed}" already exists.`);
      return;
    }
    const result = await setColor(trimmed, newColor);
    if (result) {
      setNewName('');
      setCreateError(null);
    } else {
      setCreateError(useTagStore.getState().error ?? 'Failed to create tag.');
    }
  };

  const startRename = (name: string) => {
    setEditingName(name);
    setEditingDraft(name);
  };
  const cancelRename = () => {
    setEditingName(null);
    setEditingDraft('');
  };
  const commitRename = async () => {
    if (editingName === null) return;
    const trimmed = editingDraft.trim();
    if (trimmed === '' || trimmed === editingName) {
      cancelRename();
      return;
    }
    if (trimmed.includes(':')) return;
    const ok = await renameTag(editingName, trimmed);
    if (ok) cancelRename();
  };

  const handleDelete = async (name: string) => {
    setPendingDeleteName(name);
  };

  const confirmDelete = async () => {
    if (!pendingDeleteName) return;
    await deleteTag(pendingDeleteName);
    setPendingDeleteName(null);
  };

  const pendingDeleteUsage = pendingDeleteName
    ? hosts.filter((h) => h.tags.includes(pendingDeleteName)).length
    : 0;

  return (
    <div className="tags-tab-panel">
      {pendingDeleteName && (
        <ConfirmModal
          title="Delete tag"
          message={
            pendingDeleteUsage > 0
              ? `Delete "${pendingDeleteName}"? It will be removed from ${pendingDeleteUsage} host${pendingDeleteUsage === 1 ? '' : 's'}.`
              : `Delete "${pendingDeleteName}"?`
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteName(null)}
        />
      )}
      <p className="form-hint">
        Tag colors stay local. Renaming or deleting a tag updates every host using it.
      </p>

      <div className="tags-create-row">
        <input
          className="tags-create-name"
          type="text"
          placeholder="New tag name"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setCreateError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); } }}
          aria-label="New tag name"
        />
        <input
          type="color"
          aria-label="New tag color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
        />
        <button type="button" className="primary" onClick={() => void handleCreate()}>Add</button>
      </div>
      {createError && <p className="form-error">{createError}</p>}

      {tagNames.length === 0 ? (
        <p className="form-hint">No tags.</p>
      ) : (
        <ul className="tags-list">
          {tagNames.map((name) => {
            const stored = colors[name];
            const effective = stored ?? defaultColor(name);
            const usageCount = hosts.filter((h) => h.tags.includes(name)).length;
            const isEditing = editingName === name;
            return (
              <li key={name} className="tags-row">
                <TagChip name={isEditing ? editingDraft || name : name} className="tags-row-preview" />
                {isEditing ? (
                  <input
                    autoFocus
                    className="tags-row-rename-input"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                    }}
                    onBlur={() => void commitRename()}
                    aria-label={`Rename ${name}`}
                  />
                ) : (
                  <span className="tags-row-name">{name}</span>
                )}
                <span className="tags-row-usage">
                  {usageCount > 0 ? `${usageCount} host${usageCount === 1 ? '' : 's'}` : 'unused'}
                </span>
                <input
                  type="color"
                  aria-label={`color for tag ${name}`}
                  value={effective}
                  onChange={(e) => void setColor(name, e.target.value)}
                />
                {stored && (
                  <button
                    type="button"
                    className="tags-row-clear"
                    aria-label={`reset ${name} color to default`}
                    title="Reset color"
                    onClick={() => void clearColor(name)}
                  ><RefreshIcon size={13} /></button>
                )}
                <button
                  type="button"
                  className="tags-row-action"
                  aria-label={`rename ${name}`}
                  title="Rename"
                  onClick={() => (isEditing ? void commitRename() : startRename(name))}
                ><PencilIcon size={13} /></button>
                <button
                  type="button"
                  className="tags-row-action tags-row-delete"
                  aria-label={`delete ${name}`}
                  title="Delete tag"
                  onClick={() => void handleDelete(name)}
                ><TrashIcon size={13} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}


/** Mini glyph that mirrors what xterm.js renders for each cursor option,
 * so the user can pick by shape rather than by name. */
function CursorPreview({ style }: { style: CursorStyle }) {
  return (
    <span className="cursor-preview" aria-hidden>
      <span className="cursor-preview-text">A</span>
      <span className={`cursor-preview-cursor cursor-preview-${style}`} />
    </span>
  );
}
