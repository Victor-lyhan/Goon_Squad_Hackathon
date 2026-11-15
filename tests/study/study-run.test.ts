// `runStudy` on the REAL committed NYC cache: totals add up, the file content is deterministic, the numbers
// agree with the engine's own run and metrics, and a run that needs an uncached pair is skipped and counted.
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { pairKey } from '../../shared/v2/types';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { serializeStudy } from '../../scripts/study/cli';
import { DEFAULT_GRID, gridRuns, runIdOf, type GridSpec } from '../../scripts/study/grid';
import { runStudy } from '../../scripts/study/runner';
import type { ComparisonTotals, StudyResults } from '../../scripts/study/types';
import { METERS_PER_MILE } from '../../scripts/study/units';
import { STUDY_TIMEOUT_MS, TWO_RUN_GRID, nycTravelFiles, studyInput, sum } from './study-helper';

/** Whole-number fields: a total is exactly the sum of its parts. */
const EXACT_FIELDS = [
  'packages', 'matched', 'unmatched', 'direct', 'relay', 'relayCostCents', 'courierCostCents', 'costSavedCents',
  'relayAddedM', 'courierTripM', 'early', 'onTime', 'late', 'minutesAheadOfPromise',
] as const satisfies readonly (keyof ComparisonTotals)[];

/** Converted fields: rounded to 3 decimals, so a sum of n parts may be off by n x 0.0005. */
const ROUNDED_FIELDS = [
  'relayAddedMiles', 'courierMiles', 'milesSaved', 'relayCo2Kg', 'courierCo2Kg', 'co2SavedKg',
] as const satisfies readonly (keyof ComparisonTotals)[];

/** The rules every totals object keeps on its own. */
function expectConsistent(totals: ComparisonTotals): void {
  for (const field of EXACT_FIELDS) expect(Number.isInteger(totals[field]), field).toBe(true);
  expect(totals.matched + totals.unmatched).toBe(totals.packages);
  expect(totals.direct + totals.relay).toBe(totals.matched);
  expect(totals.early + totals.onTime + totals.late).toBe(totals.matched);
  expect(totals.costSavedCents).toBe(totals.courierCostCents - totals.relayCostCents);
  expect(totals.matchRate).toBeCloseTo(totals.matched / totals.packages, 4);
  expect(totals.relayAddedMiles).toBeCloseTo(totals.relayAddedM / METERS_PER_MILE, 3);
  expect(totals.courierMiles).toBeCloseTo(totals.courierTripM / METERS_PER_MILE, 3);
  expect(totals.milesSaved).toBeCloseTo((totals.courierTripM - totals.relayAddedM) / METERS_PER_MILE, 3);
}

