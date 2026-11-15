// The simulator page before it has a run to show (#894): the first load, and a first load that failed.
//
// Both are drawn in the workspace's own frame (the two panels and the map area of `SimWorkspace`), so
// the page is never blank and nothing moves when the first poll lands: the panels hold quiet
// placeholder rows where the package list and the run summary will be, and the map area holds the one
// line that says what is going on. The frame is the same for both states; only that line changes.
//
// Nothing is fetched or computed here. The poll keeps running under both states (useSimulatorV2), so
// the page fills in by itself; "Retry now" only asks for the next poll at once.
import { Button, Spinner } from '../../../../ui';
import { PanelSection } from '../PanelSection';
import { SimWorkspace } from '../SimWorkspace';
import './states.css';

export const RETRY_NOW_TEXT = 'Retry now';

export type SimStateFrameProps =
  /** Before the first poll has an answer. */
  | { kind: 'loading'; text: string }
  /** The first poll failed: one sentence, and a button that polls now. */
  | { kind: 'error'; text: string; onRetry: () => void };

/** Placeholder rows shaped like the package list: a name and, under it, a route. Decoration only. */
function ListRows({ count }: { count: number }) {
  return (
    <ul className="sps-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="sps-row">
          <span className="sps-bar sps-bar--name" />
          <span className="sps-bar sps-bar--route" />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder rows shaped like the run summary: a label on the left, a number on the right. */
function SummaryRows({ count }: { count: number }) {
  return (
    <ul className="sps-rows sps-rows--summary" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="sps-row sps-row--pair">
          <span className="sps-bar sps-bar--label" />
          <span className="sps-bar sps-bar--value" />
        </li>
      ))}
    </ul>
  );
}

export function SimStateFrame(props: SimStateFrameProps) {
  const map = (
    // `.spc-state` (compose.css) centers its panel; states.css keeps it inside the map area.
    <div className="spc-state sps-map" data-state={props.kind}>
      {props.kind === 'loading' ? (
        <div className="spc-state__panel spc-state__panel--loading">
          <Spinner label={props.text} />
          <span aria-hidden="true">{props.text}</span>
        </div>
      ) : (
        <div className="spc-state__panel" role="alert">
          <p className="spc-state__message">{props.text}</p>
          <Button variant="secondary" onClick={props.onRetry}>{RETRY_NOW_TEXT}</Button>
        </div>
      )}
    </div>
  );
  return (
    <SimWorkspace
      left={<PanelSection title="Packages"><ListRows count={5} /></PanelSection>}
      map={map}
      right={<div className="sps-summary"><SummaryRows count={3} /></div>}
    />
  );
}
