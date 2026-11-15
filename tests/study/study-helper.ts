// Shared by tests/study/*.test.ts: the study on the REAL committed NYC cache (fixtures/nyc), read once.
// No key, no network, nothing written. Counts and IDs of the cache are never pinned: expectations are read
// from the results or recomputed from the engine.
import { NYC_FIXTURES_DIR, readNycFixtures } from '../../server/api/v2/bootRun';
import { readTravelFiles, type TravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import type { GridSpec } from '../../scripts/study/grid';
import type { StudyInput } from '../../scripts/study/runner';
import type { Assumption } from '../../scripts/study/types';

/**
 * Per test (DECISIONS pass 19 and 52: explicit, far above the local time). The whole 81-run study takes about
 * a second locally; the issue allows 3 minutes. No test asserts a duration.
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

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
