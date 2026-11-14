import { useEffect, useRef, useState } from 'react';
import type { CreateShipmentRequest } from '../../../shared/schemas';
import type { Business } from '../../../shared/types';
import { Button, Field, formatCents } from '../ui';
import { defaultForm, toRequest, validate, type FormState } from './business/shipmentFormModel';
import { RouteMiniMap } from './business/RouteMiniMap';
import './business/ShipmentForm.css';

export type ShipmentFormProps = {
  origin: Business;
  businesses: Business[];
  locked: boolean;
  submitting: boolean;
  fieldErrors?: Record<string, string>;
  initial?: Partial<FormState>;
  onSubmit: (req: CreateShipmentRequest) => void;
};

/** Assumed flat customer price shown before matching (spec: $10). */
const ASSUMED_PRICE_CENTS = 1000;

export function ShipmentForm({ origin, businesses, locked, submitting, fieldErrors, initial, onSubmit }: ShipmentFormProps) {
  const [form, setForm] = useState<FormState>(() => ({ ...defaultForm(), ...initial, originBusinessId: origin.id }));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  // Same content resubmitted reuses its id (idempotent POST); edited content gets a new one.
  const lastRequest = useRef({ sig: '', id: '' });
  const counter = useRef(0);
  useEffect(() => { setForm({ ...defaultForm(), ...initial, originBusinessId: origin.id }); setLocalErrors({}); }, [initial, origin.id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = { ...localErrors, ...fieldErrors };
  const disabled = locked || submitting;
  const destination = businesses.find((b) => b.id === form.destinationBusinessId);
  const others = businesses.filter((b) => b.id !== origin.id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const errs = validate(form);
    setLocalErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const sig = JSON.stringify(form);
    if (lastRequest.current.sig !== sig) {
      counter.current += 1;
      lastRequest.current = { sig, id: `req-${origin.id}-${counter.current}-${Date.now().toString(36)}` };
    }
    onSubmit(toRequest(form, lastRequest.current.id));
  }

  const dayTime = (prefix: 'ready' | 'deadline', label: string, error?: string) => (
    <div className="shipment-form__row">
      <Field label={`${label} day`} error={error}>
        <select
          value={form[`${prefix}Day`]}
          disabled={disabled}
          onChange={(e) => set(`${prefix}Day`, Number(e.target.value) as 1 | 2)}
        >
          <option value={1}>Day 1</option>
          <option value={2}>Day 2</option>
        </select>
      </Field>
      <Field label={`${label} time`}>
        <input type="time" value={form[`${prefix}Time`]} disabled={disabled} onChange={(e) => set(`${prefix}Time`, e.target.value)} />
      </Field>
    </div>
  );

  return (
    <form className="shipment-form" onSubmit={submit} noValidate>
      <h2>Send a package</h2>
      <p>From {origin.name} ({origin.district})</p>
      {locked && <p className="shipment-form__locked">Simulation has started, so new requests are closed until the next planning cycle.</p>}
      <Field label="Destination business" error={errors.destinationBusinessId}>
        <select value={form.destinationBusinessId} disabled={disabled} onChange={(e) => set('destinationBusinessId', e.target.value)}>
          <option value="">Choose a business…</option>
          {others.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.district}</option>)}
        </select>
      </Field>
      <Field label="Package name" error={errors.label}>
        <input type="text" value={form.label} disabled={disabled} onChange={(e) => set('label', e.target.value)} />
      </Field>
      <div className="shipment-form__row">
        <Field label="Category" error={errors.category}>
          <select value={form.category} disabled={disabled} onChange={(e) => set('category', e.target.value as FormState['category'])}>
            <option value="envelope">Envelope</option>
            <option value="small_box">Small box</option>
          </select>
        </Field>
        <Field label="Weight (kg)" hint="Up to 2 kg" error={errors.weightKg}>
          <input type="number" step="0.1" min="0" value={form.weightKg} disabled={disabled} onChange={(e) => set('weightKg', e.target.value)} />
        </Field>
      </div>
      <Field label="Description" error={errors.description}>
        <textarea value={form.description} disabled={disabled} onChange={(e) => set('description', e.target.value)} />
      </Field>
      {dayTime('ready', 'Ready', errors.readyMin)}
      {dayTime('deadline', 'Deliver by', errors.deadlineMin)}
      <Field label="Pickup instructions (optional)">
        <input type="text" value={form.pickupInstructions} disabled={disabled} onChange={(e) => set('pickupInstructions', e.target.value)} />
      </Field>
      <Field label="Drop-off instructions (optional)">
        <input type="text" value={form.dropoffInstructions} disabled={disabled} onChange={(e) => set('dropoffInstructions', e.target.value)} />
      </Field>
      {destination && (
        <section className="shipment-form__review" aria-label="Review">
          <h3>Review</h3>
          <p>{origin.name} → {destination.name}</p>
          <RouteMiniMap originNodeId={origin.nodeId} destinationNodeId={destination.nodeId} />
        </section>
      )}
      <p className="shipment-form__price">Price: {formatCents(ASSUMED_PRICE_CENTS)} flat per package</p>
      <div className="shipment-form__submit">
        <Button type="submit" disabled={disabled}>{submitting ? 'Matching your package…' : 'Find a delivery match'}</Button>
      </div>
    </form>
  );
}
