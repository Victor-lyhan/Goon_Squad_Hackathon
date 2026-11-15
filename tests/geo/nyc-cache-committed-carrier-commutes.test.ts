// The committed Google cache and the carriers' home ↔ work route lines (MVP IV F2, issue #763).
// In every playback a carrier is drawn along its whole commute: its legs (home → pickup or drop-off → home) and
// its baseline commutes (home ↔ its own business). This file works out, on the committed fixtures/nyc/ files,
// which of those stretches of the default NYC run have no line in polylines.json, and PRINTS the count.
// It does NOT fail because a line is missing: a pair without a line is legal (DECISIONS pass 44 and 54: the marker
// moves on the straight line until a human runs `npm run fetch:routes`). What it does assert is that the count is
// right: the same number `npm run fetch:routes -- --dry-run` prints, from pairs written out here by hand.
// No network, no key, nothing written.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import type { AssignmentResult, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario } from '../../shared/v2/types';
import type { TravelFiles } from '../../server/geo/cache';
import { carrierCommutePairs, planPolylines } from '../../server/geo/fetchPlan';
import { CARRIER_COMMUTE_LINES_LABEL, CARRIER_COMMUTE_LINES_NOTE, estimateFetch, formatEstimate, matchDefaultScenario } from '../../server/geo/fetchRoutes';
import type { FetchRoutesInput } from '../../server/geo/fetchRoutes';
import { COMMITTED_CACHE_TEST_TIMEOUT_MS, fixturesDir, loadCommittedCache } from './nyc-cache-committed-helper';

// The matcher runs on 60 employees and 24 packages for each estimate; locally the whole file takes about 0.3 s.
vi.setConfig({ testTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS, hookTimeout: COMMITTED_CACHE_TEST_TIMEOUT_MS });

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const readFixture = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;

/** A carrier's stretch between its home and a business, and what it is part of. */
interface Stretch {
  key: string;
  from: string;
  to: string;
  employeeId: string;
  /** `leg`: a neighbouring pair of a plan leg's `placeIds` that touches a home. `baseline`: the carrier's commute without a package. */
  kind: 'leg' | 'baseline';
}

/**
 * Every home ↔ business stretch of every carrier of these plans, written out here and not taken from
 * server/geo/fetchPlan.ts. Each pair key once; a leg stretch wins over a baseline one with the same key.
 */
