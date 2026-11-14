// PUT /api/v2/employees/:id/commute, the saves that answer 200 (DECISIONS pass 46).
// The failures are in v2-commute-route-errors.test.ts; the re-plan of a delivery whose trip the save
// changed (pass 62) is in v2-commute-replan.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeIdForCoords, pairsToEnsure } from '../../server/api/v2/commutePlan';
import { matchPending } from '../../server/api/v2/pipeline';
import { GoogleApiError, GoogleKeyMissingError } from '../../server/geo/googleClient';
import { pairKey, type Run } from '../../shared/v2/types';
import { sampleScenario, sampleShipment, stubEvents, tableTravel } from './v2-pipeline-sample';
import {
  AGENCY, CAFE, CONSOLE_METHODS, CommuteResponseSchema, METERS_PER_MIN, NEW_HOME_BODY, NEW_HOME_ID, NEW_POINT,
  NEW_POINT_TEXT, PRINT, commuteBody, startCommuteApp, type CommuteApp,
} from './v2-commute-route-helpers';

const BUSINESS_IDS = [PRINT, AGENCY, CAFE];

let started: CommuteApp[] = [];
const start = async (opts?: Parameters<typeof startCommuteApp>[0]) => {
  const app = await startCommuteApp(opts);
  started.push(app);
  return app;
};
let consoleSpies: ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(async () => {
  // No log line holds the new home's coordinates. The route logs nothing at all.
  const printed = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
  for (const text of NEW_POINT_TEXT) expect(printed).not.toContain(text);
  vi.restoreAllMocks();
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

const planOf = (run: Run, shipmentId: string) => run.assignments.plans.find((p) => p.shipmentId === shipmentId);
const tripsOf = (run: Run, employeeId: string) => run.trips.filter((t) => t.employeeId === employeeId);

describe('PUT /api/v2/employees/:id/commute: a home that is already cached', () => {
  it('answers 200 with the rebuilt trips and stores the commute', async () => {
    const app = await start();
    const before = structuredClone(app.store.get());

    const res = await app.put('emp-2', commuteBody({
      businessId: AGENCY, home: { homeId: 'home-003' }, eveningDepartureMin: 1040, availableMorning: true, maxExtraMin: 5,
    }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.employee).toEqual({
      id: 'emp-2', name: 'Ben', businessId: AGENCY, homeId: 'home-003',
      eveningDepartureMin: 1040, morningDepartureMin: 1935, maxExtraMin: 5, availableEvening: true, availableMorning: true,
    });
    expect(body.home).toEqual(before.scenario.homes.find((h) => h.id === 'home-003'));
    expect(body.trips).toEqual([
      {
        id: 'emp-2-eve', employeeId: 'emp-2', direction: 'evening', originPlaceId: AGENCY, destinationPlaceId: 'home-003',
        departureMin: 1040, baselineDurationMin: 35, baselineDistanceM: 35 * METERS_PER_MIN,
      },
      {
        id: 'emp-2-morn', employeeId: 'emp-2', direction: 'morning', originPlaceId: 'home-003', destinationPlaceId: AGENCY,
        departureMin: 1935, baselineDurationMin: 35, baselineDistanceM: 35 * METERS_PER_MIN,
      },
    ]);
    expect(body.rematchedShipmentIds).toEqual([]);

    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect(run.scenario.employees.find((e) => e.id === 'emp-2')).toEqual(body.employee);
    expect(tripsOf(run, 'emp-2')).toEqual(body.trips);
    for (const id of ['emp-1', 'emp-3']) expect(tripsOf(run, id)).toEqual(tripsOf(before, id));
    // shp-1's second leg rode emp-2's morning commute, which now starts at home-003: that relay plan is
    // dropped as a whole and the delivery is matched again (DECISIONS pass 62; the details are in
    // v2-commute-replan.test.ts). The Print Shop is on the new way to work, so it is now a direct delivery.
    expect(planOf(run, 'shp-1')).toMatchObject({ id: 'plan-shp-1', kind: 'direct' });
    expect(planOf(run, 'shp-1')!.legs.map((l) => [l.tripId, l.placeIds])).toEqual([
      ['emp-2-morn', ['home-003', PRINT, AGENCY]],
    ]);
    // The plan on a trip that did not change stays as it is, and the retried shp-3 is still unmatched.
    expect(planOf(run, 'shp-2')).toEqual(planOf(before, 'shp-2'));
    expect(run.assignments.plans).toHaveLength(before.assignments.plans.length);
    expect(run.assignments.unmatched).toEqual(before.assignments.unmatched);
    const kept = <V extends { shipmentId: string }>(values: V[]) => values.filter((v) => v.shipmentId === 'shp-2');
    expect(kept(run.jobs)).toEqual(kept(before.jobs));
    expect(kept(run.notifications)).toEqual(kept(before.notifications));
    // emp-1's relay leg went with the old plan: one job per leg of the plans that are there now.
    expect(run.jobs.map((j) => [j.id, j.employeeId, j.tripId]).sort()).toEqual([
      ['plan-shp-1-L0', 'emp-2', 'emp-2-morn'], ['plan-shp-2-L0', 'emp-3', 'emp-3-eve'],
    ]);
    expect(run.notifications.filter((n) => n.audienceId === 'emp-1')).toEqual([]);
    // home-002: nobody lives there now and no plan drives to it.
    expect(run.scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-003']);
  });

  it('still asks the travel service for the pairs: cached pairs cost no request there', async () => {
    const app = await start();
    const initial = app.store.get();
    const pairsBefore = Object.keys(app.table).length;
    const home = initial.scenario.homes.find((h) => h.id === 'home-003')!;

    const res = await app.put('emp-2', commuteBody({ businessId: AGENCY, home: { homeId: 'home-003' } }));

    expect(res.status).toBe(200);
    const expected = pairsToEnsure(home, AGENCY, BUSINESS_IDS);
    expect(app.places.calls.map((c) => c.method)).toEqual(['addPlaces', 'ensurePairs', 'ensurePolylines']);
    expect(app.places.calls[0]).toMatchObject({ places: { 'home-003': { lat: home.lat, lng: home.lng } } });
    expect(app.places.calls[1]).toMatchObject({ pairs: expected.matrix });
    expect(app.places.calls[2]).toMatchObject({ pairs: expected.polylines });
    expect(Object.keys(app.table)).toHaveLength(pairsBefore);
  });

  it('a save that changes nothing is a 200 with the same trips, and the version still goes up once', async () => {
    const app = await start();
    const before = structuredClone(app.store.get());
    const emp = before.scenario.employees.find((e) => e.id === 'emp-3')!;

    const res = await app.put('emp-3', {
      businessId: emp.businessId, home: { homeId: emp.homeId },
      eveningDepartureMin: emp.eveningDepartureMin, morningDepartureMin: emp.morningDepartureMin,
      availableEvening: emp.availableEvening, availableMorning: emp.availableMorning, maxExtraMin: emp.maxExtraMin,
    });

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.employee).toEqual(emp);
    expect(body.trips).toEqual(tripsOf(before, 'emp-3'));
    expect(app.store.get().version).toBe(before.version + 1);
    expect({ ...app.store.get(), version: before.version, assignments: { ...app.store.get().assignments, computeMs: 0 } })
      .toEqual({ ...before, assignments: { ...before.assignments, computeMs: 0 } });
  });
});

describe('PUT /api/v2/employees/:id/commute: a new home', () => {
  it('registers the point, then fetches exactly the pairs of pairsToEnsure, all before the run changes', async () => {
    const app = await start();
    const initial = app.store.get();
    expect(app.table[pairKey(NEW_HOME_ID, PRINT)]).toBeUndefined();

    const res = await app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY }));

    expect(res.status).toBe(200);
    const expected = pairsToEnsure({ id: NEW_HOME_ID }, AGENCY, BUSINESS_IDS);
    expect(expected.matrix).toHaveLength(6);
    expect(app.places.calls).toEqual([
      { method: 'addPlaces', places: { [NEW_HOME_ID]: NEW_POINT }, run: initial },
      { method: 'ensurePairs', pairs: expected.matrix, run: initial },
      { method: 'ensurePolylines', pairs: expected.polylines, run: initial },
    ]);
    // `run` in each call is the store's run at that moment: still the very object from before the request.
    for (const call of app.places.calls) expect(call.run).toBe(initial);
    expect(app.store.get()).not.toBe(initial);
    expect(app.store.get().version).toBe(initial.version + 1);
  });

  it('answers with the homeIdForCoords ID and trips built from the fetched pairs', async () => {
    const app = await start();

    const res = await app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY, eveningDepartureMin: 1000 }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(homeIdForCoords(NEW_POINT.lat, NEW_POINT.lng)).toBe(NEW_HOME_ID);
    expect(body.employee.homeId).toBe(NEW_HOME_ID);
    expect(body.home).toEqual({ id: NEW_HOME_ID, neighborhood: 'Astoria', ...NEW_POINT });
    expect(body.trips).toEqual([{
      id: 'emp-3-eve', employeeId: 'emp-3', direction: 'evening', originPlaceId: AGENCY, destinationPlaceId: NEW_HOME_ID,
      departureMin: 1000, baselineDurationMin: 10, baselineDistanceM: 10 * METERS_PER_MIN,
    }]);

    const run = app.store.get();
    expect(run.scenario.homes.find((h) => h.id === NEW_HOME_ID)).toEqual(body.home);
    // home-003 is gone: the plan that drove to it rode emp-3's old evening commute and was dropped with it
    // (the Print Shop is no longer on the way, so shp-2 has no carrier).
    expect(run.scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-002', NEW_HOME_ID]);
    expect(planOf(run, 'shp-2')).toBeUndefined();
    expect(run.assignments.unmatched.map((u) => u.shipmentId).sort()).toEqual(['shp-2', 'shp-3']);
    expect(body.rematchedShipmentIds).toEqual([]);
    expect(tripsOf(run, 'emp-3')).toEqual(body.trips);
  });

  it('coordinates with more than 5 decimals are rounded into the same home', async () => {
    const app = await start();

    const res = await app.put('emp-3', commuteBody({
      businessId: AGENCY, home: { lat: 40.764204, lng: -73.923496, neighborhood: '  Astoria ' },
    }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).home).toEqual({ id: NEW_HOME_ID, neighborhood: 'Astoria', ...NEW_POINT });
    expect(app.places.calls[0]).toMatchObject({ places: { [NEW_HOME_ID]: NEW_POINT } });
  });

  it('a second employee can then use the same home by its ID', async () => {
    const app = await start();
    expect((await app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY }))).status).toBe(200);
    const pairsAfterFirst = Object.keys(app.table).length;

    const res = await app.put('emp-2', commuteBody({ businessId: AGENCY, home: { homeId: NEW_HOME_ID }, availableMorning: true }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.home.id).toBe(NEW_HOME_ID);
    expect(body.trips.map((t) => t.baselineDurationMin)).toEqual([10, 10]);
    expect(Object.keys(app.table)).toHaveLength(pairsAfterFirst);
    expect(app.store.get().scenario.homes.filter((h) => h.id === NEW_HOME_ID)).toHaveLength(1);
  });

  it.each([
    ['GoogleKeyMissingError', () => new GoogleKeyMissingError()],
    ['GoogleApiError', () => new GoogleApiError({
      status: 429, googleStatus: 'RESOURCE_EXHAUSTED', endpoint: 'https://routes.googleapis.com/directions/v2:computeRoutes', message: 'quota',
    })],
    ['a plain Error', () => new Error('no lines')],
  ])('ensurePolylines rejecting with %s still answers 200 and saves the commute', async (_name, makeError) => {
    const app = await start();
    const before = app.store.get().version;
    app.places.failNext('ensurePolylines', makeError());

    const res = await app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).home.id).toBe(NEW_HOME_ID);
    expect(app.places.calls.map((c) => c.method)).toEqual(['addPlaces', 'ensurePairs', 'ensurePolylines']);
    expect(app.store.get().version).toBe(before + 1);
    expect(app.store.get().scenario.employees.find((e) => e.id === 'emp-3')!.homeId).toBe(NEW_HOME_ID);
  });
});

