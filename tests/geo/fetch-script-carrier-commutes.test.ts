// runFetchScript and the carriers' home ↔ work route lines (MVP IV F2, issue #763; server/geo/fetchScript.ts,
// fetchRoutes.ts, fetchPlan.ts). A carrier is drawn along its whole commute, so the lines that count are the
// stretches of its legs that touch its home and its two baseline commutes. The dry run counts the missing ones
// on their own line, and a run asks the mocked Google client for exactly the missing pairs.
// Temp folders with copies of the three real fixtures/nyc files; no network, no real key, no .env.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { readTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { CARRIER_COMMUTE_LINES_LABEL, CARRIER_COMMUTE_LINES_NOTE } from '../../server/geo/fetchRoutes';
import { KEY, totalCalls } from './fetch-routes-helpers';
import { cityClient, explainerOn, leakedLines, printedLineCount, removeTempDirs, script, snapshot, tempDirWithCacheOf, tempFixturesDir } from './fetch-script-helpers';

// A whole fetch runs the matcher on 60 employees and 24 packages; locally a run takes well under 2 s.
const RUN_TIMEOUT_MS = 30_000;

const sorted = (keys: readonly string[]) => [...keys].sort();
const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json was written');
  return files;
};
const carrierLine = (n: number | string) => `  ${CARRIER_COMMUTE_LINES_LABEL}: ${n} ${CARRIER_COMMUTE_LINES_NOTE}`;
const numberAfter = (lines: readonly string[], start: string) => {
  const line = lines.find((candidate) => candidate.startsWith(start));
  if (line === undefined) throw new Error(`no line starts with "${start}"`);
  return Number.parseInt(line.slice(start.length), 10);
};

/**
 * The default run's plans on the folder's cache, read here and not through fetchPlan.ts:
 * - `legHome`: every neighbouring pair of every plan leg's `placeIds` that touches a home;
 * - `baseline`: both baseline commutes (business → home, home → business) of every employee who carries a leg;
 * - `betweenBusinesses`: the plan stretches from one business to another, which are no commute lines.
 * Pair keys, each once per list.
 */
function planStretches(dir: string) {
  const { scenario, assignments } = explainerOn(dir);
  const homeIds = new Set(scenario.homes.map((home) => home.id));
  const legHome = new Set<string>();
  const betweenBusinesses = new Set<string>();
  const carrierIds = new Set<string>();
  for (const plan of assignments.plans) {
    for (const leg of plan.legs) {
      carrierIds.add(leg.employeeId);
      for (let i = 1; i < leg.placeIds.length; i++) {
        const [from, to] = [leg.placeIds[i - 1], leg.placeIds[i]];
        (homeIds.has(from) || homeIds.has(to) ? legHome : betweenBusinesses).add(pairKey(from, to));
      }
    }
  }
  const baseline = new Set<string>();
  for (const employee of scenario.employees) {
    if (!carrierIds.has(employee.id)) continue;
    baseline.add(pairKey(employee.businessId, employee.homeId));
    baseline.add(pairKey(employee.homeId, employee.businessId));
  }
  const idleCommutes = scenario.employees
    .filter((employee) => !carrierIds.has(employee.id))
    .flatMap((employee) => [pairKey(employee.businessId, employee.homeId), pairKey(employee.homeId, employee.businessId)]);
  return { legHome: [...legHome].sort(), baseline: [...baseline].sort(), betweenBusinesses: [...betweenBusinesses].sort(), idleCommutes, plans: assignments.plans.length };
}

/** Rewrites the folder's polylines.json without these pair keys. Every key must be there: the test removes what a run stored. */
function dropLines(dir: string, keys: readonly string[]): void {
  const files = structuredClone(cacheOf(dir));
  for (const key of keys) {
    if (!Object.hasOwn(files.polylines.polylines, key)) throw new Error(`the finished cache has no route line ${key}`);
    delete files.polylines.polylines[key];
  }
  writeTravelFiles(dir, files);
}

let seedDir: string;
let stretches: ReturnType<typeof planStretches>;

