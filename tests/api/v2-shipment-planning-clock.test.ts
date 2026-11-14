// The clock of a run that is still being planned, when a delivery request is stored (issue #624, DECISIONS pass 62).
// Only `play` locks the run. A seek, Next event, Jump to morning, Finish and "Play journey" (which seeks) move
// the clock while the phase stays `planning`, and a delivery can still be added. The matcher does not read the
// clock, so without the rewind rule a delivery stored after such a preview is answered as already at the relay
// point or delivered, with its reward already earned.
//   1. `atPlanningStart`, the pure rule.
//   2. The whole server on the committed NYC cache (v2-e2e-nyc-helper.ts): the presenter's order of steps.
//   3. The route harness on the sample city (v2-shipment-route-helpers.ts): an edit and a re-match, which
//      need a delivery that is known to be unmatched.
// Only rules are asserted on the NYC run: no story ID and no count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  INVALID_SHIPMENT, SHIPMENT_MATCHED, SHIPMENT_NOT_FOUND, SHIPMENTS_LOCKED, atPlanningStart,
} from '../../server/api/v2/shipmentOps';
import type { EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Clock, DeliveryPlan, Run } from '../../shared/v2/types';
import {
  deliveryRequest, findMatchingDelivery, readCity, recordFetch, startNycApi, statusFromPlan, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';
import { checked, lockedRun, planningRun } from './v2-shipment-ops-sample';
import {
  CAFE, PRINT, deliveryBody, expectShipmentResponse, expectUntouched, lock, remember, startShipmentApp, type ShipmentApp,
} from './v2-shipment-route-helpers';

/** A minute a preview leaves the clock at: Day 2, 1:00 AM, after every evening commute. */
const PREVIEW_MIN = 1500;

const net = recordFetch();
afterEach(() => net.expectNoOutgoing());
afterAll(() => net.restore());

// ---------- 1. the pure rule ----------

describe('atPlanningStart', () => {
  const withClock = (clock: Partial<Clock>, base: Run = planningRun): Run =>
    ({ ...structuredClone(base), clock: { ...base.clock, ...clock } });
  const start = planningRun.scenario.settings.simStartMin;

  it('puts a moved planning clock back at the start, paused, and keeps the phase and the speed', () => {
    const moved = withClock({ timeMin: PREVIEW_MIN, speed: 600 });
    const result = checked(moved, atPlanningStart);
    expect(result.clock).toEqual({ phase: 'planning', playing: false, timeMin: start, speed: 600 });
    expect({ ...result, clock: moved.clock }).toEqual(moved); // nothing else differs
  });

  it('changes only the clock: the result shares everything else with the run it was given', () => {
    const moved = withClock({ timeMin: PREVIEW_MIN });
    const result = atPlanningStart(moved);
    expect(result).not.toBe(moved);
    expect(result.version).toBe(moved.version);
    expect(result.scenario).toBe(moved.scenario);
    expect(result.assignments).toBe(moved.assignments);
    expect(moved.clock.timeMin).toBe(PREVIEW_MIN);
  });

  it('pauses a planning clock that is at the start', () => {
    expect(checked(withClock({ playing: true }), atPlanningStart).clock)
      .toEqual({ ...planningRun.clock, playing: false });
  });

  it('gives back the same run when the clock is at the start already', () => {
    expect(planningRun.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: start });
    expect(atPlanningStart(planningRun)).toBe(planningRun);
  });

  it('never moves the clock of a locked run', () => {
    expect(lockedRun.clock.phase).toBe('locked');
    expect(lockedRun.clock.timeMin).not.toBe(start);
    expect(atPlanningStart(lockedRun)).toBe(lockedRun);
    const playing = withClock({ playing: true, timeMin: PREVIEW_MIN }, lockedRun);
    expect(atPlanningStart(playing)).toBe(playing);
  });
});

// ---------- 2. the presenter's steps on the NYC run ----------

