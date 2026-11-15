import {
  createContext, useContext, useEffect, useId, useReducer, useRef, useState,
  type FormEvent, type MouseEvent, type ReactNode, type Ref,
} from 'react';
import type { ShipmentResponse } from '../../../../../shared/v2/api';
import type { CreateShipmentRequest } from '../../../../../shared/v2/schemas';
import type { Employee, NetworkBusiness, PackageCategory, Phase } from '../../../../../shared/v2/types';
import { matchShipment as apiMatchShipment } from '../../../api/v2';
import {
  DEFAULT_WINDOW, NEEDS_INPUT_HINT, RESULT_COPY, arrangedCard, draftAfterResult, emptyDraft, firstInvalidField,
  firstNeedsInput, initialSubmitState, mapServerFieldErrors, newClientRequestId, recipientOptions, retryShipmentId, submitReducer,
  toRequest, validate, windowTimes,
  type ArrangedCard, type DraftField, type FieldErrors, type NewDeliveryDraft, type SubmitStatus, type TimeWindow,
} from './newDeliveryModel';
import './newDelivery.css';

type CarrierNames = Pick<Employee, 'id' | 'name'>[];
type MatchShipment = (shipmentId: string) => Promise<ShipmentResponse>;

/**
 * What the form needs from the workspace besides its props: the employee directory (carrier names of the
 * result card) and the re-match call. The route page provides it (pages/v2/BusinessV2.tsx), so the form
 * gets both without a change to the page component that mounts it. Props win over the context.
 */
export type NewDeliveryServices = { employees: CarrierNames; matchShipment: MatchShipment };
export const NewDeliveryServicesContext = createContext<NewDeliveryServices | null>(null);

export type NewDeliveryFormProps = {
  origin: NetworkBusiness;
  businesses: NetworkBusiness[];
  phase: Phase;
  /**
   * The version of the dashboard `phase` was read from. A 409 locks the form on its own, before the page
   * has polled; the lock is dropped when a dashboard that says `planning` arrives after it, and this is how
   * the form tells a new dashboard from the one it already had. Without it only a change of `phase` counts.
   */
  dashboardVersion?: number;
  onSubmit: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  /** "Try matching again" for a saved delivery. Default: the context's call, else POST /api/v2/shipments/:id/match. */
  onMatch?: MatchShipment;
  /** Names for the carriers of the result card. Default: the context's directory. */
  employees?: CarrierNames;
  onOpenDelivery: (shipmentId: string) => void;
  onCancel: () => void;
  /** Planning window (settings.simStartMin / simEndMin); defaults to Day 1, 3:30 PM to Day 2, 12:00 PM. */
  window?: TimeWindow;
  /**
   * The draft the form opens with (MVP IV F1: a parsed request, `draftFromParsed`). Read once, when the form
   * mounts: it is the user's draft from then on. Give the form a new `key` to open it with another one.
   */
  initialDraft?: NewDeliveryDraft;
  /**
   * The fields the request did not fill (`draftFromParsed`). Each shows a hint until the user edits it, and
   * the first one on screen gets focus when the form opens. Read once, like `initialDraft`.
   */
  needsInput?: readonly DraftField[];
};

const NO_EMPLOYEES: CarrierNames = [];

/** The answers to a press: every status but the idle form and the pending line. */
const ANSWERS: readonly SubmitStatus['kind'][] = ['matched', 'unmatched', 'locked', 'unavailable', 'error'];

/**
 * Brings the answer to a press on screen (#719). It is drawn between the fields and the buttons, so it pushes
 * the pressed button down: in a 900 px high window the whole "Delivery arranged" card landed below the fold
 * and the form only looked emptied. First the pressed button, which comes back to where it was (so nothing
 * else ends up under the pointer), then the answer itself, which wins on a short screen. `nearest` moves
 * nothing when both are in view already.
 */
export function revealAnswer(form: Element | null, kind: SubmitStatus['kind']): void {
  if (!form || !ANSWERS.includes(kind)) return;
  const answer = form.querySelector(kind === 'matched' || kind === 'unmatched' ? '.nd-result' : '.nd-alert');
  for (const el of [form.querySelector('.nd-actions button[type="submit"]'), answer]) {
    // Not in every DOM (jsdom has none).
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }
}

