import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { bootV2Run, buildDefaultRun, savedRunProblem, type V2Boot } from '../../server/api/v2/bootRun';
import type { RunV2 } from '../../server/api/v2/router';
import { bootSample, FIXTURES_DIR, runJson, type BootSample } from './v2-boot-sample';

let dir: string;
let statePath: string;
let warn: MockInstance;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-boot-restart-'));
  statePath = path.join(dir, 'state-v2.json');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function boot(sample: BootSample): Extract<V2Boot, { status: 'ready' }> {
  const result = bootV2Run({ travel: sample.travel, places: sample.places, fixturesDir: FIXTURES_DIR, statePath });
  if (result.status !== 'ready') throw new Error(`expected a ready boot, got: ${result.reason}`);
  return result;
}

const files = () => fs.readdirSync(dir).sort();
/** Written by every ready boot next to the state file: the fingerprint of the default inputs (DECISIONS pass 55, #503). */
const SIDECAR = 'state-v2.source.json';

/** The boot after a bad file: the default run, one warning, the bad bytes under `.bad-1`, no state file yet. */
function expectDefaultAndCopy(sample: BootSample, badBytes: string, problem: RegExp) {
  const defaultJson = runJson(buildDefaultRun(bootSample())); // built without touching the state path
  const run = boot(sample).store.get();
  expect(runJson(run)).toBe(defaultJson);
  expect(files()).toEqual(['state-v2.json.bad-1', SIDECAR]);
  expect(fs.readFileSync(`${statePath}.bad-1`, 'utf8')).toBe(badBytes);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0][0])).toContain(`${statePath}.bad-1`);
  expect(String(warn.mock.calls[0][0])).toMatch(problem);
}

describe('bootV2Run restart', () => {
  it('boot, change the run, boot again on the same path: the same run, paused', async () => {
    const sample = bootSample();
    const first = boot(sample);
    const saved = await first.store.mutate((run) => {
      run.clock = { phase: 'locked', playing: true, timeMin: 1100, speed: 600 };
      run.scenario.shipments[0].label = 'Changed before the restart';
    });
    expect(saved.clock.playing).toBe(true);

    const second = boot(bootSample()); // a new process: a new cache object, the same data
    const run = second.store.get();
    expect(run).toEqual({ ...saved, clock: { ...saved.clock, playing: false } });
    expect(run.version).toBe(1);
    expect(run.clock).toEqual({ phase: 'locked', playing: false, timeMin: 1100, speed: 600 });
    expect(run.scenario.shipments[0].label).toBe('Changed before the restart');
    expect(files()).toEqual(['state-v2.json', SIDECAR]);
    expect(warn).not.toHaveBeenCalled();

    // and the restored store keeps saving to the same file
    await second.store.mutate((r) => {
      r.clock.timeMin = 1200;
    });
    expect(boot(sample).store.get().clock.timeMin).toBe(1200);
  });

  it('a saved run that uses a home added to the cache later (a commute save) is kept', async () => {
    const sample = bootSample();
    const home = { id: 'home-c-40.76420_-73.92350', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 };
    await boot(sample).store.mutate((run) => {
      run.scenario.homes.push(home);
      run.scenario.employees[0].homeId = home.id;
    });
    const later = bootSample();
    later.places[home.id] = { lat: home.lat, lng: home.lng };
    expect(boot(later).store.get().scenario.employees[0].homeId).toBe(home.id);
    expect(files()).toEqual(['state-v2.json', SIDECAR]);
  });

  it('a corrupt file gives the default run and leaves a renamed copy', () => {
    fs.writeFileSync(statePath, '{"schemaVersion":1,"run":{"runId":"run-1","vers');
    expectDefaultAndCopy(bootSample(), '{"schemaVersion":1,"run":{"runId":"run-1","vers', /not valid JSON/);
  });

  it('an MVP 1 state file gives the default run and leaves a renamed copy', async () => {
    const v1 = createStore({ filePath: statePath, initial: () => createInitialRun(loadDefaultScenario()) });
    await v1.mutate((run) => {
      run.clock.timeMin = 1000;
    });
    const bytes = fs.readFileSync(statePath, 'utf8');
    expect(JSON.parse(bytes).run.scenario.hubs.length).toBeGreaterThan(0); // really the MVP 1 shape
    expectDefaultAndCopy(bootSample(), bytes, /not an MVP II run/);
  });

  it('a state with an unknown place gives the default run and leaves a renamed copy', async () => {
    const sample = bootSample();
    await boot(sample).store.mutate((run) => {
      run.scenario.homes.push({ id: 'home-c-40.76420_-73.92350', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 });
      run.scenario.employees[0].homeId = 'home-c-40.76420_-73.92350';
    });
    const bytes = fs.readFileSync(statePath, 'utf8');
    warn.mockClear();
    expectDefaultAndCopy(sample, bytes, /place home-c-40\.76420_-73\.92350 is not in the travel cache/);
  });

  it('a second restart does not copy again, and the next bad file gets the next number', async () => {
    fs.writeFileSync(statePath, 'first bad file');
    const sample = bootSample();
    boot(sample);
    boot(sample);
    expect(files()).toEqual(['state-v2.json.bad-1', SIDECAR]);

    await boot(sample).store.mutate((run) => {
      run.clock.timeMin = 999;
    });
    expect(boot(sample).store.get().clock.timeMin).toBe(999); // the new state file is used
    fs.writeFileSync(statePath, 'second bad file');
    boot(sample);
    expect(files()).toEqual(['state-v2.json.bad-1', 'state-v2.json.bad-2', SIDECAR]);
    expect(fs.readFileSync(`${statePath}.bad-1`, 'utf8')).toBe('first bad file');
    expect(fs.readFileSync(`${statePath}.bad-2`, 'utf8')).toBe('second bad file');
  });

  it('a state path that cannot be set aside is not_loaded, not a crash and not a silent overwrite', () => {
    fs.mkdirSync(statePath); // a folder where the file should be
    fs.writeFileSync(path.join(statePath, 'keep.txt'), 'x');
    for (let n = 1; n < 1000; n++) fs.writeFileSync(`${statePath}.bad-${n}`, ''); // no free name left
    const sample = bootSample();
    const result = bootV2Run({ travel: sample.travel, places: sample.places, fixturesDir: FIXTURES_DIR, statePath });
    expect(result.status).toBe('not_loaded');
    expect(result.status === 'not_loaded' && result.reason).toContain(statePath);
    expect(fs.readFileSync(path.join(statePath, 'keep.txt'), 'utf8')).toBe('x');
  });
});