describe('a delivery added after a preview, on the NYC run', () => {
  let api: NycApi;
  let city: City;
  /** A sender and a recipient that match on the untouched default run, found on a first server. */
  let pair: { origin: string; destination: string };
  let created: ShipmentResponse;
  let request: ReturnType<typeof deliveryRequest>;
  const plan = () => created.plan as DeliveryPlan;
  const dashboard = async (employeeId: string) => {
    const res = await api.get<EmployeeDashboard>(`/employees/${employeeId}/dashboard`);
    expect(res.status).toBe(200);
    return res.body;
  };
  /** The run is exactly as `before` left it: same version, same clock. */
  const expectNothingMoved = async (before: SimulatorResponse) => {
    const now = await api.simulator();
    expect(now.version).toBe(before.version);
    expect(now.clock).toStrictEqual(before.clock);
  };

  beforeAll(async () => {
    // The helper finds a matching pair by storing requests, and every stored request rewinds the clock.
    // So the pair is found on a server of its own, and the test server gets one request: the one that matches.
    const scout = await startNycApi(net);
    try {
      if (scout.runtime.status === 'ready') {
        const found = await findMatchingDelivery(scout, await readCity(scout), 'planning-clock-scout');
        pair = { origin: found.origin, destination: found.destination };
      }
    } finally {
      await scout.close();
    }
    api = await startNycApi(net);
    if (api.runtime.status === 'ready') city = await readCity(api);
  }, T);
  afterAll(async () => {
    await api?.close();
  }, T);

  it('the run starts in planning with the clock at the start', async () => {
    expect(api.runtime.status).toBe('ready');
    expect(pair).toBeDefined();
    const sim = await api.simulator();
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    expect(PREVIEW_MIN).toBeGreaterThan(city.settings.simStartMin);
    expect(PREVIEW_MIN).toBeLessThan(city.settings.simEndMin);
  }, T);

  it('seek to 1500, then POST: 201 scheduled, the clock is back at the start, the job is assigned and not paid', async () => {
    const preview = await api.control({ action: 'seek', timeMin: PREVIEW_MIN });
    expect(preview.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: PREVIEW_MIN });

    request = deliveryRequest('planning-clock-live', pair.origin, pair.destination, city.settings);
    const res = await api.post<ShipmentResponse>('/shipments', request);

    expect(res.status).toBe(201);
    created = res.body;
    expect(created).toMatchObject({ matched: true, status: 'scheduled', deliveredAtMin: null });
    // The fault this guards against: at the preview's minute the plan is already under way.
    expect(statusFromPlan(plan(), PREVIEW_MIN)).not.toBe('scheduled');

    const sim = await api.simulator();
    expect(sim.clock).toStrictEqual({ ...preview.clock, timeMin: city.settings.simStartMin, playing: false });
    expect(sim.clock.phase).toBe('planning');
    expect(sim.version).toBe(preview.version + 1); // one mutation stores the delivery and the clock
    expect(sim.snapshot.timeMin).toBe(city.settings.simStartMin);
    expect(sim.snapshot.shipmentStatus[created.shipment.id]).toBe('scheduled');

    const tracking = await api.get<ShipmentResponse>(`/shipments/${created.shipment.id}`);
    expect(tracking.body).toMatchObject({ status: 'scheduled', deliveredAtMin: null });

    expect(plan().legs.length).toBeGreaterThan(0);
    for (const [legIndex, leg] of plan().legs.entries()) {
      const jobId = created.jobIds[legIndex];
      const carrier = await dashboard(leg.employeeId);
      expect(carrier.assigned.map((view) => view.job.id)).toContain(jobId);
      expect(carrier.completed.map((view) => view.job.id)).not.toContain(jobId);
      expect(leg.rewardCents).toBeGreaterThan(0);
      // Nothing is earned before the first commute: the reward is only projected.
      expect(carrier.earnedCents).toBe(0);
      expect(carrier.projectedCents).toBeGreaterThanOrEqual(leg.rewardCents);
    }
  }, T);

  it('a request that stores nothing leaves the moved clock and the version: replay, 400, 404, matched retry', async () => {
    const preview = await api.control({ action: 'seek', timeMin: PREVIEW_MIN });
    const underWay = statusFromPlan(plan(), PREVIEW_MIN);

    // The same request again: the stored delivery, as it is at the clock the presenter moved to.
    const replay = await api.post<ShipmentResponse>('/shipments', request);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ shipment: created.shipment, plan: created.plan, matched: true, status: underWay });
    await expectNothingMoved(preview);

    const invalid = await api.post<{ error: string }>('/shipments', { ...request, clientRequestId: 'planning-clock-heavy', weightKg: 5 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe(INVALID_SHIPMENT);
    await expectNothingMoved(preview);

    const unknown = await api.post<{ error: string }>('/shipments/shp-999999/match');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe(SHIPMENT_NOT_FOUND);
    await expectNothingMoved(preview);

    // A retry of a delivery that has its plan runs no match and stores nothing.
    const retry = await api.post<ShipmentResponse>(`/shipments/${created.shipment.id}/match`);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ matched: true, status: underWay, plan: created.plan });
    await expectNothingMoved(preview);
  }, T);

  it('after Play a repeated request is answered 200 with the stored delivery, and a new one is still 409', async () => {
    expect((await api.control({ action: 'play' })).clock).toMatchObject({ phase: 'locked', playing: true });
    const locked = await api.control({ action: 'pause' });
    expect(locked.clock).toMatchObject({ phase: 'locked', playing: false, timeMin: PREVIEW_MIN });

    const replay = await api.post<ShipmentResponse>('/shipments', request);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      shipment: created.shipment, plan: created.plan, jobIds: created.jobIds, matched: true,
      status: statusFromPlan(plan(), PREVIEW_MIN),
    });
    await expectNothingMoved(locked);

    // The body's shape is still checked first, and a request the run has not seen is refused.
    const changed = await api.post<ShipmentResponse>('/shipments', { ...request, label: 'Sent twice' });
    expect(changed.status).toBe(200);
    expect(changed.body.shipment).toStrictEqual(created.shipment);
    const fresh = await api.post<{ error: string }>('/shipments', { ...request, clientRequestId: 'planning-clock-late' });
    expect(fresh.status).toBe(409);
    expect(fresh.body).toStrictEqual({ error: SHIPMENTS_LOCKED });
    await expectNothingMoved(locked);
    expect((await api.exportRun()).scenario.shipments.filter((s) => s.clientRequestId === 'planning-clock-late')).toEqual([]);
  }, T);
});

