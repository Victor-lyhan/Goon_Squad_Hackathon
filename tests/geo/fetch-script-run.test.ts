// runFetchScript (server/geo/fetchScript.ts): real runs on a temp folder holding copies of the three real
// fixtures/nyc files, with a fake Google client. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import { CHECK_LINE, RESUME_LINE } from '../../server/geo/fetchScript';
import { BUSINESS_IDS, KEY, KEY_ENCODED, fakeClient, neededPairs, storyFile, totalCalls } from './fetch-routes-helpers';
import {
  CITY_POINTS,
  FIXTURE_NAMES,
  cityClient,
  cityTravel,
  fixturesOnly,
  leakedLines,
  printedLineCount,
  removeTempDirs,
  script,
  snapshot,
  tempFixturesDir,
} from './fetch-script-helpers';

// A whole fetch runs the matcher on 60 employees and 24 packages; locally a run takes well under 2 s.
const RUN_TIMEOUT_MS = 30_000;

const cacheOf = (dir: string) => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json was written');
  return files;
};
const businessPlaces = (dir: string) => Object.keys(cacheOf(dir).matrix.places).filter((id) => id.startsWith('biz-'));
const indexOfLine = (lines: string[], start: string) => lines.findIndex((line) => line.startsWith(start));

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript: a first run on an empty cache, then a second run', () => {
  let dir: string;
  let first: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempFixturesDir();
    first = await script({ dir });
  }, RUN_TIMEOUT_MS);

  it('exits 0', () => {
    expect(first.lines.at(-1)).toMatch(/^Done: the cache is complete and no error is flagged\./);
    expect(first.code).toBe(0);
  });

  it('writes both cache files and nothing else', () => {
    expect(Object.keys(snapshot(dir))).toEqual([...FIXTURE_NAMES, MATRIX_FILE, POLYLINES_FILE].sort());
    for (const [name, bytes] of Object.entries(fixturesOnly())) expect(snapshot(dir)[name]).toBe(bytes);

    const { matrix, polylines } = cacheOf(dir);
    expect(businessPlaces(dir).sort()).toEqual([...BUSINESS_IDS].sort());
    for (const id of BUSINESS_IDS) expect(matrix.places[id]).toMatchObject(CITY_POINTS[id]);
    expect(Object.keys(matrix.pairs).sort()).toEqual(neededPairs().sort());
    expect(matrix.pairs['biz-etsy|biz-sweetleaf']).toEqual(cityTravel('biz-etsy', 'biz-sweetleaf'));
    expect(Object.keys(polylines.polylines).length).toBe(first.calls.polyline.length);
    expect(first.calls.polyline.length).toBeGreaterThanOrEqual(120);
  });

  it('builds one client, from the key in the environment', () => {
    expect(first.keys).toEqual([KEY]);
    expect(first.calls.geocode).toHaveLength(18);
  });

  it('prints the progress, then the summary, the skipped steps, the plan check and the cache report, in that order', () => {
    const { lines } = first;
    const order = ['Step 1/4 geocode', 'Step 4/4 route lines', 'Fetch summary', 'Skipped steps: none', 'Plan check', 'Travel cache report', 'Done:'].map(
      (start) => indexOfLine(lines, start),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(lines).toContain('  failures: none');
  });

  it('prints one plan-check row per story package, all OK, with the label and what was expected', () => {
    const rows = first.lines.filter((line) => /^ {2}(OK|FAIL) shp-/.test(line));
    expect(rows).toHaveLength(storyFile.shipments.length);
    expect(rows.every((row) => row.startsWith('  OK '))).toBe(true);
    expect(rows[0]).toBe(`  OK shp-1 ${storyFile.shipments[0].label}: expected direct, got direct`);
    expect(rows[3]).toBe(`  OK shp-4 ${storyFile.shipments[3].label}: expected relay, got relay`);
    expect(first.lines).toContain('  24 plans checked, 0 problems');
  });

  it('exits 0 on warnings alone: only an error in the cache report fails a run', () => {
    expect(first.lines).toContain('Errors: none');
    expect(indexOfLine(first.lines, 'Warnings (')).toBeGreaterThan(0);
    expect(first.lines.some((line) => line.startsWith('  [asymmetric] '))).toBe(true);
  });

  it(
    'a second run makes no client call, leaves the files byte-identical and exits 0',
    async () => {
      const before = snapshot(dir);
      const modified = [MATRIX_FILE, POLYLINES_FILE].map((name) => fs.statSync(path.join(dir, name)).mtimeMs);

      const second = await script({ dir });

      expect(totalCalls(second.calls)).toBe(0);
      expect(second.code).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect([MATRIX_FILE, POLYLINES_FILE].map((name) => fs.statSync(path.join(dir, name)).mtimeMs)).toEqual(modified);
      expect(second.lines).toContain('  Google requests: 0');
      expect(second.lines.at(-1)).toMatch(/^Done:/);
    },
    RUN_TIMEOUT_MS,
  );
});