/** A pointer press on the form's submit button: when and where. */
export type Press = { time: number; x: number; y: number };
/** Two presses this close in time and place are one double press. */
export const REPEAT_PRESS_MS = 500;
export const REPEAT_PRESS_PX = 10;

type PressEvent = Pick<MouseEvent, 'detail' | 'target' | 'timeStamp' | 'clientX' | 'clientY'>;

const inside = (target: unknown, selector: string): boolean => {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest(selector) != null;
};

/**
 * The press to compare the next one with: a pointer press on the submit button, the one press whose answer
 * moves the form. Null for a key press or a scripted click (`detail` 0) and for a press anywhere else.
 */
export function pressOf(e: PressEvent, selector = 'button[type="submit"]'): Press | null {
  return e.detail >= 1 && inside(e.target, selector) ? { time: e.timeStamp, x: e.clientX, y: e.clientY } : null;
}

/**
 * True for the second press of a double press on a button that is no longer there (#807): "Read my request"
 * and "Fill in the form instead" turn the text box into this form, so the second press lands on whatever
 * the form has at that place. In Chrome that was the Recipient list, which opened over the card, or plain
 * text, which took the focus away from the first "Check this" field. `previous` is the press on the button
 * that went away (`pressOf(e, 'button')`); an echo is a pointer press on anything at the same place
 * (REPEAT_PRESS_PX) within REPEAT_PRESS_MS of it. A later press there is the user's own and is never dropped.
 */
export function isEchoPress(e: Pick<PressEvent, 'detail' | 'timeStamp' | 'clientX' | 'clientY'>, previous: Press | null): boolean {
  if (previous === null || e.detail < 1) return false;
  const near = Math.abs(e.clientX - previous.x) <= REPEAT_PRESS_PX && Math.abs(e.clientY - previous.y) <= REPEAT_PRESS_PX;
  const after = e.timeStamp - previous.time;
  return near && after >= 0 && after < REPEAT_PRESS_MS;
}

/**
 * True for the second press of a double press that began on the submit button (#719). The answer to the
 * first press moves the form under the pointer, so the second would press whatever button or link is there
 * now: the same button with the emptied draft (two "is required" errors under "Delivery arranged"), "View
 * delivery", "Watch in simulator" or Cancel. It is a press at the same place (REPEAT_PRESS_PX) that a mouse
 * counts as a further click (`detail` 2 or more) or, because a touch screen reports every tap as a first
 * click, that comes within REPEAT_PRESS_MS. Key presses (`detail` 0) and presses that follow no press on
 * the submit button are never dropped.
 */
export function isRepeatPress(e: PressEvent, previous: Press | null): boolean {
  if (previous === null || e.detail < 1 || !inside(e.target, 'button, a')) return false;
  const near = Math.abs(e.clientX - previous.x) <= REPEAT_PRESS_PX && Math.abs(e.clientY - previous.y) <= REPEAT_PRESS_PX;
  return near && (e.detail > 1 || e.timeStamp - previous.time < REPEAT_PRESS_MS);
}

/**
 * The New delivery form. The typed draft is local state: a re-render with equal props (a 1 s poll) never
 * resets it (DECISIONS pass 43). It starts over only when the sending business changes.
 */
