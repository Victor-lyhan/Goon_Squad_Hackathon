// MVP II commute form (docs/mvp2-ui-redesign.md §2 "Workspaces → Employee").
// Rendering and wiring only; the draft, validation, request and save states live in commuteFormModel.ts.
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import type { CommuteResponse } from '../../../../../shared/v2/api';
import type { PutCommuteRequest } from '../../../../../shared/v2/schemas';
import type { Employee, Home, NetworkBusiness, Phase } from '../../../../../shared/v2/types';
import {
  INITIAL_SAVE_STATE, MAX_DETOUR_MIN, draftFromSaved, eveningFromTimeInput, isDirty, minToTimeInput,
  morningFromTimeInput, nextDraft, parseMinutes, saveMessage, saveReducer, toRequest,
  type Draft, type DraftHome, type FieldErrors, type FieldKey, type SaveState, type SavedCommute,
} from './commuteFormModel';
import './CommuteForm.css';

/** A new home picked by the address search slot (#331). Only these three values are kept. */
export type ChosenHome = { neighborhood: string; lat: number; lng: number };

export type HomeControlArgs = {
  value: DraftHome;
  onChoose: (home: ChosenHome) => void;
  disabled: boolean;
};

export type CommuteFormProps = {
  employee: Employee;
  home: Home;
  businesses: NetworkBusiness[];
  phase: Phase;
  homeControl?: (args: HomeControlArgs) => ReactNode;
  onSave: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  /** Starting draft and save state, for static renders of each state. */
  initialDraft?: Draft;
  initialSaveState?: SaveState;
};

type FormState = {
  draft: Draft;
  /** Last known server values: from props, or from the last successful save. */
  baseline: SavedCommute;
  /** The props objects last seen, so a re-render with the same objects does nothing. */
  seen: SavedCommute;
};

