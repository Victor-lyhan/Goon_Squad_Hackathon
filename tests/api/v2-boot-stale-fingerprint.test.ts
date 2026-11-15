// The fingerprint of the default inputs and the stale rule of `bootV2Run` (DECISIONS pass 55, #503):
// a saved NYC run is restored only if it was built from the same three fixture files and the same default
// request. Everything runs on the made-up sample cache (v2-boot-sample.ts) in a temp folder; the repo's
// data/ and fixtures/nyc/ are only read. No assertion pins a story ID or a matched count.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bootV2Run, buildDefaultRun, defaultRunFingerprint, readNycFixtures, sourcePathFor,
  DEFAULT_RUN_REQUEST, DEFAULT_V2_STATE_PATH, type NycFixtures, type V2Boot,
} from '../../server/api/v2/bootRun';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { pairKey } from '../../shared/v2/types';
import { bootSample, FIXTURES_DIR, runJson, type BootSample } from './v2-boot-sample';

const T = 20_000; // every boot builds the default NYC run (DECISIONS pass 19)
const NYC_FILES = ['businesses.json', 'neighborhoods.json', 'demoStory.json'] as const;
const HEX_64 = /^[0-9a-f]{64}$/;

const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;

/** The same JSON value with the keys of every object in the opposite order. List order is kept. */
function reordered<V>(value: V): V {
  if (Array.isArray(value)) return value.map(reordered) as V;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reordered(v)])) as V;
  }
  return value;
}

// ---------- the repo's data/ folder is never touched ----------

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
beforeAll(() => {
  repoDataBefore = repoDataNames();
});
afterAll(() => {
  expect(repoDataNames()).toStrictEqual(repoDataBefore);
});

// ---------- defaultRunFingerprint ----------

describe('defaultRunFingerprint', () => {
  const fixtures = readNycFixtures(FIXTURES_DIR);
  const base = defaultRunFingerprint(fixtures, DEFAULT_RUN_REQUEST);
  const changed = (change: (copy: NycFixtures) => void): string => {
    const copy = clone(fixtures);
    change(copy);
    return defaultRunFingerprint(copy, DEFAULT_RUN_REQUEST);
  };

  it('is a SHA-256 hex string, the same on every call', () => {
    expect(base).toMatch(HEX_64);
    expect(defaultRunFingerprint(readNycFixtures(FIXTURES_DIR), { ...DEFAULT_RUN_REQUEST })).toBe(base);
  }, T);

  it('is equal for the same content in another key order', () => {
    const other = reordered(fixtures);
    expect(Object.keys(other.businessesFile.businesses[0])).not.toEqual(Object.keys(fixtures.businessesFile.businesses[0]));
    expect(other).toEqual(fixtures); // the same content
    expect(defaultRunFingerprint(other, reordered(DEFAULT_RUN_REQUEST))).toBe(base);
  }, T);

  it('is equal for files written with other whitespace and key order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-fingerprint-'));
    try {
      for (const name of NYC_FILES) {
        const value = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
        fs.writeFileSync(path.join(dir, name), `\n${JSON.stringify(reordered(value), null, '\t')}\n\n`);
      }
      expect(fs.readFileSync(path.join(dir, 'demoStory.json'), 'utf8'))
        .not.toBe(fs.readFileSync(path.join(FIXTURES_DIR, 'demoStory.json'), 'utf8'));
      expect(defaultRunFingerprint(readNycFixtures(dir), DEFAULT_RUN_REQUEST)).toBe(base);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, T);

  it('differs after a changed departure time in the story', () => {
    const evening = changed((copy) => { copy.storyFile.featuredEmployees[0].eveningDepartureMin += 5; });
    const morning = changed((copy) => { copy.storyFile.featuredEmployees[0].morningDepartureMin += 5; });
    expect(evening).toMatch(HEX_64);
    expect(evening).not.toBe(base);
    expect(morning).not.toBe(base);
    expect(morning).not.toBe(evening);
  }, T);

  it('differs after a changed business address', () => {
    expect(changed((copy) => { copy.businessesFile.businesses[0].address += ', Floor 2'; })).not.toBe(base);
  }, T);

  it('differs for a default maxExtraMin of 12 instead of 8', () => {
    const at8 = defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, maxExtraMin: 8 });
    const at12 = defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, maxExtraMin: 12 });
    expect(at12).not.toBe(at8);
    // and against the default itself, whichever number #492 leaves there
    const current = DEFAULT_RUN_REQUEST.maxExtraMin;
    expect(defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, maxExtraMin: current })).toBe(base);
    expect(defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, maxExtraMin: current === 12 ? 8 : 12 })).not.toBe(base);
  }, T);

  it('differs for any other change that defines the run: a package, a neighborhood box, the order of a list, the seed, the employee count', () => {
    const others = [
      changed((copy) => { copy.storyFile.shipments[0].deadlineMin -= 10; }),
      changed((copy) => { copy.neighborhoodsFile.neighborhoods[0].bbox.north += 0.001; }),
      changed((copy) => { copy.businessesFile.businesses.reverse(); }),
      changed((copy) => { copy.storyFile.featuredEmployees.pop(); }),
      defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, seed: DEFAULT_RUN_REQUEST.seed + 1 }),
      // #966: a run saved when the default run had the story's 60 employees only is set aside, not restored.
      defaultRunFingerprint(fixtures, { ...DEFAULT_RUN_REQUEST, employees: 60 }),
    ];
    expect(new Set([base, ...others]).size).toBe(others.length + 1);
  }, T);

  it('differs when a default price changes: a run saved under other prices is stale (#861)', () => {
    // A run saved before #861 has plans at the old flat price and settings without the pricing values, so the
    // default settings are part of the fingerprint. The exported object is changed here and put back.
    const settings = DEFAULT_SETTINGS as { platformFeeCents: number; flexWindowMin: number };
    const { platformFeeCents, flexWindowMin } = settings;
    try {
      settings.platformFeeCents = platformFeeCents + 50;
      const dearer = defaultRunFingerprint(fixtures, DEFAULT_RUN_REQUEST);
      settings.platformFeeCents = platformFeeCents;
      settings.flexWindowMin = flexWindowMin + 60;
      const longer = defaultRunFingerprint(fixtures, DEFAULT_RUN_REQUEST);
      expect(new Set([base, dearer, longer]).size).toBe(3);
    } finally {
      settings.platformFeeCents = platformFeeCents;
      settings.flexWindowMin = flexWindowMin;
    }
    expect(defaultRunFingerprint(fixtures, DEFAULT_RUN_REQUEST)).toBe(base);
  }, T);

  it('the travel cache is not an input: the function takes the three files and the request only', () => {
    expect(defaultRunFingerprint.length).toBe(2);
    expect(Object.keys(fixtures).sort()).toEqual(['businessesFile', 'neighborhoodsFile', 'storyFile']);
  }, T);
});

