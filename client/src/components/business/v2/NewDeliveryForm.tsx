import { useId, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ShipmentResponse } from '../../../../../shared/v2/api';
import type { CreateShipmentRequest } from '../../../../../shared/v2/schemas';
import type { NetworkBusiness, PackageCategory, Phase } from '../../../../../shared/v2/types';
import { newClientRequestId } from '../shipmentFormModel';
import {
  DEFAULT_WINDOW, RESULT_COPY, draftAfterResult, emptyDraft, firstInvalidField, initialSubmitState,
  mapServerFieldErrors, recipientOptions, submitReducer, toRequest, validate,
  type DraftField, type FieldErrors, type NewDeliveryDraft, type SubmitStatus, type TimeWindow,
} from './newDeliveryModel';
import './newDelivery.css';

export type NewDeliveryFormProps = {
  origin: NetworkBusiness;
  businesses: NetworkBusiness[];
  phase: Phase;
  onSubmit: (req: CreateShipmentRequest) => Promise<ShipmentResponse>;
  onOpenDelivery: (shipmentId: string) => void;
  onCancel: () => void;
  /** Planning window (settings.simStartMin / simEndMin); defaults to Day 1 15:30 to Day 2 12:00. */
  window?: TimeWindow;
};

/**
 * The New delivery form. The typed draft is local state: a re-render with equal props (a 1 s poll) never
 * resets it (DECISIONS pass 43). It starts over only when the sending business changes.
 */
export function NewDeliveryForm(props: NewDeliveryFormProps) {
  const { origin, onSubmit } = props;
  const [draft, setDraft] = useState<NewDeliveryDraft>(emptyDraft);
  const [draftOrigin, setDraftOrigin] = useState(origin.id);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [submitState, dispatch] = useReducer(submitReducer, origin.id, (id: string) => initialSubmitState(newClientRequestId(id)));
  const busy = useRef(false);
  const fields = useRef<Partial<Record<DraftField, HTMLElement | null>>>({});
  const timeWindow = props.window ?? DEFAULT_WINDOW;

  // Another business: a fresh draft (adjusting state during render, so the old draft is never drawn for it).
  if (draftOrigin !== origin.id) {
    setDraftOrigin(origin.id);
    setDraft(emptyDraft());
    setClientErrors({});
    dispatch({ type: 'dismiss' });
  }

  const focusFirst = (errors: FieldErrors) => {
    const f = firstInvalidField(errors);
    if (f) fields.current[f]?.focus();
  };

  const change = <K extends keyof NewDeliveryDraft>(key: K, value: NewDeliveryDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    // Once errors are on screen, they follow the typing (fixed fields clear right away).
    if (Object.keys(clientErrors).length > 0) setClientErrors(validate(next, origin.id, timeWindow));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy.current || props.phase === 'locked') return; // a double click sends one request
    const errors = validate(draft, origin.id, timeWindow);
    setClientErrors(errors);
    if (firstInvalidField(errors)) { focusFirst(errors); return; }
    busy.current = true;
    const sent = draft;
    dispatch({ type: 'submit' });
    try {
      const response = await onSubmit(toRequest(sent, origin.id, submitState.clientRequestId));
      const nextRequestId = newClientRequestId(origin.id);
      dispatch({ type: 'success', response, nextRequestId });
      if (response.matched) setDraft((d) => (d === sent ? draftAfterResult(d, { kind: 'matched', shipmentId: response.shipment.id }) : d));
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
  const errors: FieldErrors = { ...(status.kind === 'error' ? status.fieldErrors : {}), ...clientErrors };

  return (
    <NewDeliveryFormView
      origin={origin}
      businesses={props.businesses}
      phase={props.phase}
      window={timeWindow}
      draft={draft}
      errors={errors}
      status={status}
      onChange={change}
      onSubmit={submit}
      onOpenDelivery={props.onOpenDelivery}
      onCancel={props.onCancel}
      fieldRef={(f) => (el) => { fields.current[f] = el; }}
    />
  );
}

export type NewDeliveryFormViewProps = {
  origin: NetworkBusiness;
  businesses: NetworkBusiness[];
  phase: Phase;
  window?: TimeWindow;
  draft: NewDeliveryDraft;
  errors: FieldErrors;
  status: SubmitStatus;
  onChange: <K extends keyof NewDeliveryDraft>(key: K, value: NewDeliveryDraft[K]) => void;
  onSubmit: (e: FormEvent) => void;
  onOpenDelivery: (shipmentId: string) => void;
  onCancel: () => void;
  fieldRef?: (field: DraftField) => (el: HTMLElement | null) => void;
};

const CATEGORIES: { value: PackageCategory; label: string }[] = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'small_box', label: 'Small box' },
];

