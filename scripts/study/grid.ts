// What the study simulates: every combination of these four lists, one Random city of the NYC generator each.
// These are inputs, not assumptions; the results file repeats them under `grid`.
// Every value must be allowed by GenerateScenarioRequest (shared/v2/schemas.ts): employees 10-120,
// packages 5-60, detour limit 0-30 minutes. The Random city draws its homes from the 120 pool homes, and the
// committed cache has every home <-> business and business <-> business pair, so no run needs Google.
import type { RunParams } from './types';

export type GridSpec = {
  seeds: readonly number[];
  employeeCounts: readonly number[];
  packageCounts: readonly number[];
  detourLimitsMin: readonly number[];
};

/**
 * 3 x 3 x 3 x 3 = 81 runs around the default run (60 employees, 24 packages):
 * half and double the employees and the packages, and detour limits from the engine's default (8 minutes)
 * through the generator's default (12) to 16.
 */
export const DEFAULT_GRID: GridSpec = {
  seeds: [1, 2, 3],
  employeeCounts: [30, 60, 120],
  packageCounts: [12, 24, 48],
  detourLimitsMin: [8, 12, 16],
};

/** `s<seed>-e<employees>-p<packages>-d<maxExtraMin>`: deterministic, unique within a grid of distinct values. */
export const runIdOf = (p: RunParams): string => `s${p.seed}-e${p.employees}-p${p.packages}-d${p.maxExtraMin}`;

/** Every combination, seed outermost and detour limit innermost. */
export function gridRuns(grid: GridSpec): RunParams[] {
  const runs: RunParams[] = [];
  for (const seed of grid.seeds) {
    for (const employees of grid.employeeCounts) {
      for (const packages of grid.packageCounts) {
        for (const maxExtraMin of grid.detourLimitsMin) runs.push({ seed, employees, packages, maxExtraMin });
      }
    }
  }
  return runs;
}
