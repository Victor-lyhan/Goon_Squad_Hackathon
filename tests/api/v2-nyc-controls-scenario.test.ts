// #532, SPEC nice-to-haves 11 and 14: Recompute, and the export and import round trip, over HTTP on the
// committed NYC cache.
//   Recompute on the default run and on a Random city answers the plans that were there (same inputs,
//   same assignments), under the same `runId`.
//   An export is the whole run. Imported into a second server that was just started, the simulator
//   answers the same run and plans with a paused clock (DECISIONS pass 49, 51), also when the file was
//   exported while the clock was playing, and also for a Random city.
// Every server is the real one with no key, booted from its own temp copy of `fixtures/nyc`
// (v2-nyc-controls-helper.ts). `globalThis.fetch` is a recorder for the whole file, and a call that is
// not to a test server fails the test that made it. After every step GET /map must answer 200 and list
// every pair of every plan leg.
// The tests run in order; each continues from the runs the one before left.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { ApiError } from '../../shared/v2/schemas';
import type { Run as RunV2 } from '../../shared/v2/types';
import { copyNycFixtures, DAY_2_MIN, deliveryRequest, readCity, recordFetch, stopsOf, type City } from './v2-e2e-nyc-helper';
import {
  cityOf, expectEverythingDelivered, expectMapOfRun, expectNewCycle, expectPlansFitCity, expectRunAdds, expectSimulatorStill,
  generate, planning, playWholeDay, startControlsApi, T,
  type ControlsApi,
} from './v2-nyc-controls-helper';

/** The seed of this file's Random city, and the next ones to try if that city has no matched package. */
const SEEDS = [3407, 11, 205];

const net = recordFetch();
/** The server a judge works on: the files are exported here. */
let source: ControlsApi;
/** The second server, just started: the files are imported here. */
let target: ControlsApi;
/** A third server for the Random city file, on folders this file owns, so it can be restarted. */
let third: ControlsApi | undefined;
let thirdDirs: { fixturesDir: string; stateDir: string } | undefined;

let city: City;
/** The default run at boot, on the source server. */
let boot: SimulatorResponse;

beforeAll(async () => {
  source = await startControlsApi(net);
  target = await startControlsApi(net);
  city = await readCity(source);
  boot = await source.simulator();
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await source?.close();
  await target?.close();
  await third?.close();
  if (thirdDirs) {
    fs.rmSync(thirdDirs.fixturesDir, { recursive: true, force: true });
    fs.rmSync(thirdDirs.stateDir, { recursive: true, force: true });
  }
  net.restore();
}, T);

const ok = (res: { status: number; body: unknown }) => `${res.status} ${res.status === 200 ? '' : JSON.stringify(res.body)}`.trim();

/** POST /matches/recompute, which must answer 200 with the run GET /simulator then shows. */
async function recompute(api: ControlsApi, step: string): Promise<SimulatorResponse> {
  const before = await api.simulator();
  const res = await api.post<SimulatorResponse>('/matches/recompute');
  expect(ok(res), step).toBe('200');
  const sim = res.body;
  // The same run, one version later, the clock where it was.
  expect(sim.runId).toBe(before.runId);
  expect(sim.version).toBe(before.version + 1);
  expect(sim.clock).toStrictEqual(before.clock);
  expect(sim.computeMs).toBeGreaterThanOrEqual(0);
  expect(await api.simulator()).toStrictEqual(sim);
  await expectMapOfRun(api, sim, step);
  return sim;
}

/** What only the matcher decides in a run file: plans, jobs, events and the notifications that tell of them. */
const matchingOf = (run: RunV2) => ({
  plans: run.assignments.plans, unmatched: run.assignments.unmatched, jobs: run.jobs, events: run.events,
  notifications: run.notifications,
});

/**
 * Imports `file` into `into`, which must answer 200 with the file's run: the same requests, plans and
 * jobs, the file's clock but paused, under a `runId` that is new on that server. `shown` is the simulator
 * answer of the server the file came from, at the moment of the export.
 */
