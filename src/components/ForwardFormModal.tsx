import { useEffect, useState } from 'react';
import { useHostStore } from '../state/hostStore';
import type { Forward, ForwardInput, ForwardKind } from '../types';

interface Props {
  mode: 'create' | 'edit';
  forward?: Forward;
  onSave: (input: ForwardInput) => void;
  onCancel: () => void;
}

export function ForwardFormModal({ mode, forward, onSave, onCancel }: Props) {
  const hosts = useHostStore((s) => s.hosts);
  const [name, setName] = useState(forward?.name ?? '');
  const [hostId, setHostId] = useState(forward?.host_id ?? '');
  const [kind, setKind] = useState<ForwardKind>(forward?.kind ?? 'local');
  const [bindAddr, setBindAddr] = useState(forward?.bind_addr ?? '127.0.0.1');
  const [bindPort, setBindPort] = useState<number>(forward?.bind_port ?? 0);
  const [remoteHost, setRemoteHost] = useState(forward?.remote_host ?? '');
  const [remotePort, setRemotePort] = useState<number>(forward?.remote_port ?? 0);
  const [autoStart, setAutoStart] = useState(forward?.auto_start ?? false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  const valid =
    name.trim() !== '' && hostId !== '' &&
    bindPort >= 1 && bindPort <= 65535 &&
    remotePort >= 1 && remotePort <= 65535 &&
    bindAddr.trim() !== '' && remoteHost.trim() !== '';

  const submit = () => {
    if (!valid) return;
    onSave({
      host_id: hostId, name: name.trim(), kind,
      bind_addr: bindAddr.trim(), bind_port: bindPort,
      remote_host: remoteHost.trim(), remote_port: remotePort,
      auto_start: autoStart,
    });
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-label="forward form">
      <div className="modal modal-form">
        <h2>{mode === 'create' ? 'Add forward' : 'Edit forward'}</h2>
        <div className="form-grid">
          <label htmlFor="ffm-name">Name</label>
          <input id="ffm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />

          <label htmlFor="ffm-host">Host</label>
          <select id="ffm-host" value={hostId} onChange={(e) => setHostId(e.target.value)}>
            <option value="">Select a host…</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>

        <fieldset className="auth-method">
          <legend>Kind</legend>
          <label><input type="radio" name="kind" aria-label="local" checked={kind === 'local'} onChange={() => setKind('local')} /> Local</label>
          <label><input type="radio" name="kind" aria-label="remote" checked={kind === 'remote'} onChange={() => setKind('remote')} /> Remote</label>
        </fieldset>

        <p className="forward-section-title">{kind === 'local' ? 'Local bind' : 'Remote bind'}</p>
        <div className="form-grid">
          <label htmlFor="ffm-bind-addr">Bind address</label>
          <input id="ffm-bind-addr" value={bindAddr} onChange={(e) => setBindAddr(e.target.value)} />
          <label htmlFor="ffm-bind-port">Bind port</label>
          <input id="ffm-bind-port" type="number" min={1} max={65535} value={bindPort || ''}
            onChange={(e) => setBindPort(Number(e.target.value))} />
        </div>

        <p className="forward-section-title">{kind === 'local' ? 'Forward to' : 'Forward back to'}</p>
        <div className="form-grid">
          <label htmlFor="ffm-remote-host">Remote host</label>
          <input id="ffm-remote-host" value={remoteHost} onChange={(e) => setRemoteHost(e.target.value)} />
          <label htmlFor="ffm-remote-port">Remote port</label>
          <input id="ffm-remote-port" type="number" min={1} max={65535} value={remotePort || ''}
            onChange={(e) => setRemotePort(Number(e.target.value))} />
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          Auto-start when host is activated
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={submit} disabled={!valid}>Save</button>
        </div>
      </div>
    </div>
  );
}
