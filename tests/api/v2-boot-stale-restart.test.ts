// Restarts of the whole v2 runtime (`createV2Runtime`, as server/index.ts starts it) around a story change
// (DECISIONS pass 55, #503): a changed demoStory.json starts from the new default run and keeps the old one
// as .stale-<n>; an unchanged restart restores; a commute save that grows the travel cache does not make
// the run stale. Sample cache and copies of the NYC files in a temp folder (v2-bootstrap-helper.ts): no
// network, no real key, and the repo's data/ and fixtures/nyc/ are only read.
// No assertion pins a story ID or a matched count.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { v2StartLines } from '../../server/index';
import {
  buildDefaultRun, defaultRunFingerprint, readNycFixtures, sourcePathFor, DEFAULT_RUN_REQUEST, DEFAULT_V2_STATE_PATH,
} from '../../server/api/v2/bootRun';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { MATRIX_FILE } from '../../server/geo/cache';
import { bootSample, runJson } from './v2-boot-sample';
import {
  FAKE_KEY, GEOCODED, fakeGoogle, noNetwork, startBootstrapApi, T, tempRepo, type BootstrapApi, type TempRepo,
} from './v2-bootstrap-helper';

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
beforeAll(() => {
  repoDataBefore = repoDataNames();
});
afterAll(() => {
  expect(repoDataNames()).toStrictEqual(repoDataBefore); // the repo's data/ folder is untouched
});

let repo: TempRepo;
let api: BootstrapApi | null = null;
let logged: unknown[][];

beforeEach(() => {
  repo = tempRepo('sample');
  logged = [];
  for (const method of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
  }
});
afterEach(async () => {
  await api?.close();
  api = null;
  repo.remove();
  vi.restoreAllMocks();
});

/** A new process on the same folders: the one before is shut down first (its state is saved, paused). */
async function restart(opts: { key?: string; fetch?: ReturnType<typeof fakeGoogle>['fetch'] } = {}): Promise<BootstrapApi> {
  await api?.close();
  api = await startBootstrapApi({ cache: 'sample', repo, ...opts });
  expect(api.runtime.status).toBe('ready');
  return api;
}

const stateFiles = () => fs.readdirSync(path.dirname(repo.statePath)).filter((name) => name.startsWith('state-v2')).sort();
const staleFiles = () => stateFiles().filter((name) => name.includes('.stale-'));
const sidecarFingerprint = (): string => JSON.parse(fs.readFileSync(sourcePathFor(repo.statePath), 'utf8')).fingerprint;
const fixtureFingerprint = () => defaultRunFingerprint(readNycFixtures(repo.fixturesDir), DEFAULT_RUN_REQUEST);
/** The default run of the temp folder's current files, built without any state path. */
const currentDefaultJson = () => runJson(buildDefaultRun({ ...bootSample(), fixtures: readNycFixtures(repo.fixturesDir) }));

function editStory(change: (story: any) => void): void {
  const file = path.join(repo.fixturesDir, 'demoStory.json');
  const story = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(story);
  fs.writeFileSync(file, JSON.stringify(story, null, 2));
}

/** Moves the clock and saves, like a demo that was played for a while. */
async function playTo(running: BootstrapApi, timeMin: number): Promise<void> {
  await running.store!.mutate((run) => {
    run.clock = { phase: 'locked', playing: true, timeMin, speed: 600 };
  });
}

