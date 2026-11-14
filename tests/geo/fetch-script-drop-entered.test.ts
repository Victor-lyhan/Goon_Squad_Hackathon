// runFetchScript --drop-entered (server/geo/fetchScript.ts): removes the homes typed into the commute editor
// (`home-c-<lat>_<lng>`) from the travel cache with all their pairs and route lines. It needs no key, makes no
// Google call, saves through the existing atomic write and prints counts only, never an ID (issue #515).
// Also the line `--dry-run` adds, the usage errors and the real script file.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key, no .env.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles, serializeTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { dropEnteredHomes, formatEnteredDrop } from '../../server/geo/cacheEdit';
import { DROP_ENTERED_COMMAND, DROP_ENTERED_RUN_NOTE, USAGE, parseArgs, runFetchScript } from '../../server/geo/fetchScript';
import { ENTERED_HOME_IDS, ENTERED_ID_PATTERN, withEnteredHomes } from './cache-edit-helpers';
import { BUSINESS_IDS, KEY, repoRoot, totalCalls } from './fetch-routes-helpers';
import { leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempDirWithCacheOf, tempFixturesDir } from './fetch-script-helpers';

// The seed run (the whole fetch with the fake client) takes about 0.1 s locally and a drop a few ms.
const TEST_TIMEOUT_MS = 30_000;
// Starting node with tsx takes about a second.
const PROCESS_TIMEOUT_MS = 60_000;

vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS });

const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json');
  return files;
};

/** A folder with the seed's cache plus two entered homes, saved the way the live server saves them. */
function dirWithEnteredHomes(): string {
  const dir = tempDirWithCacheOf(seed);
  writeTravelFiles(dir, withEnteredHomes(complete, BUSINESS_IDS));
  return dir;
}

const noIds = (lines: readonly string[]) => {
  for (const line of lines) expect(line).not.toMatch(ENTERED_ID_PATTERN);
};

/** A folder a complete run was made on. Never changed after `beforeAll`; every test works on a copy. */
let seed: string;
let complete: TravelFiles;

