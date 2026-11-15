import { afterEach, describe, expect, it, vi } from 'vitest';
import { TravelDataMissingError, pairKey, type DeliveryPlan, type Notification, type Run } from '../../shared/v2/types';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { buildTrips } from '../../server/domain/v2/trips';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { matchContext, matchPending, materializeAssignment } from '../../server/api/v2/pipeline';
import {
  AGENCY, CAFE, PRINT, sampleDeps, sampleScenario, sampleShipment, sampleTable, stubEvents, tableTravel,
} from './v2-pipeline-sample';
import { startReadApi, type ReadApi } from './v2-read-routes-helper';

const RELAY_NOTE = 'Relay point: "Poster proofs" from Northside Print Shop to Midtown Agency is dropped here in the evening and collected the next morning.';

const freshRun = (): Run => createInitialRun(sampleScenario(), sampleDeps());

/** What a write route does before `matchPending`: store the shipment in the scenario. */
function addShipment(run: Run, n: number, label: string, from: string, to: string) {
  const shipment = sampleShipment(n, label, from, to);
  run.scenario.shipments.push(shipment);
  return shipment;
}

const planFor = (run: Run, shipmentId: string) => {
  const plan = run.assignments.plans.find((p) => p.shipmentId === shipmentId);
  if (!plan) throw new Error(`no plan for ${shipmentId}`);
  return plan;
};

/** Every plan that existed before is still there as the very same object. */
const expectSamePlanObjects = (run: Run, before: DeliveryPlan[]) => {
  for (const plan of before) expect(planFor(run, plan.shipmentId)).toBe(plan);
};

const reservedTripIds = (run: Run) => run.assignments.plans.flatMap((p) => p.legs.map((l) => l.tripId));

const bySeq = <T extends { createdSeq: number }>(list: T[]) => [...list].sort((a, b) => a.createdSeq - b.createdSeq);

const idAndSeq = (list: Notification[]) => list.map((n) => [n.id, n.createdSeq]);
const forBusiness = (list: Notification[], businessId: string) =>
  list.filter((n) => n.audience === 'business' && n.audienceId === businessId);

const expectCleanCopy = (run: Run) => {
  for (const { message } of run.notifications) {
    expect(message).not.toMatch(/hub/i);
    expect(message).not.toContain('undefined');
    expect(message).not.toMatch(/\b(biz|home|emp|shp|plan)-/);
  }
};

describe('v2 matchContext', () => {
  it("is the matcher's context: the run's trips and the scenario's employees, businesses and settings", () => {
    const run = freshRun();
    const travel = tableTravel();
    const ctx = matchContext(run, travel);
    expect(ctx.travel).toBe(travel);
    expect(ctx.trips).toBe(run.trips);
    expect(ctx.employees).toBe(run.scenario.employees);
    expect(ctx.businesses).toBe(run.scenario.businesses);
    expect(ctx.settings).toBe(run.scenario.settings);
    expect(Object.keys(ctx).sort()).toEqual(['businesses', 'employees', 'settings', 'travel', 'trips']);
  });
});

