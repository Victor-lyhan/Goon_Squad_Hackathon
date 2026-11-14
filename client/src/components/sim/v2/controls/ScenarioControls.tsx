import { useId, useState, type FormEvent } from 'react';
import type { GenerateScenarioRequest } from '../../../../../../shared/v2/schemas';
import type { Phase } from '../../../../../../shared/v2/types';
import {
  BUSY_REASON, DEMO_PACKAGES_NOTE, PRESET_OPTIONS, SCENARIO_FIELDS, SCENARIO_FIELD_INFO, generateConfirmText, initScenarioState,
  rangeText, syncScenarioState, validateScenario, type ScenarioField, type ScenarioForm,
} from './controlsModel';
import './controls.css';

export type ScenarioControlsProps = {
  value: GenerateScenarioRequest;
  phase: Phase;
  busy?: boolean;
  onGenerate(req: GenerateScenarioRequest): void;
};

/**
 * Scenario block: preset, seed, employee and package counts, detour limit (no hubs in MVP II).
 * Typed text is local and survives polls; it resets only when the server's values change.
 * Generate validates with the shared schema, then asks for confirmation (DECISIONS pass 10).
 */
export function ScenarioControls({ value, phase, busy = false, onGenerate }: ScenarioControlsProps) {
  const id = useId();
  const [state, setState] = useState(() => initScenarioState(value));
  const [errors, setErrors] = useState<Partial<Record<ScenarioField, string>>>({});
  const [confirming, setConfirming] = useState<GenerateScenarioRequest | null>(null);

  // Adjust state during render when the server value really changed (a new city); equal polls are a no-op.
  const synced = syncScenarioState(state, value);
  if (synced !== state) {
    setState(synced);
    setErrors({});
    setConfirming(null);
  }
  const form = synced.form;

  const edit = (patch: Partial<ScenarioForm>) => {
    setState((s) => ({ ...s, form: { ...s.form, ...patch } }));
    setConfirming(null);
  };

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const r = validateScenario(form);
    setErrors(r.errors);
    setConfirming(r.ok ? r.request : null);
  };

  const confirm = () => {
    if (!confirming) return;
    const req = confirming;
    setConfirming(null);
    onGenerate(req);
  };

  const confirmId = `${id}-confirm`;
  const busyId = `${id}-busy`;
  return (
    <form className="ctl-block ctl-scenario" noValidate onSubmit={ask} aria-label="Scenario">
      <div className="ctl-field">
        <label htmlFor={`${id}-preset`}>Preset</label>
        <select id={`${id}-preset`} className="ctl-input" value={form.preset} disabled={busy}
          onChange={(e) => edit({ preset: e.target.value === 'random' ? 'random' : 'demo' })}>
          {PRESET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {form.preset === 'demo' && <p className="ctl-hint">{DEMO_PACKAGES_NOTE}</p>}
      </div>

      <div className="ctl-fields">
        {SCENARIO_FIELDS.map((f) => {
          const info = SCENARIO_FIELD_INFO[f];
          const inputId = `${id}-${f}`;
          const hintId = `${inputId}-hint`;
          const errId = `${inputId}-error`;
          const err = errors[f];
          return (
            <div key={f} className="ctl-field">
              <label htmlFor={inputId}>{info.label}</label>
              <input id={inputId} name={f} className="ctl-input ctl-mono" type="text" inputMode="numeric"
                value={form[f]} disabled={busy} aria-invalid={err ? true : undefined}
                aria-describedby={err ? `${hintId} ${errId}` : hintId}
                onChange={(e) => edit({ [f]: e.target.value } as Partial<ScenarioForm>)} />
              <span className="ctl-hint" id={hintId}>{rangeText(f)}</span>
              {err && <span className="ctl-error" id={errId} role="alert">{err}</span>}
            </div>
          );
        })}
      </div>

      {confirming ? (
        <div className="ctl-confirm" role="alertdialog" aria-labelledby={confirmId}>
          <p id={confirmId}>{generateConfirmText(phase)}</p>
          <div className="ctl-row">
            <button type="button" className="ctl-btn ctl-danger" disabled={busy} onClick={confirm}>Generate new city</button>
            <button type="button" className="ctl-btn" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="submit" className="ctl-btn ctl-wide" disabled={busy} title={busy ? BUSY_REASON : undefined}
          aria-describedby={busy ? busyId : undefined}>
          Generate
        </button>
      )}
      {busy && <p className="ctl-note" id={busyId}>{BUSY_REASON}</p>}
    </form>
  );
}
