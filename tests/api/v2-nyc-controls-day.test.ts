// #532, SPEC nice-to-have 11: a whole day to the locked end, and Start new planning cycle, over HTTP on
// the committed NYC cache: once on the default run and once on a Random city.
//   Play (locks the run, DECISIONS pass 28) -> Jump to morning -> Finish: every matched package is delivered.
//   While locked, the routes that change plans or people answer 409 (pass 3 and 6) and change nothing.
//   Reset playback rewinds the same plans and keeps the lock.
//   Start new planning cycle (pass 6) gives a new `runId` in `planning`, and a new delivery request,
//   a commute save and Recompute are accepted again.
// The server is the real one with no key, booted from a temp copy of `fixtures/nyc` (v2-nyc-controls-helper.ts);
// `globalThis.fetch` is a recorder for the whole file, and a call that is not to the test server fails
// the test that made it. After every step GET /map must answer 200 and list every pair of every plan leg.
// The clock ticker is not started: the clock moves only when a button moves it.
// The tests run in order on one server; each continues from the run the one before left.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommuteResponse, CompareResponse, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { ApiError } from '../../shared/v2/schemas';
import {
  commuteOf, deliveryRequest, findMatchingDelivery, readCity, recordFetch, type City,
} from './v2-e2e-nyc-helper';
import {
  expectEverythingDelivered, expectMapOfRun, expectNewCycle, expectPlansFitCity, expectRunAdds, expectSimulatorStill,
  generate, planning, playWholeDay, sendEveryWrite, startControlsApi, T,
  type ControlsApi, type WriteAnswer,
} from './v2-nyc-controls-helper';

/** Seeds tried in this order for the Random city of this file; the first city with a plan is used. */
const SEEDS = [205, 11, 3407];

const net = recordFetch();
let api: ControlsApi;