describe('runFetchScript: a run where one matrix request fails, then the next run', () => {
  let dir: string;
  let failed: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempFixturesDir();
    let requests = 0;
    failed = await script({
      dir,
      google: cityClient({
        matrix: () => {
          // The key in every form a careless client could put in an error.
          if (++requests === 3) throw new Error(`fetch failed: https://routes.example/v2?key=${KEY_ENCODED} for ${KEY} / ${KEY_ENCODED}`);
          return undefined;
        },
      }),
    });
  }, RUN_TIMEOUT_MS);

  it('exits 1 and ends with the resume line', () => {
    expect(failed.code).toBe(1);
    expect(failed.lines.at(-1)).toBe(RESUME_LINE);
    expect(failed.lines).toContain('NOT complete:');
  });

  it('keeps the geocodes and the pairs of the other requests on disk', () => {
    expect(businessPlaces(dir)).toHaveLength(18);
    const pairs = Object.keys(cacheOf(dir).matrix.pairs).length;
    expect(pairs).toBeGreaterThan(0);
    expect(pairs).toBeLessThan(neededPairs().length);
    expect(fs.existsSync(path.join(dir, POLYLINES_FILE))).toBe(true);
  });

  it('lists the failed request and both skipped steps, and does not run the plan check', () => {
    const { lines } = failed;
    expect(lines).toContain('  failures: 1');
    expect(lines.some((line) => line.startsWith('    - matrix request, ') && line.includes('[redacted]'))).toBe(true);
    expect(lines).toContain('Skipped steps: 2');
    expect(lines.some((line) => line.startsWith('  - default scenario and matcher: the matrix lacks '))).toBe(true);
    expect(lines.some((line) => line.startsWith('  - route lines: '))).toBe(true);
    expect(lines).toContain('Plan check: not run, because the matcher was not run.');
    expect(indexOfLine(lines, 'Travel cache report')).toBeGreaterThan(indexOfLine(lines, 'Plan check'));
    expect(failed.calls.polyline).toHaveLength(0);
  });

  it(
    'the next run fetches only what is missing, finishes and exits 0',
    async () => {
      const next = await script({ dir });
      expect(next.calls.geocode).toHaveLength(0);
      expect(next.calls.matrix).toHaveLength(1);
      expect(next.calls.polyline.length).toBeGreaterThanOrEqual(120);
      expect(Object.keys(cacheOf(dir).matrix.pairs).sort()).toEqual(neededPairs().sort());
      expect(next.lines.at(-1)).toMatch(/^Done:/);
      expect(next.code).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );
});

describe('runFetchScript: a run that fetches everything but gets flagged', () => {
  // The plain fake client: all 18 businesses within a few meters of each other. Every request succeeds, but the
  // cache report finds businesses on the same point and the story's relay packages match as direct ones.
  let dir: string;
  let flagged: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempFixturesDir();
    flagged = await script({ dir, google: fakeClient() });
  }, RUN_TIMEOUT_MS);

  it('exits 1 and ends with the check line, not the resume line', () => {
    expect(flagged.lines).toContain('  failures: none');
    expect(flagged.lines).toContain('Skipped steps: none');
    expect(flagged.code).toBe(1);
    expect(flagged.lines.at(-1)).toBe(CHECK_LINE);
  });

  it('says what was flagged: the story rows and the cache report errors', () => {
    const { lines } = flagged;
    expect(lines).toContain(`  FAIL shp-4 ${storyFile.shipments[3].label}: expected relay, got direct`);
    expect(lines.some((line) => line.startsWith('  [same-point] '))).toBe(true);
    expect(lines).toContain(`  - 3 story packages did not match as written in demoStory.json`);
    expect(lines.some((line) => /^ {2}- the travel cache report has \d+ errors$/.test(line))).toBe(true);
  });

  it('still saves everything it fetched', () => {
    const { matrix, polylines } = cacheOf(dir);
    expect(Object.keys(matrix.pairs).sort()).toEqual(neededPairs().sort());
    expect(Object.keys(polylines.polylines).length).toBe(flagged.calls.polyline.length);
  });
});

describe('runFetchScript: a step that cannot be saved', () => {
  it(
    'stops before the next paid step and exits 1',
    async () => {
      const dir = tempFixturesDir();
      // writeTravelFiles writes `<file>.<pid>.tmp` first; a folder with that name makes the write fail.
      fs.mkdirSync(path.join(dir, `${MATRIX_FILE}.${process.pid}.tmp`));

      const { code, lines, calls } = await script({ dir });

      expect(code).toBe(1);
      expect(calls.geocode).toHaveLength(18);
      expect(calls.matrix).toHaveLength(0);
      expect(calls.polyline).toHaveLength(0);
      expect(lines.some((line) => line.startsWith('Stopped: '))).toBe(true);
      expect(lines.at(-1)).toBe(RESUME_LINE);
      expect(fs.existsSync(path.join(dir, MATRIX_FILE))).toBe(false);
    },
    RUN_TIMEOUT_MS,
  );
});
