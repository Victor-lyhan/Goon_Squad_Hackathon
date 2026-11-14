import { useEffect, useState } from 'react';
import type { PutCommuteRequest } from '../../../shared/schemas';
import type { MapResponse } from '../../../shared/api';
import type { Business, Employee, Trip } from '../../../shared/types';
import { getShipment } from '../api/client';
import { CityMap } from './CityMap';
import { Button, Card, Field, formatDuration } from '../ui';
import {
  LOCKED_TEXT, SAVED_TEXT, SIMULATOR_PATH, routeLine, addWaypoint, clearWaypoints, rematchedText, removeWaypoint, toForm, toRequest, validate,
  type CommuteForm, type WaypointDirection,
} from './employee/commuteModel';
import { projectNodes } from './sim/mapGeometry';
import './employee/CommuteEditor.css';

export type CommuteEditorProps = {
  employee: Employee;
  trips: Trip[];
  map: MapResponse;
  businesses: Business[];
  locked: boolean;
  saving?: boolean;
  fieldErrors?: Record<string, string>;
  /** Last successful PUT /commute response: its trips are shown as the persisted routes. */
  saved?: { trips: Trip[]; rematchedShipmentIds: string[] } | null;
  onSave: (req: PutCommuteRequest) => void;
};

export function CommuteEditor({
  employee, trips, map, businesses, locked, saving = false, fieldErrors, saved, onSave,
}: CommuteEditorProps) {
  const [form, setForm] = useState<CommuteForm>(() => toForm(employee));
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  useEffect(() => { setForm(toForm(employee)); }, [employee]);

  const [adjusting, setAdjusting] = useState(false);
  const [dir, setDir] = useState<WaypointDirection>('evening');
  const [wpError, setWpError] = useState('');
  const [pkgNames, setPkgNames] = useState<Record<string, string>>({});
  const rematchedKey = saved ? saved.rematchedShipmentIds.join(',') : '';
  useEffect(() => {
    let live = true;
    for (const id of rematchedKey ? rematchedKey.split(',') : []) {
      getShipment(id).then((r) => { if (live) setPkgNames((m) => ({ ...m, [id]: r.shipment.label })); }).catch(() => {});
    }
    return () => { live = false; };
  }, [rematchedKey]);

  const set = <K extends keyof CommuteForm>(k: K, v: CommuteForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = { ...localErrors, ...fieldErrors };
  const disabled = locked || saving;

  const nodes = map.graph.nodes;
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? 'Intersection';
  const named = nodes.filter((n) => n.label);
  const shown = saved ? saved.trips : trips;
  const evening = shown.find((t) => t.direction === 'evening');
  const morning = shown.find((t) => t.direction === 'morning');

  const vias = dir === 'evening' ? form.eveningViaNodeIds : form.morningViaNodeIds;
  const pos = projectNodes(nodes);
  const onMapClick = (id: string) => {
    if (!adjusting) { set('homeNodeId', id); return; }
    const r = addWaypoint(form, dir, id);
    setWpError(r.error ?? '');
    if (!r.error) setForm(r.form);
  };

  const submit = () => {
    const errs = validate(form);
    setLocalErrors(errs);
    if (Object.keys(errs).length === 0) onSave(toRequest(form));
  };

  return (
    <Card className="commute-editor">
      <h2 className="commute-editor__title">My commute</h2>

      <div className="commute-editor__layout">
      <div className="commute-editor__fields">
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


      <details className="commute-editor__adjust" open={adjusting} onToggle={(e) => { setAdjusting((e.currentTarget as HTMLDetailsElement).open); setWpError(''); }}>
        <summary>Adjust my route</summary>
        <div className="commute-editor__dir" role="group" aria-label="Route direction">
          {(['evening', 'morning'] as const).map((d) => (
            <button
              key={d} type="button" aria-pressed={dir === d}
              className={`commute-editor__dir-btn${dir === d ? ' is-active' : ''}`}
              onClick={() => { setDir(d); setWpError(''); }}
            >{d === 'evening' ? 'Evening' : 'Morning'}</button>
          ))}
        </div>
        <p className="commute-editor__hint">Tap up to 3 places on the map, in order, that your {dir} trip should pass through.</p>
        {vias.length > 0 && (
          <ol className="commute-editor__waypoints">
            {vias.map((id, i) => (
              <li key={`${id}-${i}`}>
                <span>{labelOf(id)}</span>
                <button type="button" disabled={disabled} aria-label={`Remove waypoint ${i + 1}: ${labelOf(id)}`}
                  onClick={() => { setWpError(''); setForm((f) => removeWaypoint(f, dir, i)); }}>Remove</button>
              </li>
            ))}
          </ol>
        )}
        {wpError && <p className="commute-editor__wp-error" role="alert">{wpError}</p>}
        {vias.length > 0 && (
          <button type="button" disabled={disabled} onClick={() => { setWpError(''); setForm((f) => clearWaypoints(f, dir)); }}>Clear</button>
        )}
      </details>

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

      </div>
      <div className="commute-editor__mapcol">
      <CityMap
        className="commute-editor__map"
        graph={map.graph}
        businesses={map.businesses}
        hubs={map.hubs}
        highlightRoutes={saved ? [evening?.baselineNodeIds, morning?.baselineNodeIds].filter((r): r is string[] => Boolean(r)) : undefined}
        highlightRoute={saved ? undefined : evening?.baselineNodeIds}
        baselineRoute={saved ? undefined : morning?.baselineNodeIds}
        selectedNodeId={form.homeNodeId || undefined}
        onNodeClick={disabled ? undefined : onMapClick}
      >
        {adjusting && vias.map((id, i) => {
          const p = pos.get(id);
          if (!p) return null;
          return (
            <g key={`${id}-${i}`} className="commute-editor__wp-marker" pointerEvents="none">
              <circle cx={p.x} cy={p.y} r={14} fill="#1f6feb" stroke="#fff" strokeWidth={3} />
              <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={16} fontWeight={700} fill="#fff">{i + 1}</text>
            </g>
          );
        })}
      </CityMap>
      {saved && (
        <div className="commute-editor__saved" role="status">
          <p className="commute-editor__saved-title">{SAVED_TEXT}</p>
          {rematchedText(saved.rematchedShipmentIds, pkgNames) && <p>{rematchedText(saved.rematchedShipmentIds, pkgNames)}</p>}
        </div>
      )}
      <ul className="commute-editor__routes">
        <li>{routeLine('Evening', evening, labelOf, formatDuration)}</li>
        <li>{routeLine('Morning', morning, labelOf, formatDuration)}</li>
      </ul>
      </div>
      </div>

      <div className="commute-editor__save">
        {locked && (
          <p className="commute-editor__locked" role="status">
            {LOCKED_TEXT} <a href={SIMULATOR_PATH}>Open the simulator</a>
          </p>
        )}
        <Button onClick={submit} loading={saving} disabled={locked}>Save commute and find jobs</Button>
      </div>
    </Card>
  );
}