describe('a 2-run grid', () => {
  const results = runStudy(studyInput({ grid: TWO_RUN_GRID }));

  it('has the documented top-level shape', () => {
    expect(Object.keys(results)).toEqual(['assumptions', 'grid', 'runs', 'totals', 'headline']);
    expect(results.grid).toEqual({
      preset: 'random', seeds: [1, 2], employeeCounts: [60], packageCounts: [24], detourLimitsMin: [12],
      requestWindow: results.grid.requestWindow,
      plannedRuns: 2, completedRuns: 2, skippedRuns: [],
    });
    expect(results.runs.map(run => run.id)).toEqual(['s1-e60-p24-d12', 's2-e60-p24-d12']);
    expect(results.runs.map(run => run.params)).toEqual([
      { seed: 1, employees: 60, packages: 24, maxExtraMin: 12 },
      { seed: 2, employees: 60, packages: 24, maxExtraMin: 12 },
    ]);
  });

  it('matched something in both runs, so the sums below are not sums of nothing', () => {
    for (const run of results.runs) {
      expect(run.totals.packages).toBe(24);
      expect(run.packages.length).toBeGreaterThan(0);
      expect(run.packages.length).toBe(run.totals.matched);
    }
  });

  it('run totals are the sums of the run\'s packages', () => {
    for (const run of results.runs) {
      const rows = run.packages;
      expectConsistent(run.totals);
      expect(run.totals.relayCostCents).toBe(sum(rows.map(row => row.relayCostCents)));
      expect(run.totals.courierCostCents).toBe(sum(rows.map(row => row.courierCostCents)));
      expect(run.totals.costSavedCents).toBe(sum(rows.map(row => row.costSavedCents)));
      expect(run.totals.relayAddedM).toBe(sum(rows.map(row => row.relayAddedM)));
      expect(run.totals.courierTripM).toBe(sum(rows.map(row => row.courierTripM)));
      expect(run.totals.minutesAheadOfPromise).toBe(sum(rows.map(row => row.minutesAheadOfPromise)));
      expect(run.totals.direct).toBe(rows.filter(row => row.kind === 'direct').length);
      expect(run.totals.relay).toBe(rows.filter(row => row.kind === 'relay').length);
      expect(run.totals.early).toBe(rows.filter(row => row.timing === 'early').length);
      expect(run.totals.onTime).toBe(rows.filter(row => row.timing === 'on_time').length);
      expect(run.totals.late).toBe(rows.filter(row => row.timing === 'late').length);
      const tolerance = rows.length * 0.0005 + 1e-9;
      for (const field of ROUNDED_FIELDS) {
        expect(Math.abs(run.totals[field] - sum(rows.map(row => row[field]))), field).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('study totals are the sums of the run totals', () => {
    expectConsistent(results.totals);
    expect(results.totals.runs).toBe(2);
    expect(results.totals.skippedRuns).toBe(0);
    for (const field of EXACT_FIELDS) {
      expect(results.totals[field], field).toBe(sum(results.runs.map(run => run.totals[field])));
    }
    const tolerance = results.runs.length * 0.0005 + 1e-9;
    for (const field of ROUNDED_FIELDS) {
      expect(Math.abs(results.totals[field] - sum(results.runs.map(run => run.totals[field]))), field).toBeLessThanOrEqual(tolerance);
    }
  });

  it('every package row is consistent with itself', () => {
    for (const row of results.runs.flatMap(run => run.packages)) {
      expect(row.costSavedCents).toBe(row.courierCostCents - row.relayCostCents);
      expect(row.courierCostCents).toBe(row.category === 'envelope' ? 1400 : 1800);
      expect(Number.isInteger(row.relayAddedM) && row.relayAddedM >= 0).toBe(true);
      expect(Number.isInteger(row.courierTripM) && row.courierTripM > 0).toBe(true);
      expect(row.relayAddedMiles).toBeCloseTo(row.relayAddedM / METERS_PER_MILE, 3);
      expect(row.courierMiles).toBeCloseTo(row.courierTripM / METERS_PER_MILE, 3);
      expect(row.relayCo2Kg).toBeCloseTo((row.relayAddedM / METERS_PER_MILE) * 0.4, 3);
      expect(row.courierCo2Kg).toBeCloseTo((row.courierTripM / METERS_PER_MILE) * 0.4, 3);
      expect(row.courierPromisedByMin).toBe(1440 + 630);
      expect(row.minutesAheadOfPromise).toBe(row.courierPromisedByMin - row.deliveredAtMin);
      expect(row.timing).toBe(row.deliveredAtMin < 1440 ? 'early' : row.deliveredAtMin <= 2070 ? 'on_time' : 'late');
    }
  });

  it('the headline is the study totals per matched package', () => {
    const { headline: h, totals: t } = results;
    expect(h.runs).toBe(t.runs);
    expect(h.packages).toBe(t.packages);
    expect(h.matched).toBe(t.matched);
    expect(h.matchRate).toBe(t.matchRate);
    expect(h.relayCostPerPackageCents).toBe(Math.round(t.relayCostCents / t.matched));
    expect(h.courierCostPerPackageCents).toBe(Math.round(t.courierCostCents / t.matched));
    expect(h.costSavedPerPackageCents).toBe(Math.round(t.costSavedCents / t.matched));
    expect(h.costSavedRate).toBeCloseTo(t.costSavedCents / t.courierCostCents, 4);
    expect(h.relayAddedMilesPerPackage).toBeCloseTo(t.relayAddedM / METERS_PER_MILE / t.matched, 3);
    expect(h.courierMilesPerPackage).toBeCloseTo(t.courierTripM / METERS_PER_MILE / t.matched, 3);
    expect(h.milesSavedPerPackage).toBeCloseTo((t.courierTripM - t.relayAddedM) / METERS_PER_MILE / t.matched, 3);
    expect(h.co2SavedKgPerPackage).toBeCloseTo(((t.courierTripM - t.relayAddedM) / METERS_PER_MILE) * 0.4 / t.matched, 3);
    expect(h.onTimeOrEarlyRate).toBeCloseTo((t.early + t.onTime) / t.matched, 4);
    expect(h.earlyRate).toBeCloseTo(t.early / t.matched, 4);
    expect(h.lateRate).toBeCloseTo(t.late / t.matched, 4);
    expect(h.avgMinutesAheadOfPromise).toBeCloseTo(t.minutesAheadOfPromise / t.matched, 1);
  });

  it('agrees with the engine: the same run built here gives the same plans, metrics and delivery times', () => {
    const files = nycTravelFiles();
    const input = studyInput({ files });
    for (const studyRun of results.runs) {
      const request = GenerateScenarioRequest.parse({ preset: 'random', ...studyRun.params });
      const scenario = buildNycScenario({ ...input.fixtures, places: files.matrix.places, request });
      const run = createInitialRun(scenario, { travel: input.travel, buildEvents: buildTimeline });
      const end = snapshotAt(run, scenario.settings.simEndMin, input.travel);
      const shipments = new Map(scenario.shipments.map(shipment => [shipment.id, shipment]));

      expect(studyRun.totals.packages).toBe(end.metrics.requested);
      expect(studyRun.totals.matched).toBe(end.metrics.matched);
      expect(studyRun.totals.matched).toBe(end.metrics.delivered); // the simulation delivered every matched package
      expect(studyRun.totals.unmatched).toBe(end.metrics.unmatched);
      expect(studyRun.totals.direct).toBe(end.metrics.direct);
      expect(studyRun.totals.relay).toBe(end.metrics.relay);
      expect(studyRun.totals.relayAddedM).toBe(end.metrics.extraDistanceM); // Relay's own summary number

      // The window the results report covers every package this run requested, and every delivery met its deadline.
      const window = results.grid.requestWindow!;
      for (const shipment of scenario.shipments) {
        expect(shipment.readyMin).toBeGreaterThanOrEqual(window.earliestReadyMin);
        expect(shipment.deadlineMin).toBeLessThanOrEqual(window.latestDeadlineMin);
      }
      for (const row of studyRun.packages) expect(row.deliveredAtMin).toBeLessThanOrEqual(window.latestDeadlineMin);

      expect(studyRun.packages.map(row => row.shipmentId)).toEqual(run.assignments.plans.map(plan => plan.shipmentId));
      for (const [index, plan] of run.assignments.plans.entries()) {
        const row = studyRun.packages[index]!;
        const shipment = shipments.get(plan.shipmentId)!;
        expect(row.kind).toBe(plan.kind);
        expect(row.category).toBe(shipment.category);
        expect(row.relayCostCents).toBe(plan.customerPriceCents);
        expect(row.deliveredAtMin).toBe(plan.deliveryMin);
        expect(row.courierTripM).toBe(files.matrix.pairs[pairKey(shipment.originBusinessId, shipment.destinationBusinessId)]!.distanceM);
      }
    }
  });
});

describe('determinism', () => {
  it('the same inputs give a byte-identical file', () => {
    const first = serializeStudy(runStudy(studyInput({ grid: TWO_RUN_GRID })));
    const second = serializeStudy(runStudy(studyInput({ grid: TWO_RUN_GRID })));
    expect(second).toBe(first);
    expect(first.endsWith('}\n')).toBe(true);
    expect(JSON.parse(first)).toEqual(runStudy(studyInput({ grid: TWO_RUN_GRID })));
  });

  it('the file has no timestamp and no measured duration', () => {
    const text = serializeStudy(runStudy(studyInput({ grid: TWO_RUN_GRID })));
    expect(text).not.toMatch(/generatedAt|computeMs|durationMs|elapsed|timestamp/i);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO date
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('does not change the cache or the fixtures it reads', () => {
    const files = nycTravelFiles();
    const input = studyInput({ files, grid: TWO_RUN_GRID });
    const before = JSON.stringify([files, input.fixtures]);
    runStudy(input);
    expect(JSON.stringify([files, input.fixtures])).toBe(before);
  });
});

describe('a run that needs an uncached pair', () => {
  // 10 employees use 10 of the 120 pool homes; 120 employees use all of them. Removing the travel data of one
  // home the small run does not use leaves the small run complete and makes the large run impossible.
  const grid: GridSpec = { seeds: [1], employeeCounts: [10, 120], packageCounts: [12], detourLimitsMin: [12] };
  const files = nycTravelFiles();
  const small = buildNycScenario({
    ...studyInput({ files }).fixtures, places: files.matrix.places,
    request: GenerateScenarioRequest.parse({ preset: 'random', seed: 1, employees: 10, packages: 12, maxExtraMin: 12 }),
  });
  const usedHomes = new Set(small.employees.map(employee => employee.homeId));
  const droppedHome = Object.keys(files.matrix.places).filter(id => /^home-\d{3}$/.test(id) && !usedHomes.has(id)).sort()[0]!;
  const pairs = Object.fromEntries(Object.entries(files.matrix.pairs).filter(([key]) => !key.split('|').includes(droppedHome)));
  const holed = { ...files, matrix: { ...files.matrix, pairs } };

  let results: StudyResults;
  it('is skipped, not estimated, and the other run still completes', () => {
    expect(Object.keys(pairs).length).toBeLessThan(Object.keys(files.matrix.pairs).length);
    results = runStudy(studyInput({ files: holed, grid }));
    expect(results.grid.plannedRuns).toBe(2);
    expect(results.grid.completedRuns).toBe(1);
    expect(results.runs.map(run => run.id)).toEqual(['s1-e10-p12-d12']);
    expect(results.grid.skippedRuns).toHaveLength(1);
    expect(results.grid.skippedRuns[0]).toMatchObject({
      id: 's1-e120-p12-d12', params: { seed: 1, employees: 120, packages: 12, maxExtraMin: 12 },
    });
    expect(results.grid.skippedRuns[0]!.reason).toContain(droppedHome);
  });

  it('is counted in the totals and adds nothing to them', () => {
    expect(results.totals.runs).toBe(1);
    expect(results.totals.skippedRuns).toBe(1);
    const { runs: _runs, skippedRuns: _skipped, ...sums } = results.totals;
    expect(sums).toEqual(results.runs[0]!.totals);
  });

  it('the complete cache skips neither run', () => {
    const whole = runStudy(studyInput({ files, grid }));
    expect(whole.grid.skippedRuns).toEqual([]);
    expect(whole.runs[0]).toEqual(results.runs[0]); // the hole did not touch the small run
  });

  it('a study with no completed run has no request window and no NaN', () => {
    const none = runStudy(studyInput({ files: holed, grid: { ...grid, employeeCounts: [120] } }));
    expect(none.grid).toMatchObject({ plannedRuns: 1, completedRuns: 0, requestWindow: null });
    expect(none.runs).toEqual([]);
    expect(none.totals).toMatchObject({ runs: 0, skippedRuns: 1, packages: 0, matched: 0, matchRate: null });
    expect(serializeStudy(none)).not.toMatch(/NaN|Infinity/);
  });

  it('any other error is not swallowed as a skip', () => {
    expect(() => runStudy(studyInput({ files, grid: { ...grid, employeeCounts: [121] } }))).toThrow();
  });
});

describe('the default grid', () => {
  it('is several seeds x employee counts x package counts x detour limits, all distinct', () => {
    for (const list of [DEFAULT_GRID.seeds, DEFAULT_GRID.employeeCounts, DEFAULT_GRID.packageCounts, DEFAULT_GRID.detourLimitsMin]) {
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(new Set(list).size).toBe(list.length);
    }
    const planned = gridRuns(DEFAULT_GRID);
    expect(planned).toHaveLength(
      DEFAULT_GRID.seeds.length * DEFAULT_GRID.employeeCounts.length * DEFAULT_GRID.packageCounts.length * DEFAULT_GRID.detourLimitsMin.length,
    );
    expect(new Set(planned.map(runIdOf)).size).toBe(planned.length);
  });

  it('runs completely on the committed cache, and Relay beats the courier on cost, added miles and CO2', () => {
    const results = runStudy(studyInput());
    const { grid, totals, headline: h } = results;
    expect(grid.plannedRuns).toBe(gridRuns(DEFAULT_GRID).length);
    expect(grid.skippedRuns).toEqual([]); // the cache has every pair: nothing needs Google
    expect(grid.completedRuns).toBe(grid.plannedRuns);
    expect(results.runs).toHaveLength(grid.plannedRuns);
    expect(totals.packages).toBe(sum(gridRuns(DEFAULT_GRID).map(params => params.packages)));
    expect(totals.matched).toBeGreaterThan(0);
    for (const run of results.runs) expectConsistent(run.totals);
    expectConsistent(totals);

    expect(h.costSavedPerPackageCents!).toBeGreaterThan(0);
    expect(h.relayAddedMilesPerPackage!).toBeLessThan(h.courierMilesPerPackage!);
    expect(h.relayCo2KgPerPackage!).toBeLessThan(h.courierCo2KgPerPackage!);
    // Competitive on time: nothing arrives after the courier's promise.
    expect(totals.late).toBe(0);
    expect(h.onTimeOrEarlyRate).toBe(1);
    expect(serializeStudy(results)).not.toMatch(/NaN|Infinity/);
  }, STUDY_TIMEOUT_MS);
});
