// PATCH /api/v2/shipments/:id and POST /api/v2/shipments/:id/match through the real router.
// Create is in v2-shipment-route-create.test.ts; 503s and route lines in v2-shipment-route-errors.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import {
  INVALID_SHIPMENT, SAME_BUSINESS, SHIPMENT_MATCHED, SHIPMENT_NOT_FOUND, SHIPMENTS_LOCKED,
} from '../../server/api/v2/shipmentOps';
import { ApiError } from '../../shared/v2/schemas';
import { expectCleanErrorText } from './v2-shipment-ops-sample';
import {
  AGENCY, CAFE, NO_COMMUTE, PRINT,
  deliveryBody, expectShipmentResponse, expectUntouched, lock, notesFor, openMorningCommute, remember,
  startShipmentApp, type ShipmentApp,
} from './v2-shipment-route-helpers';

const TOO_LATE = 'No commute can arrive before the deadline';

let started: ShipmentApp[] = [];
const start = async () => {
  const app = await startShipmentApp();
  started.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

/** Agency -> Corner Cafe, due before emp-2 can get there (leaves 17:10, delivers 17:34): stored as shp-4, unmatched. */
async function createTooTight(app: ShipmentApp) {
  const reply = await app.create(deliveryBody({ deadlineMin: 1040 }));
  expect(reply.status).toBe(201);
  expect(expectShipmentResponse(app, reply)).toMatchObject({ matched: false, unmatchedReason: TOO_LATE });
  return reply;
}

describe('PATCH /api/v2/shipments/:id', () => {
  it('an unmatched request edited so that it matches: 200 with the edits, the plan, the job and the notifications', async () => {
    const app = await start();
    await createTooTight(app);
    const before = remember(app);

    const reply = await app.patch('shp-4', { deadlineMin: 1980, label: 'Catering order (evening)', weightKg: 0.75 });

    expect(reply.status).toBe(200);
    const body = expectShipmentResponse(app, reply);
    expect(body.shipment).toEqual({
      ...before.copy.scenario.shipments[3], deadlineMin: 1980, label: 'Catering order (evening)', weightGrams: 750,
    });
    expect(body.shipment).toMatchObject({ id: 'shp-4', clientRequestId: 'req-new', createdSeq: 4, originBusinessId: AGENCY });
    expect(body).toMatchObject({ matched: true, status: 'scheduled', unmatchedReason: null, jobIds: ['plan-shp-4-L0'] });
    expect(body.plan).toMatchObject({ id: 'plan-shp-4', kind: 'direct', deliveryMin: 1054 });
    expect(body.plan!.legs.map((l) => l.tripId)).toEqual(['emp-2-eve']);

    const run = app.store.get();
    expect(run.version).toBe(before.copy.version + 1);
    expect(run.scenario.shipments.map((s) => s.id)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(run.assignments.unmatched).toEqual([{ shipmentId: 'shp-3', reason: NO_COMMUTE }]);
    expect(notesFor(app, 'shp-4')).toEqual([
      [AGENCY, 'Delivery arranged: "Catering order (evening)" to Corner Cafe, $7.00.'],
      [CAFE, 'Incoming delivery: "Catering order (evening)" from Midtown Agency.'],
      ['emp-2', 'New delivery job: "Catering order (evening)". Collect from Midtown Agency and deliver to Corner Cafe. Reward $3.00.'],
    ]);
    // The route lines of the new plan are asked for once (the unmatched create asked for none).
    expect(app.lines.calls.map((c) => c.legs)).toEqual([body.plan!.legs]);
  });

  it('an edit that still finds no match: 200 with matched false, the reason and the stored edits', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.patch('shp-3', { label: 'Pastry box (large)', dropoffInstructions: 'Back door' });

    expect(reply.status).toBe(200);
    const body = expectShipmentResponse(app, reply);
    expect(body).toMatchObject({ matched: false, plan: null, jobIds: [], unmatchedReason: NO_COMMUTE });
    expect(body.shipment).toEqual({
      ...before.copy.scenario.shipments[2], label: 'Pastry box (large)', dropoffInstructions: 'Back door',
    });
    const run = app.store.get();
    expect(run.version).toBe(before.copy.version + 1);
    expect(run.assignments.unmatched).toEqual([{ shipmentId: 'shp-3', reason: NO_COMMUTE }]);
    expect(run.assignments.plans).toEqual(before.copy.assignments.plans);
    expect(run.notifications).toEqual(before.copy.notifications);
    expect(app.lines.calls).toEqual([]);
  });

  it('a new recipient is matched from scratch: the old reason goes, the new one is stored', async () => {
    const app = await start();
    await createTooTight(app);

    // Agency -> Print Shop by tonight: emp-3's trip already carries shp-2, emp-2 would need 14 extra minutes.
    const reply = await app.patch('shp-4', { destinationBusinessId: PRINT, deadlineMin: 1980 });

    expect(reply.status).toBe(200);
    const body = expectShipmentResponse(app, reply);
    expect(body.shipment).toMatchObject({ destinationBusinessId: PRINT, deadlineMin: 1980 });
    expect(body.matched).toBe(false);
    expect(body.unmatchedReason).not.toBe(TOO_LATE);
    expect(app.store.get().assignments.unmatched.filter((u) => u.shipmentId === 'shp-4')).toHaveLength(1);
  });

  it('409 for a matched delivery', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.patch('shp-1', { label: 'Renamed' });

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: SHIPMENT_MATCHED });
    expect(ApiError.parse(reply.body)).toEqual({ error: SHIPMENT_MATCHED });
    expectCleanErrorText(reply.body);
    expectUntouched(app, before);
  });

  it('409 for a delivery that this route matched a moment ago', async () => {
    const app = await start();
    expect((await app.create(deliveryBody())).status).toBe(201);
    const before = remember(app);

    const reply = await app.patch('shp-4', { label: 'Renamed' });

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: SHIPMENT_MATCHED });
    expectUntouched(app, before);
  });

  it('404 for an unknown ID', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.patch('shp-99', { label: 'Renamed' });

    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ error: SHIPMENT_NOT_FOUND });
    expect(ApiError.parse(reply.body)).toEqual({ error: SHIPMENT_NOT_FOUND });
    expectUntouched(app, before);
  });

  it('400 with every problem of the edit, keyed by field', async () => {
    const app = await start();
    const before = remember(app);

    // shp-3 is sent by the cafe.
    const reply = await app.patch('shp-3', { weightKg: 9, destinationBusinessId: CAFE });

    expect(reply.status).toBe(400);
    expect(ApiError.parse(reply.body)).toEqual({
      error: INVALID_SHIPMENT, fieldErrors: { destinationBusinessId: SAME_BUSINESS, weightKg: 'Max 2 kg' },
    });
    expectCleanErrorText(reply.body);
    expectUntouched(app, before);
  });

  it('409 when the run is locked', async () => {
    const app = await start();
    await lock(app);
    const before = remember(app);

    const reply = await app.patch('shp-3', { label: 'Renamed' });

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: SHIPMENTS_LOCKED });
    expectUntouched(app, before);
    expect(app.snapshots).toEqual([]);
    expect(app.lines.calls).toEqual([]);
  });
});

