// Runs the study: one full Relay simulation per grid cell on the cached travel data, each matched package
// compared with the courier baseline. Pure: no fs, no clock, no network; the caller supplies the travel
// provider (the CachedProvider over fixtures/nyc) and the parsed fixture files.
// A run is simulated by `runOutcome` and the file is put together by `assembleStudy`, in grid order, so the
// worker threads of scripts/study/parallel.ts give the same results as `runStudy` on one thread.
// Read-only use of the engine: the scenario generator, the server's own run builder (trips, matching, jobs,
// timeline) and the snapshot at the end of the simulated two days.
// tests/study/assumptions.test.ts fails if a number literal other than 0 or 1 appears in this file.
import { TravelDataMissingError, type Scenario, type TravelMatrixFile, type TravelProvider } from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import type { NycFixtures } from '../../server/api/v2/bootRun';
import { createInitialRun } from '../../server/api/v2/initialRun';
import type { TravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { ASSUMPTIONS, assumptionValues, type AssumptionValues } from './assumptions';
import { comparePackage, headlineOf, runTotals, studyTotals } from './baseline';
import { DEFAULT_GRID, gridRuns, runIdOf, type GridSpec } from './grid';
import type { Assumption, PackageComparison, RunParams, SkippedRun, StudyResults, StudyRun } from './types';

export type StudyInput = {
  /** Travel times and distances. The study only ever passes a provider over the cache: it never calls Google. */
  travel: TravelProvider;
  /** `matrix.json` places: the geocoded businesses. */
  places: TravelMatrixFile['places'];
  fixtures: NycFixtures;
  grid?: GridSpec;
  assumptions?: readonly Assumption[];
};

/**
 * The study's input as plain data: the travel cache and the fixture files as read from disk. This is what a
 * worker thread is given (a travel provider has functions and cannot be sent to one).
 */
export type StudyData = {
  files: TravelFiles;
  fixtures: NycFixtures;
  grid?: GridSpec;
  assumptions?: readonly Assumption[];
};

/** The input of `runStudy` over that data: a provider that only reads the cache. */
export function studyInputOf(data: StudyData): StudyInput {
  return {
    travel: createCachedProvider(data.files),
    places: data.files.matrix.places,
    fixtures: data.fixtures,
    grid: data.grid,
    assumptions: data.assumptions,
  };
}

/** The scenario of one grid cell: a Random city, priced with the study's Relay price. */
function scenarioFor(params: RunParams, input: StudyInput, a: AssumptionValues): Scenario {
  const request = GenerateScenarioRequest.parse({ preset: 'random', ...params });
  const scenario = buildNycScenario({ ...input.fixtures, places: input.places, request });
  return { ...scenario, settings: { ...scenario.settings, priceCents: a.relayPriceCents } };
}

/**
 * One full simulation and its comparison rows, with the window of the packages it requested. Throws TravelDataMissingError if the run needs a pair the
 * provider does not have, and an Error if the simulation ends without delivering a matched package.
 */
export function simulateRun(
  params: RunParams, input: StudyInput, a: AssumptionValues,
): { run: StudyRun; earliestReadyMin: number; latestDeadlineMin: number } {
  const scenario = scenarioFor(params, input, a);
  const run = createInitialRun(scenario, { travel: input.travel, buildEvents: buildTimeline });
  const end = snapshotAt(run, scenario.settings.simEndMin, input.travel);

  const shipments = new Map(scenario.shipments.map(shipment => [shipment.id, shipment]));
  const tripsById = new Map(run.trips.map(trip => [trip.id, trip]));
  const packages: PackageComparison[] = run.assignments.plans.map(plan => {
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) throw new Error(`Run ${runIdOf(params)}: plan ${plan.id} has no shipment`);
    const deliveredAtMin = end.deliveredAtMin[shipment.id];
    if (deliveredAtMin === undefined) {
      throw new Error(`Run ${runIdOf(params)}: the simulation ended without delivering ${shipment.id}`);
    }
    return comparePackage({
      shipment, plan, deliveredAtMin, tripsById,
      directM: input.travel.distanceM(shipment.originBusinessId, shipment.destinationBusinessId),
    }, a);
  });
  return {
    run: { id: runIdOf(params), params, packages, totals: runTotals(packages, scenario.shipments.length, a) },
    earliestReadyMin: Math.min(...scenario.shipments.map(shipment => shipment.readyMin)),
    latestDeadlineMin: Math.max(...scenario.shipments.map(shipment => shipment.deadlineMin)),
  };
}