beforeAll(async () => {
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
  complete = cacheOf(seed);
});

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runFetchScript --drop-entered: a cache with two entered homes', () => {
  it('removes them with all their pairs and route lines, prints the counts and no ID, and exits 0', async () => {
    const dir = dirWithEnteredHomes();
    const before = cacheOf(dir);
    expect(Object.keys(before.matrix.places)).toEqual(expect.arrayContaining(ENTERED_HOME_IDS));

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(0);
    const pairs = 2 * 2 * BUSINESS_IDS.length;
    expect(lines).toEqual([
      `Dropped 2 entered homes (addresses typed into the commute editor): 2 places, ${pairs} pairs, 4 route lines.`,
      expect.stringMatching(/^The drop is saved in .+\. No Google call was made, and nothing has to be fetched again\.$/),
      expect.stringMatching(/^A saved NYC run that uses one of them starts fresh after the drop .+ restart it: /),
    ]);
    expect(lines[0]).toBe(formatEnteredDrop(dropEnteredHomes(before)));
    expect(lines[2].startsWith(DROP_ENTERED_RUN_NOTE)).toBe(true);
    noIds(lines);
  });

  it('leaves the cache exactly as it was before the homes were entered, byte for byte, and no temp file', async () => {
    const dir = dirWithEnteredHomes();
    expect(snapshot(dir)).not.toEqual(snapshot(seed));

    await script({ dir, argv: ['--drop-entered'] });

    expect(snapshot(dir)).toEqual(snapshot(seed));
    expect(fs.readFileSync(path.join(dir, MATRIX_FILE), 'utf8')).not.toContain('home-c-');
    expect(fs.readFileSync(path.join(dir, POLYLINES_FILE), 'utf8')).not.toContain('home-c-');
  });

  it('needs no key and no .env, builds no client and makes no Google call', async () => {
    const dir = dirWithEnteredHomes();
    const { code, keys, calls } = await script({ dir, argv: ['--drop-entered'], env: {} });

    expect(code).toBe(0);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(snapshot(dir)).toEqual(snapshot(seed));
  });

  it('with the real Google client and a key: a fake fetch records zero calls', async () => {
    const dir = dirWithEnteredHomes();
    const fetched: unknown[] = [];
    vi.stubGlobal('fetch', async (...request: unknown[]) => {
      fetched.push(request);
      throw new Error('the drop must not call Google');
    });
    const lines: string[] = [];

    // No `makeClient`: the command would build the real client, which calls the global `fetch`.
    const code = await runFetchScript({
      argv: ['--drop-entered'],
      env: { GOOGLE_MAPS_SERVER_KEY: KEY },
      fixturesDir: dir,
      envPath: path.join(dir, 'there-is-no.env'),
      out: (line) => lines.push(line),
    });

    expect(code).toBe(0);
    expect(fetched).toEqual([]);
    expect(lines[0]).toMatch(/^Dropped 2 entered homes /);
    expect(snapshot(dir)).toEqual(snapshot(seed));
  });

  it('does not read .env: a key that is only there is never loaded', async () => {
    const dir = dirWithEnteredHomes();
    const envPath = path.join(dir, 'test.env');
    fs.writeFileSync(envPath, `GOOGLE_MAPS_SERVER_KEY=${KEY}\n`);
    const env: Record<string, string | undefined> = {};

    const { code, keys } = await script({ dir, argv: ['--drop-entered'], env, envPath });

    expect(code).toBe(0);
    expect(keys).toEqual([]);
    expect(env).toEqual({});
  });

  it('works when a fixture file is broken: only the two cache files are read', async () => {
    const dir = dirWithEnteredHomes();
    fs.writeFileSync(path.join(dir, 'demoStory.json'), '{ "featuredEmployees": [');
    fs.rmSync(path.join(dir, 'businesses.json'));

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(0);
    expect(lines[0]).toMatch(/^Dropped 2 entered homes /);
    expect(cacheOf(dir)).toEqual(complete);
  });

  it('a second run finds nothing: one line, exit 0, nothing written', async () => {
    const dir = dirWithEnteredHomes();
    await script({ dir, argv: ['--drop-entered'] });
    const before = snapshot(dir);

    const again = await script({ dir, argv: ['--drop-entered'] });

    expect(again.code).toBe(0);
    expect(again.lines).toHaveLength(1);
    expect(snapshot(dir)).toEqual(before);
  });

  it('drops leftovers too: a pair and a route line of an entered home whose places entry is gone', async () => {
    const dir = tempDirWithCacheOf(seed);
    const files = structuredClone(complete);
    const [first, second] = ENTERED_HOME_IDS;
    files.matrix.pairs[`${first}|${BUSINESS_IDS[0]}`] = { durationS: 700, distanceM: 5000 };
    files.polylines.polylines[`${BUSINESS_IDS[1]}|${second}`] = 'line:leftover';
    writeTravelFiles(dir, files);

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(0);
    expect(lines[0]).toBe('Dropped 2 entered homes (addresses typed into the commute editor): 0 places, 1 pair, 1 route line.');
    expect(snapshot(dir)).toEqual(snapshot(seed));
    noIds(lines);
  });
});

