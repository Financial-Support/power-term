import { useEffect, useMemo, useState } from 'react';
import { sshConfigRead, type SshConfigEntry } from '../lib/ipc';
import { useHostStore } from '../state/hostStore';
import type { HostInput } from '../types';

interface Props {
  onClose: () => void;
}

interface Row {
  entry: SshConfigEntry;
  /** True if a host with this name already exists. We default to unchecked
   *  for duplicates so re-running import never silently overwrites. */
  duplicate: boolean;
  selected: boolean;
}

export function SshConfigImportModal({ onClose }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const create = useHostStore((s) => s.create);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await sshConfigRead();
        if (cancelled) return;
        const existing = new Set(hosts.map((h) => h.name.toLowerCase()));
        setRows(entries.map((e) => ({
          entry: e,
          duplicate: existing.has(e.name.toLowerCase()),
          selected: !existing.has(e.name.toLowerCase()),
        })));
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [hosts]);

  const counts = useMemo(() => {
    if (!rows) return { total: 0, selected: 0 };
    return { total: rows.length, selected: rows.filter((r) => r.selected).length };
  }, [rows]);

  const toggleAll = (on: boolean) => {
    if (!rows) return;
    setRows(rows.map((r) => ({ ...r, selected: on && !r.duplicate })));
  };

  const importSelected = async () => {
    if (!rows) return;
    setBusy(true);
    let added = 0; let skipped = 0;
    for (const r of rows) {
      if (!r.selected) { skipped++; continue; }
      const input: HostInput = {
        name: r.entry.name,
        hostname: r.entry.hostname,
        port: r.entry.port,
        username: r.entry.user || '',
        group_name: 'Imported',
        tags: r.entry.proxy_jump ? ['proxyjump:' + r.entry.proxy_jump] : [],
        auth_method: r.entry.key_path ? 'key' : 'agent',
        key_path: r.entry.key_path,
        notes: r.entry.proxy_jump
          ? `ProxyJump via "${r.entry.proxy_jump}" — backend chaining is not yet wired.`
          : null,
      };
      try { await create(input); added++; } catch { skipped++; }
    }
    setBusy(false);
    setResult({ added, skipped });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="import ssh config">
      <div className="modal modal-form ssh-import-modal">
        <h2>Import from ~/.ssh/config</h2>

        {error && <p className="error">{error}</p>}
        {!rows && !error && <p>Reading ~/.ssh/config…</p>}
        {rows && rows.length === 0 && (
          <p>No host blocks found in ~/.ssh/config.</p>
        )}

        {rows && rows.length > 0 && !result && (
          <>
            <div className="ssh-import-toolbar">
              <span className="ssh-import-summary">
                {counts.selected} of {counts.total} selected
              </span>
              <button type="button" className="ssh-import-tool" onClick={() => toggleAll(true)}>Select non-duplicates</button>
              <button type="button" className="ssh-import-tool" onClick={() => toggleAll(false)}>Clear</button>
            </div>
            <ul className="ssh-import-list">
              {rows.map((r, i) => (
                <li key={r.entry.name + i} className={`ssh-import-row${r.duplicate ? ' duplicate' : ''}`}>
                  <label className="ssh-import-check">
                    <input
                      type="checkbox"
                      checked={r.selected}
                      onChange={(e) => {
                        const next = [...rows];
                        next[i] = { ...next[i], selected: e.target.checked };
                        setRows(next);
                      }}
                    />
                  </label>
                  <div className="ssh-import-fields">
                    <div className="ssh-import-name">
                      {r.entry.name}
                      {r.duplicate && <span className="ssh-import-dup">already exists</span>}
                    </div>
                    <div className="ssh-import-detail">
                      {r.entry.user && <>{r.entry.user}@</>}{r.entry.hostname}{r.entry.port !== 22 && <>:{r.entry.port}</>}
                      {r.entry.proxy_jump && <span className="ssh-import-pj"> · jump via {r.entry.proxy_jump}</span>}
                      {r.entry.key_path && <span className="ssh-import-key"> · {trimKey(r.entry.key_path)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {result && (
          <p className="ssh-import-result">
            Added <strong>{result.added}</strong> host{result.added === 1 ? '' : 's'}.
            {result.skipped > 0 && <> Skipped {result.skipped}.</>}
          </p>
        )}

        <div className="modal-actions">
          {!result ? (
            <>
              <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="primary"
                disabled={busy || !rows || counts.selected === 0}
                onClick={() => void importSelected()}
              >{busy ? 'Importing…' : `Import ${counts.selected}`}</button>
            </>
          ) : (
            <button type="button" className="primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function trimKey(p: string): string {
  const home = p.match(/\/Users\/[^/]+/)?.[0];
  return home ? p.replace(home, '~') : p;
}