describe('v2 runtime restarts around a story change', () => {
  it('a changed story starts from the new default run, keeps the old run as .stale-1, and the next restart restores', async () => {
    const first = await restart();
    expect(first.runtime.notice).toBeUndefined();
    expect(sidecarFingerprint()).toBe(fixtureFingerprint());
    const oldDefaultJson = runJson(first.store!.get());
    await playTo(first, 1100);
    await first.close(); // shutdown pauses and saves
    api = null;
    const oldBytes = fs.readFileSync(repo.statePath, 'utf8');
    const oldFingerprint = sidecarFingerprint();

    // --- the retune: one departure time moves
    editStory((story) => { story.featuredEmployees[0].eveningDepartureMin += 5; });
    expect(fixtureFingerprint()).not.toBe(oldFingerprint);

    const second = await restart();
    const run = second.store!.get();
    expect(runJson(run)).toBe(currentDefaultJson());
    expect(runJson(run)).not.toBe(oldDefaultJson); // really the new story
    expect(run.clock.timeMin).toBe(run.scenario.settings.simStartMin);
    expect((await second.v2.get('/simulator')).body.clock).toMatchObject({ phase: 'planning', playing: false });
    expect(stateFiles()).toStrictEqual(['state-v2.json.stale-1', 'state-v2.source.json']); // no new state file before a change
    expect(fs.readFileSync(`${repo.statePath}.stale-1`, 'utf8')).toBe(oldBytes);
    expect(sidecarFingerprint()).toBe(fixtureFingerprint());

    // --- the notice: on the runtime, printed once by the server start, by nothing else
    const notice = second.runtime.notice!;
    expect(notice).toBe(
      `The NYC story files, the default detour limit or the default prices changed since ${repo.statePath} was saved. `
      + `Started from the new default run; the old run is kept as ${repo.statePath}.stale-1.`,
    );
    const lines = v2StartLines(second.runtime);
    expect(lines).toHaveLength(2);
    expect(lines.filter((line) => line === notice)).toHaveLength(1);
    expect(lines[0]).toMatch(/ready at \/api\/v2/);
    expect(logged).toStrictEqual([]); // the boot and the runtime print nothing themselves

    // --- a second restart with unchanged files restores the run and sets nothing aside
    await playTo(second, 1200);
    const third = await restart();
    expect(third.runtime.notice).toBeUndefined();
    expect(v2StartLines(third.runtime)).toHaveLength(1);
    expect(third.store!.get().clock).toStrictEqual({ phase: 'locked', playing: false, timeMin: 1200, speed: 600 });
    expect(staleFiles()).toStrictEqual(['state-v2.json.stale-1']);

    const fourth = await restart(); // and once more, with no change in between
    expect(fourth.runtime.notice).toBeUndefined();
    expect(fourth.store!.get().clock.timeMin).toBe(1200);
    expect(stateFiles()).toStrictEqual(['state-v2.json', 'state-v2.json.stale-1', 'state-v2.source.json']);
    expect(fs.readFileSync(`${repo.statePath}.stale-1`, 'utf8')).toBe(oldBytes);
    expect(logged).toStrictEqual([]);
  }, T);

  it('a state file saved before the sidecar existed is set aside once, then restarts restore', async () => {
    const first = await restart();
    await playTo(first, 1100);
    await first.close();
    api = null;
    fs.rmSync(sourcePathFor(repo.statePath)); // as written by a server from before #503

    const second = await restart();
    expect(second.runtime.notice).toContain('is missing or unreadable');
    expect(second.runtime.notice).toContain(`${repo.statePath}.stale-1`);
    expect(runJson(second.store!.get())).toBe(currentDefaultJson());
    expect(sidecarFingerprint()).toBe(fixtureFingerprint());

    await playTo(second, 1300);
    const third = await restart();
    expect(third.runtime.notice).toBeUndefined();
    expect(third.store!.get().clock.timeMin).toBe(1300);
    expect(staleFiles()).toStrictEqual(['state-v2.json.stale-1']);
  }, T);

  it('a commute save that adds a home-c place to the matrix does not make the run stale', async () => {
    const google = fakeGoogle();
    const first = await restart({ key: FAKE_KEY, fetch: google.fetch });
    const fingerprintBefore = sidecarFingerprint();
    const employee = first.store!.get().scenario.employees[0];
    const commute = await first.v2.put(`/employees/${employee.id}/commute`, {
      businessId: employee.businessId,
      home: { lat: GEOCODED.lat, lng: GEOCODED.lng, neighborhood: 'Astoria' },
      eveningDepartureMin: employee.eveningDepartureMin,
      morningDepartureMin: employee.morningDepartureMin,
      availableEvening: true,
      availableMorning: true,
      maxExtraMin: employee.maxExtraMin,
    });
    expect(commute.status).toBe(200);
    const homeId: string = commute.body.home.id;
    expect(homeId).toMatch(/^home-c-/);
    await first.close();
    api = null;

    // The travel cache on disk grew; the three story files did not change.
    const matrix = JSON.parse(fs.readFileSync(path.join(repo.fixturesDir, MATRIX_FILE), 'utf8'));
    expect(Object.hasOwn(matrix.places, homeId)).toBe(true);
    expect(Object.hasOwn(bootSample().places, homeId)).toBe(false);
    expect(fixtureFingerprint()).toBe(fingerprintBefore);

    const second = await restart(); // no key this time: cached data only
    expect(second.runtime.notice).toBeUndefined();
    const run = second.store!.get();
    expect(run.scenario.employees.find((e) => e.id === employee.id)?.homeId).toBe(homeId);
    expect(run.scenario.homes.some((home) => home.id === homeId)).toBe(true);
    expect(run.clock.playing).toBe(false);
    expect(stateFiles()).toStrictEqual(['state-v2.json', 'state-v2.source.json']); // no .stale-, no .bad-
    expect(sidecarFingerprint()).toBe(fingerprintBefore);
  }, T);

  it('the notice and the start lines never hold the key or anything from the files', async () => {
    const first = await restart({ key: FAKE_KEY, fetch: fakeGoogle().fetch });
    await playTo(first, 1100);
    await first.close();
    api = null;
    editStory((story) => { story.shipments[0].deadlineMin -= 10; });

    const second = await restart({ key: FAKE_KEY, fetch: fakeGoogle().fetch });
    const lines = v2StartLines(second.runtime).join('\n');
    expect(lines).toContain('.stale-1');
    expect(lines).not.toContain(FAKE_KEY);
    const fixtures = readNycFixtures(repo.fixturesDir);
    expect(lines).not.toContain(sidecarFingerprint());
    expect(lines).not.toContain(fixtures.storyFile.featuredEmployees[0].name);
    expect(lines).not.toContain(fixtures.storyFile.shipments[0].label);
    expect(lines).not.toContain(fixtures.businessesFile.businesses[0].address);
    // and the sidecar itself holds the two documented fields only
    expect(Object.keys(JSON.parse(fs.readFileSync(sourcePathFor(repo.statePath), 'utf8'))).sort()).toStrictEqual(['fingerprint', 'schemaVersion']);
    expect(JSON.stringify(logged)).not.toContain(FAKE_KEY);
  }, T);

  it('while not loaded the runtime has no notice and leaves a stale-looking state and its sidecar alone', async () => {
    const first = await restart();
    await playTo(first, 1100);
    await first.close();
    api = null;
    const bytes = fs.readFileSync(repo.statePath, 'utf8');
    const sidecarBytes = fs.readFileSync(sourcePathFor(repo.statePath), 'utf8');
    editStory((story) => { story.featuredEmployees[0].eveningDepartureMin += 5; });
    fs.rmSync(path.join(repo.fixturesDir, MATRIX_FILE)); // no travel cache

    const runtime = createV2Runtime({ fixturesDir: repo.fixturesDir, statePath: repo.statePath, key: null, fetch: noNetwork().fetch });
    expect(runtime.status).toBe('not_loaded');
    expect(runtime.notice).toBeUndefined();
    expect(v2StartLines(runtime)).toStrictEqual([`Relay MVP II API (/api/v2) is not loaded and answers 503: ${runtime.reason}`]);
    expect(stateFiles()).toStrictEqual(['state-v2.json', 'state-v2.source.json']);
    expect(fs.readFileSync(repo.statePath, 'utf8')).toBe(bytes);
    expect(fs.readFileSync(sourcePathFor(repo.statePath), 'utf8')).toBe(sidecarBytes);
  }, T);
});

describe('v2StartLines', () => {
  it('ready: one line; ready with a notice: the notice once, after it', () => {
    expect(v2StartLines({ status: 'ready' })).toStrictEqual(['Relay MVP II API ready at /api/v2 (NYC travel cache loaded)']);
    expect(v2StartLines({ status: 'ready', notice: 'A notice.' })).toStrictEqual([
      'Relay MVP II API ready at /api/v2 (NYC travel cache loaded)',
      'A notice.',
    ]);
  }, T);
});
