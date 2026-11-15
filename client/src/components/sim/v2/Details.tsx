// The simulator panels' "Details" toggle (#832): each item is one line, and its secondary detail
// (ids, exact minutes, extra steps, long explanations) sits under a real button, closed by default.
// The folded content stays in the page with the `hidden` attribute, so nothing is lost: every link
// and control in it is still there once the toggle is opened.
import { useId, useState, type ReactNode } from 'react';
import './SimWorkspace.css';

export const DETAILS_LABEL = 'Details';

export type DetailsToggleProps = {
  open: boolean;
  onToggle: () => void;
  /** The id (or ids, space separated) of what the button shows and hides. */
  controls: string;
  /** What the details are about; makes the button's name unique for a screen reader ("Details: Navy Yard"). */
  about?: string;
};

/** The button alone, for a list whose rows are buttons themselves (one toggle for all rows). */
export function DetailsToggle({ open, onToggle, controls, about }: DetailsToggleProps) {
  return (
    <button type="button" className="sw-details-toggle" aria-expanded={open} aria-controls={controls}
      aria-label={about ? `${DETAILS_LABEL}: ${about}` : undefined} onClick={onToggle}>
      <span className="sw-details-icon" aria-hidden="true">{open ? '−' : '+'}</span>
      {DETAILS_LABEL}
    </button>
  );
}

export type DetailsProps = { about?: string; children: ReactNode };

/** The button and what it folds. The open state is local, so a 1 s poll never closes it. */
export function Details({ about, children }: DetailsProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="sw-details">
      <DetailsToggle open={open} onToggle={() => setOpen((o) => !o)} controls={bodyId} about={about} />
      <div id={bodyId} className="sw-details-body" data-details-body="" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
