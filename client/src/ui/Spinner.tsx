import './ui.css';

export type SpinnerProps = {
  /** What is loading, for screen readers (default "Loading"). The ring itself is hidden from them. */
  label?: string;
};

/**
 * A turning ring with a text name. role="status" makes the name a polite announcement; the ring stops
 * turning under prefers-reduced-motion (ui.css) and is then drawn dotted, so it still reads as "busy".
 */
export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status">
      <span className="ui-spinner" aria-hidden="true" />
      <span className="ui-sr-only">{label}</span>
    </span>
  );
}
