interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  /** When true, both buttons are disabled and the confirm button shows
   *  a spinner. Use while the parent is awaiting a network round-trip
   *  (e.g. sync-aware delete) so the user knows the click registered. */
  loading?: boolean;
  /** Override label shown in the confirm button while `loading` is true.
   *  Defaults to `${confirmLabel}…`. */
  loadingLabel?: string;
}

export function ConfirmModal({
  title, message, confirmLabel = 'OK', cancelLabel = 'Cancel',
  onConfirm, onCancel, destructive, loading, loadingLabel,
}: Props) {
  const buttonLabel = loading ? (loadingLabel ?? `${confirmLabel}…`) : confirmLabel;
  return (
    <div className="modal-backdrop" role="dialog" aria-label={title} aria-busy={loading}>
      <div className={`modal ${destructive ? 'modal-warning' : ''}`}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button
            type="button"
            className={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="db-spinner inline-spinner" aria-hidden />}
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
