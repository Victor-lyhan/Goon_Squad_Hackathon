import type { ButtonHTMLAttributes } from 'react';
import './ui.css';
import { Spinner } from './Spinner';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Visual style (default "primary"). */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Shows a spinner and blocks clicks while true. */
  loading?: boolean;
};

export function Button({ variant = 'primary', loading = false, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`ui-btn ui-btn--${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner label="Working" />}
      {children}
    </button>
  );
}
