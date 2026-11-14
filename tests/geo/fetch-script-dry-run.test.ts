// runFetchScript --dry-run (server/geo/fetchScript.ts): the free estimate. It must call nothing, write nothing
// and need no key. Temp folders with copies of the three real fixtures/nyc files; no network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, emptyTravelFiles, readTravelFiles } from '../../server/geo/cache';
import { estimateFetch, formatEstimate } from '../../server/geo/fetchRoutes';
import { KEY, input, totalCalls } from './fetch-routes-helpers';
import { fixturesOnly, leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempFixturesDir } from './fetch-script-helpers';

// The estimate runs the matcher when the matrix is complete; locally well under 2 s.
const RUN_TIMEOUT_MS = 30_000;
const NO_KEY = 'Key: GOOGLE_MAPS_SERVER_KEY was not found. A run without --dry-run needs it in .env at the repo root.';
const KEY_FOUND = 'Key: GOOGLE_MAPS_SERVER_KEY was found (it is never printed).';

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(20);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript --dry-run on an empty cache', () => {
  it('prints the estimate, makes no call, writes nothing and exits 0, with no key and no .env', async () => {
    const dir = tempFixturesDir();
    const { code, lines, keys, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

    expect(code).toBe(0);
    expect(keys).toEqual([]);
    expect(totalCalls(calls)).toBe(0);
    expect(snapshot(dir)).toEqual(fixturesOnly());

    const estimate = formatEstimate(estimateFetch(input(emptyTravelFiles())));
    expect(lines.slice(0, estimate.length)).toEqual(estimate);
    expect(lines).toContain('  businesses to geocode: 18 of 18');
    expect(lines).toContain(NO_KEY);
    expect(lines.at(-1)).toMatch(/^Nothing was written\./);
  });

  it('says that a key was found, in the environment or in .env, and never shows it', async () => {
    const dir = tempFixturesDir();
    const inEnvironment = await script({ dir, argv: ['--dry-run'] });
    expect(inEnvironment.lines).toContain(KEY_FOUND);

    const envPath = path.join(dir, 'test.env');
    fs.writeFileSync(envPath, `# test file\nGOOGLE_MAPS_SERVER_KEY="${KEY}"\n`);
    const before = snapshot(dir);
    const inFile = await script({ dir, argv: ['--dry-run'], env: {}, envPath });

    expect(inFile.lines).toContain(KEY_FOUND);
    expect(inFile.code).toBe(0);
    expect(inFile.keys).toEqual([]);
    expect(totalCalls(inFile.calls)).toBe(0);
    expect(snapshot(dir)).toEqual(before);
    for (const line of [...inEnvironment.lines, ...inFile.lines]) expect(line).not.toContain(KEY.slice(0, 8));
  });
});

describe('runFetchScript --dry-run on a half-fetched and on a finished cache', () => {
  let dir: string;

  beforeAll(async () => {
    dir = tempFixturesDir();
    const run = await script({ dir });
    expect(run.code).toBe(0);
  }, RUN_TIMEOUT_MS);

  it(
    'on a finished cache: nothing to fetch, no call, byte-identical files, exit 0 without a key',
    async () => {
      const before = snapshot(dir);
      const { code, lines, keys, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

      expect(code).toBe(0);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines).toContain('  Google requests: 0');
      expect(lines).toContain('  Nothing to fetch: the cache has everything the default scenario needs.');
      expect(lines).toContain(NO_KEY);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'on a cache that lost its route lines: counts exactly those, and still writes nothing',
    async () => {
      const half = tempFixturesDir();
      fs.copyFileSync(path.join(dir, MATRIX_FILE), path.join(half, MATRIX_FILE));
      const before = snapshot(half);
      const wanted = Object.keys(readTravelFiles(dir)!.polylines.polylines).length;

      const { code, lines, calls } = await script({ dir: half, argv: ['--dry-run'], env: {} });

      expect(code).toBe(0);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(half)).toEqual(before);
      expect(fs.existsSync(path.join(half, POLYLINES_FILE))).toBe(false);
      expect(lines).toContain('  businesses to geocode: 0 of 18');
      expect(lines).toContain(`  Google requests: ${wanted}`);
    },
    RUN_TIMEOUT_MS,
  );
});
