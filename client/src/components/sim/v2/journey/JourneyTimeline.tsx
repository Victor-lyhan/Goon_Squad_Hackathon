// Right panel of package journey mode: the numbered steps (same numbers as the map's stop markers),
// each a button that seeks the simulation to that moment and pans the map to that place.
import { formatMin } from '../../../../ui/format';
import type { JourneyResult, JourneyStep, StepState } from './journeyModel';
import './journey.css';

export type JourneyTimelineProps = {
  journey: JourneyResult;
  onSeek: (timeMin: number, placeId: string) => void;
};

const STATE_TEXT: Record<StepState, string> = { done: 'Done', current: 'Next', upcoming: 'Upcoming' };

function extraText(min: number): string {
  return Number.isFinite(min) ? `+${Math.max(0, Math.round(min))} min extra` : 'Extra time unavailable';
}

function timeText(min: number): string {
  return Number.isFinite(min) ? formatMin(min) : 'Time unavailable';
}

function Step({ step, onSeek }: { step: JourneyStep; onSeek: JourneyTimelineProps['onSeek'] }) {
  const tone = step.legIndex === 0 ? 'leg1' : 'leg2';
  return (
    <li className={`jt-step jt-step--${step.state}`}>
      <button
        type="button"
        className="jt-step__button"
        aria-current={step.state === 'current' ? 'step' : undefined}
        onClick={() => onSeek(step.timeMin, step.placeId)}
      >
        <span className={`jt-step__n jt-step__n--${tone}`} aria-hidden="true">{step.n}</span>
        <span className="jt-step__body">
          <span className="jt-step__head">
            <span className="jt-step__label">
              <span className="jt-sr">Step {step.n}: </span>
              {step.label}
            </span>
            <span className="jt-step__state">{STATE_TEXT[step.state]}</span>
          </span>
          <span className="jt-step__place">{step.placeName}</span>
          <span className="jt-step__meta">
            <span>{timeText(step.timeMin)}</span>
            <span>{step.carrierName}</span>
            <span>{extraText(step.extraMin)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function JourneyTimeline({ journey, onSeek }: JourneyTimelineProps) {
  if (journey.kind === 'unmatched') {
    return (
      <section className="jt" aria-label="Package journey">
        <header className="jt__header">
          <h2 className="jt__title">{journey.title}</h2>
          <p className="jt__status">
            <span className="jt__status-label">Status</span> <strong>Unmatched</strong>
          </p>
        </header>
        <p className="jt__reason">{journey.reason}</p>
      </section>
    );
  }
  return (
    <section className="jt" aria-label="Package journey">
      <header className="jt__header">
        <h2 className="jt__title">{journey.title}</h2>
        <p className="jt__kind">{journey.planKind === 'relay' ? 'Relay through a network business' : 'Direct'}</p>
        <p className="jt__status" aria-live="polite">
          <span className="jt__status-label">Status</span> <strong>{journey.statusLabel}</strong>
        </p>
      </header>
      <ol className="jt__steps">
        {journey.steps.map((s) => (
          <Step key={s.n} step={s} onSeek={onSeek} />
        ))}
      </ol>
    </section>
  );
}
