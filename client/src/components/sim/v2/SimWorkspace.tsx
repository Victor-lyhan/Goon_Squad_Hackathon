import { useEffect, useReducer, useRef, useState, type ReactNode, type Ref } from 'react';
import { INITIAL_PANELS, panelReducer, workspaceKeyAction, type PanelState } from './workspaceModel';
import './SimWorkspace.css';

export type SimWorkspaceJourney = { title: string; onExit: () => void };

export type SimWorkspaceProps = {
  map: ReactNode;
  left: ReactNode;
  right: ReactNode;
  onClearSelection?: () => void;
  /** Package journey mode: shows the package title and "Back to network" at the top of the left panel. */
  journey?: SimWorkspaceJourney;
  /** Starting panel state (both open by default). */
  initialPanels?: PanelState;
};

export const LEFT_BODY_ID = 'sim-v2-left-body';
export const RIGHT_BODY_ID = 'sim-v2-right-body';

type PanelProps = {
  side: 'left' | 'right';
  title: string;
  open: boolean;
  bodyId: string;
  onToggle: () => void;
  toggleRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
};

function Panel({ side, title, open, bodyId, onToggle, toggleRef, children }: PanelProps) {
  // The chevron points the way the panel will move: toward its edge to collapse, away to expand.
  const towardEdge = side === 'left' ? '‹' : '›';
  const awayFromEdge = side === 'left' ? '›' : '‹';
  return (
    <aside className={`sw-panel sw-${side}${open ? '' : ' is-collapsed'}`} aria-label={`${title} panel`}>
      <div className="sw-panel-head">
        <button
          ref={toggleRef}
          type="button"
          className="sw-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          title={`${open ? 'Collapse' : 'Expand'} ${title.toLowerCase()} panel`}
          onClick={onToggle}
        >
          <span className="sw-toggle-icon" aria-hidden="true">{open ? towardEdge : awayFromEdge}</span>
          <span className="sw-toggle-text">{title}</span>
        </button>
      </div>
      <div id={bodyId} className="sw-panel-body" hidden={!open}>
        {children}
      </div>
    </aside>
  );
}

export function SimWorkspace({ map, left, right, onClearSelection, journey, initialPanels }: SimWorkspaceProps) {
  const [panels, dispatch] = useReducer(panelReducer, initialPanels ?? INITIAL_PANELS);
  const inJourney = !!journey;

  // #631: the journey timeline lives only in the right panel, so entering a journey opens a collapsed
  // Inspector (the one Play/Pause button floats on the map since #831). Adjusted during render, so
  // no frame shows the journey without its timeline.
  // Only the step from no journey to a journey opens it: another package, or a panel the user
  // collapses during the journey, is left as it is. The width change is the usual toggle's, so the
  // CSS transition (none with reduced motion) applies.
  const [wasInJourney, setWasInJourney] = useState(inJourney);
  if (inJourney !== wasInJourney) {
    setWasInJourney(inJourney);
    if (inJourney && !panels.rightOpen) dispatch({ type: 'toggleRight' });
  }

  // #631: both "Back to network" buttons unmount when the journey ends, which drops keyboard focus
  // to <body>. Put it on the left panel's toggle (always mounted, collapsed or not). Focus that is
  // on any other element is left alone.
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const hadJourney = useRef(inJourney);
  useEffect(() => {
    const ended = hadJourney.current && !inJourney;
    hadJourney.current = inJourney;
    if (!ended) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    leftToggleRef.current?.focus();
  }, [inJourney]);

  // Latest callbacks in a ref so the window listener is attached once.
  const latest = useRef({ onClearSelection, journey });
  latest.current = { onClearSelection, journey };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { journey: j, onClearSelection: clear } = latest.current;
      const action = workspaceKeyAction(
        { key: e.key, defaultPrevented: e.defaultPrevented, target: e.target as HTMLElement | null },
        { inJourney: !!j },
      );
      if (action === 'exit_journey') j?.onExit();
      else if (action === 'clear_selection') clear?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="sim-v2">
      <div className="sw-frame">
        <Panel side="left" title="Controls" open={panels.leftOpen} bodyId={LEFT_BODY_ID}
          onToggle={() => dispatch({ type: 'toggleLeft' })} toggleRef={leftToggleRef}>
          {journey && (
            <div className="sw-journey">
              <div className="sw-eyebrow">Package journey</div>
              <div className="sw-journey-title">{journey.title}</div>
              <button type="button" className="sw-btn" onClick={journey.onExit}>
                <span aria-hidden="true">← </span>Back to network
              </button>
            </div>
          )}
          {left}
        </Panel>
        <div className="sw-map" role="region" aria-label="Map">
          {map}
        </div>
        <Panel side="right" title="Inspector" open={panels.rightOpen} bodyId={RIGHT_BODY_ID}
          onToggle={() => dispatch({ type: 'toggleRight' })}>
          {right}
        </Panel>
      </div>
      <div className="sw-narrow" role="note">
        <p>Open the simulator on a desktop-size screen.</p>
      </div>
    </div>
  );
}