async function importRun(into: ControlsApi, file: RunV2, shown: SimulatorResponse, step: string): Promise<SimulatorResponse> {
  const before = await into.simulator();
  const res = await into.post<SimulatorResponse>('/scenario/import', file);
  expect(ok(res), step).toBe('200');
  const sim = res.body;

  // A new run on this server, so its pages ask for the map again.
  expect(sim.runId).not.toBe(before.runId);
  expect(sim.version).toBe(before.version + 1);
  // The clock of the file, never running (DECISIONS pass 49).
  expect(sim.clock).toStrictEqual({ ...file.clock, playing: false });

  // The same run: every answer of the simulator, with only the two numbers of this server changed.
  expect(planning(sim)).toStrictEqual(planning(shown));
  expect(sim).toStrictEqual({
    ...shown,
    runId: sim.runId, version: sim.version, clock: { ...shown.clock, playing: false },
    snapshot: { ...shown.snapshot, runId: sim.runId, version: sim.version },
  });
  expect(await into.simulator()).toStrictEqual(sim);

  // And the file this server exports now is the file it was given.
  expect(await into.exportRun()).toStrictEqual({ ...file, runId: sim.runId, version: sim.version, clock: sim.clock });
  expect((await into.savedRun())?.runId).toBe(sim.runId);
  await expectMapOfRun(into, sim, step);
  return sim;
}

/** GET /map of a server, which must answer 200. */
async function mapOf(api: ControlsApi): Promise<MapResponse> {
  const res = await api.get<MapResponse>('/map');
  expect(res.status).toBe(200);
  return res.body;
}

describe('Recompute on the default run', () => {
  it('answers the same plans as before, under the same runId, with the clock where it was', async () => {
    expectNewCycle(boot, city.settings);
    expect(boot.plans.length).toBeGreaterThan(0);
    const fileBefore = await source.exportRun();

    const sim = await recompute(source, 'Recompute on the default run');
    expect(planning(sim)).toStrictEqual(planning(boot));
    // Nothing else of the answer moved either: the snapshot, apart from its version.
    expect(sim.snapshot).toStrictEqual({ ...boot.snapshot, version: sim.version });
    expectNewCycle(sim, city.settings);
    expectPlansFitCity(sim, city);

    // The whole run file is the one from before: the same events, the same notifications with the same IDs.
    const fileAfter = await source.exportRun();
    expect(matchingOf(fileAfter)).toStrictEqual(matchingOf(fileBefore));
    expect(cityOf(fileAfter)).toStrictEqual(cityOf(fileBefore));
  }, T);

  it('a second Recompute answers them again, and the clock\'s minute is kept', async () => {
    // A seek does not lock the run (DECISIONS pass 28), so Recompute is still allowed in the evening.
    const firstStop = Math.min(...boot.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin));
    const moved = await source.control({ action: 'seek', timeMin: firstStop });
    expect(moved.clock).toMatchObject({ phase: 'planning', timeMin: firstStop });

    const sim = await recompute(source, 'a second Recompute, in the evening');
    expect(planning(sim)).toStrictEqual(planning(boot));
    expect(sim.snapshot).toStrictEqual({ ...moved.snapshot, version: sim.version });
    expectRunAdds(sim);

    const back = await source.control({ action: 'reset_playback' });
    expect(back.clock).toStrictEqual(boot.clock);
  }, T);
});

