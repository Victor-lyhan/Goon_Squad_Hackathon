// PUT /api/v2/employees/:id/commute for an employee who carries a delivery (issue #627, DECISIONS pass 62).
// Trip IDs depend only on the employee, so a plan made on a trip the save changed must not stay: it is
// dropped as a whole and its shipment is matched again together with the unmatched ones.
//
// Everything is asked over HTTP from one server: the commute route, the read routes and the clock control
// on the real v2 router, with the real timeline and the real snapshot, a store on a temp file, the pipeline
// sample's city and a table-driven TravelProvider. No network, no fixtures/nyc, no key.
//
// The street (minutes), as in v2-commute-route-helpers.ts:
//
//   home-003   Print Shop   home-002   Corner Cafe   home-001   NEW_HOME   Agency
//      -5          0            5           10           15         20        30
//
// The default city: shp-1 relay (emp-1 evening Print Shop -> Corner Cafe -> home-001, emp-2 morning
// home-002 -> Corner Cafe -> Agency), shp-2 direct (emp-3 evening Agency -> Print Shop -> home-003),
// shp-3 Corner Cafe -> Print Shop unmatched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCommuteRoutes, type CommutePlaces } from '../../server/api/v2/commuteRoutes';
import { changedTripIds, dropPlansOnTrips, dropUnusedHomes, type PlacePair } from '../../server/api/v2/commutePlan';
import { registerControlRoutes } from '../../server/api/v2/controlRoutes';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { registerReadRoutes } from '../../server/api/v2/readRoutes';
import { createV2Router } from '../../server/api/v2/router';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { GoogleKeyMissingError } from '../../server/geo/googleClient';
import { createStore, type Store } from '../../server/store';
import type {
  BusinessDashboard, BusinessesResponse, EmployeeDashboard, EmployeesResponse, JobResponse, MapResponse,
  SimulatorResponse,
} from '../../shared/v2/api';
import { pairKey, type Run, type Scenario, type Trip } from '../../shared/v2/types';
import { sampleScenario, sampleShipment, sampleTable, tableTravel, type TravelTable } from './v2-pipeline-sample';
import {
  AGENCY, CAFE, CommuteResponseSchema, METERS_PER_MIN, NEW_HOME_BODY, NEW_HOME_ID, PRINT, commuteBody,
} from './v2-commute-route-helpers';

const T = 20_000;
const SIM_START = 930;
const SIM_END = 2160;

// The street of the helper file. `ensurePairs` plays Google with it for the new home.
const STREET_MIN: Record<string, number> = {
  'home-003': -5, [PRINT]: 0, 'home-002': 5, [CAFE]: 10, 'home-001': 15, [NEW_HOME_ID]: 20, [AGENCY]: 30,
};

type Answer<B> = { status: number; body: B };

type ReplanApp = {
  store: Store<Run>;
  /** Every `ensurePolylines` call of the commute route. */
  lineCalls: PlacePair[][];
  /** The next `ensurePairs` call rejects with this. */
  failPairs(error: unknown): void;
  get<B>(url: string): Promise<Answer<B>>;
  put(employeeId: string, body: unknown): Promise<Answer<Record<string, unknown>>>;
  control(body: Record<string, unknown>): Promise<Answer<SimulatorResponse>>;
  close(): Promise<void>;
};

let started: ReplanApp[] = [];
afterEach(async () => {
  await Promise.all(started.map((app) => app.close()));
  started = [];
});

