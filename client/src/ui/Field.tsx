import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import './ui.css';

export type FieldProps = {
  /** Visible label text. */
  label: ReactNode;
  /** The input element (input/select/textarea); gets id and aria props injected. */
  children: ReactElement<Record<string, unknown>>;
  /** Helper text shown under the input. */
  hint?: ReactNode;
  /** Inline error message; marks the input invalid. */
  error?: ReactNode;
};

export function Field({ label, children, hint, error }: FieldProps) {
  const uid = useId();
  const inputId = (children.props.id as string | undefined) ?? `${uid}-input`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ui-field${error ? ' ui-field--invalid' : ''}`}>
      <label className="ui-field__label" htmlFor={inputId}>{label}</label>
      {cloneElement(children, { id: inputId, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <div className="ui-field__hint" id={hintId}>{hint}</div>}
      {error && <div className="ui-field__error" id={errorId} role="alert">{error}</div>}
    </div>
  );
}
