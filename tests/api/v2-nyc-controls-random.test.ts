// #532, SPEC nice-to-have 12: "Generate" with the Random city preset, over HTTP on the committed NYC cache.
// The Random city draws its homes from the 120-home pool whose travel times are all in the cache
// (DECISIONS pass 44), so with no Google key every Generate must answer 200 and never the 503
// `travel_data_missing` of pass 51.
// The server is the real one with no key, booted from a temp copy of `fixtures/nyc` (v2-nyc-controls-helper.ts);
// `globalThis.fetch` is a recorder for the whole file, and a call that is not to the test server fails
// the test that made it. After every step GET /map must answer 200 and list every pair of every plan leg.
// The tests run in order on one server; each continues from the run the one before left.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54): the counts and their
// ranges are read from the request schema, the seeds are arbitrary numbers.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { Run as RunV2 } from '../../shared/v2/types';
import { readCity, recordFetch } from './v2-e2e-nyc-helper';
import {
  cityOf, expectMapOfRun, expectNewCycle, expectPlansFitCity, expectSimulatorStill, generate, GENERATE_DEFAULTS,
  planning, rangeOf, startControlsApi, T,
  type ControlsApi, type GenerateField,
} from './v2-nyc-controls-helper';

/** Three seeds of no meaning. Any whole number is a valid seed. */
const SEEDS = [11, 205, 3407] as const;

const net = recordFetch();
let api: ControlsApi;
/** Every `runId` an answer has shown so far: a Generate must never reuse one. */
const runIds = new Set<string>();
/** The first Random city of each seed: the simulator answer and the exported run file. */
const firstOf = new Map<number, { sim: SimulatorResponse; file: RunV2 }>();

