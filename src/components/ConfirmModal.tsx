interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmModal({
  title, message, confirmLabel = 'OK', cancelLabel = 'Cancel',
  onConfirm, onCancel, destructive,
}: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-label={title}>
      <div className={`modal ${destructive ? 'modal-warning' : ''}`}>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