export function NewDeliveryForm(props: NewDeliveryFormProps) {
  const { origin, onSubmit } = props;
  const services = useContext(NewDeliveryServicesContext);
  const onMatch = props.onMatch ?? services?.matchShipment ?? apiMatchShipment;
  const employees = props.employees ?? services?.employees ?? NO_EMPLOYEES;
  const [draft, setDraft] = useState<NewDeliveryDraft>(() => props.initialDraft ?? emptyDraft());
  // The listed fields the user has not edited yet. Empty without the prop, and then nothing below differs.
  const [unchecked, setUnchecked] = useState<readonly DraftField[]>(() => props.needsInput ?? []);
  const [draftOrigin, setDraftOrigin] = useState(origin.id);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [submitState, dispatch] = useReducer(submitReducer, origin.id, (id: string) => initialSubmitState(newClientRequestId(id)));
  const busy = useRef(false);
  /**
   * The control inside the form that had the focus when the request left (#807). The fields and the button
   * are disabled while it is on its way, and a browser drops the focus of a disabled control: in Chrome it
   * went to the page body, so after the answer a keyboard user started again from the top of the page.
   */
  const sentFrom = useRef<HTMLElement | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const fields = useRef<Partial<Record<DraftField, HTMLElement | null>>>({});
  const timeWindow = props.window ?? DEFAULT_WINDOW;

  // Another business: a fresh draft (adjusting state during render, so the old draft is never drawn for it).
  if (draftOrigin !== origin.id) {
    setDraftOrigin(origin.id);
    setDraft(emptyDraft());
    setUnchecked([]); // the prefill was the other business's request
    setClientErrors({});
    dispatch({ type: 'dismiss' });
  }

  // A new dashboard (adjusting state during render, like above): when it says planning, a 409's lock goes
  // with it, so the form reopens in the same poll as the toolbar's New delivery. The draft is not touched.
  const [seen, setSeen] = useState({ phase: props.phase, version: props.dashboardVersion });
  if (seen.phase !== props.phase || seen.version !== props.dashboardVersion) {
    setSeen({ phase: props.phase, version: props.dashboardVersion });
    dispatch({ type: 'dashboard', phase: props.phase });
  }

  const focusFirst = (errors: FieldErrors) => {
    const f = firstInvalidField(errors);
    if (f) fields.current[f]?.focus();
  };

  const change = <K extends keyof NewDeliveryDraft>(key: K, value: NewDeliveryDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // An edited field is the user's own value: its "not in your request" hint goes.
    if (unchecked.includes(key)) setUnchecked(unchecked.filter((f) => f !== key));
    // Once errors are on screen, they follow the typing (fixed fields clear right away).
    if (Object.keys(clientErrors).length > 0) setClientErrors(validate(next, origin.id, timeWindow));
  };

  // Set while the draft is unchanged since a no-match answer: the button then re-matches that delivery.
  const retryId = retryShipmentId(submitState, draft);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy.current || props.phase === 'locked') return; // a double click sends one request
    if (!retryId) {
      const errors = validate(draft, origin.id, timeWindow);
      setClientErrors(errors);
      if (firstInvalidField(errors)) { focusFirst(errors); return; }
    }
    busy.current = true;
    const sent = draft;
    const active = document.activeElement;
    sentFrom.current = active instanceof HTMLElement && form.current?.contains(active) ? active : null;
    dispatch({ type: retryId ? 'retry' : 'submit' });
    try {
      // A retry is the same delivery (never a second POST /shipments); only a new request gets a new ID.
      const response = retryId
        ? await onMatch(retryId)
        : await onSubmit(toRequest(sent, origin.id, submitState.clientRequestId));
      dispatch({ type: 'success', response, draft: sent, nextRequestId: retryId ? undefined : newClientRequestId(origin.id) });
      if (response.matched) {
        setDraft((d) => (d === sent ? draftAfterResult(d, { kind: 'matched' }) : d));
        setUnchecked([]); // the form starts a fresh package; the hints were about the one just sent
      }
    } catch (error) {
      dispatch({ type: 'failure', error });
      const server = (error as { status?: number; fieldErrors?: Record<string, string> } | null);
      // The fieldsets are disabled while submitting; focus once the error state has rendered.
      if (server?.status === 400) setTimeout(() => focusFirst(mapServerFieldErrors(server.fieldErrors)), 0);
    } finally {
      busy.current = false;
    }
  };

  const status = submitState.status;
  // Every answer is a new status object, so the same answer twice (a second no-match) is shown twice.
  useEffect(() => {
    revealAnswer(form.current, status.kind);
    if (!ANSWERS.includes(status.kind)) return;
    // The focus goes back to where it was, unless the user has put it somewhere else in the meantime.
    // Without scrolling: revealAnswer has just brought the answer on screen.
    const from = sentFrom.current;
    sentFrom.current = null;
    const active = document.activeElement;
    if (from?.isConnected && (active === null || active === document.body)) from.focus({ preventScroll: true });
  }, [status]);
  // A prefilled form opens on the first field the request left out. Once, on mount: never on a poll's re-render.
  // Without scrolling (#807): at 390 px the browser moved that field to the middle of the screen, and the top
  // of the card ("Parsed offline", the sentence, the notes about the sender or a refused stop) was scrolled away.
  useEffect(() => {
    const first = firstNeedsInput(props.needsInput ?? []);
    if (first) fields.current[first]?.focus({ preventScroll: true });
  }, []);
  const errors: FieldErrors = { ...(status.kind === 'error' ? status.fieldErrors : {}), ...clientErrors };

  return (
    <NewDeliveryFormView
      origin={origin}
      businesses={props.businesses}
      employees={employees}
      phase={props.phase}
      window={timeWindow}
      retry={retryId !== null}
      draft={draft}
      needsInput={unchecked}
      errors={errors}
      status={status}
      onChange={change}
      onSubmit={submit}
      onOpenDelivery={props.onOpenDelivery}
      onCancel={props.onCancel}
      fieldRef={(f) => (el) => { fields.current[f] = el; }}
      formRef={form}
    />
  );
}