beforeAll(async () => {
  api = await startControlsApi(net);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

const enc = encodeURIComponent;

/** Leaves the server with the run the day is played on, in a new planning cycle. */
type Prepare = () => Promise<void>;

const defaultRun: Prepare = async () => {
  // The run the server booted with: nothing to do.
};

const randomCity: Prepare = async () => {
  for (const seed of SEEDS) {
    const res = await generate(api, { preset: 'random', seed });
    expect(`${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim(), `Generate with seed ${seed}`).toBe('200');
    if (res.body.plans.length > 0) return;
  }
  // Not a rule of the generator, only what this file needs: a day with nothing to deliver proves nothing.
  throw new Error(`None of the Random cities of seeds ${SEEDS.join(', ')} has a matched package`);
};

describe.each<[string, Prepare]>([
  ['the default run', defaultRun],
  ['a Random city', randomCity],
])('a whole day on %s', (name, prepare) => {
  let city: City;
  /** The run before Play. */
  let start: SimulatorResponse;
  /** The run at its locked end. */
  let end: SimulatorResponse;
  /** What each write route answered while the run was locked. */
  let refused: WriteAnswer[] = [];
  /** The run after Start new planning cycle. */
  let cycle: SimulatorResponse;

  beforeAll(async () => {
    await prepare();
    city = await readCity(api);
    start = await api.simulator();
  }, T);

  it('starts as a new planning cycle whose plans fit the city, with a map of the run', async () => {
    expectNewCycle(start, city.settings);
    expectPlansFitCity(start, city);
    expect(start.plans.length).toBeGreaterThan(0); // there is something to deliver
    await expectMapOfRun(api, start, `the start of ${name}`);
  }, T);

  it('Play, Jump to morning and Finish: every matched package ends delivered and the run is locked', async () => {
    end = await playWholeDay(api, city, name);
    expect(end.clock).toMatchObject({ phase: 'locked', playing: false, timeMin: city.settings.simEndMin });
    await expectEverythingDelivered(api, city, end);

    // The locked end is what the state file holds, in the temp folder.
    const saved = await api.savedRun();
    expect(saved?.runId).toBe(end.runId);
    expect(saved?.clock).toStrictEqual(end.clock);
  }, T);

  it('while locked, every route that changes plans or people answers 409 and changes nothing', async () => {
    refused = await sendEveryWrite(api, city, end, `controls-day-locked-${end.runId}`);
    expect(refused.map((answer) => answer.route)).toStrictEqual([
      'POST /shipments', 'PATCH /shipments/:id', 'POST /shipments/:id/match', 'PUT /employees/:id/commute', 'POST /matches/recompute',
    ]);
    for (const { route, status, body } of refused) {
      expect(`${route} ${status}`).toBe(`${route} 409`);
      // One sentence, and not a form error: there is no field to correct.
      expect(body.error.trim(), route).not.toBe('');
      expect(body.fieldErrors, route).toBeUndefined();
      expect(body.error, route).toMatch(/new planning cycle/i);
    }
    await expectSimulatorStill(api, end, 'the refused writes');
    expect((await api.savedRun())?.version).toBe(end.version);

    // The lock is on the run, not on the ID: an unknown delivery or employee is still a 404.
    expect((await api.patch<ApiError>('/shipments/no-such-delivery', { description: 'x' })).status).toBe(404);
    expect((await api.put<ApiError>('/employees/no-such-employee/commute', commuteOf(city.employees[0]))).status).toBe(404);
    await expectSimulatorStill(api, end, 'the two unknown IDs');
  }, T);

  it('while locked, the reads still answer: the comparison, the export and the map', async () => {
    const compare = await api.post<CompareResponse>('/matches/compare', {});
    expect(compare.status).toBe(200);
    // With relays allowed, the comparison's side is the run's own matching.
    expect(compare.body.withRelay.result.plans).toStrictEqual(end.plans);
    expect(compare.body.directOnly.result.plans.every((plan) => plan.kind === 'direct')).toBe(true);

    const file = await api.exportRun();
    expect(file).toMatchObject({ runId: end.runId, version: end.version, clock: end.clock });
    expect(file.assignments.plans).toStrictEqual(end.plans);

    await expectSimulatorStill(api, end, 'the comparison and the export');
    await expectMapOfRun(api, end, `the locked end of ${name}`);
  }, T);

  it('Reset playback rewinds the same plans to the first minute and keeps the run locked', async () => {
    const rewound = await api.control({ action: 'reset_playback' });
    expect(rewound.clock).toStrictEqual({ ...end.clock, timeMin: city.settings.simStartMin });
    expect(rewound.clock.phase).toBe('locked');
    expect(rewound.runId).toBe(end.runId);
    expect(planning(rewound)).toStrictEqual(planning(start));
    // Nothing has happened again: the snapshot is the one of the first minute.
    expect(rewound.snapshot.occurredEvents).toStrictEqual([]);
    expect(rewound.snapshot.shipmentStatus).toStrictEqual(start.snapshot.shipmentStatus);
    expect(rewound.snapshot.metrics).toStrictEqual(start.snapshot.metrics);
    expectRunAdds(rewound);
    await expectMapOfRun(api, rewound, `Reset playback on ${name}`);

    // Still locked at the first minute: a rewind is not a new planning cycle.
    const [origin, destination] = city.businesses.map((b) => b.id).sort();
    const again = await api.post<ApiError>('/shipments', deliveryRequest(`controls-day-rewound-${end.runId}`, origin, destination, city.settings));
    expect(again.status).toBe(409);
    expect(again.body).toStrictEqual(refused[0].body);
    await expectSimulatorStill(api, rewound, 'the refused request after Reset playback');

    // Finish again: the same end as the first time.
    const finished = await api.control({ action: 'finish' });
    expect(finished.clock).toStrictEqual(end.clock);
    expect(finished.snapshot.shipmentStatus).toStrictEqual(end.snapshot.shipmentStatus);
    expect(finished.snapshot.deliveredAtMin).toStrictEqual(end.snapshot.deliveredAtMin);
    expect(finished.snapshot.metrics).toStrictEqual(end.snapshot.metrics);
  }, T);

  it('Start new planning cycle unlocks: a new runId, paused at the first minute, the same requests matched the same way', async () => {
    const before = await api.simulator();
    expect(before.clock.phase).toBe('locked');
    const res = await api.post<SimulatorResponse>('/planning/reset');
    expect(`${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim()).toBe('200');
    cycle = res.body;

    expect(cycle.runId).not.toBe(before.runId);
    expect(cycle.version).toBe(before.version + 1);
    expect(cycle.clock).toStrictEqual({ ...before.clock, phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    expectNewCycle(cycle, city.settings);
    expect(await api.simulator()).toStrictEqual(cycle);

    // The businesses, the employees and the requests are kept, and the same inputs give the same plans
    // (AGENTS.md: same seed and inputs, identical IDs and assignments).
    const cityNow = await readCity(api);
    expect(cityNow.businesses).toStrictEqual(city.businesses);
    expect(cityNow.employees).toStrictEqual(city.employees);
    expect(cityNow.settings).toStrictEqual(city.settings);
    expect(planning(cycle)).toStrictEqual(planning(start));
    expectPlansFitCity(cycle, city);

    // The map is asked for again because the run changed, and it is the new run's.
    await expectMapOfRun(api, cycle, `Start new planning cycle on ${name}`);
  }, T);

  it('after the new cycle a new delivery request is accepted again', async () => {
    const [origin, destination] = city.businesses.map((b) => b.id).sort();
    // The very request that was refused while the run was locked.
    const res = await api.post<ShipmentResponse>('/shipments', deliveryRequest(`controls-day-locked-${end.runId}`, origin, destination, city.settings));
    expect(res.status).toBe(201);
    const { shipment } = res.body;
    expect(cycle.shipments.map((s) => s.id)).not.toContain(shipment.id);
    expect(res.body.status).toBe(res.body.matched ? 'scheduled' : 'unmatched');
    expect(res.body.plan === null).toBe(!res.body.matched);
    if (!res.body.matched) expect(res.body.unmatchedReason?.trim()).toBeTruthy();

    const after = await api.simulator();
    expect(after.runId).toBe(cycle.runId);
    expect(after.version).toBe(cycle.version + 1);
    expect(after.clock).toStrictEqual(cycle.clock);
    expect(after.shipments.map((s) => s.id).sort()).toStrictEqual([...cycle.shipments.map((s) => s.id), shipment.id].sort());
    // The plans of the cycle are reserved: the new request only takes trips that were free.
    for (const plan of cycle.plans) expect(after.plans).toContainEqual(plan);
    expectRunAdds(after);
    expectPlansFitCity(after, city);
    await expectMapOfRun(api, after, `a new delivery request on ${name}`);

    // An edit and a retry of it are not refused for the lock any more.
    const locked = new Set(refused.map((answer) => answer.body.error));
    const edit = await api.patch<ShipmentResponse & ApiError>(`/shipments/${enc(shipment.id)}`, { description: 'Hand to the front desk' });
    // Only an unmatched request can be edited (DECISIONS pass 6); a matched one is refused for that reason.
    expect(edit.status).toBe(res.body.matched ? 409 : 200);
    expect(locked.has(edit.body.error)).toBe(false);
    const retry = await api.post<ShipmentResponse>(`/shipments/${enc(shipment.id)}/match`);
    expect(retry.status).toBe(200);
    expect(retry.body.shipment.id).toBe(shipment.id);
    await expectMapOfRun(api, await api.simulator(), `an edit and a retry on ${name}`);
  }, T);

  it('after the new cycle a commute save and Recompute are accepted again', async () => {
    const employee = city.employees[0];
    const before = await api.simulator();
    const save = await api.put<CommuteResponse>(`/employees/${enc(employee.id)}/commute`, commuteOf(employee));
    expect(save.status).toBe(200);
    expect(save.body.employee).toStrictEqual(employee);
    const saved = await api.simulator();
    expect(saved.runId).toBe(before.runId);
    for (const plan of before.plans) expect(saved.plans).toContainEqual(plan);
    await expectMapOfRun(api, saved, `a commute save on ${name}`);

    const res = await api.post<SimulatorResponse>('/matches/recompute');
    expect(`${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim()).toBe('200');
    const recomputed = res.body;
    expect(recomputed.runId).toBe(saved.runId);
    expect(recomputed.version).toBe(saved.version + 1);
    expect(recomputed.clock).toStrictEqual(saved.clock);
    expect(recomputed.shipments).toStrictEqual(saved.shipments);
    expectNewCycle(recomputed, city.settings);
    expectPlansFitCity(recomputed, city);
    await expectMapOfRun(api, recomputed, `Recompute on ${name}`);
  }, T);
});

describe('the default run again: a live request still matches after a whole day and a new cycle', () => {
  it('Generate with the demo preset brings the default city back, and a delivery found from the data is matched', async () => {
    const res = await generate(api, { preset: 'demo' });
    expect(`${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim()).toBe('200');
    const city = await readCity(api);
    expectNewCycle(res.body, city.settings);
    expectPlansFitCity(res.body, city);
    await expectMapOfRun(api, res.body, 'Generate with the demo preset');

    await playWholeDay(api, city, 'the demo preset');
    const cycle = await api.post<SimulatorResponse>('/planning/reset');
    expect(cycle.status).toBe(200);
    expect(planning(cycle.body)).toStrictEqual(planning(res.body));

    // Throws when no sender and recipient pair of the city matches: then the live demo request (demo
    // steps 2 and 3) would not work after a judge has played a day and started a new cycle.
    const found = await findMatchingDelivery(api, city, 'controls-day-live');
    expect(found.delivery.status).toBe('scheduled');
    const after = await api.simulator();
    expect(after.plans).toContainEqual(found.delivery.plan);
    expectPlansFitCity(after, city);
    await expectMapOfRun(api, after, 'a matched live request after a new cycle');
  }, T);
});

describe('Jump to morning and Finish without Play', () => {
  // Only Play locks a run (DECISIONS pass 28; "a seek does not lock it", tests/api/v2-control-ops.test.ts).
  // So a judge who presses Jump to morning and Finish and never Play sees the same delivered end, on a
  // run that is still in `planning` and still takes requests. This test holds that contract on the real
  // cache. What a request sent at that moment looks like is reported in the PR of #532 as a question for
  // the planner, not asserted here.
  it('ends with every matched package delivered, and the run is still in planning and takes a request', async () => {
    const cycle = await api.post<SimulatorResponse>('/planning/reset');
    expect(cycle.status).toBe(200);
    const city = await readCity(api);
    const start = cycle.body;
    expectNewCycle(start, city.settings);
    expect(start.plans.length).toBeGreaterThan(0);

    const morning = await api.control({ action: 'jump_to_morning' });
    expect(morning.clock).toMatchObject({ phase: 'planning', playing: false });
    expect(morning.clock.timeMin).toBeGreaterThan(start.clock.timeMin);
    const end = await api.control({ action: 'finish' });
    expect(end.clock).toStrictEqual({ ...start.clock, timeMin: city.settings.simEndMin });
    expect(planning(end)).toStrictEqual(planning(start));
    expectRunAdds(end);
    await expectEverythingDelivered(api, city, end);
    await expectMapOfRun(api, end, 'Finish without Play');

    const [origin, destination] = city.businesses.map((b) => b.id).sort();
    const res = await api.post<ShipmentResponse>('/shipments', deliveryRequest('controls-day-no-play', origin, destination, city.settings));
    expect(res.status).toBe(201);
    const after = await api.simulator();
    // A delivery stored in planning puts the clock back at the start, paused (DECISIONS pass 62, #624).
    expect(after.clock).toStrictEqual({ ...end.clock, timeMin: city.settings.simStartMin });
    expectRunAdds(after);
    await expectMapOfRun(api, after, 'a request after Finish without Play');
  }, T);
});

describe('a whole day: nothing leaves the temp folders', () => {
  it('the repo\'s data/ and fixtures/nyc are untouched, the cache copy too, and no call left the test server', async () => {
    const now = await api.simulator();
    expect((await api.savedRun())?.runId).toBe(now.runId); // saved, in the temp folder
    api.expectRepoFilesUntouched();
    api.expectCacheCopyUntouched();
    expect(net.installed()).toBe(true);
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  }, T);
});
