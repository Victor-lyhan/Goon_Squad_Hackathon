// runFetchScript and homes that moved after the fetch (server/geo/fetchScript.ts): --dry-run lists every home whose
// cached point differs from the fixtures and prints the command that fixes it; a plain run prints the same, drops
// nothing, calls nothing and exits 1; --refetch drops them and fetches only their pairs and route lines again.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MATRIX_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { straightLineM } from '../../server/geo/cacheReport';
import { STORY_FILE, refetchCommand } from '../../server/geo/fetchScript';
import { HOMES, KEY, matrixPairsRequested, neededPairs, totalCalls } from './fetch-routes-helpers';
import { leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempDirWithCacheOf, tempFixturesDir } from './fetch-script-helpers';

// A whole run with the fake client takes about 20 ms locally (matcher and both reports included).
const TEST_TIMEOUT_MS = 10_000;

const NONE = 'Moved homes: none (every cached home is where the fixtures put it).';
const CANNOT_START = 'Cannot start: the travel cache no longer matches the fixtures. Nothing was dropped or written, and no Google call was made.';

// A home of the generated pool and a featured employee's home (both are compared; both sort in this order).
const POOL_HOME = 'home-007';
const STORY_HOME = 'home-story-harlem-2';
const fixtureHome = (id: string) => HOMES.find((home) => home.id === id)!;

const touches = (key: string, ids: readonly string[]) => key.split('|').some((id) => ids.includes(id));
const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json');
  return files;
};

/**
 * The human's edit: the featured home gets a new point in demoStory.json. The cache keeps the old one.
 * The fake Google knows only the real fixture points, so this is used where no request may be made anyway.
 */
function moveInFixtures(dir: string, homeId: string, dLat: number): void {
  const file = path.join(dir, STORY_FILE);
  const story = JSON.parse(fs.readFileSync(file, 'utf8'));
  const employee = story.featuredEmployees.find((candidate: { home: { id: string } }) => candidate.home.id === homeId);
  employee.home.lat += dLat;
  fs.writeFileSync(file, `${JSON.stringify(story, null, 2)}\n`);
}

/**
 * The same situation seen from the other side: the cache was fetched for another point than the fixtures have now.
 * The fixtures stay the real ones, so the fake Google can answer when the home is fetched again.
 */
function moveInCache(dir: string, homeId: string, by: { dLat?: number; dLng?: number }): void {
  const file = path.join(dir, MATRIX_FILE);
  const matrix = JSON.parse(fs.readFileSync(file, 'utf8'));
  matrix.places[homeId].lat += by.dLat ?? 0;
  matrix.places[homeId].lng += by.dLng ?? 0;
  fs.writeFileSync(file, `${JSON.stringify(matrix, null, 2)}\n`);
}

/** "moved <n> m" as the script prints it, measured here from the two points. */
function movedBy(homeId: string, by: { dLat?: number; dLng?: number }): string {
  const home = fixtureHome(homeId);
  return `${Math.round(straightLineM(home, { lat: home.lat + (by.dLat ?? 0), lng: home.lng + (by.dLng ?? 0) }))} m`;
}

/** A folder a complete run was made on. Never changed after `beforeAll`; every test works on a copy. */
let seed: string;

