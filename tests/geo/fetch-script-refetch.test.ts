// runFetchScript --refetch <placeId> (server/geo/fetchScript.ts): drop a place with all its pairs and route lines,
// save that before the first Google call, then fetch only what is missing. Also the unknown ID and the usage errors.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { dropPlaces, formatCacheEdit } from '../../server/geo/cacheEdit';
import { estimateFetch, formatEstimate } from '../../server/geo/fetchRoutes';
import { RESUME_LINE, RESUME_WITHOUT_REFETCH_LINE, USAGE, parseArgs } from '../../server/geo/fetchScript';
import { HOME_IDS, KEY, businessesFile, input, matrixPairsRequested, neededPairs, storyFile, totalCalls } from './fetch-routes-helpers';
import {
  cityClient,
  fixturesOnly,
  leakedLines,
  printedLineCount,
  removeTempDirs,
  script,
  snapshot,
  tempDirWithCacheOf,
  tempFixturesDir,
} from './fetch-script-helpers';

// A whole run with the fake client takes about 20 ms locally (matcher and both reports included).
const TEST_TIMEOUT_MS = 10_000;

// One business and one home. The home is a featured employee's, so it has commute route lines; it does not
// commute to this business, so the two pairs between them are the "pair between two dropped places".
const BUSINESS = 'biz-etsy';
const HOME = storyFile.featuredEmployees.find((employee) => employee.businessId !== BUSINESS)!.home.id;
const DROPPED = [BUSINESS, HOME];
const BUSINESS_ADDRESS = businessesFile.businesses.find((business) => business.id === BUSINESS)!.address;

const touches = (key: string, ids: readonly string[]) => key.split('|').some((id) => ids.includes(id));
const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json');
  return files;
};
const indexOfLine = (lines: string[], start: string) => lines.findIndex((line) => line.startsWith(start));

/** A folder a complete run was made on. Never changed after `beforeAll`; every test works on a copy. */
let seed: string;
let complete: TravelFiles;

