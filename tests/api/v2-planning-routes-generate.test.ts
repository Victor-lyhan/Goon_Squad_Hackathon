// POST /api/v2/scenario/generate through the real app, on the real fixtures/nyc files and the complete
// in-memory travel cache of v2-boot-sample.ts (made-up test coordinates, no network, no key).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INVALID_GENERATE } from '../../server/api/v2/planningOps';
import { pairKey } from '../../shared/v2/types';
import { bootSample, type BootSample } from './v2-boot-sample';
import {
  T, expectUntouched, initialRun, matchedScenario, startPlanningApi, stateOf, wire, type PlanningApi,
} from './v2-planning-routes-helper';

// Built once per file (DECISIONS pass 19). The tests that remove travel data build their own.
let shared: BootSample;
beforeAll(() => {
  shared = bootSample();
});

let api: PlanningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** A server whose stored run is the small 2-package city (run-1), generating on `sample`. */
const startOn = (sample: BootSample) => startPlanningApi({
  run: initialRun(matchedScenario()),
  travel: sample.travel,
  travelPairs: { has: (from, to) => from === to || Object.hasOwn(sample.files.matrix.pairs, pairKey(from, to)) },
  generateInputs: { ...sample.fixtures, places: sample.places },
});

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('POST /api/v2/scenario/generate', () => {
  it('a valid body gives a new runId and a matched run, answered as the simulator view', async () => {
    api = await startOn(shared);
    const before = api.store.get();

    const { status, body } = await api.post('/scenario/generate', { preset: 'demo' });

    expect(status).toBe(200);
    expect(body.runId).toBe('run-2');
    expect(body.version).toBe(before.version + 1);
    expect(body.clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });
    // the default workload: 18 businesses, 60 employees, 24 packages, every one matched or given a reason
    const stored = api.store.get();
    expect(stored.scenario.preset).toBe('demo');
    expect(stored.scenario.businesses).toHaveLength(18);
    expect(stored.scenario.employees).toHaveLength(60);
    expect(stored.trips.length).toBeGreaterThan(60);
    expect(body.shipments).toHaveLength(24);
    expect(body.plans.length).toBeGreaterThan(0);
    expect(body.plans.length + body.unmatched.length).toBe(24);
    expect(body.jobs.length).toBeGreaterThanOrEqual(body.plans.length);
    expect(stored.events.length).toBeGreaterThan(0);
    expect(stored.notifications.length).toBeGreaterThan(0);
    expect(body.snapshot).toMatchObject({ runId: 'run-2', version: body.version, timeMin: 930, occurredEvents: [] });
    expect(body.snapshot.metrics.matched).toBe(body.plans.length);
    // nothing of the run it replaces is left
    expect(stored.scenario.businesses.some((b) => b.id === 'biz-print-shop')).toBe(false);
    expect(body).toStrictEqual(await api.simulator());
    expect(await api.savedRun()).toStrictEqual(wire(stored));
  }, T);

  it('the same seed twice gives identical shipment and job IDs (and plans); another seed does not', async () => {
    api = await startOn(shared);
    const request = { preset: 'random', seed: 7, employees: 40, packages: 20, maxExtraMin: 10 };

    const first = await api.post('/scenario/generate', request);
    const second = await api.post('/scenario/generate', request);
    const other = await api.post('/scenario/generate', { ...request, seed: 8 });

    expect([first.status, second.status, other.status]).toEqual([200, 200, 200]);
    expect(first.body.shipments).toHaveLength(20);
    expect(first.body.jobs.length).toBeGreaterThan(0);
    expect(ids(second.body.shipments)).toEqual(ids(first.body.shipments));
    expect(ids(second.body.jobs)).toEqual(ids(first.body.jobs));
    expect(second.body.shipments).toStrictEqual(first.body.shipments);
    expect(second.body.plans).toStrictEqual(first.body.plans);
    expect(second.body.jobs).toStrictEqual(first.body.jobs);
    expect(second.body.unmatched).toStrictEqual(first.body.unmatched);
    expect(other.body.shipments).not.toStrictEqual(first.body.shipments);
    // every generate is a new run for the clients
    expect([first.body.runId, second.body.runId, other.body.runId]).toEqual(['run-2', 'run-3', 'run-4']);
    expect([first.body.version, second.body.version, other.body.version]).toEqual([1, 2, 3]);
    expect(api.store.get().scenario.employees).toHaveLength(40);
    expect(api.store.get().scenario.employees.every((e) => e.maxExtraMin === 10)).toBe(true);
  }, T);

  it('generating while locked is allowed and gives a run in planning', async () => {
    api = await startOn(shared);
    await api.lock();
    const { status, body } = await api.post('/scenario/generate', { preset: 'random', seed: 3 });
    expect(status).toBe(200);
    expect(body.clock.phase).toBe('planning');
    expect(body.shipments).toHaveLength(24); // the defaults: 60 employees, 24 packages
    expect(api.store.get().scenario.employees).toHaveLength(60);
  }, T);

  it.each([
    ['no body', undefined, { preset: 'Choose demo or random' }],
    ['an empty object', {}, { preset: 'Choose demo or random' }],
    ['an unknown preset', { preset: 'city' }, { preset: 'Choose demo or random' }],
    ['more employees than the home pool (120)', { preset: 'random', employees: 121 },
      { employees: 'Employees must be a whole number from 10 to 120' }],
    ['too few packages and a seed that is not whole', { preset: 'random', packages: 4, seed: 1.5 },
      { packages: 'Packages must be a whole number from 5 to 60', seed: 'Seed must be a whole number' }],
    ['an added-time limit above 30', { preset: 'demo', maxExtraMin: 31 },
      { maxExtraMin: 'Max added time must be a whole number from 0 to 30 minutes' }],
  ])('%s -> 400 with the field errors, and nothing changes', async (_name, request, fieldErrors) => {
    api = await startOn(shared);
    const before = await stateOf(api);

    const { status, body } = await api.post('/scenario/generate', request);

    expect(status).toBe(400);
    expect(body).toStrictEqual({ error: INVALID_GENERATE, fieldErrors });
    expect(body.error).toBe('Invalid scenario request');
    await expectUntouched(api, before.run, before.saved, before.simulator);
  }, T);

  it('a commute the travel cache lacks -> 503 travel_data_missing naming the pair, never an estimate', async () => {
    const sample = bootSample();
    api = await startOn(sample);
    const before = await stateOf(api);
    // The first featured employee of the demo story: the pair from work to home is removed from the cache.
    const featured = sample.fixtures.storyFile.featuredEmployees[0];
    const pair = pairKey(featured.businessId, featured.home.id);
    const kept = sample.files.matrix.pairs[pair];
    expect(kept).toBeDefined();
    delete sample.files.matrix.pairs[pair];

    const { status, body } = await api.post('/scenario/generate', { preset: 'demo' });

    expect(status).toBe(503);
    expect(body).toStrictEqual({
      error: `No travel time is cached for ${featured.businessId} to ${featured.home.id}. `
        + 'Run npm run fetch:routes and commit fixtures/nyc/.',
      code: 'travel_data_missing',
    });
    await expectUntouched(api, before.run, before.saved, before.simulator);

    // with the pair back the same request works
    sample.files.matrix.pairs[pair] = kept;
    const next = await api.post('/scenario/generate', { preset: 'demo' });
    expect(next.status).toBe(200);
    expect(next.body.runId).toBe('run-2');
  }, T);

  it('a business without a geocoded point -> 503 travel_data_missing, and nothing changes', async () => {
    const sample = bootSample();
    const missing = sample.fixtures.businessesFile.businesses[0].id;
    delete sample.places[missing];
    api = await startOn(sample);
    const before = await stateOf(api);

    const { status, body } = await api.post('/scenario/generate', { preset: 'random', seed: 5 });

    expect(status).toBe(503);
    expect(body).toStrictEqual({
      error: '1 of 18 businesses has no geocoded location. Run npm run fetch:routes and commit fixtures/nyc/.',
      code: 'travel_data_missing',
    });
    await expectUntouched(api, before.run, before.saved, before.simulator);
  }, T);
});