describe('sourcePathFor', () => {
  it('is the state file name with .source.json, in the same folder', () => {
    expect(sourcePathFor(path.join('data', 'state-v2.json'))).toBe(path.join('data', 'state-v2.source.json'));
    expect(path.relative(repoDataDir, sourcePathFor(DEFAULT_V2_STATE_PATH))).toBe('state-v2.source.json');
    expect(sourcePathFor(path.join('tmp', 'run'))).toBe(path.join('tmp', 'run.source.json'));
  }, T);
});

// ---------- the rules of bootV2Run, each on a temp folder ----------

let dir: string;
let fixturesDir: string;
let statePath: string;
let sourcePath: string;
let warn: MockInstance;
let log: MockInstance;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-boot-stale-'));
  fixturesDir = path.join(dir, 'fixtures');
  fs.mkdirSync(fixturesDir);
  for (const name of NYC_FILES) fs.copyFileSync(path.join(FIXTURES_DIR, name), path.join(fixturesDir, name));
  statePath = path.join(dir, 'data', 'state-v2.json');
  sourcePath = path.join(dir, 'data', 'state-v2.source.json');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

type Ready = Extract<V2Boot, { status: 'ready' }>;

const bootRaw = (sample: BootSample = bootSample()): V2Boot =>
  bootV2Run({ travel: sample.travel, places: sample.places, fixturesDir, statePath });

function boot(sample?: BootSample): Ready {
  const result = bootRaw(sample);
  if (result.status !== 'ready') throw new Error(`expected a ready boot, got: ${result.reason}`);
  return result;
}

const dataFiles = () => fs.readdirSync(path.dirname(statePath)).sort();
const currentFingerprint = () => defaultRunFingerprint(readNycFixtures(fixturesDir), DEFAULT_RUN_REQUEST);
const currentDefaultJson = () => runJson(buildDefaultRun({ ...bootSample(), fixtures: readNycFixtures(fixturesDir) }));
const sidecar = () => JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