async function start(scenario: Scenario = sampleScenario()): Promise<ReplanApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-commute-replan-'));
  const table: TravelTable = sampleTable();
  const travel = tableTravel(table);
  const store = createStore<Run>({
    filePath: path.join(dir, 'v2-state.json'),
    initial: () => createInitialRun(scenario, { travel, buildEvents: buildTimeline }),
  });

  const lineCalls: PlacePair[][] = [];
  let pairsError: unknown;
  const places: CommutePlaces = {
    addPlaces: () => undefined,
    async ensurePairs(pairs) {
      if (pairsError !== undefined) {
        const error = pairsError;
        pairsError = undefined;
        throw error;
      }
      for (const { from, to } of pairs) {
        const key = pairKey(from, to);
        if (table[key] || !(from in STREET_MIN) || !(to in STREET_MIN)) continue;
        const minutes = Math.abs(STREET_MIN[from] - STREET_MIN[to]);
        table[key] = { durationMin: minutes, distanceM: minutes * METERS_PER_MIN };
      }
    },
    async ensurePolylines(pairs) {
      lineCalls.push(structuredClone(pairs));
    },
  };

  const snapshot = (run: Run, timeMin: number) => snapshotAt(run, timeMin, travel);
  const app = express();
  app.use(express.json());
  app.use('/api/v2', createV2Router({
    travel, store,
    extraRoutes: (router) => {
      registerReadRoutes(router, { store, travel, snapshotAt: snapshot });
      registerControlRoutes(router, { store, snapshotAt: snapshot });
      registerCommuteRoutes(router, { store, travel, buildEvents: buildTimeline, places });
    },
  }));
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;

  const call = async <B>(method: string, url: string, body?: unknown): Promise<Answer<B>> => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as B };
  };

  const replanApp: ReplanApp = {
    store, lineCalls,
    failPairs: (error) => { pairsError = error; },
    get: (url) => call('GET', url),
    put: (employeeId, body) => call('PUT', `/employees/${employeeId}/commute`, body),
    control: (body) => call('POST', '/simulator/control', body),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  started.push(replanApp);
  return replanApp;
}

const ok = async <B>(app: ReplanApp, url: string): Promise<B> => {
  const res = await app.get<B>(url);
  expect(res.status, url).toBe(200);
  return res.body;
};
const simulator = (app: ReplanApp) => ok<SimulatorResponse>(app, '/simulator');
const employeeDashboard = (app: ReplanApp, id: string) => ok<EmployeeDashboard>(app, `/employees/${id}/dashboard`);
const businessDashboard = (app: ReplanApp, id: string) => ok<BusinessDashboard>(app, `/businesses/${id}/dashboard`);
const seek = async (app: ReplanApp, timeMin: number): Promise<SimulatorResponse> => {
  const res = await app.control({ action: 'seek', timeMin });
  expect(res.status).toBe(200);
  return res.body;
};
const planOf = (sim: SimulatorResponse, shipmentId: string) => sim.plans.find((p) => p.shipmentId === shipmentId);
const sorted = (values: string[]) => [...values].sort();

/**
 * What every commute save must leave behind, read over HTTP: every job rides a trip its employee has, every
 * job on a dashboard opens, every place of every plan leg is on the map, every shipment is either planned
 * or unmatched with a reason, and no notification and no home is left over from a plan that is gone.
 */
async function expectConsistent(app: ReplanApp): Promise<void> {
  const sim = await simulator(app);
  const map = await ok<MapResponse>(app, '/map');
  const { employees } = await ok<EmployeesResponse>(app, '/employees');
  const { businesses } = await ok<BusinessesResponse>(app, '/businesses');
  const dashboards = await Promise.all(employees.map((e) => employeeDashboard(app, e.id)));

  // Every job in the simulator rides a trip that exists and belongs to its employee.
  const trips = new Map<string, Trip>(dashboards.flatMap((d) => d.trips).map((t) => [t.id, t]));
  for (const job of sim.jobs) {
    expect(trips.get(job.tripId), `${job.id} rides ${job.tripId}`).toMatchObject({ employeeId: job.employeeId });
  }

  // The dashboards list exactly the simulator's jobs, and every one of them opens with its own trip.
  const listed = dashboards.flatMap((d) => [...d.assigned, ...d.completed]);
  expect(sorted(listed.map((v) => v.job.id))).toEqual(sorted(sim.jobs.map((j) => j.id)));
  for (const { job } of listed) {
    const res = await app.get<JobResponse>(`/jobs/${job.id}`);
    expect(res.status, `GET /jobs/${job.id}`).toBe(200);
    expect(res.body.trip).toEqual(trips.get(job.tripId));
    // The job view never shows a trip next to stop times of another trip.
    expect(res.body.job.pickup.serviceStartMin).toBeGreaterThanOrEqual(res.body.trip.departureMin);
    const leg = res.body.plan.legs[job.legIndex];
    expect(leg.tripId).toBe(res.body.trip.id);
    expect(leg.placeIds[0]).toBe(res.body.trip.originPlaceId);
    expect(leg.placeIds.at(-1)).toBe(res.body.trip.destinationPlaceId);
  }

  // Every place a leg drives through is a business or a home of the map.
  const onMap = new Set([...map.businesses, ...map.homes].map((p) => p.id));
  for (const plan of sim.plans) {
    expect(sim.jobs.filter((j) => j.planId === plan.id)).toHaveLength(plan.legs.length);
    for (const leg of plan.legs) for (const placeId of leg.placeIds) expect(onMap, `${plan.id} names ${placeId}`).toContain(placeId);
  }

  // Each shipment is planned or unmatched with the matcher's reason, never both and never neither.
  const planned = sim.plans.map((p) => p.shipmentId);
  expect(sorted([...planned, ...sim.unmatched.map((u) => u.shipmentId)])).toEqual(sorted(sim.shipments.map((s) => s.id)));
  for (const u of sim.unmatched) expect(u.reason.trim()).not.toBe('');

  // No notification is about a plan or a job that is gone, and each job has exactly one, for its carrier.
  const planIds = new Set(sim.plans.map((p) => p.id));
  const jobNotes = dashboards.flatMap((d) => d.notifications.map((n) => ({ ...n, employeeId: d.employee.id })));
  for (const note of jobNotes) {
    expect(planIds).toContain(note.planId);
    expect(sim.jobs.find((j) => j.id === note.jobId)).toMatchObject({ employeeId: note.employeeId });
  }
  expect(sorted(jobNotes.map((n) => n.jobId ?? ''))).toEqual(sorted(sim.jobs.map((j) => j.id)));
  for (const business of businesses) {
    const dashboard = await businessDashboard(app, business.id);
    for (const note of dashboard.notifications) expect(planIds).toContain(note.planId);
    for (const view of [...dashboard.outgoing, ...dashboard.incoming]) {
      expect(view.jobIds).toHaveLength(view.plan?.legs.length ?? 0);
      expect(view.unmatchedReason === null).toBe(view.plan !== null);
    }
  }

  // A home is listed only while an employee lives there or a plan leg names it.
  const run = app.store.get();
  const inUse = new Set([
    ...run.scenario.employees.map((e) => e.homeId),
    ...run.assignments.plans.flatMap((p) => p.legs.flatMap((leg) => leg.placeIds)),
  ]);
  for (const home of run.scenario.homes) expect(inUse, `${home.id} is listed`).toContain(home.id);
  expect(sorted(map.homes.map((h) => h.id))).toEqual(sorted([...new Set(employees.map((e) => e.homeId))]));
}

