import { useState, type InputHTMLAttributes } from 'react';
import { ConcealIcon, RevealIcon } from './AppIcons';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function SecretInput({ id, ...props }: Props) {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? 'Hide secret' : 'Show secret';

  return (
    <div className="secret-input-wrap">
      <input id={id} {...props} type={revealed ? 'text' : 'password'} />
      <button
        type="button"
        className="secret-toggle"
        aria-label={label}
        aria-controls={id}
        aria-pressed={revealed}
        title={label}
        onClick={() => setRevealed((value) => !value)}
        disabled={props.disabled}
      >
        {revealed ? <ConcealIcon size={15} /> : <RevealIcon size={15} />}
      </button>
    </div>
  );
}