describe('savedRunProblem', () => {
  const sample = bootSample();
  const good = (): { schemaVersion: number; run: RunV2 } =>
    JSON.parse(JSON.stringify({ schemaVersion: 1, run: boot(sample).store.get() }));
  const problem = (change: (file: { schemaVersion: number; run: any }) => void) => {
    const file = good();
    change(file);
    return savedRunProblem(file, sample.places);
  };

  it('accepts the default run as the store writes it', () => {
    expect(savedRunProblem(good(), sample.places)).toBeNull();
  });

  it('refuses anything that is not a whole v2 run', () => {
    expect(savedRunProblem(null, sample.places)).toBe('it does not hold a run');
    expect(savedRunProblem([], sample.places)).toBe('it does not hold a run');
    expect(savedRunProblem({ schemaVersion: 1 }, sample.places)).toBe('it does not hold a run');
    expect(problem((f) => { f.schemaVersion = 2; })).toBe('unexpected schemaVersion');
    expect(problem((f) => { f.run.scenario.schemaVersion = 1; })).toMatch(/not an MVP II run/);
    expect(problem((f) => { delete f.run.clock; })).toBe('the run has no usable clock');
    expect(problem((f) => { delete f.run.version; })).toBe('the run has no runId or version');
    // a file with the right versions but a missing section must not load and crash later
    for (const section of ['trips', 'jobs', 'notifications', 'events']) {
      expect(problem((f) => { delete f.run[section]; })).toBe(`${section} is not a list of objects`);
    }
    expect(problem((f) => { delete f.run.assignments; })).toBe('assignments is missing');
    expect(problem((f) => { delete f.run.assignments.plans; })).toBe('assignments.plans is not a list of objects');
    expect(problem((f) => { delete f.run.scenario.homes; })).toBe('scenario.homes is not a list of objects');
    expect(problem((f) => { delete f.run.scenario.settings; })).toBe('scenario.settings is missing');
  });

  it('refuses a run with a place the cache does not know, wherever it is used', () => {
    const unknown = /^place biz-ghost is not in the travel cache$/;
    expect(problem((f) => { f.run.scenario.businesses[0].id = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.scenario.employees[3].businessId = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.scenario.shipments[0].destinationBusinessId = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.trips[0].originPlaceId = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.assignments.plans[0].legs[0].placeIds[1] = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.assignments.plans[0].legs[0].stops[0].placeId = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => { f.run.jobs[0].dropoff.placeId = 'biz-ghost'; })).toMatch(unknown);
    expect(problem((f) => {
      f.run.assignments.plans.find((plan: { kind: string }) => plan.kind === 'relay').relayBusinessId = 'biz-ghost';
    })).toMatch(unknown);
    expect(problem((f) => {
      f.run.scenario.homes[0].id = 'home-ghost-1';
      f.run.scenario.homes[1].id = 'home-ghost-2';
    })).toBe('place home-ghost-1 and 1 more is not in the travel cache');
    expect(problem((f) => { delete f.run.scenario.employees[0].homeId; })).toBe("an employee's home is missing");
  });
});