function carrierStretches(scenario: Scenario, assignments: AssignmentResult): Stretch[] {
  const homeIds = new Set(scenario.homes.map((home) => home.id));
  const byKey = new Map<string, Stretch>();
  const add = (stretch: Omit<Stretch, 'key'>) => {
    const key = pairKey(stretch.from, stretch.to);
    if (!byKey.has(key)) byKey.set(key, { key, ...stretch });
  };
  const carrierIds = new Set<string>();
  for (const plan of assignments.plans) {
    for (const leg of plan.legs) {
      carrierIds.add(leg.employeeId);
      for (let i = 1; i < leg.placeIds.length; i++) {
        const [from, to] = [leg.placeIds[i - 1], leg.placeIds[i]];
        if (homeIds.has(from) || homeIds.has(to)) add({ from, to, employeeId: leg.employeeId, kind: 'leg' });
      }
    }
  }
  for (const employee of scenario.employees) {
    if (!carrierIds.has(employee.id)) continue;
    add({ from: employee.businessId, to: employee.homeId, employeeId: employee.id, kind: 'baseline' });
    add({ from: employee.homeId, to: employee.businessId, employeeId: employee.id, kind: 'baseline' });
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

let files: TravelFiles;
let input: FetchRoutesInput;
let scenario: Scenario;
let assignments: AssignmentResult;
let stretches: Stretch[];
let missing: Stretch[];

beforeAll(() => {
  files = loadCommittedCache();
  input = {
    files,
    businessesFile: readFixture<NycBusinessesFile>('businesses.json'),
    neighborhoodsFile: readFixture<NycNeighborhoodsFile>('neighborhoods.json'),
    storyFile: readFixture<NycDemoStoryFile>('demoStory.json'),
  };
  const matched = matchDefaultScenario(input, files);
  if (!matched.ok) throw new Error(`the matcher cannot run on the committed cache: ${matched.reason}`);
  ({ scenario, assignments } = matched);
  stretches = carrierStretches(scenario, assignments);
  missing = stretches.filter((stretch) => !has(files.polylines.polylines, stretch.key));
});

describe("committed NYC travel cache: the carriers' home ↔ work route lines of the default run", () => {
  it('the default run has carriers, with stretches from a home and to a home', () => {
    expect(assignments.plans.length).toBeGreaterThan(0);
    const legs = stretches.filter((stretch) => stretch.kind === 'leg');
    expect(legs.length).toBeGreaterThan(0);
    const homeIds = new Set(scenario.homes.map((home) => home.id));
    const businessIds = new Set(scenario.businesses.map((business) => business.id));
    expect(legs.some((stretch) => homeIds.has(stretch.from))).toBe(true); // a morning leg starts at home
    expect(legs.some((stretch) => homeIds.has(stretch.to))).toBe(true); // an evening leg ends at home
    for (const { key, from, to, employeeId } of stretches) {
      // One end is the carrier's own home, the other a business: a home is never a pickup, a drop-off or a relay point.
      const home = scenario.employees.find((employee) => employee.id === employeeId)!.homeId;
      expect([from, to].filter((id) => id === home), key).toHaveLength(1);
      expect([from, to].filter((id) => businessIds.has(id)), key).toHaveLength(1);
    }
  });

  it('every stretch has its travel time and distance in matrix.json: only the drawn line can be missing, never a time', () => {
    expect(stretches.filter((stretch) => !has(files.matrix.pairs, stretch.key)).map((stretch) => stretch.key)).toEqual([]);
  });

  it('reports how many of them have no route line (it does not fail when lines are missing)', () => {
    const carriers = new Set(stretches.map((stretch) => stretch.employeeId)).size;
    const legs = stretches.filter((stretch) => stretch.kind === 'leg').length;
    const report = [
      `Carrier commute route lines (default NYC run, committed cache): ${carriers} carriers, ${stretches.length} home ↔ work stretches ` +
        `(${legs} on a leg, ${stretches.length - legs} baseline commutes), ${missing.length} without a route line`,
      ...missing.map((stretch) => `  - ${stretch.from} → ${stretch.to} (${stretch.kind === 'leg' ? 'a leg' : 'the baseline commute'} of ${stretch.employeeId})`),
      missing.length === 0
        ? '  Nothing to fetch for them.'
        : '  A human with the Google key runs: npm run fetch:routes, then npm run fetch:routes -- --drop-entered, and commits fixtures/nyc/. Until then these stretches are drawn as straight lines.',
    ];
    console.log(report.join('\n'));

    expect(missing.length).toBeLessThanOrEqual(stretches.length);
    expect(report.join('\n')).not.toMatch(/undefined|NaN/);
    // No ID of a typed-in address can be printed: the default run only has pool and story homes.
    expect(report.join('\n')).not.toMatch(/home-c-/);
  });

  it('the count is the one the fetch plan and the dry run give', () => {
    const planned = planPolylines(carrierCommutePairs(assignments.plans, scenario.employees), files.polylines);
    expect(planned.map(({ from, to }) => pairKey(from, to))).toEqual(missing.map((stretch) => stretch.key));

    const estimate = estimateFetch(input);
    expect(estimate.carrierCommutePolylines).toBe(missing.length);
    expect(formatEstimate(estimate)).toContain(`  ${CARRIER_COMMUTE_LINES_LABEL}: ${missing.length} ${CARRIER_COMMUTE_LINES_NOTE}`);
    // They are part of the route lines a run fetches anyway, never more than those.
    expect(estimate.planPolylines).not.toBeNull();
    expect(missing.length).toBeLessThanOrEqual(estimate.commutePolylines + estimate.planPolylines!);
  });
});

// The count has to move. Each case takes lines out of a copy of the committed cache in memory.
describe("the carriers' count on a copy of the committed cache that lost lines", () => {
  const without = (keys: readonly string[]): FetchRoutesInput => {
    const copy = structuredClone(files);
    for (const key of keys) delete copy.polylines.polylines[key];
    return { ...input, files: copy };
  };
  const cached = () => stretches.filter((stretch) => has(files.polylines.polylines, stretch.key));

  it('one more missing line of a leg is one more in the count and in the plan lines', () => {
    const stretch = cached().find((candidate) => candidate.kind === 'leg');
    if (stretch === undefined) return; // every leg line is already missing: nothing left to take out
    const before = estimateFetch(input);
    const after = estimateFetch(without([stretch.key]));
    expect(after.carrierCommutePolylines).toBe(missing.length + 1);
    expect(after.planPolylines).toBe(before.planPolylines! + 1);
    expect(after.commutePolylines).toBe(before.commutePolylines);
  });

  it("one more missing baseline commute of a carrier is one more in the count and in the baseline lines", () => {
    const stretch = cached().find((candidate) => candidate.kind === 'baseline');
    if (stretch === undefined) return;
    const before = estimateFetch(input);
    const after = estimateFetch(without([stretch.key]));
    expect(after.carrierCommutePolylines).toBe(missing.length + 1);
    expect(after.commutePolylines).toBe(before.commutePolylines + 1);
    expect(after.planPolylines).toBe(before.planPolylines);
  });

  it('with no route line at all, the count is every stretch', () => {
    const estimate = estimateFetch({ ...input, files: { matrix: files.matrix, polylines: { schemaVersion: 1, polylines: {} } } });
    expect(estimate.carrierCommutePolylines).toBe(stretches.length);
  });

  it('a line between two businesses, or the commute of an employee who carries nothing, does not count', () => {
    const carrierKeys = new Set(stretches.map((stretch) => stretch.key));
    const others = Object.keys(files.polylines.polylines).filter((key) => !carrierKeys.has(key));
    if (others.length === 0) return;
    expect(estimateFetch(without(others)).carrierCommutePolylines).toBe(missing.length);
  });

  it('none of the cases above changed the committed cache in memory', () => {
    expect(stretches.filter((stretch) => !has(files.polylines.polylines, stretch.key))).toEqual(missing);
  });
});
