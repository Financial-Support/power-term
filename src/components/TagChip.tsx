import { defaultColor, useTagStore } from '../state/tagStore';

interface Props {
  name: string;
  /** Override the color picked from the store / hash fallback. */
  color?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Colored pill for a tag name. Color resolves from the tag store first,
 * then a deterministic hash of the name so unconfigured tags still look
 * different from each other. The text color flips between black and white
 * based on the background's luminance to stay readable.
 */
export function TagChip({ name, color, onClick, className }: Props) {
  const stored = useTagStore((s) => s.colors[name]);
  const bg = color ?? stored ?? defaultColor(name);
  const fg = textColorFor(bg);
  const cls = `tag-chip${onClick ? ' tag-chip-clickable' : ''}${className ? ' ' + className : ''}`;
  if (onClick) {
    return (
      <button type="button" className={cls} style={{ background: bg, color: fg }} onClick={onClick}>
        {name}
      </button>
    );
  }
  return (
    <span className={cls} style={{ background: bg, color: fg }}>
      {name}
    </span>
  );
}

function textColorFor(hex: string): string {
  // Standard relative luminance check; threshold tuned so mid-saturation
  // colors land on the white-text side rather than fighting low contrast.
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#000';
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1a1a1a' : '#fff';
}
