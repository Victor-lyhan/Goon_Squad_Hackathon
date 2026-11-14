// Helper for the tests of the simulator's left panel on the committed NYC cache
// (tests/api/v2-nyc-controls-*.test.ts, #532; docs/mvp2-ui-redesign.md §1 "Left panel").
// The end-to-end test walks the six demo steps. These files press the other buttons a judge can press:
// Generate with Random city, Jump to morning and Finish, Start new planning cycle, Recompute, and the
// export and import of a scenario file.
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime with no Google key. Every server here
// boots from its own copy of `fixtures/nyc` in a temp folder (DECISIONS pass 56), with both state files in
// a second temp folder, so nothing is written to the repo's `fixtures/nyc/` or `data/`.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54): the counts of a
// Generate request are read from the request schema, everything else from the answers themselves.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import type { MapResponse, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import { GenerateScenarioRequest, type ApiError } from '../../shared/v2/schemas';
import { pairKey, type Run as RunV2, type Settings } from '../../shared/v2/types';
import {
  businessAt, commuteOf, copyNycFixtures, DAY_2_MIN, deliveryRequest, expectPositionsInNyc, expectStatusesFromPlans,
  startNycApi, stopsOf,
  type Answer, type City, type FetchRecorder, type NycApi,
} from './v2-e2e-nyc-helper';

/**
 * Timeout of every test and hook in these files (DECISIONS pass 19): each talks to a real HTTP server.
 * The slowest test (a second server booted from a copy of the cache, then one Generate) takes about 1 s
 * locally and each of the three files under 4 s, so this is far more than 10x.
 */
export const T = 60_000;

// ---------- the server ----------

/** Every file of a folder with a hash of its content. */
function filesState(dir: string): string[] {
  return fs.readdirSync(dir).sort().map((name) =>
    `${name} ${createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')}`);
}

export type ControlsApi = NycApi & {
  /** The temp copy of `fixtures/nyc` this server booted from. */
  fixturesDir: string;
  /** PATCH, which the e2e helper's server object has no shortcut for. `url` is relative to /api/v2. */
  patch<B>(url: string, body: unknown): Promise<Answer<B>>;
  /**
   * The copy of the travel cache is byte for byte what was copied: with no key nothing is fetched, so
   * nothing may be added to it, and no travel time or route line is ever made up (SPEC MVP II rule 2).
   */
  expectCacheCopyUntouched(): void;
};

/**
 * The address of a server of v2-e2e-nyc-helper.ts, which keeps it to itself: read from the URL of one
 * GET the helper sends. The recorder is the global `fetch` again before this returns.
 */
async function originOf(api: NycApi): Promise<string> {
  const recorder = globalThis.fetch;
  let origin = '';
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    origin = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).origin;
    return recorder(input, init);
  }) as typeof fetch;
  try {
    await api.get('/businesses');
  } finally {
    globalThis.fetch = recorder;
  }
  return origin;
}

/**
 * The whole server on a free port, booted with no key from a copy of `fixtures/nyc`.
 * With no options it makes a new copy and `close` removes it. A test that restarts a server passes its
 * own `fixturesDir` (a copy) and `stateDir` and removes both itself.
 */
