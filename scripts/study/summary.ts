// Summaries of a finished study for the page and the terminal: the spread across runs (median and the 10th to
// 90th percentile of each run's per-package value) and the results of the runs that share one grid value.
// Pure, and it makes no new comparison: every value is read from the runs' exact totals, converted with the
// same helpers and assumptions as the headline (baseline.ts). The only numbers of its own are which
// percentiles it reports.
import { assumptionValues, type AssumptionValues } from './assumptions';
import { co2Kg, headlineOf, studyTotals } from './baseline';
import type { ComparisonTotals, StudyHeadline, StudyResults, StudyRun } from './types';
import { KG_DECIMALS, MILES_DECIMALS, RATE_DECIMALS, milesFromMeters, roundTo } from './units';

/** The ends of the range the summaries show: the middle 80% of the runs lie between them. */
export const LOW_PERCENTILE = 10;
export const HIGH_PERCENTILE = 90;
const MEDIAN_PERCENTILE = 50;

/**
 * The `percentile`th percentile (0 to 100) of `sorted`, which must be in ascending order: the value at that
 * share of the way through the list, on a straight line between the two neighbours when it falls between
 * them (the usual spreadsheet rule, so the 50th is the ordinary median). Null for an empty list.
 */
export function percentileOf(sorted: readonly number[], percentile: number): number | null {
  if (sorted.length === 0) return null;
  const position = (percentile / 100) * (sorted.length - 1);
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below);
}

/** One per-package measure of one side: over all matched packages, and how it varies from run to run. */
export type Spread = {
  /** Over all matched packages of the study: the headline's value. */
  average: number | null;
  /** Median of the runs' own per-package values. */
  median: number | null;
  /** 10th and 90th percentile of the runs' own per-package values. */
  low: number | null;
  high: number | null;
};

export type SidesSpread = { relay: Spread; courier: Spread };

/** The runs that share one grid value (30 employees, a 12-minute detour limit, ...). */
export type GroupSummary = {
  /** The grid value. */
  value: number;
  runs: number;
  /** The group's exact totals added up, as the headline of a study of only these runs. */
  headline: StudyHeadline;
};

export type StudySummary = {
  /** Runs that matched at least one package: the runs the spread is over. */
  runsWithMatch: number;
  /** Runs that matched nothing: they have no per-package value and are left out of the spread. */
  runsWithoutMatch: number;
  /** Cost to the sender per package, in cents (whole cents after rounding). */
  costCents: SidesSpread;
  /** Added vehicle miles per package. */
  miles: SidesSpread;
  /** kg of CO2 per package. */
  co2Kg: SidesSpread;
  /** Share delivered by the courier's promised time. The courier is assumed to always keep its promise. */
  onTimeRate: SidesSpread;
  byEmployees: GroupSummary[];
  byPackages: GroupSummary[];
  byDetourLimit: GroupSummary[];
};

function spreadOf(average: number | null, values: readonly number[], decimals: number): Spread {
  const sorted = [...values].sort((x, y) => x - y);
  const at = (percentile: number): number | null => {
    const value = percentileOf(sorted, percentile);
    return value === null ? null : roundTo(value, decimals);
  };
  return { average, median: at(MEDIAN_PERCENTILE), low: at(LOW_PERCENTILE), high: at(HIGH_PERCENTILE) };
}

function groupsOf(
  runs: readonly StudyRun[], values: readonly number[], pick: (run: StudyRun) => number, a: AssumptionValues,
): GroupSummary[] {
  return values.map(value => {
    const group = runs.filter(run => pick(run) === value);
    return { value, runs: group.length, headline: headlineOf(studyTotals(group.map(run => run.totals), 0, a), a) };
  });
}

/** The summaries of `results`. Deterministic: the same results give the same numbers. */
export function summarize(results: StudyResults): StudySummary {
  const a = assumptionValues(results.assumptions);
  const { headline: h, grid, runs } = results;
  const matched = runs.filter(run => run.totals.matched > 0);
  /** One value per run that matched something: the run's total per matched package. */
  const perPackage = (total: (totals: ComparisonTotals) => number): number[] =>
    matched.map(run => total(run.totals) / run.totals.matched);
  const courierOnTime = matched.length === 0 ? null : 1;

  return {
    runsWithMatch: matched.length,
    runsWithoutMatch: runs.length - matched.length,
    costCents: {
      relay: spreadOf(h.relayCostPerPackageCents, perPackage(t => t.relayCostCents), 0),
      courier: spreadOf(h.courierCostPerPackageCents, perPackage(t => t.courierCostCents), 0),
    },
    miles: {
      relay: spreadOf(h.relayAddedMilesPerPackage, perPackage(t => milesFromMeters(t.relayAddedM)), MILES_DECIMALS),
      courier: spreadOf(h.courierMilesPerPackage, perPackage(t => milesFromMeters(t.courierTripM)), MILES_DECIMALS),
    },
    co2Kg: {
      relay: spreadOf(h.relayCo2KgPerPackage, perPackage(t => co2Kg(t.relayAddedM, a.commuterCo2KgPerMile)), KG_DECIMALS),
      courier: spreadOf(h.courierCo2KgPerPackage, perPackage(t => co2Kg(t.courierTripM, a.courierCo2KgPerMile)), KG_DECIMALS),
    },
    onTimeRate: {
      relay: spreadOf(h.onTimeOrEarlyRate, perPackage(t => t.early + t.onTime), RATE_DECIMALS),
      courier: { average: courierOnTime, median: courierOnTime, low: courierOnTime, high: courierOnTime },
    },
    byEmployees: groupsOf(runs, grid.employeeCounts, run => run.params.employees, a),
    byPackages: groupsOf(runs, grid.packageCounts, run => run.params.packages, a),
    byDetourLimit: groupsOf(runs, grid.detourLimitsMin, run => run.params.maxExtraMin, a),
  };
}