export type NewDeliveryFormViewProps = {
  origin: NetworkBusiness;
  businesses: NetworkBusiness[];
  /** Names for the carriers of the result card. */
  employees?: CarrierNames;
  phase: Phase;
  window?: TimeWindow;
  /** True while the draft is unchanged since a no-match answer: the primary button re-matches that delivery. */
  retry?: boolean;
  draft: NewDeliveryDraft;
  /** Fields a parsed request left out and the user has not edited yet: each shows NEEDS_INPUT_HINT. */
  needsInput?: readonly DraftField[];
  errors: FieldErrors;
  status: SubmitStatus;
  onChange: <K extends keyof NewDeliveryDraft>(key: K, value: NewDeliveryDraft[K]) => void;
  onSubmit: (e: FormEvent) => void;
  onOpenDelivery: (shipmentId: string) => void;
  onCancel: () => void;
  fieldRef?: (field: DraftField) => (el: HTMLElement | null) => void;
  /** The form element, for the stateful form: it brings the answer on screen. */
  formRef?: Ref<HTMLFormElement>;
};

const CATEGORIES: { value: PackageCategory; label: string }[] = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'small_box', label: 'Small box' },
];

/** Stateless markup for every state (static-render tests use this directly). */
export function NewDeliveryFormView(p: NewDeliveryFormViewProps) {
  const base = useId();
  const id = (f: string) => `${base}-${f}`;
  const options = recipientOptions(p.businesses, p.origin.id);
  // Option values are positions, so business IDs never reach the DOM.
  const recipientIndex = options.findIndex((o) => o.id === p.draft.recipientId);
  const submitting = p.status.kind === 'submitting';
  const retrying = p.status.kind === 'submitting' && p.status.retry === true;
  const locked = p.phase === 'locked' || p.status.kind === 'locked';
  const ref = (f: DraftField) => p.fieldRef?.(f);
  const windowTime = windowTimes(p.window ?? DEFAULT_WINDOW);
  /** The last pointer press on the submit button; a second press right after it is dropped (isRepeatPress). */
  const lastPress = useRef<Press | null>(null);

  const field = (f: DraftField, label: ReactNode, control: (a: {
    id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; ref?: (el: HTMLElement | null) => void;
  }) => ReactNode, hint?: ReactNode) => {
    const err = p.errors[f];
    const check = p.needsInput?.includes(f) === true;
    const describedBy = [hint ? id(`${f}-hint`) : '', check ? id(`${f}-check`) : '', err ? id(`${f}-err`) : '']
      .filter(Boolean).join(' ') || undefined;
    return (
      <div className={`nd-field${check ? ' nd-field--check' : ''}${err ? ' nd-field--invalid' : ''}`}>
        <label className="nd-label" htmlFor={id(f)}>{label}</label>
        {control({ id: id(f), 'aria-invalid': err ? true : undefined, 'aria-describedby': describedBy, ref: ref(f) })}
        {hint && <p className="nd-hint" id={id(`${f}-hint`)}>{hint}</p>}
        {check && <p className="nd-check" id={id(`${f}-check`)}>{NEEDS_INPUT_HINT}</p>}
        {err && <p className="nd-error" id={id(`${f}-err`)}>{err}</p>}
      </div>
    );
  };

  const alertText = locked
    ? (p.status.kind === 'locked' && p.status.message) || RESULT_COPY.locked
    : p.status.kind === 'unavailable' ? (p.status.saved ? RESULT_COPY.unavailableRetry : RESULT_COPY.unavailable)
    : p.status.kind === 'error' ? p.status.message
    : '';

  return (
    <form className="nd" ref={p.formRef} aria-labelledby={id('title')} noValidate onSubmit={p.onSubmit}
      onClickCapture={(e) => {
        // Before any button's own handler and before the browser submits the form or follows the link.
        if (isRepeatPress(e, lastPress.current)) { e.preventDefault(); e.stopPropagation(); return; }
        lastPress.current = pressOf(e) ?? lastPress.current;
      }}
      onKeyDown={(e) => {
        // Esc anywhere in the form does what Cancel does (an open native select handles its own Esc first).
        if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); p.onCancel(); }
      }}>
      <div className="nd-head">
        <h2 className="nd-title" id={id('title')}>New delivery</h2>
        <p className="nd-from">From {p.origin.name}{p.origin.neighborhood ? ` · ${p.origin.neighborhood}` : ''}</p>
      </div>

      <fieldset className="nd-group" disabled={submitting}>
        <legend className="nd-legend">Recipient and package</legend>
        {field('recipientId', 'Recipient', (a) => (
          <select {...a} ref={a.ref as (el: HTMLSelectElement | null) => void} className="nd-input"
            value={recipientIndex === -1 ? '' : String(recipientIndex)}
            onChange={(e) => p.onChange('recipientId', e.target.value === '' ? '' : options[Number(e.target.value)]?.id ?? '')}>
            <option value="">Choose a business</option>
            {options.map((o, i) => <option key={o.id} value={String(i)}>{o.label}</option>)}
          </select>
        ), 'Any business in the network')}
        {field('label', 'Package name', (a) => (
          <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input" type="text"
            autoComplete="off" value={p.draft.label} onChange={(e) => p.onChange('label', e.target.value)} />
        ))}
        <div className="nd-row">
          {field('category', 'Type', (a) => (
            <select {...a} ref={a.ref as (el: HTMLSelectElement | null) => void} className="nd-input"
              value={p.draft.category} onChange={(e) => p.onChange('category', e.target.value as PackageCategory)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ))}
          {field('weightKg', 'Weight (kg)', (a) => (
            <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input nd-input--num"
              type="text" inputMode="decimal" autoComplete="off" value={p.draft.weightKg}
              onChange={(e) => p.onChange('weightKg', e.target.value)} />
          ), <>Up to <span className="nd-mono">2 kg</span></>)}
        </div>
        {field('description', 'Contents', (a) => (
          <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input" type="text"
            autoComplete="off" value={p.draft.description} onChange={(e) => p.onChange('description', e.target.value)} />
        ))}
        {field('pickupInstructions', 'Pickup instructions (optional)', (a) => (
          <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input" type="text"
            autoComplete="off" value={p.draft.pickupInstructions}
            onChange={(e) => p.onChange('pickupInstructions', e.target.value)} />
        ))}
        {field('dropoffInstructions', 'Drop-off instructions (optional)', (a) => (
          <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input" type="text"
            autoComplete="off" value={p.draft.dropoffInstructions}
            onChange={(e) => p.onChange('dropoffInstructions', e.target.value)} />
        ))}
      </fieldset>

      <fieldset className="nd-group" disabled={submitting}>
        <legend className="nd-legend">Timing</legend>
        <p className="nd-hint">
          Simulation window: <span className="nd-mono">{windowTime.start}</span> to <span className="nd-mono">{windowTime.end}</span>.
        </p>
        {field('readyTime', 'Ready for pickup (Day 1)', (a) => (
          <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input nd-input--time"
            type="time" value={p.draft.readyTime} onChange={(e) => p.onChange('readyTime', e.target.value)} />
        ))}
        <div className="nd-row">
          {field('deadlineDay', 'Deliver by: day', (a) => (
            <select {...a} ref={a.ref as (el: HTMLSelectElement | null) => void} className="nd-input"
              value={String(p.draft.deadlineDay)}
              onChange={(e) => p.onChange('deadlineDay', e.target.value === '1' ? 1 : 2)}>
              <option value="1">Day 1</option>
              <option value="2">Day 2</option>
            </select>
          ))}
          {field('deadlineTime', 'Deliver by: time', (a) => (
            <input {...a} ref={a.ref as (el: HTMLInputElement | null) => void} className="nd-input nd-input--time"
              type="time" value={p.draft.deadlineTime} onChange={(e) => p.onChange('deadlineTime', e.target.value)} />
          ))}
        </div>
      </fieldset>

      <div className="nd-result" role="status" aria-live="polite">
        {submitting && (
          <p className="nd-result__line">
            {retrying ? 'Looking for a matching commute again…' : 'Sending request and looking for a matching commute…'}
          </p>
        )}
        {p.status.kind === 'matched' && (
          <ArrangedResult
            card={arrangedCard(p.status.response, {
              businesses: p.businesses, employees: p.employees ?? NO_EMPLOYEES, viewerBusinessId: p.origin.id,
            })}
            onOpen={p.onOpenDelivery}
          />
        )}
        {p.status.kind === 'unmatched' && (
          <ResultLine tone="warn" text={RESULT_COPY.unmatched} detail={p.status.reason}
            shipmentId={p.status.shipmentId} onOpen={p.onOpenDelivery} />
        )}
      </div>
      <div className="nd-alert" role="alert">
        {alertText && <p className="nd-result__line nd-result__line--danger">{alertText}</p>}
      </div>

      <div className="nd-actions">
        <button type="submit" className="nd-btn nd-btn--primary" disabled={submitting || locked}>
          {retrying ? 'Matching…' : submitting ? 'Sending…' : p.retry ? 'Try matching again' : 'Find a delivery match'}
        </button>
        <button type="button" className="nd-btn" onClick={p.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The match result (DECISIONS pass 60): every value is text the model formatted from the server's answer. */
function ArrangedResult({ card, onOpen }: { card: ArrangedCard; onOpen: (id: string) => void }) {
  return (
    <div className="nd-result__line nd-result__line--ok nd-arranged">
      <p className="nd-result__text">
        <strong>{RESULT_COPY.matched}</strong>
        {' '}<span className="nd-result__id">Shipment <span className="nd-mono">{card.shipmentId}</span></span>
      </p>
      {card.facts.length > 0 && (
        <dl className="nd-facts">
          {card.facts.map((f) => (
            <div key={f.label} className="nd-fact">
              <dt>{f.label}</dt>
              <dd className={f.mono ? 'nd-mono' : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.carriers.length > 0 && (
        <ol className="nd-carriers" aria-label="Carriers">
          {card.carriers.map((c) => (
            <li key={c.key} className="nd-carrier">
              <p className="nd-carrier__who">
                <span className="nd-carrier__name">{c.name}</span>
                {' · '}<span className="nd-carrier__trip">{c.tripText}</span>
              </p>
              <ul className="nd-stops">
                {c.stops.map((st) => (
                  <li key={st.key}>
                    <span className="nd-mono">{st.timeText}</span>{' · '}{st.actionLabel} {st.placeText}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <div className="nd-result__actions">
        <button type="button" className="nd-btn nd-btn--link" onClick={() => onOpen(card.shipmentId)}>View delivery</button>
        <a className="nd-btn nd-btn--link" href={card.simulatorHref}>Watch in simulator</a>
      </div>
    </div>
  );
}

function ResultLine(p: { tone: 'ok' | 'warn'; text: string; detail?: string | null; shipmentId: string; onOpen: (id: string) => void }) {
  return (
    <div className={`nd-result__line nd-result__line--${p.tone}`}>
      <p className="nd-result__text">
        <strong>{p.text}</strong>
        {p.detail ? <> {p.detail}</> : null}
        {' '}<span className="nd-result__id">Shipment <span className="nd-mono">{p.shipmentId}</span></span>
      </p>
      <button type="button" className="nd-btn nd-btn--link" onClick={() => p.onOpen(p.shipmentId)}>View delivery</button>
    </div>
  );
}
