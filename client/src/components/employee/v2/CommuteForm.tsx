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

/** The fields in the order they appear, for moving focus to the first invalid one. */
const FIELD_ORDER: FieldKey[] = [
  'businessId', 'home', 'eveningDepartureMin', 'morningDepartureMin',
  'availableEvening', 'availableMorning', 'maxExtraMin',
];

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
  /**
   * The version of the dashboard `phase` was read from. A 409 locks the editor on its own, before the page
   * has polled; the lock is dropped when a dashboard that says `planning` arrives after it, and this is how
   * the form tells a new dashboard from the one it already had. Without it only a change of `phase` counts.
   */
  dashboardVersion?: number;
  homeControl?: (args: HomeControlArgs) => ReactNode;
  onSave: (req: PutCommuteRequest) => Promise<CommuteResponse>;
  /**
   * false when the page around the form announces the save itself (#735): the message below the buttons
   * is then plain text, so a screen reader hears each result once. Default true: the form's own live region.
   */
  announce?: boolean;
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
  employee, home, businesses, phase, dashboardVersion, homeControl, onSave, announce = true, initialDraft, initialSaveState,
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

  // A new dashboard (adjusting state during render, like above): when it says planning, a 409's lock goes
  // with it, so the editor reopens in the same poll as the workspace's locked line goes. The draft stays.
  const [seenDashboard, setSeenDashboard] = useState({ phase, version: dashboardVersion });
  if (seenDashboard.phase !== phase || seenDashboard.version !== dashboardVersion) {
    setSeenDashboard({ phase, version: dashboardVersion });
    dispatch({ type: 'dashboard', phase });
  }

  const ids = useId();
  const id = (k: string) => `${ids}-${k}`;

  const locked = phase === 'locked' || save.status === 'locked';
  const saving = save.status === 'saving';
  const dirty = isDirty(draft, baseline);
  const validation = toRequest(draft);
  const serverErrors: FieldErrors = save.status === 'error' ? save.fieldErrors : {};
  const errors: FieldErrors = { ...serverErrors, ...(validation.ok ? {} : validation.errors) };
  // Save stays pressable while a value is invalid: pressing it sends nothing and moves focus to the
  // first invalid field (#550), so a keyboard user learns which one is wrong.
  const canPress = !locked && !saving && dirty;
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
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
    if (!canPress) return;
    if (!validation.ok) {
      focusFirstInvalid(validation.errors);
      return;
    }
    // The fields are disabled while the save is pending, and a disabled control drops focus to <body>
    // (#735). Enter in a field therefore hands focus to Save first, which stays focusable (see below).
    const active = formRef.current?.ownerDocument.activeElement;
    if (active && active !== submitRef.current && formRef.current?.contains(active)) submitRef.current?.focus();
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

  function focusFirstInvalid(found: FieldErrors) {
    const first = FIELD_ORDER.find((k) => found[k]);
    if (!first) return;
    const el = formRef.current?.ownerDocument.getElementById(id(first));
    el?.focus();
  }

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
      ref={formRef}
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

      {/* #598: a fieldset, so the whole home control (input, Change, Cancel, Retry) is disabled by the
          browser while a save is pending or the run is locked. This label is the one place the home is
          printed; the address search inside shows only its controls. */}
      <fieldset
        className="cf-field cf-home"
        role="group"
        id={id('home')}
        tabIndex={-1}
        aria-labelledby={id('home-label')}
        aria-describedby={errors.home ? id('home-err') : undefined}
        disabled={locked || saving}
        // The search results are list items, which a disabled fieldset does not switch off.
        onClickCapture={(e) => {
          if (locked || saving) { e.preventDefault(); e.stopPropagation(); }
        }}
      >
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
      </fieldset>

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
            aria-invalid={errors.availableEvening ? true : undefined}
            aria-describedby={errors.availableEvening ? id('availableEvening-err') : undefined}
            checked={draft.availableEvening}
            onChange={(e) => update({ availableEvening: e.target.checked })}
          />
          Available on the evening commute
        </label>
        <label className="cf-check" htmlFor={id('availableMorning')}>
          <input
            type="checkbox"
            id={id('availableMorning')}
            aria-invalid={errors.availableMorning ? true : undefined}
            aria-describedby={errors.availableMorning ? id('availableMorning-err') : undefined}
            checked={draft.availableMorning}
            onChange={(e) => update({ availableMorning: e.target.checked })}
          />
          Available on the morning commute
        </label>
        {fieldError('availableEvening')}
        {fieldError('availableMorning')}
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
            aria-describedby={errors.maxExtraMin ? id('maxExtraMin-err') : undefined}
            disabled={locked || saving}
            value={rangeValue}
            onChange={(e) => update({ maxExtraMin: Number(e.target.value) })}
          />
        </div>
        {fieldError('maxExtraMin')}
      </div>

      <div className="cf-actions">
        {/* While saving the button is aria-disabled, not disabled (#735): it keeps the focus it had when
            it was pressed, so after a failed save the next Enter tries again. submit() ignores a press. */}
        <button
          type="submit"
          className="cf-btn cf-btn-primary"
          ref={submitRef}
          disabled={!canPress && !saving}
          aria-disabled={saving || undefined}
        >
          {saving ? 'Saving…' : 'Save commute'}
        </button>
        <button type="button" className="cf-btn" disabled={locked || saving || !dirty} onClick={discard}>
          Discard changes
        </button>
      </div>

      <div
        className={`cf-message${message ? ` cf-message-${message.role}` : ''}`}
        role={announce ? message?.role ?? 'status' : undefined}
        aria-live={announce ? (message?.role === 'alert' ? 'assertive' : 'polite') : undefined}
      >
        {message?.text ?? ''}
      </div>
    </form>
  );
}