export function CommuteForm({
  employee, home, businesses, phase, homeControl, onSave, initialDraft, initialSaveState,
}: CommuteFormProps) {
  const [form, setForm] = useState<FormState>(() => ({
    draft: initialDraft ?? draftFromSaved(employee, home),
    baseline: { employee, home },
    seen: { employee, home },
  }));
  const [save, dispatch] = useReducer(saveReducer, initialSaveState ?? INITIAL_SAVE_STATE);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Pass 43: new props objects with equal values keep the draft (derived during render, no effect).
  let current = form;
  if (form.seen.employee !== employee || form.seen.home !== home) {
    const incoming = { employee, home };
    const draft = nextDraft(form.draft, form.baseline, incoming);
    current = { draft, baseline: draft === form.draft ? form.baseline : incoming, seen: incoming };
    setForm(current);
  }
  const { draft, baseline } = current;

  const ids = useId();
  const id = (k: string) => `${ids}-${k}`;

  const locked = phase === 'locked' || save.status === 'locked';
  const saving = save.status === 'saving';
  const dirty = isDirty(draft, baseline);
  const validation = toRequest(draft);
  const serverErrors: FieldErrors = save.status === 'error' ? save.fieldErrors : {};
  const errors: FieldErrors = { ...serverErrors, ...(validation.ok ? {} : validation.errors) };
  const canSave = !locked && !saving && dirty && validation.ok;
  const message = saveMessage(save, phase);

  const update = (patch: Partial<Draft>) => {
    if (locked || saving) return;
    setForm((f) => ({ ...f, draft: { ...f.draft, ...patch } }));
    dispatch({ type: 'reset' });
  };

  const discard = () => {
    if (saving) return;
    setForm((f) => ({ ...f, draft: draftFromSaved(f.baseline.employee, f.baseline.home) }));
    dispatch({ type: 'reset' });
  };

  const submit = async () => {
    if (!canSave || !validation.ok) return;
    dispatch({ type: 'start' });
    try {
      const res = await onSave(validation.request);
      if (!mounted.current) return;
      setForm((f) => ({
        ...f,
        draft: draftFromSaved(res.employee, res.home),
        baseline: { employee: res.employee, home: res.home },
      }));
      dispatch({ type: 'success', response: res });
    } catch (error) {
      if (mounted.current) dispatch({ type: 'failure', error });
    }
  };

  const fieldProps = (k: FieldKey) => ({
    id: id(k),
    disabled: locked || saving,
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? id(`${k}-err`) : undefined,
  });
  const fieldError = (k: FieldKey) =>
    errors[k] ? <p className="cf-error" id={id(`${k}-err`)}>{errors[k]}</p> : null;

  const known = businesses.some((b) => b.id === draft.businessId);
  const detour = draft.maxExtraMin;
  const rangeValue = detour === null ? 0 : Math.min(MAX_DETOUR_MIN, Math.max(0, detour));

  return (
    <form
      className="cf"
      aria-label="Commute"
      noValidate
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="cf-field">
        <label htmlFor={id('businessId')}>Workplace</label>
        <select
          {...fieldProps('businessId')}
          value={known ? draft.businessId : ''}
          onChange={(e) => update({ businessId: e.target.value })}
        >
          {!known && <option value="">Choose a workplace</option>}
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name} · {b.neighborhood}</option>
          ))}
        </select>
        {fieldError('businessId')}
      </div>

      <div className="cf-field" role="group" aria-labelledby={id('home-label')}>
        <p className="cf-label" id={id('home-label')}>
          Home: <span className="cf-home-name">{draft.home.neighborhood}</span>
        </p>
        {homeControl ? (
          <div className="cf-home-control">
            {homeControl({
              value: draft.home,
              disabled: locked || saving,
              onChoose: (h) => update({
                home: { kind: 'new', neighborhood: h.neighborhood, lat: h.lat, lng: h.lng },
              }),
            })}
          </div>
        ) : (
          <p className="cf-hint">Shown by neighborhood only.</p>
        )}
        {fieldError('home')}
      </div>

      <div className="cf-row">
        <div className="cf-field">
          <label htmlFor={id('eveningDepartureMin')}>Evening departure (Day 1, work to home)</label>
          <input
            type="time"
            {...fieldProps('eveningDepartureMin')}
            value={minToTimeInput(draft.eveningDepartureMin)}
            onChange={(e) => update({ eveningDepartureMin: eveningFromTimeInput(e.target.value) })}
          />
          {fieldError('eveningDepartureMin')}
        </div>
        <div className="cf-field">
          <label htmlFor={id('morningDepartureMin')}>Morning departure (Day 2, home to work)</label>
          <input
            type="time"
            {...fieldProps('morningDepartureMin')}
            value={minToTimeInput(draft.morningDepartureMin)}
            onChange={(e) => update({ morningDepartureMin: morningFromTimeInput(e.target.value) })}
          />
          {fieldError('morningDepartureMin')}
        </div>
      </div>

      <fieldset className="cf-field cf-avail" disabled={locked || saving}>
        <legend className="cf-label">Availability</legend>
        <label className="cf-check" htmlFor={id('availableEvening')}>
          <input
            type="checkbox"
            id={id('availableEvening')}
            checked={draft.availableEvening}
            onChange={(e) => update({ availableEvening: e.target.checked })}
          />
          Available on the evening commute
        </label>
        <label className="cf-check" htmlFor={id('availableMorning')}>
          <input
            type="checkbox"
            id={id('availableMorning')}
            checked={draft.availableMorning}
            onChange={(e) => update({ availableMorning: e.target.checked })}
          />
          Available on the morning commute
        </label>
      </fieldset>

      <div className="cf-field">
        <label htmlFor={id('maxExtraMin')}>Maximum detour (minutes)</label>
        <div className="cf-detour">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DETOUR_MIN}
            step={1}
            {...fieldProps('maxExtraMin')}
            value={detour === null ? '' : String(detour)}
            onChange={(e) => update({ maxExtraMin: parseMinutes(e.target.value) })}
          />
          <input
            type="range"
            min={0}
            max={MAX_DETOUR_MIN}
            step={1}
            id={id('maxExtraMin-range')}
            aria-label="Maximum detour slider (minutes)"
            disabled={locked || saving}
            value={rangeValue}
            onChange={(e) => update({ maxExtraMin: Number(e.target.value) })}
          />
        </div>
        {fieldError('maxExtraMin')}
      </div>

      <div className="cf-actions">
        <button type="submit" className="cf-btn cf-btn-primary" disabled={!canSave}>
          {saving ? 'Saving…' : 'Save commute'}
        </button>
        <button type="button" className="cf-btn" disabled={locked || saving || !dirty} onClick={discard}>
          Discard changes
        </button>
      </div>

      <div
        className={`cf-message${message ? ` cf-message-${message.role}` : ''}`}
        role={message?.role ?? 'status'}
        aria-live={message?.role === 'alert' ? 'assertive' : 'polite'}
      >
        {message?.text ?? ''}
      </div>
    </form>
  );
}
