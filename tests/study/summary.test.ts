// The summaries behind the study page and the terminal table (scripts/study/summary.ts) and the CSV of every
// run (scripts/study/csv.ts), on a small real study: 24 runs on the committed NYC cache.
// No key, no network, nothing written. No number of the study is pinned: expectations are recomputed here.
import { describe, expect, it } from 'vitest';
import { RUNS_CSV_COLUMNS, runsCsv } from '../../scripts/study/csv';
import { gridRuns, runIdOf, type GridSpec } from '../../scripts/study/grid';
import { runStudy } from '../../scripts/study/runner';
import { HIGH_PERCENTILE, LOW_PERCENTILE, percentileOf, summarize, type Spread } from '../../scripts/study/summary';
import type { StudyResults } from '../../scripts/study/types';
import { METERS_PER_MILE } from '../../scripts/study/units';
import { allSkipped, noneMatched, studyInput, sum } from './study-helper';

const GRID: GridSpec = { seeds: [1, 2, 3], employeeCounts: [30, 120], packageCounts: [12, 48], detourLimitsMin: [8, 16] };
const results: StudyResults = runStudy(studyInput({ grid: GRID }));
const summary = summarize(results);

describe('percentileOf', () => {
  it('is the value that share of the way through the sorted list, on a line between two neighbours', () => {
    expect(percentileOf([], 50)).toBeNull();
    expect(percentileOf([7], 10)).toBe(7);
    expect(percentileOf([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentileOf([1, 2, 3, 4], 50)).toBe(2.5); // the ordinary median of an even count
    expect(percentileOf([0, 10], 10)).toBeCloseTo(1, 12);
    expect(percentileOf([0, 10], 90)).toBeCloseTo(9, 12);
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 10)).toBeCloseTo(2, 12);
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 90)).toBeCloseTo(10, 12);
    expect(percentileOf([3, 5, 9], 0)).toBe(3);
    expect(percentileOf([3, 5, 9], 100)).toBe(9);
    expect([LOW_PERCENTILE, HIGH_PERCENTILE]).toEqual([10, 90]);
  });
});

describe('the spread across runs', () => {
  const matched = results.runs.filter(run => run.totals.matched > 0);
  /** The same percentiles from scratch: sort, then read off the position. */
  const expected = (values: number[], decimals: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (percentile: number) => Number(percentileOf(sorted, percentile)!.toFixed(decimals));
    return { median: at(50), low: at(10), high: at(90) };
  };
  const close = (spread: Spread, want: { median: number; low: number; high: number }, digits: number) => {
    expect(spread.median).toBeCloseTo(want.median, digits);
    expect(spread.low).toBeCloseTo(want.low, digits);
    expect(spread.high).toBeCloseTo(want.high, digits);
  };

  it('is over the runs that matched a package, one per-package value per run', () => {
    expect(matched.length).toBeGreaterThan(10);
    expect(summary.runsWithMatch).toBe(matched.length);
    expect(summary.runsWithoutMatch).toBe(results.runs.length - matched.length);
    close(summary.costCents.relay, expected(matched.map(run => run.totals.relayCostCents / run.totals.matched), 0), 6);
    close(summary.costCents.courier, expected(matched.map(run => run.totals.courierCostCents / run.totals.matched), 0), 6);
    close(summary.miles.relay, expected(matched.map(run => run.totals.relayAddedM / METERS_PER_MILE / run.totals.matched), 3), 3);
    close(summary.miles.courier, expected(matched.map(run => run.totals.courierTripM / METERS_PER_MILE / run.totals.matched), 3), 3);
    close(summary.co2Kg.relay, expected(matched.map(run => (run.totals.relayAddedM / METERS_PER_MILE) * 0.4 / run.totals.matched), 3), 3);
    close(summary.co2Kg.courier, expected(matched.map(run => (run.totals.courierTripM / METERS_PER_MILE) * 0.4 / run.totals.matched), 3), 3);
    close(summary.onTimeRate.relay, expected(matched.map(run => (run.totals.early + run.totals.onTime) / run.totals.matched), 4), 4);
  });

  it('has the headline as its averages: over all matched packages, not over runs', () => {
    const h = results.headline;
    expect(summary.costCents.relay.average).toBe(h.relayCostPerPackageCents);
    expect(summary.costCents.courier.average).toBe(h.courierCostPerPackageCents);
    expect(summary.miles.relay.average).toBe(h.relayAddedMilesPerPackage);
    expect(summary.miles.courier.average).toBe(h.courierMilesPerPackage);
    expect(summary.co2Kg.relay.average).toBe(h.relayCo2KgPerPackage);
    expect(summary.co2Kg.courier.average).toBe(h.courierCo2KgPerPackage);
    expect(summary.onTimeRate.relay.average).toBe(h.onTimeOrEarlyRate);
  });

  it('keeps low <= median <= high, and the courier always on time (it is assumed to keep its promise)', () => {
    for (const sides of [summary.costCents, summary.miles, summary.co2Kg, summary.onTimeRate]) {
      for (const spread of [sides.relay, sides.courier]) {
        expect(spread.low!).toBeLessThanOrEqual(spread.median!);
        expect(spread.median!).toBeLessThanOrEqual(spread.high!);
      }
    }
    expect(summary.onTimeRate.courier).toEqual({ average: 1, median: 1, low: 1, high: 1 });
    // #861: Relay's price is per plan. Every simulated package has the flexible window (4 p.m. to 10 a.m.), so a
    // package costs $6.00 on one commute or $9.50 on two, and every per-package average lies between the two.
    for (const run of results.runs) {
      for (const row of run.packages) expect(row.relayCostCents, `${run.id} ${row.shipmentId}`).toBe(row.kind === 'direct' ? 600 : 950);
    }
    for (const cents of Object.values(summary.costCents.relay)) {
      expect(cents!).toBeGreaterThanOrEqual(600);
      expect(cents!).toBeLessThanOrEqual(950);
    }
    // The courier's cost varies too (envelopes and boxes).
    expect(summary.costCents.courier.high!).toBeGreaterThan(summary.costCents.courier.low!);
  });

  it('is all null, never NaN, when every run was skipped or none matched', () => {
    for (const none of [summarize(allSkipped(results)), summarize(noneMatched(results))]) {
      expect(JSON.stringify(none)).not.toMatch(/NaN|Infinity/);
      expect(none.runsWithMatch).toBe(0);
      for (const sides of [none.costCents, none.miles, none.co2Kg, none.onTimeRate]) {
        expect(sides.relay).toEqual({ average: null, median: null, low: null, high: null });
        expect(sides.courier).toEqual({ average: null, median: null, low: null, high: null });
      }
    }
    expect(summarize(noneMatched(results)).runsWithoutMatch).toBe(results.runs.length);
  });
});

