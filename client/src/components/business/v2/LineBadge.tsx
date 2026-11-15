// The line badge of a delivery plan (#956): the plan's words ("Direct", "Relay via Etsy") behind a small
// route line, drawn like the line marks of a transit map. Used by the Options card and by the Plan column of
// the deliveries list, so the two read the same. The drawing is decoration: the words say everything.
import type { ReactNode } from 'react';
import './lineBadge.css';

export type LineBadgeProps = {
  /** One carrier (one run) or two carriers with a relay point between them (two runs, an open station). */
  kind: 'direct' | 'relay';
  /** The plan in words. */
  children: ReactNode;
};

export function LineBadge({ kind, children }: LineBadgeProps) {
  return (
    <span className={`lb-badge lb-badge--${kind}`}>
      <span className="lb-mark" aria-hidden="true">
        <span className="lb-stop" />
        <span className="lb-run" />
        {kind === 'relay' && (
          <>
            <span className="lb-stop lb-stop--relay" />
            <span className="lb-run lb-run--second" />
          </>
        )}
        <span className="lb-stop" />
      </span>
      <span className="lb-text">{children}</span>
    </span>
  );
}
