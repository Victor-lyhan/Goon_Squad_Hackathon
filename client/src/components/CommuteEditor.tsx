import { useEffect, useState } from 'react';
import type { PutCommuteRequest } from '../../../shared/schemas';
import type { MapResponse } from '../../../shared/api';
import type { Business, Employee, Trip } from '../../../shared/types';
import { CityMap } from './CityMap';
import { Button, Card, Field } from '../ui';
import { toForm, toRequest, validate, type CommuteForm } from './employee/commuteModel';
import './employee/CommuteEditor.css';

export type CommuteEditorProps = {
  employee: Employee;
  trips: Trip[];
  map: MapResponse;
  businesses: Business[];
  locked: boolean;
  saving?: boolean;
  fieldErrors?: Record<string, string>;
  onSave: (req: PutCommuteRequest) => void;
};

export function CommuteEditor({
  employee, trips, map, businesses, locked, saving = false, fieldErrors, onSave,
}: CommuteEditorProps) {
  const [form, setForm] = useState<CommuteForm>(() => toForm(employee));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  useEffect(() => { setForm(toForm(employee)); }, [employee]);

  const set = <K extends keyof CommuteForm>(k: K, v: CommuteForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = { ...localErrors, ...fieldErrors };
  const disabled = locked || saving;

  const nodes = map.graph.nodes;
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? 'Intersection';
  const named = nodes.filter((n) => n.label);
  const evening = trips.find((t) => t.direction === 'evening');
  const morning = trips.find((t) => t.direction === 'morning');

  const submit = () => {
    const errs = validate(form);
    setLocalErrors(errs);
    if (Object.keys(errs).length === 0) onSave(toRequest(form));
  };

  return (
    <Card className="commute-editor">
      <h2 className="commute-editor__title">My commute</h2>
      {locked && (
        <p className="commute-editor__locked" role="status">
          Planning is locked. Commute edits need a new planning cycle.
        </p>
      )}

      <Field label="Employer" error={errors.businessId}>
        <select value={form.businessId} disabled={disabled} onChange={(e) => set('businessId', e.target.value)}>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>

      <Field label="Home location" hint={form.homeNodeId ? `Selected: ${labelOf(form.homeNodeId)}` : 'Pick a place or tap the map'} error={errors.homeNodeId}>
        <select value={form.homeNodeId} disabled={disabled} onChange={(e) => set('homeNodeId', e.target.value)}>
          <option value="">Choose a place…</option>
          {named.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </Field>

      <CityMap
        className="commute-editor__map"
        graph={map.graph}
        businesses={map.businesses}
        hubs={map.hubs}
        highlightRoute={evening?.baselineNodeIds}
        baselineRoute={morning?.baselineNodeIds}
        selectedNodeId={form.homeNodeId || undefined}
        onNodeClick={disabled ? undefined : (id) => set('homeNodeId', id)}
      />
      <ul className="commute-editor__routes">
        {evening && <li>Evening route: {evening.baselineDurationMin} min</li>}
        {morning && <li>Morning route: {morning.baselineDurationMin} min</li>}
      </ul>

      <div className="commute-editor__row">
        <Field label="Evening departure (Day 1)" error={errors.eveningDepartureMin}>
          <input type="time" value={form.eveningTime} disabled={disabled} onChange={(e) => set('eveningTime', e.target.value)} />
        </Field>
        <Field label="Morning departure (Day 2)" error={errors.morningDepartureMin}>
          <input type="time" value={form.morningTime} disabled={disabled} onChange={(e) => set('morningTime', e.target.value)} />
        </Field>
      </div>

      <label className="commute-editor__toggle">
        <input type="checkbox" checked={form.availableEvening} disabled={disabled} onChange={(e) => set('availableEvening', e.target.checked)} />
        Available for evening deliveries
      </label>
      <label className="commute-editor__toggle">
        <input type="checkbox" checked={form.availableMorning} disabled={disabled} onChange={(e) => set('availableMorning', e.target.checked)} />
        Available for morning deliveries
      </label>

      <Field label={`Max added minutes: ${form.maxExtraMin}`} error={errors.maxExtraMin}>
        <input type="range" min={0} max={30} step={1} value={form.maxExtraMin} disabled={disabled} onChange={(e) => set('maxExtraMin', Number(e.target.value))} />
      </Field>

      <div className="commute-editor__save">
        <Button onClick={submit} loading={saving} disabled={locked}>Save commute and find jobs</Button>
      </div>
    </Card>
  );
}