beforeAll(async () => {
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('runFetchScript: no home moved', () => {
  it(
    '--dry-run says so, after the estimate',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      const { code, lines } = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(code).toBe(0);
      expect(lines).toContain(NONE);
      expect(lines.indexOf(NONE)).toBeGreaterThan(lines.indexOf('  Google requests: 0'));
      expect(lines.join('\n')).not.toContain('--refetch');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--dry-run on an empty cache says so too: a home that was never fetched has not moved',
    async () => {
      const { code, lines } = await script({ dir: tempFixturesDir(), argv: ['--dry-run'], env: {} });
      expect(code).toBe(0);
      expect(lines).toContain(NONE);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript: a featured home moved in demoStory.json and a pool home cached on another point', () => {
  const STORY_MOVE = { dLat: 0.001 }; // about 111 m north
  const POOL_MOVE = { dLng: 0.0005 }; // about 42 m east
  const COMMAND = `  npm run fetch:routes -- --refetch ${POOL_HOME} --refetch ${STORY_HOME}`;
  let dir: string;
  let listed: string[];

  beforeAll(() => {
    dir = tempDirWithCacheOf(seed);
    moveInFixtures(dir, STORY_HOME, STORY_MOVE.dLat);
    moveInCache(dir, POOL_HOME, POOL_MOVE);
    listed = [
      'Moved homes: 2 (the fixtures no longer have them where the cached travel times were fetched for)',
      `  - ${POOL_HOME}: moved ${movedBy(POOL_HOME, POOL_MOVE)}`,
      `  - ${STORY_HOME}: moved ${movedBy(STORY_HOME, STORY_MOVE)}`,
      'To drop them and fetch only what is then missing, run:',
      COMMAND,
    ];
  }, TEST_TIMEOUT_MS);

  it(
    'the two distances are what a human would expect',
    () => {
      expect(listed[1]).toBe(`  - ${POOL_HOME}: moved 42 m`);
      expect(listed[2]).toBe(`  - ${STORY_HOME}: moved 111 m`);
      expect(COMMAND.trim()).toBe(refetchCommand([STORY_HOME, POOL_HOME, STORY_HOME]));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--dry-run lists both with the distance in meters and the exact command, exits 0 and writes nothing, without a key',
    async () => {
      const before = snapshot(dir);
      const { code, lines, keys, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

      expect(code).toBe(0);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      const start = lines.indexOf(listed[0]);
      expect(start).toBeGreaterThan(0);
      expect(lines.slice(start, start + listed.length)).toEqual(listed);
      expect(lines[0]).toBe('Fetch estimate (no Google call was made)');
      expect(lines.at(-1)).toMatch(/^Nothing was written\./);
      // IDs and distances only: no coordinate of either point.
      expect(lines.join('\n')).not.toMatch(/\b40\.\d{3,}/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a plain run prints the same list and command, drops nothing, builds no client and exits 1',
    async () => {
      const before = snapshot(dir);
      const { code, lines, keys, calls } = await script({ dir });

      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines).toEqual([CANNOT_START, ...listed]);
      expect(lines.at(-1)).toBe(COMMAND);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a plain run without a key says the same: the moved homes come first',
    async () => {
      const { code, lines } = await script({ dir, env: {} });
      expect(code).toBe(1);
      expect(lines).toEqual([CANNOT_START, ...listed]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--refetch for only one of them: nothing is dropped, and the command names both',
    async () => {
      const before = snapshot(dir);
      const { code, lines, keys, calls } = await script({ dir, argv: ['--refetch', POOL_HOME] });

      expect(code).toBe(1);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines).toEqual([
        CANNOT_START,
        'Moved homes: 1 (the fixtures no longer have it where the cached travel times were fetched for)',
        listed[2],
        'To drop it and fetch only what is then missing, run:',
        COMMAND,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--refetch for a business only: the command printed adds the moved homes to it',
    async () => {
      const before = snapshot(dir);
      const { code, lines, calls } = await script({ dir, argv: ['--refetch', 'biz-etsy'] });

      expect(code).toBe(1);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines.at(-1)).toBe(`  npm run fetch:routes -- --refetch biz-etsy --refetch ${POOL_HOME} --refetch ${STORY_HOME}`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    '--dry-run --refetch with both: no moved home is left, and the estimate counts their pairs',
    async () => {
      const before = snapshot(dir);
      const { code, lines, calls } = await script({ dir, argv: ['--dry-run', `--refetch=${STORY_HOME},${POOL_HOME}`], env: {} });

      expect(code).toBe(0);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines).toContain(NONE);
      expect(lines.some((line) => line.startsWith('  matrix pairs to fetch: 72 in '))).toBe(true); // 2 homes x 18 businesses x 2 directions
      expect(lines.some((line) => line.includes(`Dropped ${POOL_HOME}, ${STORY_HOME}: 2 places, 72 pairs, `))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript --refetch for the moved homes', () => {
  // The fixtures are the real ones here and the cache holds the two homes on other points, so the fake Google
  // can answer for the points the fixtures have.
  const MOVED = [POOL_HOME, STORY_HOME];
  let dir: string;
  let run: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempDirWithCacheOf(seed);
    moveInCache(dir, POOL_HOME, { dLng: 0.0005 });
    moveInCache(dir, STORY_HOME, { dLat: -0.02 });
    run = await script({ dir, argv: ['--refetch', STORY_HOME, '--refetch', POOL_HOME] });
  }, TEST_TIMEOUT_MS);

  it(
    'drops both, says so, and then fetches',
    () => {
      expect(run.lines[0]).toMatch(new RegExp(`^Dropped ${POOL_HOME}, ${STORY_HOME}: 2 places, 72 pairs, \\d+ route lines?\\.`));
      expect(run.lines.join('\n')).not.toContain('Moved homes');
      expect(run.keys).toEqual([KEY]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'requests only the pairs and the route lines of the two homes',
    () => {
      expect(run.calls.geocode).toEqual([]);
      expect([...matrixPairsRequested(run.calls)].sort()).toEqual(neededPairs().filter((key) => touches(key, MOVED)).sort());
      const wanted = Object.keys(cacheOf(seed).polylines.polylines).filter((key) => touches(key, MOVED));
      expect(wanted.length).toBeGreaterThanOrEqual(2);
      expect([...run.calls.polyline].sort()).toEqual(wanted.sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ends complete with exit 0, and the cache has both homes on the points of the fixtures',
    () => {
      expect(run.lines.at(-1)).toMatch(/^Done: the cache is complete and no error is flagged\./);
      expect(run.code).toBe(0);
      const { places } = cacheOf(dir).matrix;
      for (const id of MOVED) expect(places[id]).toEqual({ lat: fixtureHome(id).lat, lng: fixtureHome(id).lng });
      expect(snapshot(dir)).toEqual(snapshot(seed));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'afterwards --dry-run finds no moved home and a plain run exits 0 without a call',
    async () => {
      const dry = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(dry.lines).toContain(NONE);
      const plain = await script({ dir });
      expect(plain.code).toBe(0);
      expect(totalCalls(plain.calls)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('runFetchScript: a home moved by less than a meter', () => {
  it(
    'still counts: any difference from the fixtures is listed, and a plain run exits 1',
    async () => {
      const dir = tempDirWithCacheOf(seed);
      moveInCache(dir, STORY_HOME, { dLat: 0.000001 }); // about 0.1 m
      const row = `  - ${STORY_HOME}: moved less than 1 m`;

      const dry = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(dry.code).toBe(0);
      expect(dry.lines).toContain(row);

      const plain = await script({ dir });
      expect(plain.code).toBe(1);
      expect(totalCalls(plain.calls)).toBe(0);
      expect(plain.lines).toContain(row);
      expect(plain.lines.at(-1)).toBe(`  npm run fetch:routes -- --refetch ${STORY_HOME}`);
    },
    TEST_TIMEOUT_MS,
  );
});