describe('runFetchScript --drop-entered: nothing to drop', () => {
  it('prints one line, leaves both files byte-identical and exits 0', async () => {
    const dir = tempDirWithCacheOf(seed);
    const before = snapshot(dir);
    const mtimes = () => [MATRIX_FILE, POLYLINES_FILE].map((name) => fs.statSync(path.join(dir, name)).mtimeMs);
    const written = mtimes();

    const { code, lines, keys, calls } = await script({ dir, argv: ['--drop-entered'], env: {} });

    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Entered homes: none in the travel cache \(.+\)\. Nothing was dropped or written\.$/);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    expect(mtimes()).toEqual(written);
  });

  it('does not rewrite a cache that is not in the saved byte format', async () => {
    // Hand-formatted JSON: a save would reformat it, so "nothing to drop" must not save.
    const dir = tempDirWithCacheOf(seed);
    fs.writeFileSync(path.join(dir, MATRIX_FILE), JSON.stringify(complete.matrix));
    fs.writeFileSync(path.join(dir, POLYLINES_FILE), JSON.stringify(complete.polylines));
    const before = snapshot(dir);
    expect(before[MATRIX_FILE]).not.toBe(serializeTravelFiles(complete).matrix);

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(snapshot(dir)).toEqual(before);
  });

  it('no cache at all: one line, exit 0, and no cache file is created', async () => {
    const dir = tempFixturesDir();
    const before = snapshot(dir);

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Entered homes: none\. There is no travel cache in /);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('runFetchScript --drop-entered: a cache it cannot use', () => {
  it('a matrix.json that cannot be read: exits 1, changes nothing, and the message holds no entered-home ID', async () => {
    const dir = dirWithEnteredHomes();
    const file = path.join(dir, MATRIX_FILE);
    const matrix = JSON.parse(fs.readFileSync(file, 'utf8'));
    matrix.places[ENTERED_HOME_IDS[0]].lat = 'not a number'; // the reader's error quotes this place's ID
    fs.writeFileSync(file, JSON.stringify(matrix));
    const before = snapshot(dir);

    const { code, lines, calls } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(1);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Cannot start: Travel cache .*matrix\.json: place "home-c \(entered address\)" needs a numeric lat and lng Nothing was dropped or written\.$/);
    noIds(lines);
    expect(snapshot(dir)).toEqual(before);
  });

  it('route lines without a matrix: exits 1 and says why, instead of reporting "none"', async () => {
    const dir = tempFixturesDir();
    fs.writeFileSync(path.join(dir, POLYLINES_FILE), `{ "schemaVersion": 1, "polylines": { "${ENTERED_HOME_IDS[0]}|biz-etsy": "line" } }\n`);
    const before = snapshot(dir);

    const { code, lines } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`${POLYLINES_FILE} exists but ${MATRIX_FILE} does not`);
    expect(lines[0]).toContain('Nothing was dropped or written.');
    noIds(lines);
    expect(snapshot(dir)).toEqual(before);
  });

  it('a save that fails: exits 1, says to run the same command again, and prints no ID', async () => {
    const dir = dirWithEnteredHomes();
    // writeTravelFiles writes `<file>.<pid>.tmp` first; a folder with that name makes the write fail before any rename.
    fs.mkdirSync(path.join(dir, `${MATRIX_FILE}.${process.pid}.tmp`));
    const before = snapshot(dir);

    const { code, lines, calls } = await script({ dir, argv: ['--drop-entered'] });

    expect(code).toBe(1);
    expect(totalCalls(calls)).toBe(0);
    expect(lines[0]).toMatch(/^Stopped: /);
    expect(lines.join('\n')).not.toContain('Dropped');
    expect(lines.at(-1)).toBe('The drop may be half saved: fix the problem above, then run the same command again.');
    noIds(lines);
    // The save writes every temp file before the first rename, so nothing was replaced.
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('runFetchScript --drop-entered --dry-run', () => {
  it('prints what a drop would remove, writes nothing and exits 0', async () => {
    const dir = dirWithEnteredHomes();
    const before = snapshot(dir);

    const { code, lines, keys, calls } = await script({ dir, argv: ['--drop-entered', '--dry-run'], env: {} });

    expect(code).toBe(0);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(formatEnteredDrop(dropEnteredHomes(cacheOf(dir)), 'Would drop'));
    expect(lines[1]).toMatch(/Nothing was written\. Cache folder: /);
    noIds(lines);
    expect(snapshot(dir)).toEqual(before);
  });
});

describe('runFetchScript --dry-run: the entered homes line', () => {
  const isEnteredLine = (line: string) => line.startsWith('Entered homes: ');

  it('prints one line with their number, the free command and what happens to a saved run, and no ID', async () => {
    const dir = dirWithEnteredHomes();
    const before = snapshot(dir);

    const { code, lines, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

    expect(code).toBe(0);
    expect(totalCalls(calls)).toBe(0);
    const entered = lines.filter(isEnteredLine);
    expect(entered).toHaveLength(1);
    expect(entered[0]).toMatch(/^Entered homes: 2 \(addresses typed into the commute editor; /);
    expect(entered[0]).toContain(DROP_ENTERED_COMMAND);
    expect(entered[0]).toContain('A saved NYC run that uses one of them starts fresh after the drop');
    expect(entered[0].endsWith(DROP_ENTERED_RUN_NOTE)).toBe(true);
    noIds(lines);
    expect(snapshot(dir)).toEqual(before);
    // The estimate is the one of the cache without them: the default scenario needs no entered home.
    expect(lines).toContain('  Google requests: 0');
  });

  it('uses the singular for one home', async () => {
    const dir = tempDirWithCacheOf(seed);
    const files = structuredClone(complete);
    files.matrix.places[ENTERED_HOME_IDS[1]] = { lat: 40.8, lng: -73.95 };
    writeTravelFiles(dir, files);

    const { lines } = await script({ dir, argv: ['--dry-run'], env: {} });

    const entered = lines.filter(isEnteredLine);
    expect(entered).toHaveLength(1);
    expect(entered[0]).toMatch(/^Entered homes: 1 \(an address typed into the commute editor; its ID holds its coordinates, so do not commit the cache with it\)\. /);
    noIds(lines);
  });

  it('prints no such line when the cache holds none', async () => {
    const dir = tempDirWithCacheOf(seed);
    const { code, lines } = await script({ dir, argv: ['--dry-run'], env: {} });

    expect(code).toBe(0);
    expect(lines.filter(isEnteredLine)).toEqual([]);
    expect(lines.join('\n')).not.toContain('--drop-entered');
  });
});

describe('runFetchScript --drop-entered: the command line', () => {
  it.each([
    [['--drop-entered', '--check-key'], '--drop-entered cannot be used with --check-key: the drop makes no Google call, and the check is three of them.'],
    [['--check-key', '--drop-entered'], '--drop-entered cannot be used with --check-key: the drop makes no Google call, and the check is three of them.'],
    [
      ['--drop-entered', '--refetch', 'biz-etsy'],
      '--drop-entered cannot be used with --refetch: the drop makes no Google call, and --refetch fetches from Google. Run them one after the other.',
    ],
    [
      ['--refetch=home-001', '--drop-entered', '--dry-run'],
      '--drop-entered cannot be used with --refetch: the drop makes no Google call, and --refetch fetches from Google. Run them one after the other.',
    ],
    [['--drop-entered=yes'], '--drop-entered takes no value.'],
    [['--help', '--drop-entered'], '--help is used alone.'],
    [['--drop-entred'], 'Unknown flag --drop-entred.'],
  ])('%j: exits 2 with the problem and the usage text, and nothing is read, called or written', async (argv, problem) => {
    const dir = dirWithEnteredHomes();
    const before = snapshot(dir);

    const { code, lines, keys, calls } = await script({ dir, argv });

    expect(code).toBe(2);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toEqual([problem, '', ...USAGE]);
    expect(snapshot(dir)).toEqual(before);
  });

  it('parseArgs: --drop-entered alone is the drop, may be repeated and may have --dry-run', () => {
    const drop = { ok: true, options: { dryRun: false, help: false, refetch: [], checkKey: false, dropEntered: true } };
    expect(parseArgs(['--drop-entered'])).toEqual(drop);
    expect(parseArgs(['--drop-entered', '--drop-entered'])).toEqual(drop);
    expect(parseArgs(['--dry-run', '--drop-entered'])).toEqual({ ok: true, options: { ...drop.options, dryRun: true } });
    expect(parseArgs([])).toEqual({ ok: true, options: { ...drop.options, dropEntered: false } });
  });

  it('the usage text lists the flag: what it removes, that it is free, what it prints and what it cannot be combined with', () => {
    const usage = USAGE.join('\n');
    expect(usage).toContain(`${DROP_ENTERED_COMMAND} [--dry-run]`);
    expect(usage).toContain('  --drop-entered');
    expect(usage).toContain('place IDs that start with home-c-');
    expect(usage).toMatch(/needs no key, reads no\s+\.env and makes no Google call/);
    expect(usage).toMatch(/never an\s+ID/);
    expect(usage).toMatch(/starts fresh afterwards/);
    expect(usage).toContain('Not with --refetch or --check-key.');
    for (const line of USAGE) expect(line.length, line).toBeLessThanOrEqual(120);
  });
});

describe('npm run fetch:routes -- --drop-entered: the real script file', () => {
  // The root tsconfig does not typecheck scripts/, so these start the file itself. The child gets no key.
  // `--dry-run` keeps it from ever writing to the real fixtures/nyc, whatever a developer's copy holds.
  const env = { ...process.env };
  delete env.GOOGLE_MAPS_SERVER_KEY;
  const start = (...flags: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'scripts/fetch-routes.ts', ...flags], { cwd: repoRoot, env, encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS });

  it(
    'passes the flag through: exit 0 with --dry-run and nothing changed in fixtures/nyc, exit 2 with --check-key',
    () => {
      const dir = path.join(repoRoot, 'fixtures/nyc');
      const before = snapshot(dir);

      const dry = start('--drop-entered', '--dry-run');

      expect(dry.stderr).toBe('');
      expect(dry.status).toBe(0);
      expect(dry.stdout).toMatch(/^(Entered homes: none in the travel cache \(fixtures\/nyc\)\. Nothing was dropped or written\.|Would drop \d+ entered homes? )/);
      expect(dry.stdout).not.toMatch(ENTERED_ID_PATTERN);
      expect(snapshot(dir)).toEqual(before);

      const wrong = start('--drop-entered', '--check-key');
      expect(wrong.status).toBe(2);
      expect(wrong.stdout).toContain('--drop-entered cannot be used with --check-key');
    },
    PROCESS_TIMEOUT_MS * 2,
  );
});