/** Rewrites one fixture file of the temp folder. */
function editFixture(name: (typeof NYC_FILES)[number], change: (value: any) => void): void {
  const file = path.join(fixturesDir, name);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(value);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
const moveADeparture = () => editFixture('demoStory.json', (story) => { story.featuredEmployees[0].eveningDepartureMin += 5; });

/** A first boot and one change, so a state file and its sidecar are on disk. Returns the state file's bytes. */
async function savedRunAt(timeMin: number): Promise<string> {
  await boot().store.mutate((run) => {
    run.clock = { phase: 'locked', playing: true, timeMin, speed: 600 };
  });
  return fs.readFileSync(statePath, 'utf8');
}

describe('bootV2Run: the sidecar and the stale rule', () => {
  it('no state file: the default run, and the sidecar is written through a temp file', () => {
    const result = boot();
    expect(runJson(result.store.get())).toBe(currentDefaultJson());
    expect(result.notice).toBeUndefined();
    expect('notice' in result).toBe(false);
    expect(dataFiles()).toEqual(['state-v2.source.json']); // no state file yet, no .tmp left behind
    expect(sidecar()).toStrictEqual({ schemaVersion: 1, fingerprint: currentFingerprint() });
    expect(sidecar().fingerprint).toMatch(HEX_64);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  }, T);

  it('no state file and an old sidecar: the default run, the sidecar is rewritten, nothing is set aside', () => {
    boot();
    const before = sidecar().fingerprint;
    moveADeparture();
    const result = boot();
    expect(result.notice).toBeUndefined();
    expect(runJson(result.store.get())).toBe(currentDefaultJson());
    expect(sidecar().fingerprint).toBe(currentFingerprint());
    expect(sidecar().fingerprint).not.toBe(before);
    expect(dataFiles()).toEqual(['state-v2.source.json']);
  }, T);

  it('a usable state and an equal sidecar: restored paused at the same minute, as before', async () => {
    const bytes = await savedRunAt(1100);
    const saved = JSON.parse(bytes).run;
    const sidecarBytes = fs.readFileSync(sourcePath, 'utf8');

    const result = boot();
    const run = result.store.get();
    expect(run).toEqual({ ...saved, clock: { ...saved.clock, playing: false } });
    expect(run.clock).toEqual({ phase: 'locked', playing: false, timeMin: 1100, speed: 600 });
    expect(result.notice).toBeUndefined();
    expect(dataFiles()).toEqual(['state-v2.json', 'state-v2.source.json']);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(bytes); // a boot alone writes no state
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sidecarBytes);
    expect(warn).not.toHaveBeenCalled();
  }, T);

  it('a usable state and a different sidecar: the state becomes .stale-1 and the default run is built from the current files', async () => {
    const bytes = await savedRunAt(1100);
    const oldFingerprint = sidecar().fingerprint;
    moveADeparture();

    const result = boot();
    const run = result.store.get();
    expect(runJson(run)).toBe(currentDefaultJson());
    expect(run.clock.timeMin).not.toBe(1100);
    expect(run.clock.playing).toBe(false);
    expect(dataFiles()).toEqual(['state-v2.json.stale-1', 'state-v2.source.json']);
    expect(fs.readFileSync(`${statePath}.stale-1`, 'utf8')).toBe(bytes); // renamed, byte for byte
    expect(sidecar()).toStrictEqual({ schemaVersion: 1, fingerprint: currentFingerprint() });
    expect(sidecar().fingerprint).not.toBe(oldFingerprint);

    expect(result.notice).toBe(
      `The NYC story files, the default employee count, the default detour limit or the default prices changed since ${statePath} was saved. `
      + `Started from the new default run; the old run is kept as ${statePath}.stale-1.`,
    );
    expect(result.notice).not.toMatch(/\n/);
    // bootV2Run itself prints nothing: the server start logs the notice once
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  }, T);

  it('a usable state and no sidecar: set aside as stale too, and the notice says why', async () => {
    const bytes = await savedRunAt(1100);
    fs.rmSync(sourcePath);

    const result = boot();
    expect(runJson(result.store.get())).toBe(currentDefaultJson());
    expect(dataFiles()).toEqual(['state-v2.json.stale-1', 'state-v2.source.json']);
    expect(fs.readFileSync(`${statePath}.stale-1`, 'utf8')).toBe(bytes);
    expect(sidecar()).toStrictEqual({ schemaVersion: 1, fingerprint: currentFingerprint() });
    expect(result.notice).toContain(`${sourcePath} is missing or unreadable`);
    expect(result.notice).toContain(`the old run is kept as ${statePath}.stale-1.`);
  }, T);

  it.each([
    ['not JSON', '{"schemaVersion":1,"finger'],
    ['another schemaVersion', JSON.stringify({ schemaVersion: 2, fingerprint: 'x' })],
    ['no fingerprint', JSON.stringify({ schemaVersion: 1 })],
    ['a list', '[]'],
  ])('a sidecar that cannot be read (%s) counts as missing', async (_label, content) => {
    const bytes = await savedRunAt(1100);
    fs.writeFileSync(sourcePath, content);
    const result = boot();
    expect(result.notice).toContain('is missing or unreadable');
    expect(fs.readFileSync(`${statePath}.stale-1`, 'utf8')).toBe(bytes);
    expect(sidecar()).toStrictEqual({ schemaVersion: 1, fingerprint: currentFingerprint() });
  }, T);

  it('the first free number is used: an existing .stale file is never overwritten', async () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(`${statePath}.stale-1`, 'an older run');
    fs.writeFileSync(`${statePath}.stale-3`, 'another older run');
    const first = await savedRunAt(1100);
    moveADeparture();
    expect(boot().notice).toContain(`${statePath}.stale-2.`);

    const second = await savedRunAt(1200);
    moveADeparture();
    expect(boot().notice).toContain(`${statePath}.stale-4.`);

    expect(dataFiles()).toEqual([
      'state-v2.json.stale-1', 'state-v2.json.stale-2', 'state-v2.json.stale-3', 'state-v2.json.stale-4', 'state-v2.source.json',
    ]);
    expect(fs.readFileSync(`${statePath}.stale-1`, 'utf8')).toBe('an older run');
    expect(fs.readFileSync(`${statePath}.stale-2`, 'utf8')).toBe(first);
    expect(fs.readFileSync(`${statePath}.stale-3`, 'utf8')).toBe('another older run');
    expect(fs.readFileSync(`${statePath}.stale-4`, 'utf8')).toBe(second);
  }, T);

  it('an unusable state is still renamed to .bad-<n>, with no notice, whatever the sidecar says', async () => {
    await savedRunAt(1100);
    moveADeparture(); // the sidecar now differs as well: "unusable" wins
    fs.writeFileSync(statePath, '{not json');

    const result = boot();
    expect(runJson(result.store.get())).toBe(currentDefaultJson());
    expect(result.notice).toBeUndefined();
    expect(dataFiles()).toEqual(['state-v2.json.bad-1', 'state-v2.source.json']);
    expect(fs.readFileSync(`${statePath}.bad-1`, 'utf8')).toBe('{not json');
    expect(sidecar()).toStrictEqual({ schemaVersion: 1, fingerprint: currentFingerprint() });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(`${statePath}.bad-1`);
  }, T);

  it('not_loaded: neither the state file nor the sidecar is touched', async () => {
    const bytes = await savedRunAt(1100);
    const sidecarBytes = fs.readFileSync(sourcePath, 'utf8');
    moveADeparture(); // a restart that would set the run aside, if the cache were complete
    const untouched = () => {
      expect(dataFiles()).toEqual(['state-v2.json', 'state-v2.source.json']);
      expect(fs.readFileSync(statePath, 'utf8')).toBe(bytes);
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sidecarBytes);
    };

    const gap = bootSample();
    const { businesses } = readNycFixtures(fixturesDir).businessesFile;
    delete gap.files.matrix.pairs[pairKey(businesses[0].id, businesses[1].id)];
    expect(bootRaw(gap).status).toBe('not_loaded');
    untouched();

    expect(bootV2Run({ travel: null, places: null, fixturesDir, statePath }).status).toBe('not_loaded');
    untouched();

    fs.rmSync(path.join(fixturesDir, 'demoStory.json'));
    expect(bootRaw().status).toBe('not_loaded');
    untouched();
    expect(warn).not.toHaveBeenCalled();
  }, T);

  it('not_loaded with no files at all creates nothing, not even the folder', () => {
    expect(bootV2Run({ travel: null, places: null, fixturesDir, statePath }).status).toBe('not_loaded');
    expect(fs.existsSync(path.dirname(statePath))).toBe(false);
  }, T);

  it('a stale state that cannot be renamed is not_loaded: nothing is overwritten and the sidecar stays', async () => {
    const bytes = await savedRunAt(1100);
    const sidecarBytes = fs.readFileSync(sourcePath, 'utf8');
    moveADeparture();
    for (let n = 1; n < 1000; n++) fs.writeFileSync(`${statePath}.stale-${n}`, ''); // no free name left

    const result = bootRaw();
    expect(result.status).toBe('not_loaded');
    expect(result.status === 'not_loaded' && result.reason).toContain(statePath);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(bytes);
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sidecarBytes);
    expect(fs.readFileSync(`${statePath}.stale-1`, 'utf8')).toBe('');
  }, T);

  it('a sidecar that cannot be written does not stop the server: ready, one warning, no temp file left', () => {
    fs.mkdirSync(sourcePath, { recursive: true }); // a folder where the sidecar should be
    const result = boot();
    expect(runJson(result.store.get())).toBe(currentDefaultJson());
    expect(result.notice).toBeUndefined();
    expect(dataFiles()).toEqual(['state-v2.source.json']);
    expect(fs.statSync(sourcePath).isDirectory()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(sourcePath);
  }, T);
});