describe('PUT /api/v2/employees/:id/commute: the retry of unmatched requests', () => {
  it('a request the new commute makes feasible gets its plan, jobs and notifications', async () => {
    const app = await start();
    const before = structuredClone(app.store.get());
    expect(before.assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3']);
    expect(before.assignments.plans.map((p) => p.shipmentId)).toEqual(['shp-1', 'shp-2']);

    // emp-1 (Print Shop) moves to the new home and opens the morning: home (20) -> Corner Cafe (10) -> Print Shop (0).
    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.rematchedShipmentIds).toEqual(['shp-3']);
    expect(body.trips.map((t) => t.id)).toEqual(['emp-1-eve', 'emp-1-morn']);

    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect(run.assignments.unmatched).toEqual([]);

    const plan = planOf(run, 'shp-3')!;
    expect(plan).toMatchObject({ id: 'plan-shp-3', kind: 'direct', deliveryMin: 1959 });
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({
      tripId: 'emp-1-morn', employeeId: 'emp-1', placeIds: [NEW_HOME_ID, CAFE, PRINT], extraMin: 4, finishMin: 1959,
    });
    expect(plan.legs[0].stops.map((s) => [s.placeId, s.kind, s.arrivalMin])).toEqual([
      [CAFE, 'pickup', 1945], [PRINT, 'delivery', 1957],
    ]);

    const jobs = run.jobs.filter((j) => j.shipmentId === 'shp-3');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ planId: plan.id, employeeId: 'emp-1', tripId: 'emp-1-morn', legIndex: 0 });
    const notes = run.notifications.filter((n) => n.shipmentId === 'shp-3');
    expect(notes.map((n) => [n.audience, n.audienceId, n.kind]).sort()).toEqual([
      ['business', CAFE, 'delivery_matched'],
      ['business', PRINT, 'delivery_matched'],
      ['employee', 'emp-1', 'job_assigned'],
    ]);
    expect(notes.find((n) => n.audience === 'employee')).toMatchObject({ jobId: jobs[0].id, planId: plan.id });
    // New notifications are newer than every one that was there.
    const newestBefore = Math.max(...before.notifications.map((n) => n.createdSeq));
    for (const note of notes) expect(note.createdSeq).toBeGreaterThan(newestBefore);
    expect(run.events.some((e) => e.shipmentId === 'shp-3')).toBe(true);

    // The plan on a trip that did not change, its job and its notifications are exactly as they were.
    const kept = <V extends { shipmentId: string }>(values: V[]) => values.filter((v) => v.shipmentId === 'shp-2');
    expect(planOf(run, 'shp-2')).toEqual(planOf(before, 'shp-2'));
    expect(kept(run.jobs)).toEqual(kept(before.jobs));
    expect(kept(run.notifications)).toEqual(kept(before.notifications));
    // shp-1's first leg rode emp-1's old evening commute to home-001. It is planned again on the new one
    // and is not "rematched": it had a plan before the save.
    expect(planOf(run, 'shp-1')!.legs.map((l) => [l.tripId, l.placeIds])).toEqual([
      ['emp-1-eve', [PRINT, CAFE, NEW_HOME_ID]], ['emp-2-morn', ['home-002', CAFE, AGENCY]],
    ]);
    expect(run.assignments.plans).toHaveLength(before.assignments.plans.length + 1);
    expect(run.jobs).toHaveLength(before.jobs.length + 1);
    // No leg drives to home-001 any more, so it is no longer listed.
    expect(run.scenario.homes.map((h) => h.id)).toEqual(['home-002', 'home-003', NEW_HOME_ID]);
  });

  it('an existing home can make a request feasible too', async () => {
    const app = await start();

    // emp-1 keeps home-001 (15) and opens the morning: home -> Corner Cafe (10) -> Print Shop (0).
    const res = await app.put('emp-1', commuteBody({ availableMorning: true }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-3']);
    expect(planOf(app.store.get(), 'shp-3')!.legs[0].placeIds).toEqual(['home-001', CAFE, PRINT]);
  });

  it('retries every unmatched request and lists the matched ones in createdSeq order', async () => {
    // emp-3 starts with no commute at all, so shp-2 (Agency -> Print Shop) has no carrier. shp-4 (Corner Cafe
    // -> Agency) loses emp-2's morning commute to shp-1. shp-3 stays without a carrier in every case.
    const scenario = sampleScenario();
    scenario.employees.find((e) => e.id === 'emp-3')!.availableEvening = false;
    scenario.shipments.find((s) => s.id === 'shp-2')!.createdSeq = 9; // newer than shp-4: ID order is not createdSeq order
    scenario.shipments.push(sampleShipment(4, 'Coffee beans', CAFE, AGENCY));
    const app = await start({ scenario });
    const before = structuredClone(app.store.get());
    expect(before.assignments.plans.map((p) => p.shipmentId)).toEqual(['shp-1']);
    expect(before.assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-2', 'shp-3', 'shp-4']);

    // emp-3 switches both commutes on: Agency (30) -> Print Shop (0) -> home-003 (-5) in the evening,
    // home-003 -> Corner Cafe (10) -> Agency in the morning.
    const res = await app.put('emp-3', commuteBody({
      businessId: AGENCY, home: { homeId: 'home-003' }, availableEvening: true, availableMorning: true,
    }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-4', 'shp-2']);
    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect(planOf(run, 'shp-2')!.legs.map((l) => l.tripId)).toEqual(['emp-3-eve']);
    expect(planOf(run, 'shp-4')!.legs.map((l) => l.tripId)).toEqual(['emp-3-morn']);
    expect(planOf(run, 'shp-1')).toEqual(planOf(before, 'shp-1'));
    // shp-3 was retried and keeps a reason.
    expect(run.assignments.unmatched).toEqual([{ shipmentId: 'shp-3', reason: expect.any(String) }]);
    expect(run.jobs.map((j) => j.shipmentId).sort()).toEqual(['shp-1', 'shp-1', 'shp-2', 'shp-4']);
  });

  it('a request added after the first plan run is retried as well', async () => {
    const app = await start();
    // A second request for the same lane, created live: also unmatched.
    await app.store.mutate((run) => {
      run.scenario.shipments.push(sampleShipment(4, 'Second pastry box', CAFE, PRINT));
      matchPending(run, ['shp-4'], { travel: tableTravel(app.table), buildEvents: stubEvents });
    });
    const before = structuredClone(app.store.get());
    expect(before.assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3', 'shp-4']);

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY, availableMorning: true }));

    // One new morning commute carries one package: the older request gets it.
    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-3']);
    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect(run.assignments.unmatched).toEqual([
      { shipmentId: 'shp-4', reason: 'Every matching commute is already carrying a package' },
    ]);
  });

  it('with nothing unmatched and no plan on a changed trip, the plans, jobs, notifications and events stay as they were', async () => {
    const scenario = sampleScenario();
    scenario.shipments = scenario.shipments.filter((s) => s.id !== 'shp-3');
    const app = await start({ scenario });
    const before = structuredClone(app.store.get());
    expect(before.assignments.unmatched).toEqual([]);

    // emp-2's evening commute carries nothing: it leaves later and gets a lower limit. The morning commute,
    // which carries shp-1's second leg, is not changed.
    const res = await app.put('emp-2', commuteBody({
      businessId: AGENCY, home: { homeId: 'home-002' }, eveningDepartureMin: 1050, availableMorning: true, maxExtraMin: 3,
    }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.rematchedShipmentIds).toEqual([]);
    expect(body.trips.map((t) => [t.id, t.departureMin])).toEqual([['emp-2-eve', 1050], ['emp-2-morn', 1935]]);
    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect(run.assignments).toEqual(before.assignments);
    expect(run.jobs).toEqual(before.jobs);
    expect(run.notifications).toEqual(before.notifications);
    expect(run.events).toEqual(before.events);
  });
});
