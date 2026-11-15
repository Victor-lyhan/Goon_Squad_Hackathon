// Right panel of package journey mode: the steps with the map's symbols (docs/mvp3.md P1 "Symbols
// instead of numbered events"): filled square = sender, diamond = relay ("Overnight · <relay>"),
// two-arrow swap = handoff ("Handed to <carrier B>"), flag = delivered, each with the map's short label.
// Each step is a button that seeks the simulation to that moment and pans the map to that place; its
// screen-reader name still starts "Step n:". Under the header: the planned delivery time (and the
// delivered time once the snapshot has it) and one line per carrier, "A · <name>" / "B · <name>" with the
// letter badge in the carrier's map colour (as JourneyLegend.tsx), home neighbourhood, extra minutes and
// reward. All read from the plan and the snapshot by journeyModel.ts; nothing is computed here. The
// extra minutes are the leg's own value with its sign (DECISIONS pass 62): "-3 min extra" for a shorter
// route. Colours come only from map/layers.ts.
import { formatCents, formatMin } from '../../../../ui/format';
import { RELAY_INK, toneLabelColor } from '../../../map/layers';
import type { RouteTone, StopSymbol } from '../../../map/types';
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

/** The map's symbol ink (RELAY_INK) as CSS. */
const INK = `rgb(${RELAY_INK[0]}, ${RELAY_INK[1]}, ${RELAY_INK[2]})`;

/** Inline SVG of the map's stop symbols (layers.ts SYMBOL_GLYPH: ■ ◆ ⇄ ⚑), drawn in the map's ink. */
export function StopSymbolIcon({ symbol }: { symbol: StopSymbol }) {
  const common = { width: 20, height: 20, viewBox: '0 0 20 20', focusable: 'false' as const, 'aria-hidden': true };
  switch (symbol) {
    case 'sender':
      return (
        <svg {...common} className="jt-sym jt-sym--sender" data-symbol="sender">
          <rect x="4" y="4" width="12" height="12" fill={INK} />
        </svg>
      );
    case 'relay':
      return (
        <svg {...common} className="jt-sym jt-sym--relay" data-symbol="relay">
          <polygon points="10,2 18,10 10,18 2,10" fill={INK} />
        </svg>
      );
    case 'swap':
      return (
        <svg {...common} className="jt-sym jt-sym--swap" data-symbol="swap">
          <path d="M3 7h12M12 4l3 3-3 3M17 13H5M8 10l-3 3 3 3" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="square" />
        </svg>
      );
    default:
      return (
        <svg {...common} className="jt-sym jt-sym--recipient" data-symbol="recipient">
          <path d="M5 2v16" stroke={INK} strokeWidth="2" />
          <polygon points="6,3 16,6.5 6,10" fill={INK} />
        </svg>
      );
  }
}

/** The carrier's letter badge in its map colour, as on its vehicle and in the journey legend. */
function LetterBadge({ tone, letter }: { tone: RouteTone; letter: string }) {
  return (
    <span className={`jt-badge jt-badge--${tone}`} aria-hidden="true" style={{ background: toneLabelColor(tone) }}>
      {letter}
    </span>
  );
}

function LegLine({ carrier }: { carrier: JourneyCarrier }) {
  return (
    <li className={`jt-leg jt-leg--${carrier.tone}`} style={{ borderLeftColor: toneLabelColor(carrier.tone) }}>
      <LetterBadge tone={carrier.tone} letter={carrier.letter} />
      <span className="jt-leg__name">
        {carrier.letter} · {carrier.name}
      </span>
      <span className="jt-leg__home">from {carrier.homeNeighborhood}</span>
      <span className="jt-leg__extra">{extraText(carrier.extraMin)}</span>
      <span className="jt-leg__reward">{rewardText(carrier.rewardCents)}</span>
    </li>
  );
}

/**
 * #718: at 1440 x 900 the last steps sit below the fold of the Inspector, so the step the package is
 * heading for scrolls into view ('nearest': no scroll when it is already shown). A callback ref on the
 * current step only, one function for the module: React calls it when a step becomes the current one,
 * not on every poll, so a reader who scrolled up is left alone. No hook, so Step stays a plain function.
 */
function showCurrentStep(el: HTMLLIElement | null): void {
  el?.scrollIntoView?.({ block: 'nearest' });
}

type StepProps = { step: JourneyStep; next: JourneyStep | undefined; onSeek: JourneyTimelineProps['onSeek'] };

function Step({ step, next, onSeek }: StepProps) {
  const tone: RouteTone = step.legIndex === 0 ? 'leg1' : 'leg2';
  // The rail to the next step is the carrier's colour while the same carrier has the package (the thick
  // line on the map); between legs (overnight at the relay point) it stays a thin grey rail.
  const carried = next !== undefined && next.legIndex === step.legIndex;
  return (
    <li ref={step.state === 'current' ? showCurrentStep : undefined} className={`jt-step jt-step--${step.state}`}>
      <button
        type="button"
        className="jt-step__button"
        aria-current={step.state === 'current' ? 'step' : undefined}
        onClick={() => onSeek(step.timeMin, step.placeId)}
      >
        {/* The map's symbol instead of a number. The step number stays in the DOM, visually hidden and
            hidden from screen readers (they read "Step n:" from the label), for the order checks. */}
        <span className={`jt-step__n jt-step__n--${tone} jt-step__n--${step.symbol}`} aria-hidden="true">
          <StopSymbolIcon symbol={step.symbol} />
          <span className="jt-sr">{step.n}</span>
        </span>
        <span className="jt-step__body">
          <span className="jt-step__head">
            <span className="jt-step__label">
              <span className="jt-sr">Step {step.n}: </span>
              {step.label}
            </span>
            <span className="jt-step__state">{STATE_TEXT[step.state]}</span>
          </span>
          <span className="jt-step__short">{step.symbolLabel}</span>
          {/* Shown only when the short label does not already name the place ("DUMBO Studio", "Overnight ·
              Brooklyn Roasting"); then it is visually hidden but still read with the step. */}
          <span className={`jt-step__place${step.symbolLabel.includes(step.placeName) ? ' jt-sr' : ''}`}>{step.placeName}</span>
          <span className="jt-step__meta">
            <span>{timeText(step.timeMin)}</span>
            <span>{step.carrierName}</span>
            <span>{extraText(step.extraMin)}</span>
          </span>
        </span>
      </button>
      {next !== undefined && (
        <span
          className={`jt-step__rail${carried ? ' jt-step__rail--carried' : ''}`}
          aria-hidden="true"
          style={carried ? { background: toneLabelColor(tone) } : undefined}
        />
      )}
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
        {journey.steps.map((s, i) => (
          <Step key={s.n} step={s} next={journey.steps[i + 1]} onSeek={onSeek} />
        ))}
      </ol>
    </section>
  );
}
