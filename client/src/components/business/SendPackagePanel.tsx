import { useMemo, useRef, useState } from 'react';
import type { ShipmentResponse } from '../../../../shared/api';
import type { Business, Employee, Hub } from '../../../../shared/types';
import type { CreateShipmentRequest } from '../../../../shared/schemas';
import { ApiRequestError, createShipment, matchShipment, patchShipment } from '../../api';
import { ShipmentForm } from '../ShipmentForm';
import { MatchResultCard } from './MatchResultCard';
import { patchFromRequest } from './businessPortalModel';
import { formFromShipment, type FormState } from './shipmentFormModel';
import { Button } from '../../ui';
import './BusinessPortal.css';

export type SendPackagePanelProps = {
  origin: Business;
  businesses: Business[];
  hubs: Hub[];
  employees: Employee[];
  locked: boolean;
  /** Prefill for a duplicate (new request). */
  initial?: Partial<FormState>;
  /** Bumps to reset the panel to a fresh form (new clientRequestId). */
  resetKey: number;
  onViewTracking: (shipmentId: string) => void;
  /** Refetch the dashboard (called after every action). */
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
};

export function SendPackagePanel(p: SendPackagePanelProps) {
  const [result, setResult] = useState<ShipmentResponse | null>(null);
  const [editing, setEditing] = useState<{ id: string; initial: Partial<FormState> } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const busy = useRef(false);
  const [lastReset, setLastReset] = useState(p.resetKey);
  if (lastReset !== p.resetKey) {
    setLastReset(p.resetKey);
    setResult(null); setEditing(null); setFieldErrors({});
  }
  const formInitial = useMemo(() => editing?.initial ?? p.initial, [editing, p.initial]);

  async function run(action: () => Promise<ShipmentResponse>) {
    if (busy.current) return; // blocks double submission
    busy.current = true;
    setSubmitting(true);
    setFieldErrors({});
    try {
      const res = await action();
      setResult(res);
      setEditing(null);
      await p.onChanged();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 400 && e.fieldErrors) setFieldErrors(e.fieldErrors);
      else p.onError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const onSubmit = (req: CreateShipmentRequest) =>
    run(() => (editing ? patchShipment(editing.id, patchFromRequest(req)) : createShipment(req)));

  if (result && !editing) {
    return (
      <div className="bp-send">
        {submitting && <p role="status">Matching your package…</p>}
        <MatchResultCard
          response={result}
          businesses={p.businesses}
          hubs={p.hubs}
          employees={p.employees}
          onViewTracking={() => p.onViewTracking(result.shipment.id)}
          onEdit={() => setEditing({ id: result.shipment.id, initial: formFromShipment(result.shipment) })}
          onRetry={() => void run(() => matchShipment(result.shipment.id))}
        />
        <Button variant="secondary" onClick={() => { setResult(null); setFieldErrors({}); }}>Send another package</Button>
      </div>
    );
  }
  return (
    <div className="bp-send">
      {editing && <p>Editing request {editing.id}. Saving re-runs matching.</p>}
      <ShipmentForm
        origin={p.origin}
        businesses={p.businesses}
        locked={p.locked}
        submitting={submitting}
        fieldErrors={fieldErrors}
        initial={formInitial}
        onSubmit={(r) => void onSubmit(r)}
      />
      {editing && <Button variant="ghost" onClick={() => setEditing(null)} disabled={submitting}>Cancel edit</Button>}
    </div>
  );
}
