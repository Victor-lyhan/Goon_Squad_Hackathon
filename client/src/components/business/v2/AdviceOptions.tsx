// The "Options" card of the Business New delivery page (#863, the AI what-if advisor): after a request is
// read, the server tries a few variants of it on the engine (POST /api/v2/advise, #862) and this card lists
// them above the confirmation card, each with its price. Choosing one only sets the ready and deliver-by
// times of the form; the form's own button still sends (unchanged POST /api/v2/shipments).
// A row starts with what the server marks the option as (#960): small badges, Fastest, Cheapest, Recommended
// or Balanced, then its price as the row's large figure with the arrival time, and one sentence under them
// (for a recommended option, why it is recommended). The card does not say who made the options.
// The card is an extra and never blocks the form (#880): while it waits it shows skeleton rows and a line
// that says what is happening. It explains itself instead of going away (#948): an answer with no option
// stays as the server's sentence in one plain line, with the names of the form fields the options still wait
// for under it, and the card asks again by itself (after a short pause) once the recipient or a time in the
// form changes. Only a call that got no answer at all (no network) hides it.
import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import type { NetworkBusiness } from '../../../../../shared/v2/types';
import {
  ADVICE_COPY, REASK_DELAY_MS, WAITING_ROWS, adviceCard, adviceFailure, appliedText, askKey, askTimes, chosenKey,
  noOptions, optionName, type AdviceFailure, type AdviseAsk, type AdviseCall,
} from './adviceModel';
import { sameTimes, type DraftTimes } from './newDeliveryModel';
import './newDelivery.css';

export type AdviceOptionsProps = {
  /**
   * The request as the form holds it now (`adviseAsk`). The card asks about it once, when it mounts (give it
   * a new `key` for another read request). While it has no option to show, a change of the recipient or of a
   * time asks again; with options on screen it never does: they stay the options of the request as it was read.
   */
  request: AdviseAsk;
  /**
   * The sentence the request was read from (#960). It goes to the server with every call, which reads from it
   * what the sender cares about when it marks an option Recommended. The card itself never shows it.
   */
  sentence?: string;
  businesses: NetworkBusiness[];
  advise: AdviseCall;
  /** A press on an option: the page puts these times in the form. */
  onChoose: (times: DraftTimes) => void;
};

type Answer =
  | { kind: 'loading' }
  | { kind: 'answer'; body: unknown }
  /** The call was rejected: the server answered with an error, or there was no answer at all (the card is hidden). */
  | AdviceFailure;

const LOADING: Answer = { kind: 'loading' };

export function AdviceOptions(p: AdviceOptionsProps) {
  const base = useId();
  /** The request of the last call: the rows and the sentence on screen are about this one. */
  const [asked, setAsked] = useState(p.request);
  const [answer, setAnswer] = useState<Answer>(LOADING);
  /** The times of the last press. Its line is shown while the form still holds them. */
  const [pressed, setPressed] = useState<DraftTimes | null>(null);
  const { advise, request, sentence } = p;

  // One call per asked request. A card that goes away (Edit request, Cancel, a sent delivery) or asks again
  // aborts it, so a late answer changes nothing.
  useEffect(() => {
    const controller = new AbortController();
    advise(asked, sentence ? { signal: controller.signal, text: sentence } : { signal: controller.signal }).then(
      (body) => { if (!controller.signal.aborted) setAnswer({ kind: 'answer', body }); },
      (error) => { if (!controller.signal.aborted) setAnswer(adviceFailure(error)); },
    );
    return () => { controller.abort(); };
  }, [advise, asked, sentence]);

  const card = useMemo(
    () => (answer.kind === 'answer' ? adviceCard(answer.body, { draft: asked, businesses: p.businesses }) : null),
    [answer, asked, p.businesses],
  );

  // No option on screen, and the form now holds another recipient or time than the one asked about (the user
  // filled in what was missing, or moved the deadline): ask again, once the typing has paused.
  const reask = answer.kind !== 'loading' && !card && askKey(request) !== askKey(asked);
  useEffect(() => {
    if (!reask) return undefined;
    const timer = setTimeout(() => { setAnswer(LOADING); setAsked(request); }, REASK_DELAY_MS);
    return () => { clearTimeout(timer); };
  }, [reask, request]);

  const waiting = answer.kind === 'loading' || reask;
  // The call got no answer: the card is not drawn, and the form is the one of before the card.
  if (answer.kind === 'no_answer' && !waiting) return null;
  // The form is about another recipient than the options on screen: their prices are not for it. The card
  // comes back with the recipient.
  if (card && request.destinationBusinessId !== asked.destinationBusinessId) return null;

  const current = askTimes(request);
  // No rows to show: why, in one line, and which fields of the form the options wait for.
  const none = waiting || card ? null
    : noOptions(answer.kind === 'answer' ? answer.body : null, request, answer.kind === 'failed' ? answer.refused : {});
  const chosen = card ? chosenKey(card, current) : null;
  const applied = pressed && current && sameTimes(pressed, current) ? appliedText(pressed) : '';

  return (
    <section className="nd-options" aria-labelledby={`${base}-title`} aria-busy={waiting || undefined}>
      <h2 className="nd-options__title" id={`${base}-title`}>{ADVICE_COPY.title}</h2>
      {/* One line, polite, and in the page before its text changes: what the card is waiting for, or the
          one sentence about a request with no option (the server's own) or a call that failed. It is empty,
          and takes no room, once the options are there: the rows speak for themselves (#960). */}
      <p className={`nd-options__status${none ? ' nd-options__status--note' : ''}`} role="status">
        {waiting ? ADVICE_COPY.loadingLine : none?.note}
      </p>
      {none && none.fields.length > 0 && (
        <p className="nd-options__needed">
          {none.lead}{' '}
          {none.fields.map((name, i) => (
            <Fragment key={name}>{i > 0 && ', '}<strong className="nd-options__need">{name}</strong></Fragment>
          ))}
        </p>
      )}
      {none?.next && <p className="nd-options__hint">{none.next}</p>}
      {waiting && (
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
                    <div className="nd-option__head">
                      {/* What the option is marked as (#960), in words: the colour of a badge only adds to it.
                          The space between two badges keeps them two words for a screen reader. */}
                      {r.tags.length > 0 && (
                        <p className="nd-option__tags">
                          {r.tags.map((tag, i) => (
                            <Fragment key={tag}>
                              {i > 0 && ' '}
                              <span className={`nd-option__tag nd-option__tag--${tag}`}>{ADVICE_COPY[tag]}</span>
                            </Fragment>
                          ))}
                        </p>
                      )}
                      <h3 className="nd-option__label">{r.label}</h3>
                    </div>
                    {/* The price is the row's large figure, with the arrival time under it. */}
                    <div className="nd-option__deal">
                      <p className="nd-option__price"><span className="nd-mono nd-option__cents">{r.priceText}</span></p>
                      <dl className="nd-option__arrives">
                        <dt>Arrives</dt>
                        <dd className="nd-mono">{r.arrivalText}</dd>
                      </dl>
                    </div>
                  </div>
                  {r.summary && <p className="nd-option__summary">{r.summary}</p>}
                  <dl className="nd-option__facts">
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