describe('v2 materializeAssignment', () => {
  it('gives identical notifications when applied twice in a row', () => {
    const run = freshRun();
    const once = materializeAssignment(run, run.assignments, sampleDeps());
    expect(once.notifications).toEqual(run.notifications);
    const twice = materializeAssignment({ ...run, ...once }, once.assignments, sampleDeps());
    expect(twice.notifications).toEqual(run.notifications);
    expect(twice.jobs).toEqual(run.jobs);
    expect(twice.events).toEqual(run.events);
    expect(twice.assignments).toBe(run.assignments);
  });

  it('does not write into the run', () => {
    const run = freshRun();
    const before = structuredClone(run);
    materializeAssignment(run, { ...run.assignments, plans: [] }, sampleDeps());
    expect(run).toEqual(before);
  });

  it("removes a removed plan's jobs and notifications and keeps the createdSeq of the rest", () => {
    const run = freshRun();
    const [relay, direct] = run.assignments.plans;
    const without = materializeAssignment(run, { ...run.assignments, plans: [direct] }, sampleDeps());
    expect(without.jobs.map((j) => j.id)).toEqual(['plan-shp-2-L0']);
    expect(without.notifications.map((n) => [n.id, n.createdSeq])).toEqual([
      ['ntf-plan-shp-2-biz-agency', 6],
      ['ntf-plan-shp-2-biz-print-shop', 7],
      ['ntf-plan-shp-2-L0', 8],
    ]);
    expect(without.notifications).toEqual(run.notifications.filter((n) => n.planId === direct.id));

    // The plan comes back: its notifications are new, numbered after everything seen so far.
    const back = materializeAssignment({ ...run, ...without }, { ...run.assignments, plans: [relay, direct] }, sampleDeps());
    expect(back.notifications.map((n) => [n.id, n.createdSeq])).toEqual([
      ['ntf-plan-shp-1-biz-print-shop', 9],
      ['ntf-plan-shp-1-biz-agency', 10],
      ['ntf-plan-shp-1-biz-cafe', 11],
      ['ntf-plan-shp-1-L0', 12],
      ['ntf-plan-shp-1-L1', 13],
      ['ntf-plan-shp-2-biz-agency', 6],
      ['ntf-plan-shp-2-biz-print-shop', 7],
      ['ntf-plan-shp-2-L0', 8],
    ]);
  });

  it('refreshes the text of an existing notification in place', () => {
    const run = freshRun();
    run.scenario.shipments[0].label = 'Poster proofs (v2)';
    run.scenario.businesses.find((b) => b.id === CAFE)!.name = 'Corner Bakery';
    const again = materializeAssignment(run, run.assignments, sampleDeps());
    expect(again.notifications.map((n) => [n.id, n.createdSeq])).toEqual(run.notifications.map((n) => [n.id, n.createdSeq]));
    expect(again.notifications[0].message)
      .toBe('Delivery arranged: "Poster proofs (v2)" to Midtown Agency via Corner Bakery (relay point), $10.50.');
    // The relay point's own message says "here", so only the label changes in it.
    expect(again.notifications[2].message)
      .toBe('Relay point: "Poster proofs (v2)" from Northside Print Shop to Midtown Agency is dropped here in the evening and collected the next morning.');
    expect(again.notifications[3].message)
      .toBe('New delivery job: "Poster proofs (v2)". Drop at Corner Bakery; another employee completes delivery. Reward $3.00.');
  });

  it('never prints a raw ID when a business does not resolve', () => {
    const run = freshRun();
    run.scenario.businesses = run.scenario.businesses.filter((b) => b.id === PRINT);
    const { notifications } = materializeAssignment(run, run.assignments, sampleDeps());
    expect(notifications.map((n) => n.message)).toEqual([
      'Delivery arranged: "Poster proofs" to Unknown place via a relay point, $10.50.',
      'Incoming delivery: "Poster proofs" from Northside Print Shop via a relay point.',
      'Relay point: "Poster proofs" from Northside Print Shop to Unknown place is dropped here in the evening and collected the next morning.',
      'New delivery job: "Poster proofs". Drop at the relay point; another employee completes delivery. Reward $3.00.',
      'New delivery job: "Poster proofs". Collect from the relay point and deliver to Unknown place. Reward $3.00.',
      'Delivery arranged: "Signed contract" to Northside Print Shop, $7.00.',
      'Incoming delivery: "Signed contract" from Unknown place.',
      'New delivery job: "Signed contract". Collect from Unknown place and deliver to Northside Print Shop. Reward $3.00.',
    ]);
    expectCleanCopy({ ...run, notifications });
  });

  it('skips a plan whose shipment is gone, but still gives it jobs for the timeline', () => {
    const run = freshRun();
    run.scenario.shipments = run.scenario.shipments.filter((s) => s.id !== 'shp-1');
    const out = materializeAssignment(run, run.assignments, sampleDeps());
    expect(out.jobs).toHaveLength(3);
    expect(out.notifications.every((n) => n.planId === 'plan-shp-2')).toBe(true);
  });
});

