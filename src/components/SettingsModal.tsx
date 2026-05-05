import { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { homeDir } from '@tauri-apps/api/path';
import { useSettingsStore } from '../state/settingsStore';
import { useHostStore } from '../state/hostStore';
import { useSshKeyStore } from '../state/sshKeyStore';
import { defaultColor, useTagStore } from '../state/tagStore';
import { THEME_NAMES, THEME_KEY_FOR_NAME, THEME_DISPLAY_NAME } from '../themes';
import { SyncTab } from './SyncTab';
import { AISettingsTab } from './AISettingsTab';
import { TagChip } from './TagChip';
import type { CursorStyle, SettingsPatch, SshKey, Theme } from '../types';

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

type Tab = 'appearance' | 'terminal' | 'tags' | 'keys' | 'sync' | 'ai';

export function SettingsModal({ onClose, initialTab }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'appearance');
  const [terminalTheme, setTerminalTheme] = useState(settings?.terminal_theme ?? 'default');
  const [fontFamily, setFontFamily] = useState(settings?.font_family ?? 'SF Mono');
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
        <div className="modal-settings-header">
          <h2>Settings</h2>
          <button type="button" className="modal-close-btn" aria-label="Close settings" title="Close (Esc)" onClick={onClose}>✕</button>
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
          <button role="tab" aria-selected={activeTab === 'keys'} onClick={() => setActiveTab('keys')}>Keys</button>
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

        {activeTab === 'keys' && <KeysTab />}

        {activeTab === 'sync' && (
          <div className="sync-tab-panel">
            <SyncTab />
          </div>
        )}

        {activeTab === 'ai' && <AISettingsTab />}

        {localError && <p className="form-error">{localError}</p>}

        {activeTab !== 'sync' && activeTab !== 'ai' && activeTab !== 'tags' && activeTab !== 'keys' && (
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
    const usage = hosts.filter((h) => h.tags.includes(name)).length;
    const message =
      usage > 0
        ? `Delete tag "${name}"? It will be removed from ${usage} host${usage === 1 ? '' : 's'}.`
        : `Delete tag "${name}"?`;
    if (!confirm(message)) return;
    await deleteTag(name);
  };

  return (
    <div className="tags-tab-panel">
      <p className="form-hint">
        Tag colors are stored locally and used to render the chip beside each host. Renaming or deleting a tag updates every host that uses it.
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
        <p className="form-hint">No tags yet. Add one above, or attach a tag to a host.</p>
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
                    title="Reset to auto color"
                    onClick={() => void clearColor(name)}
                  >↺</button>
                )}
                <button
                  type="button"
                  className="tags-row-action"
                  aria-label={`rename ${name}`}
                  title="Rename"
                  onClick={() => (isEditing ? void commitRename() : startRename(name))}
                >✎</button>
                <button
                  type="button"
                  className="tags-row-action tags-row-delete"
                  aria-label={`delete ${name}`}
                  title="Delete tag"
                  onClick={() => void handleDelete(name)}
                >🗑</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * SSH key registry. Users curate a list of (name, path) pairs that
 * HostFormModal then surfaces as a dropdown, so they don't have to
 * paste / browse for the same key every time they save a host.
 *
 * Path is unique per row (DB constraint), so adding the same file twice
 * surfaces a friendly "already exists" error from the backend.
 */
function KeysTab() {
  const keys = useSshKeyStore((s) => s.keys);
  const error = useSshKeyStore((s) => s.error);
  const load = useSshKeyStore((s) => s.load);
  const create = useSshKeyStore((s) => s.create);
  const updateKey = useSshKeyStore((s) => s.update);
  const deleteKey = useSshKeyStore((s) => s.delete);
  const hosts = useHostStore((s) => s.hosts);

  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPath, setEditPath] = useState('');

  useEffect(() => { void load(); }, [load]);

  // Surface usage info per key so the user knows which hosts will lose
  // their key reference if they delete it. We match by `path` since the
  // host model stores the absolute path, not the key id.
  const usageByPath = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hosts) {
      if (h.auth_method === 'key' && h.key_path) {
        m.set(h.key_path, (m.get(h.key_path) ?? 0) + 1);
      }
    }
    return m;
  }, [hosts]);

  const browseKey = async (setter: (p: string) => void) => {
    let defaultPath: string | undefined;
    try {
      const home = await homeDir();
      defaultPath = `${home.replace(/\/$/, '')}/.ssh`;
    } catch { /* fallback to dialog default */ }
    const picked = await openDialog({
      multiple: false,
      directory: false,
      title: 'Select private key',
      defaultPath,
    });
    if (typeof picked === 'string' && picked.length > 0) setter(picked);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newPath.trim()) {
      setCreateError('Both name and path are required.');
      return;
    }
    const k = await create({ name: newName.trim(), path: newPath.trim() });
    if (k) {
      setNewName('');
      setNewPath('');
      setCreateError(null);
    } else {
      setCreateError(useSshKeyStore.getState().error ?? 'Failed to add key.');
    }
  };

  const startEdit = (k: SshKey) => {
    setEditingId(k.id);
    setEditName(k.name);
    setEditPath(k.path);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPath('');
  };

  const commitEdit = async (id: string) => {
    if (!editName.trim() || !editPath.trim()) { cancelEdit(); return; }
    const k = await updateKey(id, { name: editName.trim(), path: editPath.trim() });
    if (k) cancelEdit();
  };

  const handleDelete = async (k: SshKey) => {
    const usage = usageByPath.get(k.path) ?? 0;
    const msg = usage > 0
      ? `Delete key "${k.name}"? ${usage} host${usage === 1 ? '' : 's'} reference this key path and will need to be edited.`
      : `Delete key "${k.name}"?`;
    if (!confirm(msg)) return;
    await deleteKey(k.id);
  };

  return (
    <div className="keys-tab-panel">
      <p className="form-hint">
        Saved private keys appear in the host form's auth dropdown. The path is what gets used for SSH; the name is just a label.
      </p>

      <div className="keys-create-row">
        <input
          className="keys-create-name"
          placeholder="Label (e.g. Personal)"
          value={newName}
          onChange={(e) => { setNewName(e.target.value); setCreateError(null); }}
        />
        <input
          className="keys-create-path"
          placeholder="/Users/you/.ssh/id_ed25519"
          value={newPath}
          onChange={(e) => { setNewPath(e.target.value); setCreateError(null); }}
        />
        <button type="button" onClick={() => void browseKey(setNewPath)}>Browse…</button>
        <button type="button" className="primary" onClick={() => void handleCreate()}>Add</button>
      </div>
      {createError && <p className="form-error">{createError}</p>}
      {error && !createError && <p className="form-error">{error}</p>}

      {keys.length === 0 ? (
        <p className="form-hint">No keys saved yet.</p>
      ) : (
        <ul className="keys-list">
          {keys.map((k) => {
            const isEditing = editingId === k.id;
            const usage = usageByPath.get(k.path) ?? 0;
            return (
              <li key={k.id} className="keys-row">
                {isEditing ? (
                  <>
                    <input
                      className="keys-row-name-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                    />
                    <input
                      className="keys-row-path-input"
                      value={editPath}
                      onChange={(e) => setEditPath(e.target.value)}
                    />
                    <button type="button" onClick={() => void browseKey(setEditPath)}>Browse</button>
                    <button type="button" onClick={() => void commitEdit(k.id)}>Save</button>
                    <button type="button" onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="keys-row-name">{k.name}</span>
                    <span className="keys-row-path" title={k.path}>{k.path}</span>
                    <span className="keys-row-usage">
                      {usage > 0 ? `${usage} host${usage === 1 ? '' : 's'}` : 'unused'}
                    </span>
                    <button
                      type="button"
                      className="keys-row-action"
                      aria-label={`edit ${k.name}`}
                      title="Edit"
                      onClick={() => startEdit(k)}
                    >✎</button>
                    <button
                      type="button"
                      className="keys-row-action keys-row-delete"
                      aria-label={`delete ${k.name}`}
                      title="Delete key"
                      onClick={() => void handleDelete(k)}
                    >🗑</button>
                  </>
                )}
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