beforeAll(async () => {
  seedDir = tempFixturesDir();
  const first = await script({ dir: seedDir });
  expect(first.code).toBe(0);
  stretches = planStretches(seedDir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(50);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe("the carriers' commute route lines of the default run", () => {
  it('are stretches from or to a home on both kinds of leg, and the finished cache has a line for every one', () => {
    expect(stretches.plans).toBeGreaterThan(0);
    expect(stretches.legHome.length).toBeGreaterThan(0);
    expect(stretches.baseline.length).toBeGreaterThan(0);
    expect(stretches.betweenBusinesses.length).toBeGreaterThan(0);
    // Evening legs end at a home and morning legs start at one.
    expect(stretches.legHome.some((key) => key.startsWith('home-'))).toBe(true);
    expect(stretches.legHome.some((key) => key.startsWith('biz-'))).toBe(true);
    for (const key of [...stretches.legHome, ...stretches.baseline]) {
      const [from, to] = key.split('|');
      expect(from.startsWith('home-') !== to.startsWith('home-'), key).toBe(true); // exactly one end is a home
    }
    const lines = cacheOf(seedDir).polylines.polylines;
    for (const key of [...stretches.legHome, ...stretches.baseline, ...stretches.betweenBusinesses]) expect(Object.hasOwn(lines, key), key).toBe(true);
  });
});

describe('runFetchScript --dry-run: "commute route lines to fetch for carriers"', () => {
  it(
    'is 0 on a finished cache, next to the matched plans line, and nothing is to fetch',
    async () => {
      const { code, lines, keys, calls } = await script({ dir: seedDir, argv: ['--dry-run'], env: {} });
      expect(code).toBe(0);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      const plans = lines.indexOf('  route lines to fetch for matched plans: 0');
      expect(plans).toBeGreaterThan(0);
      expect(lines[plans + 1]).toBe(carrierLine(0));
      expect(lines[plans + 1].startsWith('  commute route lines to fetch for carriers: 0')).toBe(true);
      expect(lines).toContain('  Google requests: 0');
      expect(lines).toContain('  Nothing to fetch: the cache has everything the default scenario needs.');
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'counts every missing stretch of a plan leg that touches a home, without a key, a call or a write',
    async () => {
      const dir = tempDirWithCacheOf(seedDir);
      dropLines(dir, stretches.legHome);
      const before = snapshot(dir);

      const { code, lines, keys, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

      expect(code).toBe(0);
      expect(keys).toEqual([]);
      expect(totalCalls(calls)).toBe(0);
      expect(snapshot(dir)).toEqual(before);
      expect(lines).toContain(carrierLine(stretches.legHome.length));
      // They are plan lines: the count is part of the lines above it, and the total does not add it twice.
      expect(lines).toContain('  route lines to fetch for baseline commutes: 0');
      expect(lines).toContain(`  route lines to fetch for matched plans: ${stretches.legHome.length}`);
      expect(lines).toContain(`  Google requests: ${stretches.legHome.length}`);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "counts a carrier's missing baseline commute too, and leaves out business → business stretches and idle employees",
    async () => {
      const dir = tempDirWithCacheOf(seedDir);
      const carrierKeys = [stretches.legHome[0], stretches.baseline[0], stretches.baseline.at(-1)!];
      const otherKeys = [stretches.betweenBusinesses[0], stretches.idleCommutes[0]];
      dropLines(dir, [...carrierKeys, ...otherKeys]);

      const { code, lines, calls } = await script({ dir, argv: ['--dry-run'], env: {} });

      expect(code).toBe(0);
      expect(totalCalls(calls)).toBe(0);
      expect(lines).toContain(carrierLine(carrierKeys.length));
      const baseline = numberAfter(lines, '  route lines to fetch for baseline commutes: ');
      const plans = numberAfter(lines, '  route lines to fetch for matched plans: ');
      expect(baseline).toBe(3); // two carrier commutes and the idle employee's
      expect(plans).toBe(2); // the home stretch of a leg and the business → business stretch
      expect(lines).toContain(`  Google requests: ${carrierKeys.length + otherKeys.length}`);
    },
    RUN_TIMEOUT_MS,
  );

  it('says "not known yet" on an empty cache: who carries is known only after the matcher has run', async () => {
    const { code, lines, calls } = await script({ dir: tempFixturesDir(), argv: ['--dry-run'], env: {} });
    expect(code).toBe(0);
    expect(totalCalls(calls)).toBe(0);
    expect(lines).toContain(carrierLine('not known yet'));
    expect(lines.findIndex((line) => line.startsWith('  route lines to fetch for matched plans: not known yet'))).toBe(lines.indexOf(carrierLine('not known yet')) - 1);
  });
});

describe('runFetchScript: a run on a cache that lacks carrier commute lines', () => {
  it(
    'asks the mocked Google client for exactly the missing pairs, skips every cached pair and never prints the key',
    async () => {
      const dir = tempDirWithCacheOf(seedDir);
      // Missing: every home stretch of the plan legs but one, one carrier's baseline commute, one plan stretch
      // between two businesses. Cached: everything else, with one home stretch of a leg among it.
      const keptLegHome = stretches.legHome[1];
      const missingCarrier = [...stretches.legHome.filter((key) => key !== keptLegHome), stretches.baseline[0]];
      const missingPlan = [stretches.betweenBusinesses[0]];
      dropLines(dir, [...missingCarrier, ...missingPlan]);
      const linesBefore = cacheOf(dir).polylines.polylines;

      const dry = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(dry.lines).toContain(carrierLine(missingCarrier.length));
      expect(dry.lines).toContain(`  Google requests: ${missingCarrier.length + missingPlan.length}`);

      const { code, lines, keys, calls } = await script({ dir });

      // The pair list: exactly the missing ones, each once, and no other kind of request.
      expect(calls.geocode).toEqual([]);
      expect(calls.matrix).toEqual([]);
      expect(sorted(calls.polyline)).toEqual(sorted([...missingCarrier, ...missingPlan]));
      expect(calls.polyline).not.toContain(keptLegHome);
      for (const key of calls.polyline) expect(Object.hasOwn(linesBefore, key), key).toBe(false);

      // The run says how many of the lines are the carriers', fills them in and is complete.
      expect(lines).toContain(
        `Step 4/4 route lines: ${missingCarrier.length + missingPlan.length} to fetch for the baseline commutes and the matched plans' legs, ` +
          `${missingCarrier.length} of them for the carriers' commutes (home ↔ work)`,
      );
      expect(lines.at(-1)).toMatch(/^Done: the cache is complete and no error is flagged\./);
      expect(code).toBe(0);
      const after = cacheOf(dir);
      expect(after.polylines.polylines).toEqual(cacheOf(seedDir).polylines.polylines);
      expect(after.matrix).toEqual(cacheOf(seedDir).matrix);

      // The key went to the client and nowhere else.
      expect(keys).toEqual([KEY]);
      for (const line of [...dry.lines, ...lines]) expect(line).not.toContain(KEY.slice(0, 8));

      // Nothing is left: the next dry run counts 0 and a second run calls nothing.
      const again = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(again.lines).toContain(carrierLine(0));
      expect(again.lines).toContain('  Google requests: 0');
      const second = await script({ dir });
      expect(totalCalls(second.calls)).toBe(0);
      expect(second.code).toBe(0);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    'a carrier line Google cannot route is a failure in the summary, not a made-up line: the count stays and the run exits 1',
    async () => {
      const dir = tempDirWithCacheOf(seedDir);
      const [refused, fetched] = stretches.legHome;
      dropLines(dir, [refused, fetched]);
      const google = cityClient({
        polyline: (from, to) => {
          if (pairKey(from, to) === refused) throw new Error('no route between these points');
          return undefined;
        },
      });

      const { code, lines } = await script({ dir, google });

      expect(code).toBe(1);
      expect(sorted([...new Set(google.calls.polyline)])).toEqual(sorted([refused, fetched]));
      const stored = cacheOf(dir).polylines.polylines;
      expect(Object.hasOwn(stored, refused)).toBe(false);
      expect(Object.hasOwn(stored, fetched)).toBe(true);
      expect(lines.at(-1)).toBe('Run again to resume.');

      const dry = await script({ dir, argv: ['--dry-run'], env: {} });
      expect(dry.lines).toContain(carrierLine(1));
    },
    RUN_TIMEOUT_MS,
  );
});