// ---------- 3. an edit and a re-match, on the sample city ----------
// shp-1 and shp-2 are matched, shp-3 is unmatched and stays unmatched when it is edited or retried.

describe('an edit or a re-match after a preview, on the sample city', () => {
  let started: ShipmentApp[] = [];
  /** The sample city after a preview: phase `planning`, the clock at `PREVIEW_MIN`. */
  const startPreviewed = async () => {
    const app = await startShipmentApp();
    started.push(app);
    net.allow(app.base);
    await app.store.mutate((run) => {
      run.clock.timeMin = PREVIEW_MIN;
    });
    return app;
  };
  afterEach(async () => {
    await Promise.all(started.map((app) => app.close()));
    started = [];
  });

  const START = 930;
  const atStart: Clock = { phase: 'planning', playing: false, timeMin: START, speed: 120 };

  /** One mutation stored the request and the clock, and the answer was built at the start of the run. */
  const expectRewound = (app: ShipmentApp, before: { copy: Run }) => {
    const run = app.store.get();
    expect(before.copy.clock).toEqual({ ...atStart, timeMin: PREVIEW_MIN });
    expect(run.clock).toEqual(atStart);
    expect(run.version).toBe(before.copy.version + 1);
    expect(app.snapshots).toHaveLength(1);
    expect(app.snapshots[0].run).toBe(run);
    expect(app.snapshots[0].timeMin).toBe(START);
  };

  it('POST /shipments rewinds, whether the delivery matches or not', async () => {
    // Agency -> Corner Cafe matches on emp-2's free evening trip; Agency -> Print Shop finds no commute.
    for (const [destinationBusinessId, matched] of [[CAFE, true], [PRINT, false]] as const) {
      const app = await startPreviewed();
      const before = remember(app);
      const reply = await app.create(deliveryBody({ destinationBusinessId }));
      expect(reply.status).toBe(201);
      expect(expectShipmentResponse(app, reply).matched).toBe(matched);
      expectRewound(app, before);
    }
  });

  it('PATCH /shipments/:id rewinds when the edit is stored', async () => {
    const app = await startPreviewed();
    const before = remember(app);

    const reply = await app.patch('shp-3', { label: 'Pastry box (large)' });

    expect(reply.status).toBe(200);
    expect(expectShipmentResponse(app, reply).shipment.label).toBe('Pastry box (large)');
    expectRewound(app, before);
  });

  it('POST /shipments/:id/match rewinds when the match is run again', async () => {
    const app = await startPreviewed();
    const before = remember(app);

    const reply = await app.retry('shp-3');

    expect(reply.status).toBe(200);
    expectShipmentResponse(app, reply);
    expectRewound(app, before);
    // Only the clock and the version differ from the run before the retry found nothing again.
    expect({ ...app.store.get(), clock: before.copy.clock, version: before.copy.version, assignments: null })
      .toEqual({ ...before.copy, assignments: null });
  });

  it('a stored request with the clock at the start already leaves the clock as it is', async () => {
    const app = await startShipmentApp();
    started.push(app);
    net.allow(app.base);
    const before = remember(app);
    expect(before.copy.clock).toEqual(atStart);

    expect((await app.patch('shp-3', { label: 'Pastry box (large)' })).status).toBe(200);

    expect(app.store.get().clock).toEqual(atStart);
    expect(app.store.get().version).toBe(before.copy.version + 1);
  });

  const refusals: [string, (app: ShipmentApp) => ReturnType<ShipmentApp['request']>, number, string | null][] = [
    ['POST with a stored clientRequestId (replay)', (app) => app.create(deliveryBody({ clientRequestId: 'sample-1' })), 200, null],
    ['POST with a body the schema refuses', (app) => app.create(deliveryBody({ weightKg: 5 })), 400, INVALID_SHIPMENT],
    ['POST with an unknown sender', (app) => app.create(deliveryBody({ originBusinessId: 'biz-nowhere' })), 400, INVALID_SHIPMENT],
    ['PATCH of an unknown ID', (app) => app.patch('shp-99', { label: 'Renamed' }), 404, SHIPMENT_NOT_FOUND],
    ['PATCH of a matched delivery', (app) => app.patch('shp-1', { label: 'Renamed' }), 409, SHIPMENT_MATCHED],
    ['PATCH with a body the schema refuses', (app) => app.patch('shp-3', { weightKg: 5 }), 400, INVALID_SHIPMENT],
    ['retry of an unknown ID', (app) => app.retry('shp-99'), 404, SHIPMENT_NOT_FOUND],
    ['retry of a matched delivery', (app) => app.retry('shp-1'), 200, null],
  ];
  it.each(refusals)('%s stores nothing: the moved clock and the version stay', async (_name, send, status, error) => {
    const app = await startPreviewed();
    const before = remember(app);

    const reply = await send(app);

    expect(reply.status).toBe(status);
    if (error !== null) expect(reply.body.error).toBe(error);
    expectUntouched(app, before);
    expect(app.store.get().clock.timeMin).toBe(PREVIEW_MIN);
  });

  it('while locked: a replay is 200 with the stored delivery, a new request, an edit and a retry are 409, nothing moves', async () => {
    const app = await startPreviewed();
    await lock(app);
    const before = remember(app);

    const replay = await app.create(deliveryBody({ clientRequestId: 'sample-3' }));
    expect(replay.status).toBe(200);
    expect(expectShipmentResponse(app, replay).shipment).toEqual(before.copy.scenario.shipments.find((s) => s.id === 'shp-3'));
    // The answer is about the stored run, at the clock it is locked at.
    expect(app.snapshots).toHaveLength(1);
    expect(app.snapshots[0].timeMin).toBe(PREVIEW_MIN);

    for (const reply of [await app.create(deliveryBody()), await app.patch('shp-3', { label: 'Renamed' }), await app.retry('shp-3')]) {
      expect(reply.status).toBe(409);
      expect(reply.body).toEqual({ error: SHIPMENTS_LOCKED });
    }
    expectUntouched(app, before);
    expect(app.store.get().clock).toEqual({ ...atStart, phase: 'locked', timeMin: PREVIEW_MIN });
  });
});