describe('the groups of runs', () => {
  it('split the runs by employee count, by package count and by detour limit, each run in exactly one group', () => {
    expect(summary.byEmployees.map(group => group.value)).toEqual(GRID.employeeCounts);
    expect(summary.byPackages.map(group => group.value)).toEqual(GRID.packageCounts);
    expect(summary.byDetourLimit.map(group => group.value)).toEqual(GRID.detourLimitsMin);
    for (const groups of [summary.byEmployees, summary.byPackages, summary.byDetourLimit]) {
      expect(groups.map(group => group.runs)).toEqual([12, 12]);
      expect(sum(groups.map(group => group.headline.packages))).toBe(results.totals.packages);
      expect(sum(groups.map(group => group.headline.matched))).toBe(results.totals.matched);
    }
  });

  it('give each group the headline of a study of only its runs', () => {
    for (const group of summary.byDetourLimit) {
      const own = runStudy(studyInput({ grid: { ...GRID, detourLimitsMin: [group.value] } }));
      expect(group.headline).toEqual(own.headline);
    }
    for (const group of summary.byEmployees) {
      const runs = results.runs.filter(run => run.params.employees === group.value);
      expect(group.headline.matchRate).toBeCloseTo(sum(runs.map(run => run.totals.matched)) / sum(runs.map(run => run.totals.packages)), 4);
    }
  });

  it('show the match rate rising with the number of employees on the committed cache', () => {
    const [few, many] = summary.byEmployees;
    expect(many!.headline.matchRate!).toBeGreaterThan(few!.headline.matchRate!);
  });
});