export async function startControlsApi(net: FetchRecorder, opts: { fixturesDir?: string; stateDir?: string } = {}): Promise<ControlsApi> {
  const fixturesDir = opts.fixturesDir ?? copyNycFixtures();
  const removeCopy = () => {
    if (!opts.fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true });
  };
  const copied = filesState(fixturesDir);
  let api: NycApi;
  try {
    api = await startNycApi(net, { fixturesDir, stateDir: opts.stateDir });
  } catch (err) {
    removeCopy();
    throw err;
  }
  expect(api.runtime.reason).toBeUndefined();
  expect(api.runtime.status).toBe('ready');
  const origin = await originOf(api);
  expect(net.installed()).toBe(true);
  return {
    ...api,
    fixturesDir,
    // Through the recorder, like every other call: only the test server is an allowed address.
    patch: async <B>(url: string, body: unknown): Promise<Answer<B>> => {
      const res = await globalThis.fetch(`${origin}/api/v2${url}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as B };
    },
    expectCacheCopyUntouched: () => expect(filesState(fixturesDir)).toStrictEqual(copied),
    close: async (how) => {
      await api.close(how);
      removeCopy();
    },
  };
}

// ---------- the Generate form ----------

export type GenerateField = 'employees' | 'packages' | 'maxExtraMin';

/** What the Generate form sends when only the preset (and a seed) is chosen: the schema's own defaults. */
export const GENERATE_DEFAULTS = GenerateScenarioRequest.parse({ preset: 'random' });

/**
 * The whole numbers the request schema accepts for a field of the Generate form, found by asking the
 * schema itself (shared/v2/schemas.ts), so no test here holds a range of its own.
 */
export function rangeOf(field: GenerateField): { min: number; max: number } {
  const accepted: number[] = [];
  for (let n = -10; n <= 1000; n++) {
    if (GenerateScenarioRequest.safeParse({ preset: 'random', [field]: n }).success) accepted.push(n);
  }
  if (accepted.length === 0) throw new Error(`The Generate schema accepts no value for ${field}`);
  const min = accepted[0];
  const max = accepted[accepted.length - 1];
  // One range without holes, and it ends inside what was tried.
  expect(accepted).toHaveLength(max - min + 1);
  expect(max).toBeLessThan(1000);
  return { min, max };
}

/** POST /scenario/generate as the left panel sends it. */
export const generate = (api: NycApi, body: unknown): Promise<Answer<SimulatorResponse & ApiError & { code?: string }>> =>
  api.post('/scenario/generate', body);

// ---------- what an answer is compared by ----------

/**
 * The part of a simulator answer the matcher decides: the requests, the plans with every stop time,
 * carrier and price, the jobs, and the requests nobody can carry with their reason. "The same plans"
 * in these files means this, compared with `toStrictEqual`. `computeMs` is measured, so it is left out.
 */
export const planning = (sim: SimulatorResponse) => ({
  shipments: sim.shipments, plans: sim.plans, jobs: sim.jobs, unmatched: sim.unmatched,
});

/** The whole city of a run file: who works and lives where, and what was requested. */
export const cityOf = (run: RunV2) => ({
  businesses: run.scenario.businesses, homes: run.scenario.homes, employees: run.scenario.employees,
  shipments: run.scenario.shipments, settings: run.scenario.settings, trips: run.trips,
});

/** GET /simulator with its status, for a step that must not have changed anything. */
export async function expectSimulatorStill(api: NycApi, before: SimulatorResponse, step: string): Promise<void> {
  const res = await api.get<SimulatorResponse>('/simulator');
  expect(res.status, `GET /simulator after ${step}`).toBe(200);
  expect(res.body, `GET /simulator after ${step}`).toStrictEqual(before);
}

// ---------- rules every run must keep ----------

/**
 * A run at the start of a planning cycle: paused in `planning` at the first minute, every request
 * either planned or listed as unmatched with a reason, nothing picked up yet.
 */
export function expectNewCycle(sim: SimulatorResponse, settings: Settings): void {
  expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: settings.simStartMin });
  expectRunAdds(sim);
  expect(sim.snapshot.occurredEvents).toStrictEqual([]);
  for (const plan of sim.plans) expect(`${plan.shipmentId} ${sim.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} scheduled`);
  for (const job of sim.jobs) expect(`${job.id} ${sim.snapshot.jobStatus[job.id]}`).toBe(`${job.id} assigned`);
  expect(sim.snapshot.deliveredAtMin).toStrictEqual({});
}

/** At any minute: every request is planned or unmatched (never both, never neither), and the snapshot follows the plans. */
export function expectRunAdds(sim: SimulatorResponse): void {
  const requested = sim.shipments.map((s) => s.id).sort();
  const planned = sim.plans.map((plan) => plan.shipmentId);
  const unmatched = sim.unmatched.map((u) => u.shipmentId);
  expect(new Set(requested).size).toBe(requested.length);
  expect([...planned, ...unmatched].sort()).toStrictEqual(requested);
  for (const u of sim.unmatched) expect(u.reason.trim(), `the reason of ${u.shipmentId}`).not.toBe('');
  // One job per leg, in the plan's order.
  expect(sim.jobs.map((job) => `${job.planId} ${job.legIndex} ${job.employeeId}`).sort())
    .toStrictEqual(sim.plans.flatMap((plan) => plan.legs.map((leg, i) => `${plan.id} ${i} ${leg.employeeId}`)).sort());
  expect(sim.snapshot.runId).toBe(sim.runId);
  expect(sim.snapshot.metrics).toMatchObject({ requested: requested.length, matched: planned.length, unmatched: unmatched.length });
  expect(JSON.stringify(sim)).not.toMatch(/NaN|undefined|Infinity/);
  expectStatusesFromPlans(sim);
  expectPositionsInNyc(sim);
}

/**
 * Every plan is a delivery the city can really make (SPEC "Matching"): known carriers within their own
 * detour limit, stops only at network businesses in the order the plan kind defines, a relay point that
 * is a third business, picked up after the package is ready and delivered by its deadline.
 */
export function expectPlansFitCity(sim: SimulatorResponse, city: City): void {
  const trips = new Set<string>();
  for (const plan of sim.plans) {
    const shipment = sim.shipments.find((s) => s.id === plan.shipmentId);
    if (!shipment) throw new Error(`${plan.id} is for a delivery the simulator does not list`);
    const origin = businessAt(city, shipment.originBusinessId);
    const destination = businessAt(city, shipment.destinationBusinessId);
    const stops = plan.legs.map((leg) => leg.stops.map((stop) => `${stop.kind} ${businessAt(city, stop.placeId).id}`));
    if (plan.kind === 'relay') {
      const relay = businessAt(city, plan.relayBusinessId as string);
      expect([origin.id, destination.id]).not.toContain(relay.id);
      expect(stops, plan.id).toStrictEqual([
        [`pickup ${origin.id}`, `hub_drop ${relay.id}`],
        [`hub_pickup ${relay.id}`, `delivery ${destination.id}`],
      ]);
      expect(plan.legs[0].employeeId).not.toBe(plan.legs[1].employeeId);
    } else {
      expect(plan.relayBusinessId).toBeUndefined();
      expect(stops, plan.id).toStrictEqual([[`pickup ${origin.id}`, `delivery ${destination.id}`]]);
    }

    for (const leg of plan.legs) {
      const carrier = city.employee.get(leg.employeeId);
      if (!carrier) throw new Error(`${plan.id} is carried by ${leg.employeeId}, who is not in the city`);
      expect(leg.extraMin, `${plan.id} added minutes of ${leg.employeeId}`).toBeLessThanOrEqual(carrier.maxExtraMin);
      // One package per trip.
      expect(trips.has(leg.tripId), `${leg.tripId} carries two packages`).toBe(false);
      trips.add(leg.tripId);
      // The leg starts and ends where the carrier's commute does; neighbours are distinct places.
      expect([leg.placeIds[0], leg.placeIds.at(-1)].sort()).toStrictEqual([carrier.businessId, carrier.homeId].sort());
      for (let i = 1; i < leg.placeIds.length; i++) expect(leg.placeIds[i]).not.toBe(leg.placeIds[i - 1]);
    }

    const times = stopsOf(plan).flatMap((stop) => [stop.arrivalMin, stop.serviceStartMin, stop.serviceEndMin]);
    expect(times, `${plan.id} stop times in order`).toStrictEqual([...times].sort((a, b) => a - b));
    for (const t of times) expect(Number.isInteger(t)).toBe(true);
    expect(stopsOf(plan)[0].serviceStartMin).toBeGreaterThanOrEqual(shipment.readyMin);
    expect(plan.deliveryMin).toBe(stopsOf(plan).at(-1)!.serviceEndMin);
    expect(plan.deliveryMin).toBeLessThanOrEqual(shipment.deadlineMin);
    expect(plan.deliveryMin).toBeLessThanOrEqual(city.settings.simEndMin);
  }
}

// ---------- the map ----------

/**
 * GET /map after a step: a 200 for the run the simulator shows, and it lists every neighbouring pair of
 * every plan leg, each with a route line or `null` (shared/v2/api.ts). A pair with no cached line is
 * `null` and never a made-up line; no test here requires a line for a given pair (DECISIONS pass 54).
 */
export async function expectMapOfRun(api: NycApi, sim: SimulatorResponse, step: string): Promise<MapResponse> {
  const res = await api.get<MapResponse>('/map');
  expect(res.status, `GET /map after ${step}`).toBe(200);
  const map = res.body;
  expect(map.runId, `the map's run after ${step}`).toBe(sim.runId);

  const places = new Set([...map.businesses, ...map.homes].map((place) => place.id));
  const listed = new Set<string>();
  for (const line of map.polylines) {
    const key = pairKey(line.from, line.to);
    expect(listed.has(key), `${key} is listed twice`).toBe(false);
    listed.add(key);
    // Both ends are places drawn on this map.
    expect(places.has(line.from) && places.has(line.to), `${key} joins places of the map`).toBe(true);
    if (line.encoded !== null) {
      expect(typeof line.encoded, `the line of ${key}`).toBe('string');
      expect(line.encoded.length, `the line of ${key}`).toBeGreaterThan(0);
    }
  }

  const notListed: string[] = [];
  const carriers = new Set(map.employees.map((e) => e.id));
  for (const plan of sim.plans) {
    for (const leg of plan.legs) {
      expect(carriers.has(leg.employeeId), `${leg.employeeId} of ${plan.id} is on the map`).toBe(true);
      for (let i = 1; i < leg.placeIds.length; i++) {
        const key = pairKey(leg.placeIds[i - 1], leg.placeIds[i]);
        if (!listed.has(key)) notListed.push(`${plan.id}: ${key}`);
      }
    }
  }
  expect(notListed, `plan leg pairs the map does not list after ${step}`).toStrictEqual([]);
  return map;
}

// ---------- a whole day ----------

/** Seeks past the fallback of Jump to morning when the run has no Day 2 stop (DECISIONS: "or 1860 if none"). */
const MORNING_FALLBACK_MIN = 1860;

/**
 * Play, Jump to morning, Finish: the three buttons that take a run from its first minute to the end.
 * Only Play locks a run (DECISIONS pass 28); the ticker is not started, so the clock moves only when a
 * button moves it and every minute below is exact. Returns the run at its locked end.
 */
export async function playWholeDay(api: NycApi, city: City, name: string): Promise<SimulatorResponse> {
  const start = await api.simulator();
  expectNewCycle(start, city.settings);

  const played = await api.control({ action: 'play' });
  expect(played.clock).toStrictEqual({ ...start.clock, phase: 'locked', playing: true });
  expect(played.version).toBe(start.version + 1);
  await expectMapOfRun(api, played, `Play on ${name}`);

  // Jump to morning: 5 minutes before the first stop of Day 2, and nothing of Day 2 has happened yet.
  const day2 = start.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin).filter((t) => t >= DAY_2_MIN);
  const firstOfDay2 = day2.length > 0 ? Math.min(...day2) : null;
  const morning = await api.control({ action: 'jump_to_morning' });
  expect(morning.clock).toMatchObject({ phase: 'locked', playing: true });
  expect(morning.clock.timeMin).toBe(firstOfDay2 === null ? MORNING_FALLBACK_MIN : firstOfDay2 - 5);
  expect(morning.clock.timeMin).toBeGreaterThan(start.clock.timeMin);
  if (firstOfDay2 !== null) expect(morning.nextEventMin).toBe(firstOfDay2);
  expect(planning(morning)).toStrictEqual(planning(start));
  expectRunAdds(morning);
  for (const event of morning.snapshot.occurredEvents) expect(event.timeMin).toBeLessThan(DAY_2_MIN);
  for (const plan of morning.plans.filter((p) => p.kind === 'relay')) {
    // Overnight a relayed package waits at its relay business.
    const relay = businessAt(city, plan.relayBusinessId as string);
    expect(`${plan.shipmentId} ${morning.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} at_hub`);
    expect(morning.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: relay.lat, lng: relay.lng });
  }
  await expectMapOfRun(api, morning, `Jump to morning on ${name}`);

  const end = await api.control({ action: 'finish' });
  expect(end.clock).toStrictEqual({ ...start.clock, phase: 'locked', playing: false, timeMin: city.settings.simEndMin });
  expect(end.runId).toBe(start.runId);
  expect(end.version).toBe(start.version + 3); // one per button
  expect(end.nextEventMin).toBeNull();
  expect(planning(end)).toStrictEqual(planning(start));
  expectRunAdds(end);
  await expectMapOfRun(api, end, `Finish on ${name}`);
  return end;
}

