import './ui.css';

export type SpinnerProps = {
  /** Accessible text announced to screen readers (default "Loading"). */
  label?: string;
};

export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status">
      <span className="ui-spinner" aria-hidden="true" />
      <span className="ui-sr-only">{label}</span>
    </span>
  );
}