describe('runs.csv', () => {
  const csv = runsCsv(results);
  const lines = csv.split('\n');
  const rows = lines.slice(1, -1).map(line => line.split(','));

  it('has a header and one line per planned run in grid order, each ended by a line feed', () => {
    expect(csv.endsWith('\n')).toBe(true);
    expect(csv).not.toContain('\r');
    expect(lines[0]).toBe(RUNS_CSV_COLUMNS.join(','));
    expect(lines.at(-1)).toBe('');
    expect(rows.map(row => row[0])).toEqual(gridRuns(GRID).map(runIdOf));
    for (const row of rows) expect(row).toHaveLength(RUNS_CSV_COLUMNS.length);
    expect(RUNS_CSV_COLUMNS.slice(0, 6)).toEqual(['run', 'seed', 'employees', 'packages_requested', 'detour_limit_min', 'status']);
    expect(RUNS_CSV_COLUMNS.at(-1)).toBe('skipped_reason');
    expect(new Set(RUNS_CSV_COLUMNS).size).toBe(RUNS_CSV_COLUMNS.length);
  });

  it('copies each run: its settings, then its totals exactly as they are in the results', () => {
    const column = (name: string) => RUNS_CSV_COLUMNS.indexOf(name);
    for (const [index, run] of results.runs.entries()) {
      const row = rows[index]!;
      const t = run.totals;
      expect(row.slice(0, 6)).toEqual([run.id, String(run.params.seed), String(run.params.employees), String(t.packages), String(run.params.maxExtraMin), 'simulated']);
      expect(row[column('packages_matched')]).toBe(String(t.matched));
      expect(row[column('packages_unmatched')]).toBe(String(t.unmatched));
      expect(row[column('match_rate')]).toBe(String(t.matchRate));
      expect(row[column('matched_on_one_commute')]).toBe(String(t.direct));
      expect(row[column('matched_on_two_commutes')]).toBe(String(t.relay));
      expect(row[column('relay_cost_cents')]).toBe(String(t.relayCostCents));
      expect(row[column('courier_cost_cents')]).toBe(String(t.courierCostCents));
      expect(row[column('cost_saved_cents')]).toBe(String(t.costSavedCents));
      expect(row[column('relay_added_m')]).toBe(String(t.relayAddedM));
      expect(row[column('courier_trip_m')]).toBe(String(t.courierTripM));
      expect(row[column('relay_added_miles')]).toBe(String(t.relayAddedMiles));
      expect(row[column('courier_miles')]).toBe(String(t.courierMiles));
      expect(row[column('miles_saved')]).toBe(String(t.milesSaved));
      expect(row[column('relay_co2_kg')]).toBe(String(t.relayCo2Kg));
      expect(row[column('courier_co2_kg')]).toBe(String(t.courierCo2Kg));
      expect(row[column('co2_saved_kg')]).toBe(String(t.co2SavedKg));
      expect(row[column('delivered_a_day_early')]).toBe(String(t.early));
      expect(row[column('delivered_on_time')]).toBe(String(t.onTime));
      expect(row[column('delivered_late')]).toBe(String(t.late));
      expect(row[column('minutes_ahead_of_promise')]).toBe(String(t.minutesAheadOfPromise));
      expect(row[column('skipped_reason')]).toBe('');
    }
    // Every totals field except the requested packages (a setting column) has a column of its own.
    expect(RUNS_CSV_COLUMNS.length).toBe(6 + (Object.keys(results.runs[0]!.totals).length - 1) + 1);
    // The columns add up to the study's totals.
    expect(sum(rows.map(row => Number(row[column('packages_requested')])))).toBe(results.totals.packages);
    expect(sum(rows.map(row => Number(row[column('packages_matched')])))).toBe(results.totals.matched);
    expect(sum(rows.map(row => Number(row[column('relay_added_m')])))).toBe(results.totals.relayAddedM);
  });

  it('keeps a skipped run in its place, with empty totals and its reason, quoted when it has a comma or a quote', () => {
    const skipped = allSkipped(results);
    skipped.grid.skippedRuns[1]!.reason = 'No travel data for "biz-a", home-001';
    const skippedLines = runsCsv(skipped).split('\n');
    expect(skippedLines).toHaveLength(lines.length);
    expect(skippedLines[1]).toBe(`s1-e30-p12-d8,1,30,12,8,skipped${','.repeat(RUNS_CSV_COLUMNS.length - 7)},No travel matrix data for biz-a|home-001`);
    expect(skippedLines[2]).toBe(`s1-e30-p12-d16,1,30,12,16,skipped${','.repeat(RUNS_CSV_COLUMNS.length - 7)},"No travel data for ""biz-a"", home-001"`);
    expect(runsCsv(skipped)).not.toMatch(/null|undefined|NaN/);
  });

  it('is deterministic and has no NaN: a run that matched nothing has a match rate of 0', () => {
    expect(runsCsv(JSON.parse(JSON.stringify(results)) as StudyResults)).toBe(csv);
    expect(csv).not.toMatch(/null|undefined|NaN|Infinity/);
    const none = runsCsv(noneMatched(results)).split('\n')[1]!.split(',');
    expect(none.slice(5, 9)).toEqual(['simulated', '0', '12', '0']);
  });
});
