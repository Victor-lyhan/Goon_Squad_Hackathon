// Shared by tests/study/*.test.ts: the study on the REAL committed NYC cache (fixtures/nyc), read once.
// No key, no network, nothing written. Counts and IDs of the cache are never pinned: expectations are read
// from the results or recomputed from the engine.
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { readTravelFiles, type TravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import type { GridSpec } from '../../scripts/study/grid';
import type { StudyData, StudyInput } from '../../scripts/study/runner';
import type { Assumption, StudyResults } from '../../scripts/study/types';

/**
 * Per test (DECISIONS pass 19 and 52: explicit, far above the local time). The whole 3,024-run study takes
 * about 12 seconds on one thread and 2 to 4 on worker threads locally; tests run small grids, and only
 * tests/study/committed-page.test.ts runs the whole study, once. No test asserts a duration.
 */
export const STUDY_TIMEOUT_MS = 180_000;

/** Two runs that differ only in the seed: enough packages of both categories and both plan kinds. */
export const TWO_RUN_GRID: GridSpec = { seeds: [1, 2], employeeCounts: [60], packageCounts: [24], detourLimitsMin: [12] };

export function nycTravelFiles(): TravelFiles {
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache (matrix.json and polylines.json)');
  return files;
}

/** The input `npm run study` builds, over `files` (default: the committed cache). */
export function studyInput(
  options: { grid?: GridSpec; assumptions?: readonly Assumption[]; files?: TravelFiles } = {},
): StudyInput {
  const files = options.files ?? nycTravelFiles();
  return {
    travel: createCachedProvider(files),
    places: files.matrix.places,
    fixtures: readNycFixtures(NYC_FIXTURES_DIR),
    grid: options.grid,
    assumptions: options.assumptions,
  };
}

/** The same input as plain data, the way `npm run study` hands it to its worker threads. */
export function studyData(
  options: { grid?: GridSpec; assumptions?: readonly Assumption[]; files?: TravelFiles } = {},
): StudyData {
  return {
    files: options.files ?? nycTravelFiles(),
    fixtures: readNycFixtures(NYC_FIXTURES_DIR),
    grid: options.grid,
    assumptions: options.assumptions,
  };
}

/** `sample` as a study where every run was skipped: no run, no package, every average null. */
export function allSkipped(sample: StudyResults): StudyResults {
  return {
    ...sample,
    grid: {
      ...sample.grid,
      requestWindow: null,
      completedRuns: 0,
      skippedRuns: sample.runs.map(run => ({ id: run.id, params: run.params, reason: 'No travel matrix data for biz-a|home-001' })),
    },
    runs: [],
    totals: {
      ...(Object.fromEntries(Object.keys(sample.totals).map(key => [key, 0])) as unknown as StudyResults['totals']),
      matchRate: null, skippedRuns: sample.runs.length,
    },
    headline: {
      ...(Object.fromEntries(Object.keys(sample.headline).map(key => [key, null])) as unknown as StudyResults['headline']),
      runs: 0, packages: 0, matched: 0,
    },
  };
}

/** `sample` with runs that were simulated but matched nothing: the per-package values have nothing to divide by. */
export function noneMatched(sample: StudyResults): StudyResults {
  const empty = allSkipped(sample);
  return {
    ...empty,
    grid: { ...sample.grid },
    runs: sample.runs.map(run => ({
      ...run,
      packages: [],
      totals: {
        ...(Object.fromEntries(Object.keys(run.totals).map(key => [key, 0])) as unknown as StudyResults['runs'][number]['totals']),
        packages: run.totals.packages, unmatched: run.totals.packages, matchRate: 0,
      },
    })),
    totals: { ...empty.totals, runs: sample.runs.length, skippedRuns: 0, packages: sample.totals.packages, unmatched: sample.totals.packages, matchRate: 0 },
    headline: { ...empty.headline, runs: sample.runs.length, packages: sample.totals.packages, matchRate: 0 },
  };
}

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
