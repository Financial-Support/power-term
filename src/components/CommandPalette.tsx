import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSshTarget } from '../lib/sshTarget';
import { useHostStore } from '../state/hostStore';
import { useSnippetStore } from '../state/snippetStore';
import type { Host, Snippet, SshTarget } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSshConnect: (target: SshTarget) => void;
  onConnectHost?: (host: Host) => void;
  onInsertSnippet?: (snippet: Snippet) => void;
  onNewLocalTab?: () => void;
  onOpenSettings?: () => void;
}

type Item =
  | { kind: 'host'; host: Host; score: number }
  | { kind: 'snippet'; snippet: Snippet; score: number }
  | { kind: 'ssh'; target: SshTarget; raw: string; score: number }
  | { kind: 'action'; id: string; label: string; hint?: string; run: () => void; score: number };

const RESULT_LIMIT = 30;

export function CommandPalette({
  open, onClose, onSshConnect, onConnectHost, onInsertSnippet, onNewLocalTab, onOpenSettings,
}: Props) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const hosts = useHostStore((s) => s.hosts);
  const snippets = useSnippetStore((s) => s.snippets);

  // Reset query+selection every time the palette is opened.
  useEffect(() => {
    if (open) { setText(''); setSelected(0); }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const q = text.trim();
    const out: Item[] = [];

    // Direct ssh-string fallback so the user can always type a brand-new
    // host without saving it first.
    if (q.toLowerCase().startsWith('ssh ')) {
      try {
        const target = parseSshTarget(q.slice(4).trim());
        out.push({ kind: 'ssh', target, raw: q.slice(4).trim(), score: 100 });
      } catch { /* incomplete — fall through */ }
    }

    for (const h of hosts) {
      const s = scoreItem(q, [h.name, h.hostname, h.username, h.group_name ?? '', ...h.tags]);
      if (s > 0) out.push({ kind: 'host', host: h, score: s + recencyBoost(h.last_used_at) });
    }
    for (const sn of snippets) {
      const s = scoreItem(q, [sn.name, ...sn.tags]);
      if (s > 0) out.push({ kind: 'snippet', snippet: sn, score: s + recencyBoost(sn.last_used_at) });
    }

    const actions: Array<{ id: string; label: string; hint?: string; run?: () => void }> = [
      { id: 'new-tab', label: 'New local tab', hint: '⌘T', run: onNewLocalTab },
      { id: 'settings', label: 'Open Settings', hint: '⌘,', run: onOpenSettings },
    ];
    for (const a of actions) {
      if (!a.run) continue;
      const s = scoreItem(q, [a.label]);
      if (s > 0) out.push({ kind: 'action', id: a.id, label: a.label, hint: a.hint, run: a.run, score: s });
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, RESULT_LIMIT);
  }, [open, text, hosts, snippets, onNewLocalTab, onOpenSettings]);

  // Clamp the cursor when the result set shrinks.
  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  // Keep the highlighted row in view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selected}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  const runItem = (item: Item | undefined) => {
    if (!item) return;
    switch (item.kind) {
      case 'host':
        if (onConnectHost) onConnectHost(item.host);
        break;
      case 'snippet':
        if (onInsertSnippet) onInsertSnippet(item.snippet);
        break;
      case 'ssh':
        onSshConnect(item.target);
        break;
      case 'action':
        item.run();
        break;
    }
    onClose();
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter')     { e.preventDefault(); runItem(items[selected]); return; }
  };

  return (
    <div className="palette-backdrop" role="dialog" aria-label="command palette" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search hosts, snippets, or type 'ssh user@host'…"
          value={text}
          onChange={(e) => { setText(e.target.value); setSelected(0); }}
          onKeyDown={handleKey}
        />
        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 ? (
            <div className="palette-empty">
              {text ? 'No matches' : 'Start typing to search hosts and snippets'}
            </div>
          ) : items.map((item, i) => (
            <button
              key={itemKey(item)}
              type="button"
              role="option"
              aria-selected={i === selected}
              data-idx={i}
              className={`palette-row${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => runItem(item)}
            >
              <ItemRow item={item} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  switch (item.kind) {
    case 'host':
      return (
        <>
          <span className="palette-row-label">{item.host.name}</span>
          <span className="palette-row-meta">{item.host.username}@{item.host.hostname}{item.host.port !== 22 ? `:${item.host.port}` : ''}</span>
          <span className="palette-row-kind">Host</span>
        </>
      );
    case 'snippet':
      return (
        <>
          <span className="palette-row-label">{item.snippet.name}</span>
          <span className="palette-row-meta">{firstLine(item.snippet.content)}</span>
          <span className="palette-row-kind">Snippet</span>
        </>
      );
    case 'ssh':
      return (
        <>
          <span className="palette-row-label">Connect: {item.raw}</span>
          <span className="palette-row-meta">{item.target.user}@{item.target.host}:{item.target.port}</span>
          <span className="palette-row-kind">SSH</span>
        </>
      );
    case 'action':
      return (
        <>
          <span className="palette-row-label">{item.label}</span>
          <span className="palette-row-meta" />
          <span className="palette-row-kind">{item.hint ?? 'Action'}</span>
        </>
      );
  }
}

function itemKey(item: Item): string {
  switch (item.kind) {
    case 'host': return `host:${item.host.id}`;
    case 'snippet': return `snippet:${item.snippet.id}`;
    case 'ssh': return `ssh:${item.raw}`;
    case 'action': return `action:${item.id}`;
  }
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  const line = nl >= 0 ? s.slice(0, nl) : s;
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

/** Recent items get a small score boost so they float to the top when the
 * query is empty or weakly distinguishing. */
function recencyBoost(last: number | null): number {
  if (!last) return 0;
  const ageMs = Date.now() - last;
  const days = ageMs / (1000 * 60 * 60 * 24);
  if (days < 1) return 5;
  if (days < 7) return 2;
  return 0.5;
}

/** Score a candidate against `query` based on the best haystack field.
 * Empty query passes everything. Substring match scored by position +
 * length ratio; missing match returns 0 and the item is filtered out. */
function scoreItem(query: string, haystacks: string[]): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  let best = 0;
  for (const h of haystacks) {
    const lh = h.toLowerCase();
    const idx = lh.indexOf(q);
    if (idx < 0) continue;
    const positionScore = 1 - idx / Math.max(lh.length, 1);
    const lengthScore = q.length / Math.max(lh.length, 1);
    const score = 1 + positionScore * 2 + lengthScore;
    if (score > best) best = score;
  }
  return best;
}
