// Runs the study: one full Relay simulation per grid cell on the cached travel data, each matched package
// compared with the courier baseline. Pure: no fs, no clock, no network; the caller supplies the travel
// provider (the CachedProvider over fixtures/nyc) and the parsed fixture files.
// Read-only use of the engine: the scenario generator, the server's own run builder (trips, matching, jobs,
// timeline) and the snapshot at the end of the simulated two days.
// tests/study/assumptions.test.ts fails if a number literal other than 0 or 1 appears in this file.
import { TravelDataMissingError, type Scenario, type TravelMatrixFile, type TravelProvider } from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import type { NycFixtures } from '../../server/api/v2/bootRun';
import { createInitialRun } from '../../server/api/v2/initialRun';
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

/** The whole study. A run that needs an uncached pair is skipped and listed under `grid.skippedRuns`. */
export function runStudy(input: StudyInput): StudyResults {
  const grid = input.grid ?? DEFAULT_GRID;
  const assumptions = (input.assumptions ?? ASSUMPTIONS).map(assumption => ({ ...assumption }));
  const a = assumptionValues(assumptions);

  const planned = gridRuns(grid);
  const runs: StudyRun[] = [];
  const skippedRuns: SkippedRun[] = [];
  const readyMins: number[] = [];
  const deadlineMins: number[] = [];
  for (const params of planned) {
    try {
      const simulated = simulateRun(params, input, a);
      runs.push(simulated.run);
      readyMins.push(simulated.earliestReadyMin);
      deadlineMins.push(simulated.latestDeadlineMin);
    } catch (error) {
      if (!(error instanceof TravelDataMissingError)) throw error;
      skippedRuns.push({ id: runIdOf(params), params, reason: error.message });
    }
  }

  const totals = studyTotals(runs.map(run => run.totals), skippedRuns.length, a);
  return {
    assumptions,
    grid: {
      preset: 'random',
      seeds: [...grid.seeds],
      employeeCounts: [...grid.employeeCounts],
      packageCounts: [...grid.packageCounts],
      detourLimitsMin: [...grid.detourLimitsMin],
      requestWindow: runs.length === 0 ? null : {
        earliestReadyMin: Math.min(...readyMins),
        latestDeadlineMin: Math.max(...deadlineMins),
      },
      plannedRuns: planned.length,
      completedRuns: runs.length,
      skippedRuns,
    },
    runs,
    totals,
    headline: headlineOf(totals, a),
  };
}
