// Right panel of package journey mode: the numbered steps (same numbers as the map's stop markers),
// each a button that seeks the simulation to that moment and pans the map to that place. Under the
// header: the planned delivery time (and the delivered time once the snapshot has it) and one line
// per leg with its carrier, home neighbourhood, extra minutes and reward. All read from the plan and
// the snapshot by journeyModel.ts; nothing is computed here. The extra minutes are the leg's own
// value with its sign, as in the employee inspector (DECISIONS pass 62): "-3 min extra" for a shorter route.
import { formatCents, formatMin } from '../../../../ui/format';
import { formatExtraMin } from '../inspector/inspectorModel';
import { SHIPMENT_STATUS_TEXT } from '../packages/statusText';
import type { Journey, JourneyCarrier, JourneyResult, JourneyStep, StepState } from './journeyModel';
import './journey.css';

export type JourneyTimelineProps = {
  journey: JourneyResult;
  onSeek: (timeMin: number, placeId: string) => void;
};

const STATE_TEXT: Record<StepState, string> = { done: 'Done', current: 'Next', upcoming: 'Upcoming' };

function extraText(min: number): string {
  return typeof min === 'number' && Number.isFinite(min) ? `${formatExtraMin(min)} extra` : 'Extra time unavailable';
}

function timeText(min: number): string {
  return Number.isFinite(min) ? formatMin(min) : 'Time unavailable';
}

function rewardText(cents: number): string {
  return Number.isFinite(cents) ? `${formatCents(cents)} reward` : 'Reward unavailable';
}

function Times({ journey }: { journey: Journey }) {
  return (
    <>
      <p className="jt__time jt__time--planned">
        <span className="jt__status-label">Planned delivery</span> <strong>{timeText(journey.deliveryMin)}</strong>
      </p>
      {journey.deliveredAtMin !== null && (
        <p className="jt__time jt__time--delivered">
          <span className="jt__status-label">Delivered</span> <strong>{timeText(journey.deliveredAtMin)}</strong>
        </p>
      )}
    </>
  );
}

function LegLine({ carrier }: { carrier: JourneyCarrier }) {
  return (
    <li className={`jt-leg jt-leg--${carrier.tone}`}>
      <span className="jt-leg__n">Leg {carrier.legIndex + 1}</span>
      <span className="jt-leg__name">{carrier.name}</span>
      <span className="jt-leg__home">from {carrier.homeNeighborhood}</span>
      <span className="jt-leg__extra">{extraText(carrier.extraMin)}</span>
      <span className="jt-leg__reward">{rewardText(carrier.rewardCents)}</span>
    </li>
  );
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
            <span className="jt__status-label">Status</span> <strong>{SHIPMENT_STATUS_TEXT.unmatched}</strong>
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
        <Times journey={journey} />
      </header>
      <ul className="jt__legs" aria-label="Carriers">
        {journey.carriers.map((c) => (
          <LegLine key={c.legIndex} carrier={c} />
        ))}
      </ul>
      <ol className="jt__steps">
        {journey.steps.map((s) => (
          <Step key={s.n} step={s} onSeek={onSeek} />
        ))}
      </ol>
    </section>
  );
}