describe('export of the default run, import into a second server that was just started', () => {
  let file: RunV2;
  let shown: SimulatorResponse;

  it('the export is the whole run the simulator shows', async () => {
    shown = await source.simulator();
    file = await source.exportRun();
    expect(file.scenario.schemaVersion).toBe(2);
    expect(file).toMatchObject({ runId: shown.runId, version: shown.version, clock: shown.clock });
    expect(file.assignments).toStrictEqual({ plans: shown.plans, unmatched: shown.unmatched, computeMs: shown.computeMs });
    expect(file.jobs).toStrictEqual(shown.jobs);
    expect(file.scenario.shipments).toStrictEqual(shown.shipments);
    expect(file.scenario.businesses).toStrictEqual(city.businesses);
    expect(file.scenario.employees).toStrictEqual(city.employees);
    // An export changes nothing, and two exports are the same file.
    expect(await source.exportRun()).toStrictEqual(file);
    await expectSimulatorStill(source, shown, 'two exports');
    await expectMapOfRun(source, shown, 'the export');
  }, T);

  it('the second server answers the same run and plans, paused, and its map draws the same routes', async () => {
    // The target first holds a Random city, so the import really replaces a different run.
    const other = await generate(target, { preset: 'random', seed: SEEDS[0] });
    expect(ok(other)).toBe('200');
    expect(planning(other.body)).not.toStrictEqual(planning(shown));

    const sim = await importRun(target, file, shown, 'the import of the default run');
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    expectNewCycle(sim, city.settings);
    expectPlansFitCity(sim, await readCity(target));
    // Both servers read the same cache, so the two maps differ in nothing but the run's ID.
    expect(await mapOf(target)).toStrictEqual({ ...(await mapOf(source)), runId: sim.runId });
  }, T);

  it('the imported run plays a whole day to the same delivered end', async () => {
    const targetCity = await readCity(target);
    const end = await playWholeDay(target, targetCity, 'the imported default run');
    await expectEverythingDelivered(target, targetCity, end);
    expect(end.snapshot.deliveredAtMin).toStrictEqual(Object.fromEntries(shown.plans.map((plan) => [plan.shipmentId, plan.deliveryMin])));
  }, T);

  it('an export taken while the clock is playing in the evening imports paused at that minute, still locked', async () => {
    // On the source: Play, then a seek to the middle of the Day 1 evening. No ticker, so the minute is exact.
    const day1 = shown.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin).filter((t) => t < DAY_2_MIN);
    expect(day1.length).toBeGreaterThan(0);
    const evening = Math.floor((Math.min(...day1) + Math.max(...day1)) / 2);
    await source.control({ action: 'play' });
    const playing = await source.control({ action: 'seek', timeMin: evening });
    expect(playing.clock).toMatchObject({ phase: 'locked', playing: true, timeMin: evening });
    const playingFile = await source.exportRun();
    expect(playingFile.clock.playing).toBe(true);

    const sim = await importRun(target, playingFile, playing, 'the import of a playing run');
    expect(sim.clock).toStrictEqual({ ...playing.clock, playing: false });
    // Something has happened by then and something is still to come, exactly as on the source.
    expect(sim.snapshot.occurredEvents.length).toBeGreaterThan(0);
    expect(sim.nextEventMin).toBe(playing.nextEventMin);
    expectRunAdds(sim);

    // The lock came with the file: a delivery request is refused until a new planning cycle.
    const [origin, destination] = city.businesses.map((b) => b.id).sort();
    const refused = await target.post<ApiError>('/shipments', deliveryRequest('controls-scenario-locked', origin, destination, city.settings));
    expect(refused.status).toBe(409);
    await expectSimulatorStill(target, sim, 'the refused request on the imported locked run');
  }, T);

  it('Start new planning cycle and Recompute work on the imported run and answer the source\'s plans, never a 503', async () => {
    const before = await target.simulator();
    const res = await target.post<SimulatorResponse>('/planning/reset');
    expect(ok(res)).toBe('200');
    const cycle = res.body;
    expect(cycle.runId).not.toBe(before.runId);
    expectNewCycle(cycle, city.settings);
    expect(planning(cycle)).toStrictEqual(planning(boot));
    await expectMapOfRun(target, cycle, 'Start new planning cycle on the imported run');

    const sim = await recompute(target, 'Recompute on the imported run');
    expect(planning(sim)).toStrictEqual(planning(boot));
  }, T);
});

describe('a file that is not a run of this server', () => {
  it('is refused with a 400 and one sentence, and the run stays as it was', async () => {
    const before = await target.simulator();
    const file = await source.exportRun();
    const unknownHome = structuredClone(file);
    // One employee moves to a home the file does not hold (DECISIONS pass 59).
    unknownHome.scenario.employees[0].homeId = `${file.scenario.employees[0].homeId}-moved`;
    const noScenario = { runId: file.runId, version: file.version };
    const mvp1 = { ...file, scenario: { ...file.scenario, schemaVersion: 1 } };

    for (const [what, body] of Object.entries({ unknownHome, noScenario, mvp1, list: [file], empty: {} })) {
      const res = await target.post<ApiError & { code?: string }>('/scenario/import', body);
      expect(res.status, what).toBe(400);
      expect(res.body.error.trim(), what).not.toBe('');
      expect(res.body.code, what).toBeUndefined();
      await expectSimulatorStill(target, before, `the refused file (${what})`);
    }
    expect((await target.savedRun())?.version).toBe(before.version);
    await expectMapOfRun(target, before, 'the refused files');
  }, T);
});