describe('v2 relay-point notification (#535)', () => {
  it('tells the relay business of a relay plan once: audience, ID, kind, shipment, plan and text', () => {
    const run = freshRun();
    const relay = planFor(run, 'shp-1');
    expect(relay).toMatchObject({ kind: 'relay', relayBusinessId: CAFE });
    expect(forBusiness(run.notifications, CAFE)).toEqual([{
      id: 'ntf-plan-shp-1-biz-cafe', audience: 'business', audienceId: CAFE, kind: 'delivery_matched',
      shipmentId: 'shp-1', planId: 'plan-shp-1', message: RELAY_NOTE, createdSeq: 3,
    }]);
    // "relay point", never "hub"; no employee, no home, no raw ID.
    expect(RELAY_NOTE).not.toMatch(/hub|home/i);
    for (const { name } of run.scenario.employees) expect(RELAY_NOTE).not.toMatch(new RegExp(`\\b${name}\\b`));
    expectCleanCopy(run);
    // Sender and recipient keep their own messages.
    expect(run.notifications.filter((n) => n.planId === relay.id && n.audience === 'business').map((n) => n.audienceId))
      .toEqual([PRINT, AGENCY, CAFE]);
  });

  it('adds nothing for a direct plan: sender and recipient only', () => {
    const run = freshRun();
    const direct = planFor(run, 'shp-2');
    expect(direct.kind).toBe('direct');
    expect(direct.relayBusinessId).toBeUndefined();
    expect(run.notifications.filter((n) => n.planId === direct.id).map((n) => n.id)).toEqual([
      'ntf-plan-shp-2-biz-agency', 'ntf-plan-shp-2-biz-print-shop', 'ntf-plan-shp-2-L0',
    ]);
    // Every plan: two business notifications, plus one more only when it is a relay plan.
    for (const plan of run.assignments.plans) {
      const business = run.notifications.filter((n) => n.planId === plan.id && n.audience === 'business');
      expect(business, plan.id).toHaveLength(plan.kind === 'relay' ? 3 : 2);
    }
  });

  it('is idempotent: the pipeline run twice gives the same notifications with the same createdSeq', () => {
    const run = freshRun();
    const first = structuredClone(run.notifications);
    expect(idAndSeq(first)).toContainEqual(['ntf-plan-shp-1-biz-cafe', 3]);

    // Materialize the same plans again, twice, as a recompute does.
    Object.assign(run, materializeAssignment(run, run.assignments, sampleDeps()));
    expect(run.notifications).toEqual(first);
    Object.assign(run, materializeAssignment(run, run.assignments, sampleDeps()));
    expect(run.notifications).toEqual(first);

    // The incremental match run twice for the same shipment: nothing twice, nothing renumbered.
    addShipment(run, 4, 'Catering order', AGENCY, CAFE);
    matchPending(run, ['shp-4'], sampleDeps());
    const afterOne = structuredClone(run.notifications);
    matchPending(run, ['shp-4'], sampleDeps());
    expect(run.notifications).toEqual(afterOne);
    expect(afterOne.filter((n) => n.planId !== 'plan-shp-4')).toEqual(first);
    const ids = run.notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a relay plan that disappears after a recompute takes its relay notification with it', () => {
    const run = freshRun();
    const [relay, direct] = run.assignments.plans;
    expect(forBusiness(run.notifications, CAFE)).toHaveLength(1);
    const without = materializeAssignment(run, { ...run.assignments, plans: [direct] }, sampleDeps());
    expect(forBusiness(without.notifications, CAFE)).toEqual([]);
    expect(without.notifications.some((n) => n.planId === relay.id)).toBe(false);
    expect(without.notifications).toEqual(run.notifications.filter((n) => n.planId === direct.id));
  });

  it('keeps one notification per ID when the relay business is also the sender or the recipient', () => {
    // Not something the matcher produces; the reconcile must still never emit an ID twice.
    const run = freshRun();
    const relay = { ...planFor(run, 'shp-1'), relayBusinessId: PRINT };
    const out = materializeAssignment(run, { ...run.assignments, plans: [relay] }, sampleDeps());
    expect(forBusiness(out.notifications, PRINT).map((n) => [n.id, n.message])).toEqual([
      ['ntf-plan-shp-1-biz-print-shop', 'Delivery arranged: "Poster proofs" to Midtown Agency via Northside Print Shop (relay point), $10.50.'],
    ]);
  });
});

