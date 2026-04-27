interface Props {
  host: string;
  fingerprint: string;
  keyType: string;
  isMismatch?: boolean;
  expected?: string;
  onAccept: () => void;
  onCancel: () => void;
}

export function HostFingerprintPrompt(props: Props) {
  const { host, fingerprint, keyType, isMismatch, expected, onAccept, onCancel } = props;
  return (
    <div className="modal-backdrop" role="dialog" aria-label="host fingerprint">
      <div className={`modal ${isMismatch ? 'modal-warning' : ''}`}>
        <h2>{isMismatch ? '⚠ Host key changed' : 'New host'}</h2>
        <p>
          {isMismatch
            ? `The fingerprint of ${host} does not match the one previously trusted.`
            : `${host} is not in your known_hosts. Verify the fingerprint with the server admin before trusting.`}
        </p>
        <dl className="fingerprint">
          <dt>Type</dt><dd>{keyType}</dd>
          <dt>Fingerprint</dt><dd className="mono">{fingerprint}</dd>
          {expected && <><dt>Previously trusted</dt><dd className="mono">{expected}</dd></>}
        </dl>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={onAccept}>
            {isMismatch ? 'Reset and accept' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