/** What one planned run came to: its simulation, or why it was skipped. Plain data, so a worker thread can send it. */
export type RunOutcome =
  | { run: StudyRun; earliestReadyMin: number; latestDeadlineMin: number }
  | { skipped: SkippedRun };

/** The assumptions a study runs with: a copy of the given list (default: ASSUMPTIONS), so the results own theirs. */
export function studyAssumptions(assumptions?: readonly Assumption[]): Assumption[] {
  return (assumptions ?? ASSUMPTIONS).map(assumption => ({ ...assumption }));
}

/** One planned run. A run that needs an uncached pair is skipped, never estimated; any other error is thrown. */
export function runOutcome(params: RunParams, input: StudyInput, a: AssumptionValues): RunOutcome {
  try {
    return simulateRun(params, input, a);
  } catch (error) {
    if (!(error instanceof TravelDataMissingError)) throw error;
    return { skipped: { id: runIdOf(params), params, reason: error.message } };
  }
}

/**
 * The results file from the outcome of every planned run. `outcomes[i]` belongs to `gridRuns(grid)[i]`: the
 * order of the grid, not the order the runs finished in, so one thread and many threads give the same file.
 */
export function assembleStudy(grid: GridSpec, assumptions: readonly Assumption[], outcomes: readonly RunOutcome[]): StudyResults {
  const a = assumptionValues(assumptions);
  const runs: StudyRun[] = [];
  const skippedRuns: SkippedRun[] = [];
  const readyMins: number[] = [];
  const deadlineMins: number[] = [];
  for (const outcome of outcomes) {
    if ('skipped' in outcome) {
      skippedRuns.push(outcome.skipped);
    } else {
      runs.push(outcome.run);
      readyMins.push(outcome.earliestReadyMin);
      deadlineMins.push(outcome.latestDeadlineMin);
    }
  }

  // Folded, not spread into Math.min: a study has thousands of runs.
  const least = (values: readonly number[]): number => values.reduce((low, value) => Math.min(low, value));
  const most = (values: readonly number[]): number => values.reduce((high, value) => Math.max(high, value));
  const totals = studyTotals(runs.map(run => run.totals), skippedRuns.length, a);
  return {
    assumptions: assumptions.map(assumption => ({ ...assumption })),
    grid: {
      preset: 'random',
      seeds: [...grid.seeds],
      employeeCounts: [...grid.employeeCounts],
      packageCounts: [...grid.packageCounts],
      detourLimitsMin: [...grid.detourLimitsMin],
      requestWindow: runs.length === 0 ? null : {
        earliestReadyMin: least(readyMins),
        latestDeadlineMin: most(deadlineMins),
      },
      plannedRuns: outcomes.length,
      completedRuns: runs.length,
      skippedRuns,
    },
    runs,
    totals,
    headline: headlineOf(totals, a),
  };
}

/**
 * The whole study on this thread, one run after the other in grid order. `onRun` is told after every run how
 * many are done. scripts/study/parallel.ts runs the same runs on worker threads and gives the same results.
 */
export function runStudy(input: StudyInput, onRun?: (done: number, planned: number) => void): StudyResults {
  const grid = input.grid ?? DEFAULT_GRID;
  const assumptions = studyAssumptions(input.assumptions);
  const a = assumptionValues(assumptions);
  const planned = gridRuns(grid);
  const outcomes: RunOutcome[] = [];
  for (const params of planned) {
    outcomes.push(runOutcome(params, input, a));
    onRun?.(outcomes.length, planned.length);
  }
  return assembleStudy(grid, assumptions, outcomes);
}