describe('v2 relay-point notification in GET /businesses/:id/dashboard (#535)', () => {
  // The real timeline and the real snapshot function, as the bootstrap wires them.
  const travel = tableTravel();
  const deps = { travel, buildEvents: buildTimeline };
  let api: ReadApi | undefined;
  afterEach(async () => {
    await api?.close();
    api = undefined;
  });
  const start = async (run: Run) => {
    api = await startReadApi({ travel, run, snapshotAt: (r, timeMin) => snapshotAt(r, timeMin, travel) });
    return api;
  };

  it("lists the notification in the relay business's dashboard, although it neither sends nor receives the package", async () => {
    const app = await start(createInitialRun(sampleScenario(), deps));
    const res = await app.get(`/businesses/${CAFE}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.incoming).toEqual([]);
    expect(res.body.outgoing.map((v: { shipment: { id: string } }) => v.shipment.id)).toEqual(['shp-3']); // unmatched, no plan
    expect(res.body.notifications).toEqual([{
      id: 'ntf-plan-shp-1-biz-cafe', audience: 'business', audienceId: CAFE, kind: 'delivery_matched',
      shipmentId: 'shp-1', planId: 'plan-shp-1', message: RELAY_NOTE, createdSeq: 3,
    }]);
    // The sender and the recipient do not get the relay point's message.
    for (const id of [PRINT, AGENCY]) {
      const other = await app.get(`/businesses/${id}/dashboard`);
      expect(other.body.notifications.map((n: Notification) => n.id)).not.toContain('ntf-plan-shp-1-biz-cafe');
      expect(other.body.notifications.map((n: Notification) => n.message)).not.toContain(RELAY_NOTE);
    }
  });

  it('a business that is the sender of one plan and the relay point of another gets both kinds, each once', async () => {
    // What a commute save does: emp-1 now also drives to work in the morning, past the cafe,
    // so the cafe's own package (shp-3) gets a plan. The cafe stays the relay point of shp-1.
    const run = createInitialRun(sampleScenario(), deps);
    run.scenario.employees[0].availableMorning = true;
    run.trips = run.scenario.employees.flatMap((e) => buildTrips(e, travel));
    matchPending(run, ['shp-3'], deps);
    matchPending(run, ['shp-3'], deps); // a second pass adds nothing
    expect(planFor(run, 'shp-3')).toMatchObject({ kind: 'direct' });
    expect(planFor(run, 'shp-1')).toMatchObject({ kind: 'relay', relayBusinessId: CAFE });

    const app = await start(run);
    const res = await app.get(`/businesses/${CAFE}/dashboard`);
    expect(res.status).toBe(200);
    // Newest first.
    expect(res.body.notifications.map((n: Notification) => [n.id, n.shipmentId, n.message])).toEqual([
      ['ntf-plan-shp-3-biz-cafe', 'shp-3', 'Delivery arranged: "Pastry box" to Northside Print Shop, $7.00.'],
      ['ntf-plan-shp-1-biz-cafe', 'shp-1', RELAY_NOTE],
    ]);
    for (const n of res.body.notifications as Notification[]) {
      expect(n).toMatchObject({ audience: 'business', audienceId: CAFE, kind: 'delivery_matched' });
    }
  });
});

describe('v2 matchPending', () => {
  it('matches a new shipment on a free trip and keeps every existing plan object', () => {
    const run = freshRun();
    const plansBefore = [...run.assignments.plans];
    const snapshot = structuredClone(plansBefore);
    const notificationsBefore = structuredClone(run.notifications);
    addShipment(run, 4, 'Catering order', AGENCY, CAFE);

    matchPending(run, ['shp-4'], sampleDeps());

    // The same objects, unchanged, and the new plan after them: creation order (DECISIONS pass 4).
    expect(run.assignments.plans.map((p) => p.id)).toEqual(['plan-shp-1', 'plan-shp-2', 'plan-shp-4']);
    expectSamePlanObjects(run, plansBefore);
    expect(plansBefore).toEqual(snapshot);

    // emp-3's evening trip would rank first (earlier delivery) but already carries shp-2.
    const added = planFor(run, 'shp-4');
    expect(added).toMatchObject({ id: 'plan-shp-4', shipmentId: 'shp-4', kind: 'direct', deliveryMin: 1054 });
    expect(added.legs.map((l) => l.tripId)).toEqual(['emp-2-eve']);
    expect(added.legs[0].placeIds).toEqual([AGENCY, CAFE, 'home-002']);

    const reserved = reservedTripIds(run);
    expect(new Set(reserved).size).toBe(reserved.length);
    expect([...reserved].sort()).toEqual(['emp-1-eve', 'emp-2-eve', 'emp-2-morn', 'emp-3-eve']);

    expect(run.jobs.map((j) => j.id).sort()).toEqual(['plan-shp-1-L0', 'plan-shp-1-L1', 'plan-shp-2-L0', 'plan-shp-4-L0']);
    const job = run.jobs.find((j) => j.id === 'plan-shp-4-L0')!;
    expect(job).toMatchObject({ employeeId: 'emp-2', legIndex: 0, tripId: 'emp-2-eve', rewardCents: 300 });
    expect(job.pickup).toMatchObject({ placeId: AGENCY, kind: 'pickup' });
    expect(job.dropoff).toMatchObject({ placeId: CAFE, kind: 'delivery' });

    // Old notifications are untouched; the new plan adds one per business side and one per job.
    const isNew = (n: { planId: string }) => n.planId === 'plan-shp-4';
    expect(run.notifications.filter((n) => !isNew(n))).toEqual(notificationsBefore);
    expect(run.notifications.filter(isNew).map((n) => [n.id, n.audienceId, n.createdSeq])).toEqual([
      ['ntf-plan-shp-4-biz-agency', AGENCY, 9],
      ['ntf-plan-shp-4-biz-cafe', CAFE, 10],
      ['ntf-plan-shp-4-L0', 'emp-2', 11],
    ]);
    expect(run.notifications.find((n) => n.id === 'ntf-plan-shp-4-L0')!.message)
      .toBe('New delivery job: "Catering order". Collect from Midtown Agency and deliver to Corner Cafe. Reward $3.00.');
    expectCleanCopy(run);

    expect(run.events).toEqual(stubEvents(run.assignments.plans, run.jobs));
    expect(run.events).toHaveLength(4);
    expect(run.assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3']);
  });

  it('keeps plans, jobs and events in the creation order of their shipments, past shp-9 and after a request with no match', () => {
    const run = freshRun();
    // Ten or more deliveries: "shp-10" sorts before "shp-2" as text, so text order would show here.
    const first = run.scenario.shipments.find((s) => s.id === 'shp-1')!;
    run.scenario.shipments = run.scenario.shipments.filter((s) => s.id !== 'shp-1');
    run.scenario.shipments.push({ ...first, id: 'shp-10', createdSeq: 10 });
    const moved = { ...planFor(run, 'shp-1'), id: 'plan-shp-10', shipmentId: 'shp-10' };
    run.assignments.plans = [planFor(run, 'shp-2'), moved];
    Object.assign(run, materializeAssignment(run, run.assignments, sampleDeps()));

    const planOrder = () => run.assignments.plans.map((p) => p.shipmentId);
    const jobOrder = () => [...new Set(run.jobs.map((j) => j.shipmentId))];

    addShipment(run, 11, 'Catering order', AGENCY, CAFE);
    matchPending(run, ['shp-11'], sampleDeps());
    expect(planOrder()).toEqual(['shp-2', 'shp-10', 'shp-11']);
    expect(jobOrder()).toEqual(['shp-2', 'shp-10', 'shp-11']);
    expect(run.events).toEqual(stubEvents(run.assignments.plans, run.jobs));

    // A request with no match, and a retry of one, move nothing.
    const plansBefore = [...run.assignments.plans];
    const jobsBefore = structuredClone(run.jobs);
    addShipment(run, 12, 'Second catering order', AGENCY, CAFE);
    matchPending(run, ['shp-12'], sampleDeps());
    matchPending(run, ['shp-3'], sampleDeps());
    expect(run.assignments.unmatched.map((u) => u.shipmentId).sort()).toEqual(['shp-12', 'shp-3']);
    expect(run.assignments.plans).toHaveLength(plansBefore.length);
    run.assignments.plans.forEach((plan, i) => expect(plan).toBe(plansBefore[i]));
    expect(run.jobs).toEqual(jobsBefore);
  });

  it('measures computeMs for the incremental match', () => {
    const run = freshRun();
    run.assignments.computeMs = -1;
    addShipment(run, 4, 'Catering order', AGENCY, CAFE);
    matchPending(run, ['shp-4'], sampleDeps());
    expect(Number.isFinite(run.assignments.computeMs)).toBe(true);
    expect(run.assignments.computeMs).toBeGreaterThanOrEqual(0);
  });

  it('merges a new unmatched shipment into the unmatched list and reserves no trip twice', () => {
    const run = freshRun();
    addShipment(run, 4, 'Catering order', AGENCY, CAFE);
    matchPending(run, ['shp-4'], sampleDeps());
    const plansBefore = [...run.assignments.plans];
    const notificationsBefore = structuredClone(run.notifications);

    addShipment(run, 5, 'Second catering order', AGENCY, CAFE);
    matchPending(run, ['shp-5'], sampleDeps());

    expect(run.assignments.unmatched).toEqual([
      { shipmentId: 'shp-3', reason: 'No sender evening commute or recipient morning commute is available' },
      { shipmentId: 'shp-5', reason: 'Every matching commute is already carrying a package' },
    ]);
    expect(run.assignments.plans).toHaveLength(3);
    expectSamePlanObjects(run, plansBefore);
    expect(bySeq(run.notifications)).toEqual(bySeq(notificationsBefore));
    const reserved = reservedTripIds(run);
    expect(new Set(reserved).size).toBe(reserved.length);
  });

  it('moves a shipment out of unmatched once a commute can carry it', () => {
    const run = freshRun();
    expect(run.assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3']);
    const plansBefore = [...run.assignments.plans];

    // What a commute save does: emp-1 now also drives to work in the morning, past the cafe.
    const emp1 = run.scenario.employees[0];
    emp1.availableMorning = true;
    run.trips = run.scenario.employees.flatMap((e) => buildTrips(e, tableTravel()));

    matchPending(run, ['shp-3'], sampleDeps());

    expect(run.assignments.unmatched).toEqual([]);
    expect(run.assignments.plans.map((p) => p.id).sort()).toEqual(['plan-shp-1', 'plan-shp-2', 'plan-shp-3']);
    expectSamePlanObjects(run, plansBefore);
    const added = planFor(run, 'shp-3');
    expect(added.kind).toBe('direct');
    expect(added.legs[0]).toMatchObject({ tripId: 'emp-1-morn', employeeId: 'emp-1', placeIds: ['home-001', CAFE, PRINT] });
    expect(run.jobs.map((j) => j.id)).toContain('plan-shp-3-L0');
    expect(run.notifications.filter((n) => n.createdSeq > 8).map((n) => n.id)).toEqual([
      'ntf-plan-shp-3-biz-cafe', 'ntf-plan-shp-3-biz-print-shop', 'ntf-plan-shp-3-L0',
    ]);
    expect(run.notifications).toHaveLength(11);
    const reserved = reservedTripIds(run);
    expect(new Set(reserved).size).toBe(reserved.length);
    expectCleanCopy(run);
  });

  it('keeps an unmatched shipment unmatched, without duplicating it, when it is retried', () => {
    const run = freshRun();
    matchPending(run, ['shp-3'], sampleDeps());
    expect(run.assignments.unmatched).toEqual([
      { shipmentId: 'shp-3', reason: 'No sender evening commute or recipient morning commute is available' },
    ]);
    expect(run.assignments.plans.map((p) => p.id)).toEqual(['plan-shp-1', 'plan-shp-2']);
  });

  it('does nothing to plans, jobs or notifications for an already matched or unknown shipment', () => {
    const run = freshRun();
    const before = structuredClone({ ...run, assignments: { ...run.assignments, computeMs: 0 } });
    matchPending(run, ['shp-1', 'shp-404'], sampleDeps());
    expect({ ...run, assignments: { ...run.assignments, computeMs: 0 } }).toEqual(before);
  });

  it('lets TravelDataMissingError through and leaves the run as it was', () => {
    const run = freshRun();
    addShipment(run, 4, 'Catering order', AGENCY, CAFE);
    const before = structuredClone(run);
    const table = sampleTable();
    delete table[pairKey(CAFE, 'home-002')]; // emp-2's way home from the new drop-off
    const buildEvents = vi.fn(stubEvents);

    let thrown: unknown;
    try {
      matchPending(run, ['shp-4'], { travel: tableTravel(table), buildEvents });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TravelDataMissingError);
    expect(thrown).toMatchObject({ from: CAFE, to: 'home-002' });
    expect(buildEvents).not.toHaveBeenCalled();
    expect(run).toEqual(before);
  });
});