/** At the end of the day every matched package is delivered, at the recipient, when its plan said. */
export async function expectEverythingDelivered(api: NycApi, city: City, end: SimulatorResponse): Promise<void> {
  for (const plan of end.plans) {
    const shipment = end.shipments.find((s) => s.id === plan.shipmentId)!;
    const destination = businessAt(city, shipment.destinationBusinessId);
    expect(`${plan.shipmentId} ${end.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} delivered`);
    expect(end.snapshot.deliveredAtMin[plan.shipmentId]).toBe(plan.deliveryMin);
    expect(end.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: destination.lat, lng: destination.lng });

    // The sender's and the recipient's tracking view says the same.
    const tracking = await api.get<ShipmentResponse>(`/shipments/${encodeURIComponent(plan.shipmentId)}`);
    expect(tracking.status).toBe(200);
    expect(tracking.body).toMatchObject({ matched: true, status: 'delivered', deliveredAtMin: plan.deliveryMin });
  }
  for (const job of end.jobs) expect(`${job.id} ${end.snapshot.jobStatus[job.id]}`).toBe(`${job.id} completed`);
  expect(end.snapshot.markers).toStrictEqual([]); // everybody has arrived
  expect(end.snapshot.occurredEvents).toHaveLength(end.plans.flatMap(stopsOf).length); // one event per stop

  // A request nobody could carry is still unmatched, with its reason, and nothing was delivered for it.
  for (const { shipmentId, reason } of end.unmatched) {
    const tracking = await api.get<ShipmentResponse>(`/shipments/${encodeURIComponent(shipmentId)}`);
    expect(tracking.body).toMatchObject({ matched: false, status: 'unmatched', plan: null, deliveredAtMin: null, unmatchedReason: reason });
  }

  // Projected equals actual once everything is delivered: every reward is earned.
  const { metrics } = end.snapshot;
  expect(metrics.delivered).toBe(end.plans.length);
  expect(metrics.earnedRewardsCents).toBe(end.jobs.reduce((total, job) => total + job.rewardCents, 0));
  expect(metrics.earnedPlatformContributionCents).toBe(metrics.projectedPlatformContributionCents);
}