/** At every minute a carrier holds a package, the package has a position and its carrier's marker shows it. */
async function expectCarriedPackagesVisible(app: ReplanApp): Promise<void> {
  const { plans } = await simulator(app);
  for (const plan of plans) {
    for (const leg of plan.legs) {
      const from = leg.stops[0].serviceEndMin;
      const to = leg.stops[leg.stops.length - 1].serviceEndMin;
      for (const minute of new Set([from, Math.floor((from + to) / 2), to - 1])) {
        const { snapshot } = await seek(app, minute);
        const where = `${plan.shipmentId} at minute ${minute}`;
        expect(snapshot.packagePositions[plan.shipmentId], where).toBeDefined();
        expect(snapshot.markers.find((m) => m.employeeId === leg.employeeId), where)
          .toMatchObject({ carryingShipmentId: plan.shipmentId });
      }
    }
  }
}

describe('a commute save for an employee who carries a delivery: evening switched off', () => {
  it('the job is gone everywhere, the delivery is unmatched with a reason, and nothing completes or pays', async () => {
    const app = await start();
    const before = await simulator(app);
    expect(planOf(before, 'shp-2')!.legs.map((l) => l.tripId)).toEqual(['emp-3-eve']);
    expect((await employeeDashboard(app, 'emp-3')).assigned.map((v) => v.job.id)).toEqual(['plan-shp-2-L0']);
    expect((await app.get('/jobs/plan-shp-2-L0')).status).toBe(200);

    // emp-3 (Agency, home-003) no longer drives home in the evening. emp-2's evening commute would need +14 min.
    const res = await app.put('emp-3', commuteBody({ businessId: AGENCY, home: { homeId: 'home-003' }, availableEvening: false }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.trips).toEqual([]);
    // shp-2 had a plan before the save, so it is not "rematched"; it lost its plan.
    expect(body.rematchedShipmentIds).toEqual([]);

    const sim = await simulator(app);
    expect(sim.version).toBe(before.version + 1);
    expect(sim.runId).toBe(before.runId);
    expect(planOf(sim, 'shp-2')).toBeUndefined();
    expect(sim.jobs.filter((j) => j.shipmentId === 'shp-2')).toEqual([]);
    expect(sim.unmatched.find((u) => u.shipmentId === 'shp-2')).toEqual({
      shipmentId: 'shp-2', reason: "Every route would exceed the employees' added-time limit",
    });
    expect(sim.snapshot.shipmentStatus['shp-2']).toBe('unmatched');
    // The other delivery is exactly as it was.
    expect(planOf(sim, 'shp-1')).toEqual(planOf(before, 'shp-1'));
    expect(sim.jobs.filter((j) => j.shipmentId === 'shp-1')).toEqual(before.jobs.filter((j) => j.shipmentId === 'shp-1'));

    // The employee: no job, no job notification, nothing to earn. The old job link is a plain 404.
    const mine = await employeeDashboard(app, 'emp-3');
    expect(mine.trips).toEqual([]);
    expect([...mine.assigned, ...mine.completed]).toEqual([]);
    expect(mine.notifications).toEqual([]);
    expect(mine.projectedCents).toBe(0);
    expect((await app.get('/jobs/plan-shp-2-L0')).status).toBe(404);

    // The sender and the recipient: the delivery is listed as unmatched, with no "arranged" notification left.
    const sender = await businessDashboard(app, AGENCY);
    expect(sender.outgoing.find((v) => v.shipment.id === 'shp-2')).toMatchObject({
      plan: null, jobIds: [], status: 'unmatched', unmatchedReason: expect.any(String),
    });
    expect(sender.notifications.filter((n) => n.shipmentId === 'shp-2')).toEqual([]);
    expect((await businessDashboard(app, PRINT)).notifications.filter((n) => n.shipmentId === 'shp-2')).toEqual([]);

    await expectConsistent(app);

    // At the end of the day nothing was delivered or paid for it.
    const end = (await app.control({ action: 'finish' })).body;
    expect(end.clock.timeMin).toBe(SIM_END);
    expect(end.snapshot.shipmentStatus['shp-2']).toBe('unmatched');
    expect(end.snapshot.deliveredAtMin['shp-2']).toBeUndefined();
    expect(end.snapshot.earningsCents['emp-3'] ?? 0).toBe(0);
    expect(end.snapshot.occurredEvents.filter((e) => e.shipmentId === 'shp-2')).toEqual([]);
    expect((await employeeDashboard(app, 'emp-3')).earnedCents).toBe(0);
  }, T);

  it('a relay loses both legs when one carrier leaves, and a waiting request takes the freed commute', async () => {
    // shp-4 Print Shop -> Corner Cafe is on emp-1's way home, but shp-1 has that commute.
    const scenario = sampleScenario();
    scenario.shipments.push(sampleShipment(4, 'Menu cards', PRINT, CAFE));
    const app = await start(scenario);
    const before = await simulator(app);
    expect(planOf(before, 'shp-1')!.legs.map((l) => l.tripId)).toEqual(['emp-1-eve', 'emp-2-morn']);
    expect(before.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3', 'shp-4']);

    // emp-2, the second carrier of shp-1, stops driving in the morning.
    const res = await app.put('emp-2', commuteBody({
      businessId: AGENCY, home: { homeId: 'home-002' }, eveningDepartureMin: 1030, availableMorning: false,
    }));

    expect(res.status).toBe(200);
    // Only shp-4 had no plan before and has one now.
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-4']);

    const sim = await simulator(app);
    // Both legs of the relay are gone, also emp-1's, whose commute did not change.
    expect(planOf(sim, 'shp-1')).toBeUndefined();
    expect(sim.jobs.filter((j) => j.shipmentId === 'shp-1')).toEqual([]);
    expect(planOf(sim, 'shp-4')!.legs.map((l) => l.tripId)).toEqual(['emp-1-eve']);
    expect(sorted(sim.unmatched.map((u) => u.shipmentId))).toEqual(['shp-1', 'shp-3']);
    expect(planOf(sim, 'shp-2')).toEqual(planOf(before, 'shp-2'));

    // emp-1 now has the new job and its notification, not the relay leg.
    const first = await employeeDashboard(app, 'emp-1');
    expect(first.assigned.map((v) => v.job.id)).toEqual(['plan-shp-4-L0']);
    expect(first.notifications.map((n) => n.jobId)).toEqual(['plan-shp-4-L0']);
    expect((await employeeDashboard(app, 'emp-2')).assigned).toEqual([]);
    // The relay point no longer expects the package.
    expect((await businessDashboard(app, CAFE)).notifications.filter((n) => n.shipmentId === 'shp-1')).toEqual([]);
    for (const jobId of ['plan-shp-1-L0', 'plan-shp-1-L1']) expect((await app.get(`/jobs/${jobId}`)).status).toBe(404);

    await expectConsistent(app);
    await expectCarriedPackagesVisible(app);
  }, T);
});

describe('a commute save for an employee who carries a delivery: a later departure', () => {
  it('the delivery is planned again on the new departure, and the marker and the package follow it', async () => {
    const app = await start();
    const before = await simulator(app);
    const oldPlan = planOf(before, 'shp-1')!;
    expect(oldPlan.legs[0]).toMatchObject({ tripId: 'emp-1-eve', employeeId: 'emp-1' });
    expect(oldPlan.legs[0].stops[0]).toMatchObject({ placeId: PRINT, serviceStartMin: 1020 });
    const notesBefore = app.store.get().notifications;
    const newestBefore = Math.max(...notesBefore.map((n) => n.createdSeq));

    // emp-1 leaves the Print Shop 30 minutes later.
    const res = await app.put('emp-1', commuteBody({ eveningDepartureMin: 1050 }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.trips.map((t) => [t.id, t.departureMin])).toEqual([['emp-1-eve', 1050]]);
    // shp-1 had a plan before the save; shp-3 still has no carrier.
    expect(body.rematchedShipmentIds).toEqual([]);

    const sim = await simulator(app);
    const plan = planOf(sim, 'shp-1')!;
    expect(plan).toMatchObject({ id: 'plan-shp-1', kind: 'relay', relayBusinessId: CAFE });
    expect(plan.legs.map((l) => l.tripId)).toEqual(['emp-1-eve', 'emp-2-morn']);
    // The first leg is timed from the new departure: 2 min pickup, 10 min drive, 2 min drop, 5 min home.
    expect(plan.legs[0].stops.map((s) => [s.placeId, s.kind, s.serviceStartMin, s.serviceEndMin])).toEqual([
      [PRINT, 'pickup', 1050, 1052], [CAFE, 'hub_drop', 1062, 1064],
    ]);
    expect(plan.legs[0].finishMin).toBe(1069);
    // The second carrier's leg is the same commute as before.
    expect(plan.legs[1]).toEqual(oldPlan.legs[1]);
    expect(sim.unmatched.map((u) => u.shipmentId)).toEqual(['shp-3']);
    expect(planOf(sim, 'shp-2')).toEqual(planOf(before, 'shp-2'));

    // The job view shows the new trip next to the new stop times.
    const job = await ok<JobResponse>(app, '/jobs/plan-shp-1-L0');
    expect(job.trip.departureMin).toBe(1050);
    expect(job.job.pickup).toEqual(plan.legs[0].stops[0]);
    expect(job.job.dropoff).toEqual(plan.legs[0].stops[1]);

    // The re-planned delivery gets its normal notifications again, as new ones: sender, recipient,
    // relay point and one per job.
    const notes = app.store.get().notifications.filter((n) => n.shipmentId === 'shp-1');
    expect(notes.map((n) => [n.audience, n.audienceId, n.kind]).sort()).toEqual([
      ['business', AGENCY, 'delivery_matched'],
      ['business', CAFE, 'delivery_matched'],
      ['business', PRINT, 'delivery_matched'],
      ['employee', 'emp-1', 'job_assigned'],
      ['employee', 'emp-2', 'job_assigned'],
    ]);
    for (const note of notes) expect(note.createdSeq).toBeGreaterThan(newestBefore);
    // The notifications of the delivery that kept its plan are untouched.
    const others = (run: Run['notifications']) => run.filter((n) => n.shipmentId !== 'shp-1');
    expect(others(app.store.get().notifications)).toEqual(others(notesBefore));

    await expectConsistent(app);

    // In the old carry window the vehicle has not left yet and the package waits at the sender.
    const early = await seek(app, 1025);
    expect(early.snapshot.markers.find((m) => m.employeeId === 'emp-1')).toBeUndefined();
    expect(early.snapshot.packagePositions['shp-1']).toBeDefined();
    expect(early.snapshot.shipmentStatus['shp-1']).toBe('scheduled');
    // In the new one the marker carries it.
    const carried = await seek(app, 1055);
    expect(carried.snapshot.markers.find((m) => m.employeeId === 'emp-1')).toMatchObject({ carryingShipmentId: 'shp-1' });
    expect(carried.snapshot.shipmentStatus['shp-1']).toBe('picked_up');
    await expectCarriedPackagesVisible(app);
  }, T);

  it('in planning the clock goes back to the start, paused, when a plan was dropped', async () => {
    const app = await start();
    const moved = await seek(app, 1100);
    expect(moved.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: 1100 });
    expect(moved.snapshot.shipmentStatus['shp-1']).toBe('at_hub');

    const res = await app.put('emp-1', commuteBody({ eveningDepartureMin: 1050 }));

    expect(res.status).toBe(200);
    const sim = await simulator(app);
    expect(sim.clock).toEqual({ ...moved.clock, timeMin: SIM_START, playing: false });
    expect(sim.snapshot.shipmentStatus['shp-1']).toBe('scheduled');
    expect(sim.snapshot.occurredEvents).toEqual([]);
  }, T);

  it('in planning the clock goes back to the start when a waiting request got a plan', async () => {
    const app = await start();
    await seek(app, 1100);

    // emp-1 opens the morning commute: home-001 -> Corner Cafe -> Print Shop carries shp-3. No trip that
    // carries a plan changed, so no plan is dropped.
    const before = await simulator(app);
    const res = await app.put('emp-1', commuteBody({ availableMorning: true }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual(['shp-3']);
    const sim = await simulator(app);
    expect(sim.clock).toEqual({ ...before.clock, timeMin: SIM_START, playing: false });
    for (const plan of before.plans) expect(sim.plans).toContainEqual(plan);
    for (const job of before.jobs) expect(sim.jobs).toContainEqual(job);
    await expectConsistent(app);
  }, T);
});

describe('a commute save for an employee who carries a delivery: a new home', () => {
  it('the leg drives to the new home, and the old home is gone from the run and from the map', async () => {
    const app = await start();
    const before = await simulator(app);
    expect(planOf(before, 'shp-1')!.legs[0].placeIds).toEqual([PRINT, CAFE, 'home-001']);
    expect((await ok<MapResponse>(app, '/map')).homes.map((h) => h.id)).toContain('home-001');

    // emp-1 moves from home-001 (15) to the new home (20). The Corner Cafe (10) is still on the way.
    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.home.id).toBe(NEW_HOME_ID);
    expect(body.rematchedShipmentIds).toEqual([]);

    const sim = await simulator(app);
    const plan = planOf(sim, 'shp-1')!;
    expect(plan.legs[0]).toMatchObject({ tripId: 'emp-1-eve', employeeId: 'emp-1', placeIds: [PRINT, CAFE, NEW_HOME_ID] });
    // Home 5 min further: the leg ends 5 min later than the old one, and the stops are the same.
    expect(plan.legs[0].stops).toEqual(planOf(before, 'shp-1')!.legs[0].stops);
    expect(plan.legs[0].finishMin).toBe(planOf(before, 'shp-1')!.legs[0].finishMin + 5);
    expect(plan.legs[1]).toEqual(planOf(before, 'shp-1')!.legs[1]);
    expect(planOf(sim, 'shp-2')).toEqual(planOf(before, 'shp-2'));

    // No leg names the old home, the run no longer lists it, and the map has the new one with the leg's pairs.
    expect(sim.plans.flatMap((p) => p.legs.flatMap((l) => l.placeIds))).not.toContain('home-001');
    expect(app.store.get().scenario.homes.map((h) => h.id)).toEqual(['home-002', 'home-003', NEW_HOME_ID]);
    const map = await ok<MapResponse>(app, '/map');
    expect(sorted(map.homes.map((h) => h.id))).toEqual(sorted(['home-002', 'home-003', NEW_HOME_ID]));
    const pairs = map.polylines.map((p) => pairKey(p.from, p.to));
    expect(pairs).toContain(pairKey(CAFE, NEW_HOME_ID));
    expect(pairs.filter((key) => key.includes('home-001'))).toEqual([]);

    // The route asked only for the two commute lines; the new leg's lines are the map's job (pass 57).
    expect(app.lineCalls).toEqual([[{ from: PRINT, to: NEW_HOME_ID }, { from: NEW_HOME_ID, to: PRINT }]]);

    await expectConsistent(app);
    await expectCarriedPackagesVisible(app);
  }, T);

  it('a new home that takes the delivery off the route leaves it unmatched, and the old home goes too', async () => {
    const app = await start();

    // emp-3 (Agency 30) moves from home-003 (-5) to the new home (20): the Print Shop (0) is now 44 min extra.
    const res = await app.put('emp-3', commuteBody({ businessId: AGENCY, home: NEW_HOME_BODY }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).rematchedShipmentIds).toEqual([]);
    const sim = await simulator(app);
    expect(planOf(sim, 'shp-2')).toBeUndefined();
    expect(sorted(sim.unmatched.map((u) => u.shipmentId))).toEqual(['shp-2', 'shp-3']);
    expect(app.store.get().scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-002', NEW_HOME_ID]);
    expect((await employeeDashboard(app, 'emp-3')).assigned).toEqual([]);
    await expectConsistent(app);
  }, T);

  it('a home another employee still lives at stays', async () => {
    const scenario = sampleScenario();
    scenario.employees.find((e) => e.id === 'emp-2')!.homeId = 'home-001'; // emp-1 and emp-2 share home-001
    scenario.homes = scenario.homes.filter((h) => h.id !== 'home-002');
    const app = await start(scenario);

    const res = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));

    expect(res.status).toBe(200);
    expect(app.store.get().scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-003', NEW_HOME_ID]);
    await expectConsistent(app);
  }, T);
});

describe('a commute save that changes no trip a plan rides', () => {
  it('only maxExtraMin: every plan, job, notification and event stays, and so does the clock', async () => {
    const app = await start();
    const moved = await seek(app, 1100);
    const before = structuredClone(app.store.get());
    const emp = before.scenario.employees.find((e) => e.id === 'emp-1')!;

    // 2 minutes would no longer allow the 4 extra minutes of shp-1, but the limit alone re-plans nothing
    // (DECISIONS pass 8: Recompute does that).
    const res = await app.put('emp-1', commuteBody({ maxExtraMin: 2 }));

    expect(res.status).toBe(200);
    const body = CommuteResponseSchema.parse(res.body);
    expect(body.rematchedShipmentIds).toEqual([]);
    expect(body.trips).toEqual(before.trips.filter((t) => t.employeeId === 'emp-1'));

    const run = app.store.get();
    expect(run.version).toBe(before.version + 1);
    expect({ ...run.assignments, computeMs: 0 }).toEqual({ ...before.assignments, computeMs: 0 });
    expect(run.jobs).toEqual(before.jobs);
    expect(run.notifications).toEqual(before.notifications);
    expect(run.events).toEqual(before.events);
    expect(run.trips).toEqual(expect.arrayContaining(before.trips));
    expect(run.scenario.homes).toEqual(before.scenario.homes);
    expect(run.scenario.employees.find((e) => e.id === 'emp-1')).toEqual({ ...emp, maxExtraMin: 2 });
    expect((await simulator(app)).clock).toEqual(moved.clock);
    await expectConsistent(app);
  }, T);

  it('a changed commute that carries nothing keeps every plan and the clock', async () => {
    const app = await start();
    const moved = await seek(app, 1100);
    const before = structuredClone(app.store.get());

    // emp-2's evening commute is free: it moves 20 minutes, the morning one (shp-1's second leg) stays.
    const res = await app.put('emp-2', commuteBody({
      businessId: AGENCY, home: { homeId: 'home-002' }, eveningDepartureMin: 1050, availableMorning: true,
    }));

    expect(res.status).toBe(200);
    expect(CommuteResponseSchema.parse(res.body).trips.map((t) => [t.id, t.departureMin]))
      .toEqual([['emp-2-eve', 1050], ['emp-2-morn', 1935]]);
    const run = app.store.get();
    expect({ ...run.assignments, computeMs: 0 }).toEqual({ ...before.assignments, computeMs: 0 });
    expect(run.jobs).toEqual(before.jobs);
    expect(run.notifications).toEqual(before.notifications);
    expect(run.events).toEqual(before.events);
    expect((await simulator(app)).clock).toEqual(moved.clock);
    await expectConsistent(app);
  }, T);
});

describe('a refused commute save for an employee who carries a delivery', () => {
  it('400, 404, 409 and 503 change nothing: the same run, the same version, the same clock', async () => {
    const app = await start();
    await seek(app, 1100);
    const planning = app.store.get();
    // Each of these would drop shp-1's plan if it were applied.
    const change = commuteBody({ eveningDepartureMin: 1050 });

    const invalid = await app.put('emp-1', { ...change, eveningDepartureMin: 'late' });
    expect(invalid.status).toBe(400);
    const unknownHome = await app.put('emp-1', commuteBody({ home: { homeId: 'home-999' }, availableEvening: false }));
    expect(unknownHome.status).toBe(400);
    const unknown = await app.put('emp-99', change);
    expect(unknown.status).toBe(404);
    app.failPairs(new GoogleKeyMissingError());
    const noGoogle = await app.put('emp-1', commuteBody({ home: NEW_HOME_BODY }));
    expect(noGoogle.status).toBe(503);
    expect(app.store.get()).toBe(planning);

    const playing = await app.control({ action: 'play' });
    expect(playing.body.clock.phase).toBe('locked');
    await app.control({ action: 'pause' });
    const locked = app.store.get();
    const refused = await app.put('emp-1', change);
    expect(refused.status).toBe(409);
    expect(app.store.get()).toBe(locked);
    expect(locked.assignments).toEqual(planning.assignments);
    expect(locked.jobs).toEqual(planning.jobs);
    expect(locked.trips).toEqual(planning.trips);
    await expectConsistent(app);
  }, T);
});

describe('the pure steps of the re-plan (commutePlan.ts)', () => {
  const trip = (id: string, changes: Partial<Trip> = {}): Trip => ({
    id, employeeId: 'emp-1', direction: id.endsWith('eve') ? 'evening' : 'morning',
    originPlaceId: PRINT, destinationPlaceId: 'home-001', departureMin: 1020,
    baselineDurationMin: 15, baselineDistanceM: 15 * METERS_PER_MIN, ...changes,
  });
  const sampleRun = (): Run => createInitialRun(sampleScenario(), { travel: tableTravel(), buildEvents: buildTimeline });

  it('changedTripIds lists a trip that is gone or differs in departure, origin or destination', () => {
    const before = [trip('emp-1-eve'), trip('emp-1-morn')];
    expect(changedTripIds(before, before.map((t) => ({ ...t })))).toEqual([]);
    expect(changedTripIds(before, [trip('emp-1-morn')])).toEqual(['emp-1-eve']);
    expect(changedTripIds(before, [])).toEqual(['emp-1-eve', 'emp-1-morn']);
    expect(changedTripIds(before, [trip('emp-1-eve', { departureMin: 1021 }), trip('emp-1-morn')])).toEqual(['emp-1-eve']);
    expect(changedTripIds(before, [trip('emp-1-eve'), trip('emp-1-morn', { originPlaceId: AGENCY })])).toEqual(['emp-1-morn']);
    expect(changedTripIds(before, [trip('emp-1-eve', { destinationPlaceId: 'home-002' }), trip('emp-1-morn')])).toEqual(['emp-1-eve']);
    // The baseline numbers follow the two places, and a trip that is only new carried nothing.
    expect(changedTripIds([trip('emp-1-eve')], [trip('emp-1-eve', { baselineDurationMin: 99 }), trip('emp-1-morn')])).toEqual([]);
  });

  it('dropPlansOnTrips removes the whole plan with its jobs, events and notifications, and nothing else', () => {
    const run = sampleRun();
    const before = structuredClone(run);

    expect(dropPlansOnTrips(run, ['emp-3-morn', 'emp-2-eve'])).toEqual([]);
    expect(run).toEqual(before);

    // emp-2's morning commute is the second leg of the relay shp-1.
    expect(dropPlansOnTrips(run, ['emp-2-morn'])).toEqual(['shp-1']);
    expect(run.assignments.plans.map((p) => p.shipmentId)).toEqual(['shp-2']);
    const kept = <V extends { planId: string }>(values: V[]) => values.filter((v) => v.planId === 'plan-shp-2');
    expect(run.jobs).toEqual(kept(before.jobs));
    expect(run.events).toEqual(kept(before.events));
    expect(run.notifications).toEqual(kept(before.notifications));
    expect(run.jobs).toHaveLength(1);
    expect(run.assignments.unmatched).toEqual(before.assignments.unmatched);
    expect(run.trips).toEqual(before.trips);
    expect(run.scenario).toEqual(before.scenario);
  });

  it('dropUnusedHomes keeps a home an employee lives at or a plan leg names', () => {
    const run = sampleRun();
    const homes = run.scenario.homes;
    dropUnusedHomes(run);
    expect(run.scenario.homes).toBe(homes);

    // emp-3 moves in with emp-2; the plan of shp-2 still drives to home-003.
    run.scenario.employees.find((e) => e.id === 'emp-3')!.homeId = 'home-002';
    dropUnusedHomes(run);
    expect(run.scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-002', 'home-003']);
    dropPlansOnTrips(run, ['emp-3-eve']);
    dropUnusedHomes(run);
    expect(run.scenario.homes.map((h) => h.id)).toEqual(['home-001', 'home-002']);
  });
});
