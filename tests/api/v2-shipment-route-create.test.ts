// POST /api/v2/shipments through the real router: a new delivery (direct, relay, no match), the replay of a
// `clientRequestId`, parallel creates, and every refusal (400 per field group, 409 when locked).
// Edit and retry are in v2-shipment-route-edit.test.ts; 503s and route lines in v2-shipment-route-errors.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, INVALID_SHIPMENT, READY_OUTSIDE_WINDOW, SAME_BUSINESS,
  SHIPMENTS_LOCKED, UNKNOWN_BUSINESS,
} from '../../server/api/v2/shipmentOps';
import { ApiError } from '../../shared/v2/schemas';
import { expectCleanErrorText } from './v2-shipment-ops-sample';
import {
  AGENCY, ALL_CARRYING, CAFE, NO_COMMUTE, PRINT,
  deliveryBody, emptyCity, expectShipmentResponse, expectUntouched, lock, notesFor, remember, startShipmentApp,
  type ShipmentApp,
} from './v2-shipment-route-helpers';

let started: ShipmentApp[] = [];
const start = async (opts?: Parameters<typeof startShipmentApp>[0]) => {
  const app = await startShipmentApp(opts);
  started.push(app);
  return app;
};
afterEach(async () => {
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

const shipmentIds = (app: ShipmentApp) => app.store.get().scenario.shipments.map((s) => s.id);
const planOf = (app: ShipmentApp, shipmentId: string) =>
  app.store.get().assignments.plans.find((p) => p.shipmentId === shipmentId);

describe('POST /api/v2/shipments: a new delivery', () => {
  it('direct match: 201 with the stored delivery, its plan, one job and the notifications; version +1', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(201);
    const body = expectShipmentResponse(app, reply);
    expect(body.shipment).toEqual({
      id: 'shp-4', clientRequestId: 'req-new', label: 'Catering order',
      originBusinessId: AGENCY, destinationBusinessId: CAFE, readyMin: 960, deadlineMin: 1980,
      category: 'small_box', description: 'Lunch for twelve', weightGrams: 1500,
      pickupInstructions: 'Ask at the front desk', dropoffInstructions: 'Hand to the barista', createdSeq: 4,
    });
    expect(body).toMatchObject({ matched: true, status: 'scheduled', deliveredAtMin: null, unmatchedReason: null });
    expect(body.plan).toMatchObject({ id: 'plan-shp-4', kind: 'direct', deliveryMin: 1054, customerPriceCents: 700 });
    expect(body.plan).not.toHaveProperty('relayBusinessId');
    expect(body.plan!.legs).toHaveLength(1);
    expect(body.plan!.legs[0]).toMatchObject({ tripId: 'emp-2-eve', employeeId: 'emp-2', placeIds: [AGENCY, CAFE, 'home-002'] });
    expect(body.jobIds).toEqual(['plan-shp-4-L0']);

    const run = app.store.get();
    expect(run.version).toBe(before.copy.version + 1);
    expect(shipmentIds(app)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(run.jobs.find((j) => j.id === 'plan-shp-4-L0')).toMatchObject({
      employeeId: 'emp-2', legIndex: 0, tripId: 'emp-2-eve',
      pickup: { placeId: AGENCY, kind: 'pickup' }, dropoff: { placeId: CAFE, kind: 'delivery' },
    });
    // Sender, recipient and the carrier.
    expect(notesFor(app, 'shp-4')).toEqual([
      [AGENCY, 'Delivery arranged: "Catering order" to Corner Cafe, $7.00.'],
      [CAFE, 'Incoming delivery: "Catering order" from Midtown Agency.'],
      ['emp-2', 'New delivery job: "Catering order". Collect from Midtown Agency and deliver to Corner Cafe. Reward $3.00.'],
    ]);
    // The deliveries that were there before keep their plans, jobs and notifications.
    for (const id of ['shp-1', 'shp-2']) {
      expect(planOf(app, id)).toEqual(before.copy.assignments.plans.find((p) => p.shipmentId === id));
    }
    expect(run.notifications.filter((n) => n.shipmentId !== 'shp-4')).toEqual(before.copy.notifications);
    expect(run.assignments.unmatched).toEqual(before.copy.assignments.unmatched);
    expect(run.events).toHaveLength(before.copy.events.length + 1);
  });

  it('relay match: 201 with two legs, one job per leg, and notifications that name the relay business', async () => {
    const app = await start({ scenario: emptyCity() });
    expect(app.store.get().version).toBe(0);

    const reply = await app.create(deliveryBody({ originBusinessId: PRINT, destinationBusinessId: AGENCY, label: 'Poster proofs' }));

    expect(reply.status).toBe(201);
    const body = expectShipmentResponse(app, reply);
    expect(body.shipment).toMatchObject({ id: 'shp-1', createdSeq: 1, originBusinessId: PRINT, destinationBusinessId: AGENCY });
    expect(body.matched).toBe(true);
    expect(body.plan).toMatchObject({ id: 'plan-shp-1', kind: 'relay', relayBusinessId: CAFE, deliveryMin: 1964 });
    expect(body.plan!.legs.map((l) => [l.tripId, l.employeeId, l.placeIds])).toEqual([
      ['emp-1-eve', 'emp-1', [PRINT, CAFE, 'home-001']],
      ['emp-2-morn', 'emp-2', ['home-002', CAFE, AGENCY]],
    ]);
    expect(body.plan!.legs.map((l) => l.stops.map((s) => [s.placeId, s.kind]))).toEqual([
      [[PRINT, 'pickup'], [CAFE, 'hub_drop']],
      [[CAFE, 'hub_pickup'], [AGENCY, 'delivery']],
    ]);
    expect(body.jobIds).toEqual(['plan-shp-1-L0', 'plan-shp-1-L1']);

    const run = app.store.get();
    expect(run.version).toBe(1);
    expect(run.jobs.map((j) => [j.id, j.employeeId, j.legIndex])).toEqual([
      ['plan-shp-1-L0', 'emp-1', 0], ['plan-shp-1-L1', 'emp-2', 1],
    ]);
    // Sender, recipient and both carriers: each message names the relay business (DECISIONS pass 46).
    // The relay business gets its own message, which says "here" (DECISIONS pass 57).
    const notes = notesFor(app, 'shp-1');
    expect(notes).toEqual([
      [PRINT, 'Delivery arranged: "Poster proofs" to Midtown Agency via Corner Cafe (relay point), $10.50.'],
      [AGENCY, 'Incoming delivery: "Poster proofs" from Northside Print Shop via Corner Cafe (relay point).'],
      [CAFE, 'Relay point: "Poster proofs" from Northside Print Shop to Midtown Agency is dropped here in the evening and collected the next morning.'],
      ['emp-1', 'New delivery job: "Poster proofs". Drop at Corner Cafe; another employee completes delivery. Reward $3.00.'],
      ['emp-2', 'New delivery job: "Poster proofs". Collect from Corner Cafe and deliver to Midtown Agency. Reward $3.00.'],
    ]);
    for (const [audienceId, message] of notes) {
      expect(message).toContain(audienceId === CAFE ? 'Relay point' : 'Corner Cafe');
      expect(message).not.toMatch(/hub/i);
    }
    expect(run.events).toHaveLength(2);
  });

  it('no match: 201 with matched false and the reason, never an error; the delivery is stored', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.create(deliveryBody({ originBusinessId: CAFE, destinationBusinessId: PRINT }));

    expect(reply.status).toBe(201);
    const body = expectShipmentResponse(app, reply);
    expect(body).toMatchObject({
      matched: false, plan: null, jobIds: [], status: 'unmatched', deliveredAtMin: null, unmatchedReason: NO_COMMUTE,
    });
    expect(body.shipment.id).toBe('shp-4');
    expect(reply.body).not.toHaveProperty('error');

    const run = app.store.get();
    expect(run.version).toBe(before.copy.version + 1);
    expect(shipmentIds(app)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(run.assignments.unmatched).toEqual([
      { shipmentId: 'shp-3', reason: NO_COMMUTE }, { shipmentId: 'shp-4', reason: NO_COMMUTE },
    ]);
    expect(notesFor(app, 'shp-4')).toEqual([]);
    expect(run.assignments.plans).toEqual(before.copy.assignments.plans);
    expect(run.jobs).toEqual(before.copy.jobs);
    expect(run.notifications).toEqual(before.copy.notifications);
  });

  it('no match because the only commute is taken: the second delivery on the same trip is a 201 with its own reason', async () => {
    const app = await start();
    expect((await app.create(deliveryBody())).status).toBe(201);

    const reply = await app.create(deliveryBody({ clientRequestId: 'req-second' }));

    expect(reply.status).toBe(201);
    const body = expectShipmentResponse(app, reply);
    expect(body).toMatchObject({ matched: false, unmatchedReason: ALL_CARRYING });
    expect(body.shipment.id).toBe('shp-5');
    expect(planOf(app, 'shp-4')!.legs[0].tripId).toBe('emp-2-eve');
  });

  it('reads status and delivered time from snapshotAt, taken once at the clock of the stored run', async () => {
    const app = await start();
    // A preview moved the clock. The request that stores the delivery puts it back at the start (930).
    await app.store.mutate((run) => {
      run.clock.timeMin = 1100;
    });
    app.progress['shp-4'] = 'delivered';
    app.deliveredAtMin['shp-4'] = 1054;

    const body = expectShipmentResponse(app, await app.create(deliveryBody()));

    expect(body).toMatchObject({ status: 'delivered', deliveredAtMin: 1054, matched: true });
    expect(app.snapshots).toHaveLength(1);
    expect(app.snapshots[0].run).toBe(app.store.get());
    expect(app.snapshots[0].timeMin).toBe(930);
    expect(app.store.get().clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });
  });
});

describe('POST /api/v2/shipments: the same clientRequestId again', () => {
  it('answers 200 with the same delivery and changes nothing: no second shipment, same version', async () => {
    const app = await start();
    const first = await app.create(deliveryBody());
    expect(first.status).toBe(201);
    const after = remember(app);

    const second = await app.create(deliveryBody());

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(expectShipmentResponse(app, second).shipment.id).toBe('shp-4');
    expectUntouched(app, after);
    expect(shipmentIds(app)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(app.store.get().version).toBe(1);
  });

  it('answers the stored delivery even when the repeated body differs', async () => {
    const app = await start();
    const first = await app.create(deliveryBody());
    const after = remember(app);

    const second = await app.create(deliveryBody({ label: 'Something else', destinationBusinessId: PRINT, weightKg: 0.2 }));

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expectUntouched(app, after);
  });

  it('replays an unmatched delivery as 200 with matched false and its reason', async () => {
    const app = await start();
    const body = deliveryBody({ originBusinessId: CAFE, destinationBusinessId: PRINT });
    const first = await app.create(body);
    expect(first.status).toBe(201);
    const after = remember(app);

    const second = await app.create(body);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(expectShipmentResponse(app, second)).toMatchObject({ matched: false, unmatchedReason: NO_COMMUTE });
    expectUntouched(app, after);
  });

  it('sent three times in parallel: one 201, two 200, one shipment, version +1', async () => {
    const app = await start();

    const replies = await Promise.all([1, 2, 3].map(() => app.create(deliveryBody())));

    expect(replies.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    for (const reply of replies) {
      expect(expectShipmentResponse(app, reply).shipment.id).toBe('shp-4');
      expect(reply.body).toEqual(replies[0].body);
    }
    expect(shipmentIds(app)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);
    expect(app.store.get().version).toBe(1);
    expect(app.store.get().jobs.filter((j) => j.shipmentId === 'shp-4')).toHaveLength(1);
    expect(notesFor(app, 'shp-4')).toHaveLength(3);
  });
});

describe('POST /api/v2/shipments: two different deliveries in parallel', () => {
  it('stores two shipments with the next two IDs; the free commute goes to the first one stored', async () => {
    const app = await start();

    const replies = await Promise.all([
      app.create(deliveryBody({ clientRequestId: 'req-a', label: 'Order A' })),
      app.create(deliveryBody({ clientRequestId: 'req-b', label: 'Order B' })),
    ]);

    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    const bodies = replies.map((reply) => expectShipmentResponse(app, reply));
    expect(bodies.map((b) => b.shipment.id).sort()).toEqual(['shp-4', 'shp-5']);
    expect(bodies.map((b) => b.shipment.clientRequestId)).toEqual(['req-a', 'req-b']);
    for (const body of bodies) expect(body.shipment.id).toBe(`shp-${body.shipment.createdSeq}`);

    // Both want emp-2's evening trip. Whichever was stored first is shp-4 and has it.
    const byId = new Map(bodies.map((b) => [b.shipment.id, b]));
    expect(byId.get('shp-4')).toMatchObject({ matched: true, jobIds: ['plan-shp-4-L0'] });
    expect(byId.get('shp-5')).toMatchObject({ matched: false, unmatchedReason: ALL_CARRYING });

    const run = app.store.get();
    expect(run.version).toBe(2);
    expect(shipmentIds(app)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4', 'shp-5']);
    expect(run.scenario.shipments.map((s) => s.createdSeq)).toEqual([1, 2, 3, 4, 5]);
    const reserved = run.assignments.plans.flatMap((p) => p.legs.map((l) => l.tripId));
    expect(new Set(reserved).size).toBe(reserved.length);
  });
});

describe('POST /api/v2/shipments: refusals leave the run as it was', () => {
  const REQUIRED = {
    clientRequestId: 'The delivery details did not arrive, so reload the page and send again', originBusinessId: 'Choose a sender',
    destinationBusinessId: 'Choose a recipient', label: 'Package name is required',
    category: 'Choose a package type', description: 'Describe the contents', weightKg: 'Enter the weight in kg',
    readyMin: 'Choose a ready time', deadlineMin: 'Choose a deliver-by time',
  };

  it.each<[string, unknown, Record<string, string>]>([
    ['no body', undefined, { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['a body that is not an object', [deliveryBody()], { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['missing fields', {}, REQUIRED],
    ['package fields', deliveryBody({ clientRequestId: '', label: '  ', category: 'crate', description: 5, weightKg: 3 }), {
      clientRequestId: 'The delivery details did not arrive, so reload the page and send again', label: 'Package name is required',
      category: 'Choose envelope or small box', description: 'The description must be text', weightKg: 'Max 2 kg',
    }],
    ['unknown businesses', deliveryBody({ originBusinessId: 'biz-nowhere', destinationBusinessId: 'biz-nobody' }), {
      originBusinessId: UNKNOWN_BUSINESS, destinationBusinessId: UNKNOWN_BUSINESS,
    }],
    ['sender and recipient are the same', deliveryBody({ destinationBusinessId: AGENCY }), { destinationBusinessId: SAME_BUSINESS }],
    ['times outside the planning window', deliveryBody({ readyMin: 100, deadlineMin: 2500 }), {
      readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW,
    }],
    ['deliver-by before ready', deliveryBody({ readyMin: 1500, deadlineMin: 1400 }), { deadlineMin: DEADLINE_BEFORE_READY }],
    ['instructions that are not text', deliveryBody({ pickupInstructions: 7, dropoffInstructions: ['x'] }), {
      pickupInstructions: 'Pickup instructions must be text', dropoffInstructions: 'Drop-off instructions must be text',
    }],
  ])('400 for %s', async (_name, sent, fieldErrors) => {
    const app = await start();
    const before = remember(app);

    const reply = await app.create(sent);

    expect(reply.status).toBe(400);
    expect(ApiError.parse(reply.body)).toEqual({ error: INVALID_SHIPMENT, fieldErrors });
    expect(Object.keys(reply.body).sort()).toEqual(['error', 'fieldErrors']);
    expectCleanErrorText(reply.body);
    expectUntouched(app, before);
    expect(app.snapshots).toEqual([]);
    expect(app.lines.calls).toEqual([]);
  });

  it('400 for a body that is not JSON', async () => {
    const app = await start();
    const before = remember(app);

    const reply = await app.request('POST', '/shipments', '{"clientRequestId": ');

    expect(reply.status).toBe(400);
    expect(ApiError.parse(reply.body)).toEqual({ error: 'Request body is not valid JSON' });
    expectUntouched(app, before);
  });

  it('409 when the run is locked', async () => {
    const app = await start();
    await lock(app);
    const before = remember(app);

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(409);
    expect(ApiError.parse(reply.body)).toEqual({ error: SHIPMENTS_LOCKED });
    expect(reply.body).toEqual({ error: SHIPMENTS_LOCKED });
    expectUntouched(app, before);
    expect(app.snapshots).toEqual([]);
    expect(app.lines.calls).toEqual([]);
  });

  it('a refused request does not use up an ID: the next valid one is still the next ID', async () => {
    const app = await start();
    expect((await app.create(deliveryBody({ weightKg: 5 }))).status).toBe(400);

    const reply = await app.create(deliveryBody());

    expect(reply.status).toBe(201);
    expect(expectShipmentResponse(app, reply).shipment.id).toBe('shp-4');
    expect(app.store.get().version).toBe(1);
  });
});