describe('POST /api/v2/shipments/:id/match', () => {
  it('retry after a commute change that makes it feasible: 200 with the plan, the job and the notifications', async () => {
    const app = await start();
    const first = await app.retry('shp-3');
    expect(expectShipmentResponse(app, first)).toMatchObject({ matched: false, unmatchedReason: NO_COMMUTE });
    await openMorningCommute(app);
    const before = remember(app);

    const reply = await app.retry('shp-3');

    expect(reply.status).toBe(200);
    const body = expectShipmentResponse(app, reply);
    expect(body).toMatchObject({ matched: true, status: 'scheduled', unmatchedReason: null, jobIds: ['plan-shp-3-L0'] });
    expect(body.shipment).toEqual(before.copy.scenario.shipments[2]);
    expect(body.plan).toMatchObject({ id: 'plan-shp-3', kind: 'direct', deliveryMin: 1954 });
    expect(body.plan!.legs[0]).toMatchObject({ tripId: 'emp-1-morn', employeeId: 'emp-1', placeIds: ['home-001', CAFE, PRINT] });

    const run = app.store.get();
    expect(run.version).toBe(before.copy.version + 1);
    expect(run.assignments.unmatched).toEqual([]);
    expect(run.scenario.shipments).toEqual(before.copy.scenario.shipments);
    expect(notesFor(app, 'shp-3')).toEqual([
      [CAFE, 'Delivery arranged: "Pastry box" to Northside Print Shop, $7.00.'],
      [PRINT, 'Incoming delivery: "Pastry box" from Corner Cafe.'],
      ['emp-1', 'New delivery job: "Pastry box". Collect from Corner Cafe and deliver to Northside Print Shop. Reward $3.00.'],
    ]);
    for (const id of ['shp-1', 'shp-2']) {
      expect(run.assignments.plans.find((p) => p.shipmentId === id))
        .toEqual(before.copy.assignments.plans.find((p) => p.shipmentId === id));
    }
    expect(app.lines.calls.map((c) => c.legs)).toEqual([body.plan!.legs]);
  });

  it('retry that still finds no match: 200 with matched false and the reason, listed once', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.retry('shp-3');

    expect(reply.status).toBe(200);
    expect(expectShipmentResponse(app, reply)).toMatchObject({ matched: false, plan: null, unmatchedReason: NO_COMMUTE });
    const run = app.store.get();
    expect(run.assignments.unmatched).toEqual([{ shipmentId: 'shp-3', reason: NO_COMMUTE }]);
    expect(run.assignments.plans).toEqual(before.copy.assignments.plans);
    expect(run.jobs).toEqual(before.copy.jobs);
    expect(run.notifications).toEqual(before.copy.notifications);
    expect(app.lines.calls).toEqual([]);
  });

  it('retry of an already matched delivery: 200 with the current view, nothing changes', async () => {
    const app = await start();
    app.progress['shp-1'] = 'at_hub';
    const before = remember(app);

    const reply = await app.retry('shp-1');

    expect(reply.status).toBe(200);
    const body = expectShipmentResponse(app, reply);
    expect(body).toMatchObject({ matched: true, status: 'at_hub', jobIds: ['plan-shp-1-L0', 'plan-shp-1-L1'] });
    expect(body.plan).toEqual(before.copy.assignments.plans.find((p) => p.shipmentId === 'shp-1'));
    expectUntouched(app, before);
    // The snapshot is taken on the run the answer is about, at its clock.
    expect(app.snapshots).toHaveLength(1);
    expect(app.snapshots[0].run).toEqual(before.copy);
    expect(app.snapshots[0].timeMin).toBe(before.copy.clock.timeMin);
    // Its route lines were asked for when it was matched.
    expect(app.lines.calls).toEqual([]);
  });

  it('404 for an unknown ID', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.retry('shp-99');

    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ error: SHIPMENT_NOT_FOUND });
    expectUntouched(app, before);
  });

  it.each(['shp-3', 'shp-1'])('409 when the run is locked (%s)', async (shipmentId) => {
    const app = await start();
    await lock(app);
    const before = remember(app);

    const reply = await app.retry(shipmentId);

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: SHIPMENTS_LOCKED });
    expect(ApiError.parse(reply.body)).toEqual({ error: SHIPMENTS_LOCKED });
    expectUntouched(app, before);
    expect(app.snapshots).toEqual([]);
  });
});
