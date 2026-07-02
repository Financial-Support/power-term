import { useMemo, useRef, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import { defaultColor, useTagStore } from '../state/tagStore';
import { CloseIcon, SearchIcon } from './AppIcons';
import { TagChip } from './TagChip';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** id used for the input's aria-label / linked <label> in parent forms. */
  id?: string;
}

/**
 * Multi-tag picker with colored chips for the selected set, an inline add
 * input that doubles as a filter over known tags, and a suggestions row of
 * unselected tags. New tags can be created on the fly by pressing Enter on
 * a free-text value — the host save then persists the membership.
 *
 * Tag colors come from the tag store; tags lacking a stored color fall back
 * to the deterministic name-hash so they still render distinctly.
 */
export function TagsMultiPicker({ value, onChange, id }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const colors = useTagStore((s) => s.colors);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Union of tags from any host plus tags configured in the colour table.
  // Internal `kind:value` markers (e.g. proxyjump:gateway) are skipped — they
  // aren't user-facing labels and would clutter the picker.
  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) {
      for (const t of h.tags) {
        if (t && !t.includes(':')) set.add(t);
      }
    }
    for (const k of Object.keys(colors)) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [hosts, colors]);

  const selected = new Set(value);
  const trimmedDraft = draft.trim();
  const lower = trimmedDraft.toLowerCase();

  const suggestions = useMemo(() => {
    return knownTags
      .filter((t) => !selected.has(t))
      .filter((t) => lower === '' || t.toLowerCase().includes(lower))
      .slice(0, 24);
  }, [knownTags, selected, lower]);

  const canCreate =
    trimmedDraft !== '' &&
    !selected.has(trimmedDraft) &&
    !knownTags.some((t) => t.toLowerCase() === lower);

  const add = (name: string) => {
    const t = name.trim();
    if (t === '' || selected.has(t)) return;
    onChange([...value, t]);
    setDraft('');
    inputRef.current?.focus();
  };

  const remove = (name: string) => {
    onChange(value.filter((t) => t !== name));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Prefer an exact match in the suggestion list; otherwise create.
      const exact = knownTags.find((t) => t.toLowerCase() === lower);
      if (exact) add(exact);
      else if (canCreate) add(trimmedDraft);
      return;
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // Quick-remove the last chip when the input is empty — matches the
      // behaviour of most chip pickers and avoids a forced mouse jump.
      e.preventDefault();
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="tag-picker">
      <div className="tag-picker-selected">
        {value.length === 0 && <span className="tag-picker-empty">No tags</span>}
        {value.map((name) => {
          const bg = colors[name] ?? defaultColor(name);
          return (
            <span key={name} className="tag-picker-chip" style={{ background: bg, color: chipText(bg) }}>
              {name}
              <button
                type="button"
                className="tag-picker-chip-x"
                aria-label={`Remove ${name}`}
                onClick={() => remove(name)}
              ><CloseIcon size={11} /></button>
            </span>
          );
        })}
      </div>

      <div className="tag-picker-input-row">
        <span className="tag-picker-input-icon" aria-hidden>
          <SearchIcon size={12} />
        </span>
        <input
          id={id}
          ref={inputRef}
          className="tag-picker-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? 'Add tag…' : 'Add another tag…'}
          aria-label="Add tag"
        />
      </div>

      {(suggestions.length > 0 || canCreate) && (
        <div className="tag-picker-suggest">
          {canCreate && (
            <button
              type="button"
              className="tag-picker-create"
              onClick={() => add(trimmedDraft)}
              title={`Create new tag "${trimmedDraft}"`}
            >+ Create "{trimmedDraft}"</button>
          )}
          {suggestions.map((name) => (
            <TagChip
              key={name}
              name={name}
              className="tag-picker-suggest-chip"
              onClick={() => add(name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function chipText(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#000';
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}
