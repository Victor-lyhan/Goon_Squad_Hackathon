import type { Request, Response } from 'express';
import type { ShipmentResponse } from '../../shared/api';
import { CreateShipmentRequest, PatchShipmentRequest, type ApiError } from '../../shared/schemas';
import type { Run, Shipment } from '../../shared/types';
import { snapshotAt } from '../domain/simulation';
import type { Store } from '../store';
import { matchPending } from './pipeline';
import { shipmentView } from './views';

type Res = Response<ShipmentResponse | ApiError>;
const LOCKED = 'Start a new planning cycle to change deliveries';

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) fieldErrors[issue.path.join('.') || 'body'] ??= issue.message;
  return fieldErrors;
}

/** Business and time-window checks shared by POST and PATCH; keys are form field names. */
function checkAgainstRun(run: Run, v: Pick<Shipment, 'readyMin' | 'deadlineMin'> &
  { originBusinessId: string; destinationBusinessId: string }) {
  const errors: Record<string, string> = {};
  const ids = new Set(run.scenario.businesses.map((b) => b.id));
  if (!ids.has(v.originBusinessId)) errors.originBusinessId = 'Unknown business';
  if (!ids.has(v.destinationBusinessId)) errors.destinationBusinessId = 'Unknown business';
  const { simStartMin, simEndMin } = run.scenario.settings;
  if (v.readyMin < simStartMin || v.readyMin > simEndMin) errors.readyMin = 'Ready time is outside the planning window';
  if (v.deadlineMin < simStartMin || v.deadlineMin > simEndMin) errors.deadlineMin = 'Deliver-by is outside the planning window';
  return errors;
}

function respond(store: Store, id: string, res: Res, status = 200) {
  const run = store.get();
  const view = shipmentView(run, snapshotAt(run, run.clock.timeMin), id);
  if (!view) {
    res.status(404).json({ error: 'Shipment not found' });
    return;
  }
  res.status(status).json({ ...view, matched: view.plan !== null });
}

const isMatched = (run: Run, id: string) => run.assignments.plans.some((p) => p.shipmentId === id);

export const postShipment = (store: Store) => async (req: Request, res: Res) => {
  const parsed = CreateShipmentRequest.safeParse(req.body);
  if (!parsed.success) {
    // Also report unknown businesses / out-of-window times so one response lists every problem.
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : NaN);
    const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
    const extra = checkAgainstRun(store.get(), {
      originBusinessId: str('originBusinessId'), destinationBusinessId: str('destinationBusinessId'),
      readyMin: num('readyMin'), deadlineMin: num('deadlineMin'),
    });
    for (const k of Object.keys(extra)) {
      if (Number.isNaN(num(k)) && !(k.endsWith('Id') && str(k))) delete extra[k]; // missing: zod already said so
    }
    res.status(400).json({ error: 'Invalid shipment', fieldErrors: { ...extra, ...zodFieldErrors(parsed.error.issues) } });
    return;
  }
  const body = parsed.data;
  const before = store.get();
  if (before.clock.phase === 'locked') {
    res.status(409).json({ error: LOCKED });
    return;
  }
  const replay = before.scenario.shipments.find((s) => s.clientRequestId === body.clientRequestId);
  if (replay) {
    respond(store, replay.id, res, 200);
    return;
  }
  const fieldErrors = checkAgainstRun(before, body);
  if (Object.keys(fieldErrors).length) {
    res.status(400).json({ error: 'Invalid shipment', fieldErrors });
    return;
  }

  let id = '';
  let created = false;
  try {
    await store.mutate((run) => {
      // Re-check inside the serialized mutation so concurrent replays never double-create.
      const dup = run.scenario.shipments.find((s) => s.clientRequestId === body.clientRequestId);
      if (dup) { id = dup.id; return; }
      if (run.clock.phase === 'locked') throw new Error(LOCKED);
      const seq = run.scenario.shipments.reduce((m, s) => Math.max(m, s.createdSeq), 0) + 1;
      const { weightKg, ...rest } = body;
      const shipment: Shipment = { ...rest, id: `shp-${seq}`, weightGrams: Math.round(weightKg * 1000), createdSeq: seq };
      run.scenario.shipments.push(shipment);
      matchPending(run, [shipment.id]);
      id = shipment.id;
      created = true;
    });
  } catch (e) {
    const locked = (e as Error).message === LOCKED;
    res.status(locked ? 409 : 500).json({ error: (e as Error).message });
    return;
  }
  respond(store, id, res, created ? 201 : 200);
};

export const patchShipment = (store: Store) => async (req: Request, res: Res) => {
  const parsed = PatchShipmentRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid shipment', fieldErrors: zodFieldErrors(parsed.error.issues) });
    return;
  }
  const id = String(req.params.id);
  const run = store.get();
  const current = run.scenario.shipments.find((s) => s.id === id);
  if (!current) {
    res.status(404).json({ error: 'Shipment not found' });
    return;
  }
  if (run.clock.phase === 'locked') {
    res.status(409).json({ error: LOCKED });
    return;
  }
  if (isMatched(run, id)) {
    res.status(409).json({ error: 'This delivery is already matched and can no longer be edited' });
    return;
  }
  const { weightKg, ...rest } = parsed.data;
  const edits = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const next: Shipment = {
    ...current, ...edits,
    ...(weightKg !== undefined ? { weightGrams: Math.round(weightKg * 1000) } : {}),
  };
  const fieldErrors = checkAgainstRun(run, next);
  if (next.destinationBusinessId === next.originBusinessId) fieldErrors.destinationBusinessId = 'Choose a different business';
  if (next.deadlineMin <= next.readyMin) fieldErrors.deadlineMin = 'Deliver-by must be after ready time';
  if (Object.keys(fieldErrors).length) {
    res.status(400).json({ error: 'Invalid shipment', fieldErrors });
    return;
  }
  try {
    await store.mutate((r) => {
      const idx = r.scenario.shipments.findIndex((s) => s.id === id);
      if (idx < 0 || isMatched(r, id)) throw new Error('Shipment changed');
      r.scenario.shipments[idx] = next;
      matchPending(r, [id]);
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
    return;
  }
  respond(store, id, res);
};

export const postShipmentMatch = (store: Store) => async (req: Request, res: Res) => {
  const id = String(req.params.id);
  const run = store.get();
  if (!run.scenario.shipments.some((s) => s.id === id)) {
    res.status(404).json({ error: 'Shipment not found' });
    return;
  }
  if (run.clock.phase === 'locked') {
    res.status(409).json({ error: LOCKED });
    return;
  }
  if (!isMatched(run, id)) {
    try {
      await store.mutate((r) => { if (!isMatched(r, id)) matchPending(r, [id]); });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
      return;
    }
  }
  respond(store, id, res);
};