function windowText(w: TimeWindow): string {
  const t = (m: number) => `Day ${Math.floor(m / 1440) + 1} ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${t(w.startMin)} to ${t(w.endMin)}`;
}

/** Stateless markup for every state (static-render tests use this directly). */
export function NewDeliveryFormView(p: NewDeliveryFormViewProps) {
  const base = useId();
  const id = (f: string) => `${base}-${f}`;
  const options = recipientOptions(p.businesses, p.origin.id);
  // Option values are positions, so business IDs never reach the DOM.
  const recipientIndex = options.findIndex((o) => o.id === p.draft.recipientId);
  const submitting = p.status.kind === 'submitting';
  const locked = p.phase === 'locked' || p.status.kind === 'locked';
  const ref = (f: DraftField) => p.fieldRef?.(f);

  const field = (f: DraftField, label: ReactNode, control: (a: {
    id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; ref?: (el: HTMLElement | null) => void;
  }) => ReactNode, hint?: string) => {
    const err = p.errors[f];
    const describedBy = [hint ? id(`${f}-hint`) : '', err ? id(`${f}-err`) : ''].filter(Boolean).join(' ') || undefined;
    return (
      <div className={`nd-field${err ? ' nd-field--invalid' : ''}`}>
        <label className="nd-label" htmlFor={id(f)}>{label}</label>
        {control({ id: id(f), 'aria-invalid': err ? true : undefined, 'aria-describedby': describedBy, ref: ref(f) })}
        {hint && <p className="nd-hint" id={id(`${f}-hint`)}>{hint}</p>}
        {err && <p className="nd-error" id={id(`${f}-err`)}>{err}</p>}
      </div>
    );
  };

  const alertText = locked
    ? RESULT_COPY.locked
    : p.status.kind === 'unavailable' ? RESULT_COPY.unavailable
    : p.status.kind === 'error' ? p.status.message
    : '';

  return (
    <form className="nd" aria-labelledby={id('title')} noValidate onSubmit={p.onSubmit}>
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
          ), 'Up to 2 kg')}
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
        <p className="nd-hint">Simulation window: {windowText(p.window ?? DEFAULT_WINDOW)}.</p>
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
        {submitting && <p className="nd-result__line">Sending request and looking for a matching commute…</p>}
        {p.status.kind === 'matched' && (
          <ResultLine tone="ok" text={RESULT_COPY.matched} shipmentId={p.status.shipmentId} onOpen={p.onOpenDelivery} />
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
          {submitting ? 'Sending…' : 'Send request'}
        </button>
        <button type="button" className="nd-btn" onClick={p.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ResultLine(p: { tone: 'ok' | 'warn'; text: string; detail?: string | null; shipmentId: string; onOpen: (id: string) => void }) {
  return (
    <div className={`nd-result__line nd-result__line--${p.tone}`}>
      <p className="nd-result__text">
        <strong>{p.text}</strong>
        {p.detail ? <> {p.detail}</> : null}
      </p>
      <button type="button" className="nd-btn nd-btn--link" onClick={() => p.onOpen(p.shipmentId)}>View delivery</button>
    </div>
  );
}