beforeAll(async () => {
  api = await startControlsApi(net);
  runIds.add((await api.simulator()).runId);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

/**
 * One Generate that must work: 200, a new `runId`, one more version, a fresh planning cycle whose plans
 * fit the generated city, the answer GET /simulator gives, and a map of the new run.
 */
async function generateCity(server: ControlsApi, body: Record<string, unknown>, step: string) {
  const before = await server.simulator();
  const res = await generate(server, body);
  // The body is in the message, so a 503 `travel_data_missing` names its pair in the failure.
  expect(`${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim(), step).toBe('200');
  const sim = res.body;

  expect(sim.runId).not.toBe(before.runId);
  expect(sim.version).toBe(before.version + 1);
  expect(sim.computeMs).toBeGreaterThanOrEqual(0);
  expect(await server.simulator()).toStrictEqual(sim);

  const file = await server.exportRun();
  const city = await readCity(server);
  expectNewCycle(sim, city.settings);
  expectPlansFitCity(sim, city);
  expect(sim.shipments).toStrictEqual(file.scenario.shipments);
  await expectMapOfRun(server, sim, step);
  return { sim, file, city };
}

describe.each(SEEDS)('Generate with Random city, seed %i and the default counts', (seed) => {
  it('answers 200 with a new runId and a matched city of the default size, never a 503', async () => {
    const { sim, file, city } = await generateCity(api, { preset: 'random', seed }, `Generate with seed ${seed}`);
    expect(runIds.has(sim.runId), `${sim.runId} was used before`).toBe(false);
    runIds.add(sim.runId);
    firstOf.set(seed, { sim, file });

    // The form's values are the city's: the seed, the two counts and the detour limit of every commuter.
    expect(file.scenario).toMatchObject({ preset: 'random', seed });
    expect(sim.shipments).toHaveLength(GENERATE_DEFAULTS.packages);
    expect(city.employees).toHaveLength(GENERATE_DEFAULTS.employees);
    expect(city.settings.defaultMaxExtraMin).toBe(GENERATE_DEFAULTS.maxExtraMin);
    for (const employee of city.employees) expect(employee.maxExtraMin).toBe(GENERATE_DEFAULTS.maxExtraMin);

    // Homes are only commute endpoints, drawn from the cached pool; packages go between two businesses.
    const homes = new Set(file.scenario.homes.map((home) => home.id));
    for (const employee of city.employees) {
      expect(city.business.has(employee.businessId)).toBe(true);
      expect(homes.has(employee.homeId)).toBe(true);
    }
    for (const shipment of sim.shipments) {
      expect(city.business.has(shipment.originBusinessId)).toBe(true);
      expect(city.business.has(shipment.destinationBusinessId)).toBe(true);
      expect(shipment.originBusinessId).not.toBe(shipment.destinationBusinessId);
    }
  }, T);
});

describe('Random city: the seed decides the city', () => {
  it('the three seeds gave three different cities', () => {
    expect([...firstOf.keys()]).toStrictEqual([...SEEDS]);
    const cities = SEEDS.map((seed) => JSON.stringify(cityOf(firstOf.get(seed)!.file)));
    expect(new Set(cities).size).toBe(SEEDS.length);
  }, T);

  it('the same seed again, after other cities, gives the same city and the same plans under a new runId', async () => {
    const seed = SEEDS[0];
    const first = firstOf.get(seed)!;
    const again = await generateCity(api, { preset: 'random', seed }, `Generate with seed ${seed} again`);
    expect(runIds.has(again.sim.runId)).toBe(false);
    runIds.add(again.sim.runId);

    expect(planning(again.sim)).toStrictEqual(planning(first.sim));
    expect(cityOf(again.file)).toStrictEqual(cityOf(first.file));
    expect(again.file.events).toStrictEqual(first.file.events);
    expect(again.file.notifications).toStrictEqual(first.file.notifications);
    // The counts the form leaves out and the counts it sends are one request.
    const spelled = await generateCity(api, { ...GENERATE_DEFAULTS, seed }, `Generate with seed ${seed} and the default counts spelled out`);
    expect(planning(spelled.sim)).toStrictEqual(planning(first.sim));
  }, T);

  it('the same seed on a server that was just started gives the same plans too', async () => {
    const seed = SEEDS[1];
    const other = await startControlsApi(net);
    try {
      const there = await generateCity(other, { preset: 'random', seed }, `Generate with seed ${seed} on a second server`);
      expect(planning(there.sim)).toStrictEqual(planning(firstOf.get(seed)!.sim));
      expect(cityOf(there.file)).toStrictEqual(cityOf(firstOf.get(seed)!.file));
      other.expectCacheCopyUntouched();
    } finally {
      await other.close();
    }
  }, T);

  it('a Generate while the run is locked by Play answers a new run, paused in planning', async () => {
    const played = await api.control({ action: 'play' });
    expect(played.clock).toMatchObject({ phase: 'locked', playing: true });
    // `expectNewCycle` inside: phase `planning`, paused, at the first minute.
    const { sim } = await generateCity(api, { preset: 'random', seed: SEEDS[2] }, 'Generate on a locked run');
    runIds.add(sim.runId);
    expect(planning(sim)).toStrictEqual(planning(firstOf.get(SEEDS[2])!.sim));
  }, T);
});

describe.each<GenerateField>(['employees', 'packages', 'maxExtraMin'])('Random city: %s outside its range', (field) => {
  it('is a 400 that names the field, and the run stays as it was', async () => {
    const { min, max } = rangeOf(field);
    const before = await api.simulator();
    for (const value of [min - 1, max + 1, min + 0.5, String(min)]) {
      const res = await generate(api, { preset: 'random', seed: SEEDS[0], [field]: value });
      const sent = `${field}: ${JSON.stringify(value)}`;
      expect(res.status, sent).toBe(400);
      expect(res.body.error, sent).toEqual(expect.any(String));
      expect(res.body.code, sent).toBeUndefined(); // not a TravelUnavailable body
      expect(Object.keys(res.body.fieldErrors ?? {}), sent).toStrictEqual([field]);
      expect(res.body.fieldErrors?.[field].trim(), sent).not.toBe('');
      await expectSimulatorStill(api, before, `a refused Generate (${sent})`);
    }
    await expectMapOfRun(api, before, `the refused Generate requests for ${field}`);
  }, T);

  it('the smallest and the largest value of the range are a 200', async () => {
    const { min, max } = rangeOf(field);
    for (const value of [min, max]) {
      const { sim, city } = await generateCity(api, { preset: 'random', seed: SEEDS[1], [field]: value }, `Generate with ${field} ${value}`);
      runIds.add(sim.runId);
      const made = { employees: city.employees.length, packages: sim.shipments.length, maxExtraMin: city.settings.defaultMaxExtraMin };
      expect(made).toStrictEqual({
        employees: GENERATE_DEFAULTS.employees, packages: GENERATE_DEFAULTS.packages, maxExtraMin: GENERATE_DEFAULTS.maxExtraMin,
        [field]: value,
      });
    }
  }, T);
});

describe('Random city: the edges of the form together', () => {
  it('the smallest counts the schema allows answer 200', async () => {
    const body = { preset: 'random', seed: SEEDS[2], employees: rangeOf('employees').min, packages: rangeOf('packages').min };
    const { sim, city } = await generateCity(api, body, 'Generate with the smallest counts');
    expect(sim.shipments).toHaveLength(body.packages);
    expect(city.employees).toHaveLength(body.employees);
  }, T);

  it('the largest counts the schema allows answer 200', async () => {
    const body = { preset: 'random', seed: SEEDS[2], employees: rangeOf('employees').max, packages: rangeOf('packages').max };
    const { sim, city } = await generateCity(api, body, 'Generate with the largest counts');
    expect(sim.shipments).toHaveLength(body.packages);
    expect(city.employees).toHaveLength(body.employees);
  }, T);

  it('a detour limit of 0 answers 200: every request is planned or unmatched with a reason, none is an error', async () => {
    // Zero matches is a valid answer (DECISIONS pass 61); a 503 or a 500 is not. `generateCity` checks the rest.
    const { sim, city } = await generateCity(api, { preset: 'random', seed: SEEDS[0], maxExtraMin: 0 }, 'Generate with detour limit 0');
    for (const employee of city.employees) expect(employee.maxExtraMin).toBe(0);
    for (const leg of sim.plans.flatMap((plan) => plan.legs)) expect(leg.extraMin).toBeLessThanOrEqual(0);
    expect(sim.plans.length + sim.unmatched.length).toBe(sim.shipments.length);
  }, T);
});

describe('Random city: nothing leaves the temp folders', () => {
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