describe('Random city: Recompute, export and import', () => {
  let random: SimulatorResponse;
  let randomCity: City;
  let file: RunV2;

  it('Generate on the source (locked by the Play above) answers a Random city with something to deliver', async () => {
    for (const seed of SEEDS) {
      const res = await generate(source, { preset: 'random', seed });
      expect(ok(res), `Generate with seed ${seed}`).toBe('200');
      random = res.body;
      if (random.plans.length > 0) break;
    }
    // Not a rule of the generator, only what this file needs: a round trip of no plans proves little.
    expect(random.plans.length).toBeGreaterThan(0);
    randomCity = await readCity(source);
    expectNewCycle(random, randomCity.settings);
    expectPlansFitCity(random, randomCity);
    await expectMapOfRun(source, random, 'Generate on the source');
  }, T);

  it('Recompute answers the plans Generate made', async () => {
    const sim = await recompute(source, 'Recompute on the Random city');
    expect(planning(sim)).toStrictEqual(planning(random));
    expect(sim.snapshot).toStrictEqual({ ...random.snapshot, version: sim.version });
    random = sim;
  }, T);

  it('its export imports into a third server that was just started: the same city, plans and a paused clock', async () => {
    file = await source.exportRun();
    expect(file.scenario.preset).toBe('random');
    thirdDirs = { fixturesDir: copyNycFixtures(), stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'v2-nyc-controls-state-')) };
    third = await startControlsApi(net, thirdDirs);
    const atBoot = await third.simulator();
    expect(planning(atBoot)).toStrictEqual(planning(boot)); // it starts with the default run

    const sim = await importRun(third, file, random, 'the import of the Random city');
    expectNewCycle(sim, randomCity.settings);
    const thirdCity = await readCity(third);
    expect(thirdCity.businesses).toStrictEqual(randomCity.businesses);
    expect(thirdCity.employees).toStrictEqual(randomCity.employees);
    expect(thirdCity.settings).toStrictEqual(randomCity.settings);
    expectPlansFitCity(sim, thirdCity);
    expect(await mapOf(third)).toStrictEqual({ ...(await mapOf(source)), runId: sim.runId });
  }, T);

  it('the imported Random city plays a whole day, and a restart of that server keeps it, paused at the end', async () => {
    const api = third as ControlsApi;
    const end = await playWholeDay(api, randomCity, 'the imported Random city');
    await expectEverythingDelivered(api, randomCity, end);
    api.expectCacheCopyUntouched();
    api.expectRepoFilesUntouched();

    await api.close(); // stops, pauses and saves once more (one more version)
    third = await startControlsApi(net, thirdDirs);
    const restored = await third.simulator();
    expect(restored).toStrictEqual({
      ...end, version: end.version + 1, snapshot: { ...end.snapshot, version: end.version + 1 },
    });
    expect(restored.clock).toMatchObject({ phase: 'locked', playing: false, timeMin: randomCity.settings.simEndMin });
    await expectMapOfRun(third, restored, 'a restart on the imported Random city');
  }, T);

  it('Start new planning cycle and Recompute work on the restored Random city and answer the plans Generate made', async () => {
    const api = third as ControlsApi;
    const res = await api.post<SimulatorResponse>('/planning/reset');
    expect(ok(res)).toBe('200'); // never the 503 of a pair the cache lacks (DECISIONS pass 59)
    expectNewCycle(res.body, randomCity.settings);
    expect(planning(res.body)).toStrictEqual(planning(random));
    await expectMapOfRun(api, res.body, 'Start new planning cycle on the imported Random city');

    const sim = await recompute(api, 'Recompute on the imported Random city');
    expect(planning(sim)).toStrictEqual(planning(random));
  }, T);
});

describe('Recompute, export and import: nothing leaves the temp folders', () => {
  it('the repo\'s data/ and fixtures/nyc are untouched, every cache copy too, and no call left the test servers', async () => {
    for (const api of [source, target, third as ControlsApi]) {
      const now = await api.simulator();
      expect((await api.savedRun())?.runId).toBe(now.runId); // saved, in the temp folder
      api.expectRepoFilesUntouched();
      api.expectCacheCopyUntouched();
    }
    expect(net.installed()).toBe(true);
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  }, T);
});
