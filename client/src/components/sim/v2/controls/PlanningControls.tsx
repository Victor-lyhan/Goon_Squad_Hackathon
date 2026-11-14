import { useId } from 'react';
import type { Phase } from '../../../../../../shared/v2/types';
import { PLANNING_NOTE, toPlanningView } from './controlsModel';
import './controls.css';

export type PlanningControlsProps = {
  phase: Phase;
  busy?: boolean;
  onReset(): void;
  onRecompute(): void;
};

/**
 * Planning cycle block. Start new planning cycle is always enabled (it is the only way to unlock);
 * Recompute is refused while locked. Neither asks for confirmation (DECISIONS pass 10).
 */
export function PlanningControls({ phase, busy = false, onReset, onRecompute }: PlanningControlsProps) {
  const v = toPlanningView(phase, busy);
  const reasonId = `${useId()}-recompute`;
  return (
    <div className="ctl-block ctl-planning">
      <p className="ctl-phase">
        Phase <span className={`ctl-mono ctl-phase-tag is-${phase}`}>{v.phaseLabel}</span>
      </p>
      <p className="ctl-note">{PLANNING_NOTE}</p>
      <button type="button" className="ctl-btn ctl-primary ctl-wide" onClick={onReset}>
        Start new planning cycle
      </button>
      <button type="button" className="ctl-btn ctl-wide" disabled={v.recomputeDisabled !== null}
        title={v.recomputeDisabled ?? undefined} aria-describedby={v.recomputeDisabled ? reasonId : undefined}
        onClick={onRecompute}>
        Recompute matches
      </button>
      {v.recomputeDisabled && <p className="ctl-note" id={reasonId}>{v.recomputeDisabled}</p>}
    </div>
  );
}