beforeAll(async () => {
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
  complete = cacheOf(seed);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript --refetch: one business and one home', () => {
  let dir: string;
  let run: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    run = await script({ dir, argv: ['--refetch', BUSINESS, '--refetch', HOME] });
  }, TEST_TIMEOUT_MS);

  it(
    'prints what was dropped (formatCacheEdit) before the first step of the fetch',
    () => {
      const edit = dropPlaces(complete, DROPPED);
      expect(edit.dropped).toEqual(DROPPED);
      expect(edit.removed.places).toBe(2);
      // The business with 17 businesses and every home, the home with 18 businesses; their own two pairs once.
      expect(edit.removed.pairs).toBe(2 * 17 + 2 * HOME_IDS.length + 2 * 18 - 2);
      expect(edit.removed.polylines).toBeGreaterThanOrEqual(4);

      expect(run.lines.slice(0, 3)).toEqual([...formatCacheEdit(edit), expect.stringMatching(/^The drop is saved in /), '']);
      expect(run.lines[0]).toMatch(/^Dropped biz-etsy, home-story-[a-z0-9-]+: 2 places, \d+ pairs, \d+ route lines\./);
      expect(run.lines[3]).toBe('Step 1/4 geocode: 1 of 18 businesses have no coordinates yet');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'geocodes only the dropped business',
    () => {
      expect(run.calls.geocode).toEqual([BUSINESS_ADDRESS]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'requests exactly the matrix pairs of the two dropped places, each once',
    () => {
      const requested = matrixPairsRequested(run.calls);
      expect(new Set(requested).size).toBe(requested.length);
      expect([...requested].sort()).toEqual(neededPairs().filter((key) => touches(key, DROPPED)).sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'requests exactly the route lines that went with them, each once',
    () => {
      const lines = Object.keys(complete.polylines.polylines);
      const wanted = lines.filter((key) => touches(key, DROPPED)).sort();
      expect(wanted.some((key) => touches(key, [BUSINESS]))).toBe(true);
      expect(wanted.some((key) => touches(key, [HOME]))).toBe(true);
      expect(wanted.length).toBeLessThan(lines.length);
      expect([...run.calls.polyline].sort()).toEqual(wanted);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ends complete with exit 0 and the cache it started from, byte for byte',
    () => {
      expect(run.lines.at(-1)).toMatch(/^Done: the cache is complete and no error is flagged\./);
      expect(run.code).toBe(0);
      expect(run.keys).toEqual([KEY]);
      expect(snapshot(dir)).toEqual(snapshot(seed));
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --refetch=a,b: the drop is on disk before the first Google request', () => {
  let dir: string;
  let run: Awaited<ReturnType<typeof script>>;
  let onDiskAtFirstRequest: TravelFiles | undefined;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    // Google is down: every request fails, and the first one looks at what is on disk at that moment.
    const down = (): never => {
      onDiskAtFirstRequest ??= cacheOf(dir);
      throw new Error(`fetch failed for key ${KEY}`);
    };
    run = await script({ dir, argv: [`--refetch=${BUSINESS},${HOME}`], google: cityClient({ geocode: down, matrix: down, polyline: down }) });
  }, TEST_TIMEOUT_MS);

  it(
    'had saved the cache without the two places when the first request was made',
    () => {
      expect(totalCalls(run.calls)).toBeGreaterThan(0);
      expect(onDiskAtFirstRequest).toEqual(dropPlaces(complete, DROPPED).files);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'exits 1 with a consistent cache: no pair and no route line of the two places is left, nothing else is lost',
    () => {
      expect(run.code).toBe(1);
      const { matrix, polylines } = cacheOf(dir);
      expect(Object.keys(matrix.pairs).filter((key) => touches(key, DROPPED))).toEqual([]);
      expect(Object.keys(polylines.polylines).filter((key) => touches(key, DROPPED))).toEqual([]);
      expect(matrix.places[BUSINESS]).toBeUndefined();
      // The matrix step notes the point it is about to ask for before it asks, so the home is back as a place,
      // on the fixtures' point and with no pair: exactly what a plain run fills in.
      const home = storyFile.featuredEmployees.find((employee) => employee.home.id === HOME)!.home;
      expect(matrix.places[HOME]).toEqual({ lat: home.lat, lng: home.lng });
      const expected = dropPlaces(complete, DROPPED).files;
      expect(matrix.pairs).toEqual(expected.matrix.pairs);
      expect(polylines).toEqual(expected.polylines);
      expect(matrix.places).toEqual({ ...expected.matrix.places, [HOME]: { lat: home.lat, lng: home.lng } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ends with the resume line, after saying that the next run needs no --refetch',
    () => {
      expect(run.lines.slice(-2)).toEqual([RESUME_WITHOUT_REFETCH_LINE, RESUME_LINE]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the same --refetch again: the business is no longer in the cache, so exit 1 and nothing changes',
    async () => {
      const before = snapshot(dir);
      const again = await script({ dir, argv: [`--refetch=${BUSINESS},${HOME}`] });
      expect(again.code).toBe(1);
      expect(totalCalls(again.calls)).toBe(0);
      expect(again.lines).toHaveLength(2);
      expect(again.lines[0]).toBe(`Not in the travel cache: ${BUSINESS}. Nothing was dropped for it.`);
      expect(again.lines[1]).toContain('a run without it fetches whatever is missing');
      expect(snapshot(dir)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '"Run again to resume." is true: a plain run refills the two places and exits 0',
    async () => {
      const next = await script({ dir });
      expect(next.calls.geocode).toEqual([BUSINESS_ADDRESS]);
      expect([...matrixPairsRequested(next.calls)].sort()).toEqual(neededPairs().filter((key) => touches(key, DROPPED)).sort());
      expect(next.code).toBe(0);
      expect(snapshot(dir)).toEqual(snapshot(seed));
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --refetch: a place ID that is not in the cache', () => {
  it.each([
    ['an ID nobody has', ['--refetch', 'biz-nope'], ['biz-nope']],
    ['the start of a real ID', ['--refetch', 'home-00'], ['home-00']],
    ['a real one and a wrong one together', [`--refetch=${BUSINESS},biz-nope`], ['biz-nope']],
    ['in a dry run', ['--dry-run', '--refetch', 'biz-nope', '--refetch', HOME], ['biz-nope']],
  ])(
    '%s: is reported, changes nothing, makes no call and exits 1',
    async (_name, argv, unknown) => {
      const dir = tempDirWithCacheOf(seed);
      const before = snapshot(dir);

      const { code, lines, keys, calls } = await script({ dir, argv });

      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toHaveLength(unknown.length + 1);
      expect(lines.slice(0, -1)).toEqual(unknown.map((id) => `Not in the travel cache: ${id}. Nothing was dropped for it.`));
      expect(lines.at(-1)).toMatch(/^Nothing was dropped or written, and no Google call was made\./);
      expect(lines.join('\n')).not.toContain('Dropped');
      expect(snapshot(dir)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'on a folder with no cache at all: exit 1, and no cache file appears',
    async () => {
      const dir = tempFixturesDir();
      const { code, calls } = await script({ dir, argv: ['--refetch', BUSINESS] });
      expect(code).toBe(1);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(fixturesOnly());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'does not repeat a key that was pasted where the place ID goes',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      const { code, lines } = await script({ dir, argv: ['--refetch', KEY] });
      expect(code).toBe(1);
      expect(lines[0]).toBe('Not in the travel cache: [redacted]. Nothing was dropped for it.');
      expect(lines.join('\n')).not.toContain(KEY);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --refetch: what stops it before the drop', () => {
  it(
    'no key: one line naming the variable, nothing dropped, no call',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      const before = snapshot(dir);
      const { code, lines, keys, calls } = await script({ dir, argv: ['--refetch', BUSINESS], env: {} });
      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('GOOGLE_MAPS_SERVER_KEY is not set');
      expect(snapshot(dir)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a drop that cannot be saved: no client is built, no call is made, both cache files are as they were',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      // writeTravelFiles writes `<file>.<pid>.tmp` first; a folder with that name makes the write fail.
      fs.mkdirSync(path.join(dir, `${MATRIX_FILE}.${process.pid}.tmp`));
      const before = snapshot(dir);

      const { code, lines, keys, calls } = await script({ dir, argv: ['--refetch', BUSINESS] });

      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines[0]).toMatch(/^Stopped: /);
      expect(lines.at(-1)).toContain('No Google call was made.');
      expect(lines.at(-1)).toContain('run the same command again, with --refetch');
      expect(lines.join('\n')).not.toContain('Dropped');
      expect(snapshot(dir)[MATRIX_FILE]).toBe(before[MATRIX_FILE]);
      expect(snapshot(dir)[POLYLINES_FILE]).toBe(before[POLYLINES_FILE]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --dry-run --refetch', () => {
  it(
    'shows the estimate as it would be after the drop, needs no key, calls nothing and writes nothing',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      const before = snapshot(dir);
      const edit = dropPlaces(complete, DROPPED);

      const { code, lines, keys, calls } = await script({ dir, argv: ['--dry-run', '--refetch', HOME, '--refetch', BUSINESS], env: {} });

      expect(code).toBe(0);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);

      expect(lines[0]).toBe('--refetch in a dry run: nothing is dropped. A run would first drop and report:');
      expect(lines.slice(1, 1 + formatCacheEdit(edit).length)).toEqual(formatCacheEdit(edit).map((line) => `  ${line}`));
      const estimate = formatEstimate(estimateFetch(input(edit.files)));
      const start = indexOfLine(lines, 'Fetch estimate');
      expect(lines.slice(start, start + estimate.length)).toEqual(estimate);
      expect(lines).toContain('  businesses to geocode: 1 of 18');
      expect(lines.some((line) => line.startsWith(`  matrix pairs to fetch: ${edit.removed.pairs} in `))).toBe(true);
      expect(lines).toContain('Moved homes: none (every cached home is where the fixtures put it).');
      expect(lines.at(-1)).toMatch(/^Nothing was written\./);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --refetch: the command line', () => {
  it.each([
    [['--refetch'], '--refetch needs a value.'],
    [['--refetch='], '--refetch needs a value.'],
    [['--refetch', '--dry-run'], '--refetch needs a value.'],
    [['--dry-run', '--refetch'], '--refetch needs a value.'],
    [['--refetch=biz-etsy,,home-001'], '--refetch needs a value.'],
    [['--refetch', 'biz-etsy,'], '--refetch needs a value.'],
    [['--refetch', 'biz-etsy', 'home-001'], 'Unexpected argument: this command takes only flags.'],
    [['--help', '--refetch', 'biz-etsy'], '--help is used alone.'],
  ])(
    '%j: exits 2 with the problem and the usage text, before anything is read',
    async (argv, problem) => {
      const missing = path.join(tempFixturesDir(), 'no-such-folder');
      const { code, lines, keys, calls } = await script({ dir: missing, argv });

      expect(code).toBe(2);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toEqual([problem, '', ...USAGE]);
      expect(fs.existsSync(missing)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'parseArgs: repeated, with = and with commas, each ID once in the order given',
    () => {
      expect(parseArgs(['--refetch', 'biz-etsy'])).toEqual({ ok: true, options: { dryRun: false, help: false, refetch: ['biz-etsy'], checkKey: false } });
      expect(parseArgs(['--refetch', 'b', '--dry-run', '--refetch=a,c', '--refetch', 'b , d'])).toEqual({
        ok: true,
        options: { dryRun: true, help: false, refetch: ['b', 'a', 'c', 'd'], checkKey: false },
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the usage text explains --refetch and that a run never drops a place by itself',
    () => {
      const usage = USAGE.join('\n');
      expect(usage).toContain('--refetch <placeId>');
      expect(usage).toContain('--refetch=a,b');
      expect(usage).toContain('A run never drops a place by itself.');
    },
    TEST_TIMEOUT_MS,
  );
});
