// The "Options" card of the Business New delivery page (#863, the AI what-if advisor): after a request is
// read, the server tries a few variants of it on the engine (POST /api/v2/advise, #862) and this card lists
// them above the confirmation card, each with its price. Choosing one only sets the ready and deliver-by
// times of the form; the form's own button still sends (unchanged POST /api/v2/shipments).
// The card is an extra and never blocks the form (#880): while it waits it shows skeleton rows and a line
// that says what is happening; when the call fails or answers with no option it says so in one plain
// sentence, and that the request can still be sent.
import { useEffect, useId, useMemo, useState } from 'react';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import {
  ADVICE_COPY, WAITING_ROWS, adviceCard, appliedText, chosenKey, noOptionsText, optionName,
  type AdviseCall, type AdviseDraft,
} from './adviceModel';
import { sameTimes, type DraftTimes } from './newDeliveryModel';
import './newDelivery.css';

export type AdviceOptionsProps = {
  /** The request to ask options for (`adviseDraft`). Read once, when the card mounts: give it a new `key` for another request. */
  draft: AdviseDraft;
  businesses: NetworkBusiness[];
  advise: AdviseCall;
  /**
   * The times the form holds now: the row with the same times is marked as the one in the form. Null while
   * the form is about another recipient than `draft`; the card is then not drawn (its prices are not for
   * that request) and comes back with the recipient.
   */
  current: DraftTimes | null;
  /** A press on an option: the page puts these times in the form. */
  onChoose: (times: DraftTimes) => void;
};

type Answer = { kind: 'loading' } | { kind: 'answer'; body: unknown } | { kind: 'failed' };

export function AdviceOptions(p: AdviceOptionsProps) {
  const base = useId();
  const [draft] = useState(p.draft);
  const [answer, setAnswer] = useState<Answer>({ kind: 'loading' });
  /** The times of the last press. Its line is shown while the form still holds them. */
  const [pressed, setPressed] = useState<DraftTimes | null>(null);
  const { advise } = p;

  // One call per card. A card that goes away (Edit request, Cancel, a sent delivery) aborts it, so a late
  // answer changes nothing.
  useEffect(() => {
    const controller = new AbortController();
    advise(draft, { signal: controller.signal }).then(
      (body) => { if (!controller.signal.aborted) setAnswer({ kind: 'answer', body }); },
      () => { if (!controller.signal.aborted) setAnswer({ kind: 'failed' }); },
    );
    return () => { controller.abort(); };
  }, [advise, draft]);

  const card = useMemo(
    () => (answer.kind === 'answer' ? adviceCard(answer.body, { draft, businesses: p.businesses }) : null),
    [answer, draft, p.businesses],
  );

  // The form is about another recipient: these prices are not for it.
  if (p.current === null) return null;

  const loading = answer.kind === 'loading';
  // No rows to show: the call failed, or the answer holds no option the page can show.
  const problem = loading || card ? '' : answer.kind === 'answer' ? noOptionsText(answer.body) : ADVICE_COPY.failed;
  const chosen = card ? chosenKey(card, p.current) : null;
  const applied = pressed && sameTimes(pressed, p.current) ? appliedText(pressed) : '';

  return (
    <section className="nd-options" aria-labelledby={`${base}-title`} aria-busy={loading || undefined}>
      <h2 className="nd-options__title" id={`${base}-title`}>{ADVICE_COPY.title}</h2>
      {/* One line, polite, and in the page before its text changes: what the card is waiting for, then who
          made the options (an offline answer says so in plain words), or the one sentence about a call
          that failed or found nothing. */}
      <p className="nd-options__status" role="status">
        {loading ? ADVICE_COPY.loadingLine : card ? card.sourceLine : problem}
      </p>
      {loading && (
        <ul className="nd-options__list" aria-hidden="true">
          {Array.from({ length: WAITING_ROWS }, (_, i) => (
            <li key={i} className="nd-option nd-option--skeleton">
              <span className="nd-skeleton nd-skeleton--label" />
              <span className="nd-skeleton nd-skeleton--line" />
            </li>
          ))}
        </ul>
      )}
      {card && (
        <>
          <ul className="nd-options__list">
            {card.rows.map((r) => {
              const isChosen = r.key === chosen;
              return (
                <li key={r.key} className={`nd-option${isChosen ? ' nd-option--chosen' : ''}`}>
                  <div className="nd-option__top">
                    <h3 className="nd-option__label">{r.label}</h3>
                    <p className="nd-option__price">
                      {r.cheapest && <><span className="nd-option__tag nd-option__tag--ok">{ADVICE_COPY.cheapest}</span>{' '}</>}
                      <span className="nd-mono nd-option__cents">{r.priceText}</span>
                    </p>
                  </div>
                  {r.summary && <p className="nd-option__summary">{r.summary}</p>}
                  <dl className="nd-option__facts">
                    <div className="nd-option__fact">
                      <dt>Arrives</dt>
                      <dd className="nd-mono">{r.arrivalText}</dd>
                    </div>
                    <div className="nd-option__fact">
                      <dt>Route</dt>
                      <dd>{r.routeText}</dd>
                    </div>
                    <div className="nd-option__fact">
                      <dt>{ADVICE_COPY.extra}</dt>
                      <dd className="nd-mono">{r.extraText}</dd>
                    </div>
                    {r.carriersText && (
                      <div className="nd-option__fact">
                        <dt>Carried by</dt>
                        <dd>{r.carriersText}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="nd-option__foot">
                    {/* One stop per option. Its name holds the option and its price (#880). The option the
                        form holds says so on the button itself: a "Choose this option" on what is chosen
                        already read as one more thing to press before sending. */}
                    <button type="button" className="nd-btn nd-option__choose" aria-pressed={isChosen}
                      aria-label={optionName(r, isChosen)}
                      onClick={() => { p.onChoose(r.times); setPressed(r.times); }}>
                      {isChosen ? ADVICE_COPY.chosen : ADVICE_COPY.choose}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {card.note && <p className="nd-options__hint">{card.note}</p>}
          <p className="nd-options__hint">{card.rows.length > 1 ? ADVICE_COPY.hint : ADVICE_COPY.hintSingle}</p>
          <p className="nd-options__applied" aria-live="polite">{applied}</p>
        </>
      )}
    </section>
  );
}
