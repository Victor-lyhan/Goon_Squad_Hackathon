import { useRef, useState, type ChangeEvent } from 'react';
import type { CompareResponse } from '../../../../shared/api';
import type { Run } from '../../../../shared/types';
import { Link } from 'react-router-dom';
import type { Phase } from '../../../../shared/types';
import { compareMatches, exportScenario, generateScenario, importScenario, recomputeMatches, resetPlanning } from '../../api';
import { Button, Drawer, Field } from '../../ui';
import { ComparePanel } from './ComparePanel';
import {
  EXPORT_FILENAME, NUMERIC_FIELDS, FIELD_RANGES, TRADEOFF_STEPS, defaultForm, errorMessage, rangeHint, recomputeButtonState,
  recomputeToast, validateSetup,
  type NumericField, type SetupForm,
} from './setupModel';
import './SetupDrawer.css';

export type SetupDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Called after an action that changed the run, so the page refetches. */
  onChanged: (message?: string) => void;
  /** Current run phase; recompute is refused by the server while locked. */
  phase?: Phase;
  /** Employee the demo hint links to (their portal is where the limit is lowered). */
  hintEmployeeId?: string;
};

type Action = 'compare' | 'recompute' | 'generate' | 'export' | 'import' | 'reset';

export function SetupDrawer({ open, onClose, onChanged, phase, hintEmployeeId }: SetupDrawerProps) {
  const [form, setForm] = useState<SetupForm>(defaultForm);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const validation = validateSetup(form);

  const run = async (action: Action, fn: () => Promise<string | void>, changes: boolean) => {
    if (pending) return;
    setPending(action); setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      if (changes) { setCompare(null); onChanged(msg || undefined); }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const set = (patch: Partial<SetupForm>) => setForm((f) => ({ ...f, ...patch }));

  const onGenerate = () => {
    if (!validation.ok) { setShowErrors(true); return; }
    setShowErrors(false);
    void run('generate', async () => { await generateScenario(validation.request); return 'City generated.'; }, true);
  };
  const onCompare = () => void run('compare', async () => { setCompare(await compareMatches()); }, false);
  const onRecompute = () => void run('recompute', async () => recomputeToast(await recomputeMatches()), true);
  const onExport = () => void run('export', async () => {
    const data = await exportScenario();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = EXPORT_FILENAME;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return 'Scenario exported.';
  }, false);
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('import', async () => {
      let data: Run;
      try { data = JSON.parse(await file.text()) as Run; } catch { throw new Error('That file is not valid JSON.'); }
      await importScenario(data);
      return 'Scenario imported.';
    }, true);
  };
  const onReset = () => void run('reset', async () => { await resetPlanning(); return 'New planning cycle started.'; }, true);

  const busy = pending !== null;
  const rc = recomputeButtonState(phase, busy);
  return (
    <Drawer open={open} onClose={onClose} title="Setup">
      <div className="setup">
        <section className="setup-section">
          <h3>Direct vs relay</h3>
          <Button variant="secondary" onClick={onCompare} loading={pending === 'compare'} disabled={busy}>Compare</Button>
          {compare && <ComparePanel compare={compare} />}
        </section>

        <section className="setup-section">
          <h3>Generate city</h3>
          <Field label="Preset">
            <select value={form.preset} onChange={(e) => set({ preset: e.target.value as SetupForm['preset'] })}>
              <option value="demo">Demo</option>
              <option value="random">Random</option>
            </select>
          </Field>
          <div className="setup-grid">
            {NUMERIC_FIELDS.map((f: NumericField) => (
              <Field key={f} label={FIELD_RANGES[f].label} hint={rangeHint(f)} error={showErrors ? validation.errors[f] : undefined}>
                <input type="text" inputMode="numeric" value={form[f]} onChange={(e) => set({ [f]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Button onClick={onGenerate} loading={pending === 'generate'} disabled={busy}>Generate city</Button>
        </section>

        <section className="setup-section">
          <h3>Scenario file</h3>
          <div className="setup-row">
            <Button variant="secondary" onClick={onExport} loading={pending === 'export'} disabled={busy}>Export JSON</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={pending === 'import'} disabled={busy}>Import JSON</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} aria-label="Import scenario file" />
          </div>
        </section>

        <section className="setup-section">
          <h3>Planning</h3>
          <Button variant="secondary" onClick={onReset} loading={pending === 'reset'} disabled={busy}>Start new planning cycle</Button>
          <Button variant="secondary" onClick={onRecompute} loading={pending === 'recompute'} disabled={rc.disabled}>Recompute matches</Button>
          {rc.hint && <p className="setup-hint">{rc.hint}</p>}
        </section>

        <section className="setup-section">
          <h3>Show the detour tradeoff</h3>
          <ol className="setup-tradeoff">
            <li>{TRADEOFF_STEPS[0]}</li>
            <li>
              {hintEmployeeId
                ? <>Lower an employee’s added-time limit in the <Link to={`/employee/${hintEmployeeId}`}>employee portal</Link></>
                : TRADEOFF_STEPS[1]}
            </li>
            <li>{TRADEOFF_STEPS[2]}</li>
          </ol>
        </section>

        {error && <div className="setup-error" role="alert">{error}</div>}
        {notice && !error && <div className="setup-notice" role="status">{notice}</div>}
      </div>
    </Drawer>
  );
}
