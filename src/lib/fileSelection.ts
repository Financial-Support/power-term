export interface SelectionModifiers {
  toggle: boolean;
  range: boolean;
}

export interface FileSelectionResult {
  selected: Set<string>;
  anchor: string;
}

/** Apply desktop file-manager selection semantics to an ordered list. */
export function nextFileSelection(
  orderedKeys: string[],
  current: ReadonlySet<string>,
  anchor: string | null,
  key: string,
  modifiers: SelectionModifiers,
): FileSelectionResult {
  const visible = new Set(orderedKeys);
  const selected = new Set([...current].filter((item) => visible.has(item)));

  if (modifiers.range && anchor && visible.has(anchor)) {
    const start = orderedKeys.indexOf(anchor);
    const end = orderedKeys.indexOf(key);
    const range = orderedKeys.slice(Math.min(start, end), Math.max(start, end) + 1);
    return {
      selected: modifiers.toggle ? new Set([...selected, ...range]) : new Set(range),
      anchor,
    };
  }

  if (modifiers.toggle) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    return { selected, anchor: key };
  }

  return { selected: new Set([key]), anchor: key };
}
