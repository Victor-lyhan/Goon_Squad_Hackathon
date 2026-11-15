// `client/public/study/runs.csv`: every planned run of the study as one row, linked from the study page as
// "Download every run (CSV)". Pure and deterministic: the same results give the same bytes.
// A simulated run's row is its totals exactly as they are in the results file (scripts/study/types.ts,
// ComparisonTotals); nothing is computed here. A skipped run has its settings, `skipped` and the reason.
// Rows are in grid order (seed outermost, detour limit innermost), skipped runs in their place.
import { gridRuns, runIdOf } from './grid';
import type { ComparisonTotals, StudyResults } from './types';

/** The columns of a simulated run's totals, in file order: the CSV name and the field it is read from. */
const TOTAL_COLUMNS: ReadonlyArray<readonly [string, keyof ComparisonTotals]> = [
  ['packages_matched', 'matched'],
  ['packages_unmatched', 'unmatched'],
  ['match_rate', 'matchRate'],
  ['matched_on_one_commute', 'direct'],
  ['matched_on_two_commutes', 'relay'],
  ['relay_cost_cents', 'relayCostCents'],
  ['courier_cost_cents', 'courierCostCents'],
  ['cost_saved_cents', 'costSavedCents'],
  ['relay_added_m', 'relayAddedM'],
  ['courier_trip_m', 'courierTripM'],
  ['relay_added_miles', 'relayAddedMiles'],
  ['courier_miles', 'courierMiles'],
  ['miles_saved', 'milesSaved'],
  ['relay_co2_kg', 'relayCo2Kg'],
  ['courier_co2_kg', 'courierCo2Kg'],
  ['co2_saved_kg', 'co2SavedKg'],
  ['delivered_a_day_early', 'early'],
  ['delivered_on_time', 'onTime'],
  ['delivered_late', 'late'],
  ['minutes_ahead_of_promise', 'minutesAheadOfPromise'],
];

/** The header row. Money, distance, CO2 and minutes are totals over the run's matched packages. */
export const RUNS_CSV_COLUMNS: readonly string[] = [
  'run', 'seed', 'employees', 'packages_requested', 'detour_limit_min', 'status',
  ...TOTAL_COLUMNS.map(([name]) => name),
  'skipped_reason',
];

/** A field as CSV text: quoted when it holds a comma, a quote or a line break. */
function field(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file: the header and one line per planned run, each ended by a line feed. */
export function runsCsv(results: StudyResults): string {
  const simulated = new Map(results.runs.map(run => [run.id, run]));
  const skipped = new Map(results.grid.skippedRuns.map(run => [run.id, run]));
  const lines = [RUNS_CSV_COLUMNS.join(',')];
  for (const params of gridRuns(results.grid)) {
    const id = runIdOf(params);
    const run = simulated.get(id);
    const settings = [id, params.seed, params.employees, params.packages, params.maxExtraMin];
    if (run) {
      lines.push([...settings, 'simulated', ...TOTAL_COLUMNS.map(([, key]) => run.totals[key]), ''].map(field).join(','));
    } else {
      lines.push([...settings, 'skipped', ...TOTAL_COLUMNS.map(() => null), skipped.get(id)?.reason ?? ''].map(field).join(','));
    }
  }
  return `${lines.join('\n')}\n`;
}