// ---------- the write routes ----------

export type WriteAnswer = { route: string; status: number; body: ApiError };

/**
 * One request to each route that changes the plans or the people (shared/v2/api.ts), each of them valid
 * for the run it is sent to: a new delivery request, an edit and a retry of an existing request, a commute
 * save that keeps the saved home (so it needs nothing from Google), and Recompute.
 * `tag` makes the delivery's `clientRequestId` new, so the request is never a replay.
 */
export async function sendEveryWrite(api: ControlsApi, city: City, sim: SimulatorResponse, tag: string): Promise<WriteAnswer[]> {
  const [origin, destination] = city.businesses.map((b) => b.id).sort();
  const shipment = sim.shipments[0];
  const employee = city.employees[0];
  const enc = encodeURIComponent;
  const answers: [string, Answer<ApiError>][] = [
    ['POST /shipments', await api.post('/shipments', deliveryRequest(tag, origin, destination, city.settings))],
    ['PATCH /shipments/:id', await api.patch(`/shipments/${enc(shipment.id)}`, { description: 'Hand to the front desk' })],
    ['POST /shipments/:id/match', await api.post(`/shipments/${enc(shipment.id)}/match`)],
    ['PUT /employees/:id/commute', await api.put(`/employees/${enc(employee.id)}/commute`, commuteOf(employee))],
    ['POST /matches/recompute', await api.post('/matches/recompute')],
  ];
  return answers.map(([route, { status, body }]) => ({ route, status, body }));
}
