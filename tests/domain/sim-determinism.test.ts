import { describe, expect, it } from 'vitest';
import type {
  AssignmentResult,
  DeliveryPlan,
  Job,
  Run,
  Scenario,
} from '../../shared/types';
import { generateScenario, type GenerateScenarioOptions } from '../../server/domain/generator';
import { assignShipments, type MatchContext, type MatchMode } from '../../server/domain/matching';
import { computeMetrics } from '../../server/domain/metrics';
import { buildTrips, createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

const SNAPSHOT_TIMES = [930, 1500, 2160];
const SEEDS = [1, 42, 999];

const DEFAULT_CITY: Omit<GenerateScenarioOptions, 'seed'> = {
  preset: 'random', employees: 60, packages: 24, hubs: 6, maxExtraMin: 8,
};

const MAX_CITY: Omit<GenerateScenarioOptions, 'seed'> = {
  preset: 'random', employees: 200, packages: 60, hubs: 10, maxExtraMin: 8,
};

type PipelineResult = {
  scenario: Scenario;
  modes: Record<MatchMode, {
    assignments: AssignmentResult;
    trips: Run['trips'];
    jobs: Job[];
    timeline: Run['events'];
    snapshots: ReturnType<typeof snapshotAt>[];
    metrics: ReturnType<typeof computeMetrics>[];
    stateFile: { schemaVersion: 1; run: Run };
  }>;
};

function jobsFor(plans: DeliveryPlan[]): Job[] {
  return plans.flatMap((plan) => plan.legs.map((leg, legIndex) => ({
    id: `${plan.id}-L${legIndex}`,
    planId: plan.id,
    shipmentId: plan.shipmentId,
    employeeId: leg.employeeId,
    legIndex,
    tripId: leg.tripId,
    pickup: leg.stops[0]!,
    dropoff: leg.stops[leg.stops.length - 1]!,
    rewardCents: leg.rewardCents,
  })));
}

function pipeline(options: GenerateScenarioOptions): PipelineResult {
  const scenario = generateScenario(options);
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap((employee) => buildTrips(employee, scenario.businesses, router));
  const context: MatchContext = {
    router,
    trips,
    employees: scenario.employees,
    businesses: scenario.businesses,
    hubs: scenario.hubs,
    settings: scenario.settings,
  };

  const modes = Object.fromEntries((['with_relay', 'direct_only'] as const).map((mode) => {
    const assignments = assignShipments(scenario.shipments, context, { mode });
    const jobs = jobsFor(assignments.plans);
    const timeline = buildTimeline(assignments.plans, jobs, scenario.hubs);
    const run: Run = {
      runId: `determinism-${scenario.seed}-${mode}`,
      version: 1,
      scenario,
      trips,
      assignments,
      jobs,
      notifications: [],
      events: timeline,
      clock: { phase: 'locked', playing: false, timeMin: scenario.settings.simStartMin, speed: 30 },
    };
    const snapshots = SNAPSHOT_TIMES.map((timeMin) => snapshotAt(run, timeMin));
    const metrics = snapshots.map((snapshot) => computeMetrics({
      shipments: scenario.shipments,
      plans: assignments.plans,
      unmatched: assignments.unmatched,
      occurredEvents: snapshot.occurredEvents,
      settings: scenario.settings,
    }));

    return [mode, {
      assignments, trips, jobs, timeline, snapshots, metrics,
      stateFile: { schemaVersion: 1, run },
    }];
  })) as PipelineResult['modes'];

  return { scenario, modes };
}

function assertIdFormats(result: PipelineResult): void {
  const tripId = /^emp-\d+-(?:eve|morn)$/;
  const planId = /^plan-shp-\d+$/;
  const jobId = /^plan-shp-\d+-L\d+$/;

  for (const mode of ['with_relay', 'direct_only'] as const) {
    const output = result.modes[mode];
    expect(output.trips.every((trip) => tripId.test(trip.id))).toBe(true);
    expect(output.assignments.plans.every((plan) => planId.test(plan.id))).toBe(true);
    expect(output.assignments.plans.every((plan) => plan.legs.every((leg) => tripId.test(leg.tripId)))).toBe(true);
    expect(output.jobs.every((job) => jobId.test(job.id))).toBe(true);
  }
}

describe('generated-city domain pipeline determinism', () => {
  it.each([
    ['default city', DEFAULT_CITY],
    ['maximum city', MAX_CITY],
  ])('is deeply and byte-for-byte stable for every required seed in the %s', (_name, city) => {
    for (const seed of SEEDS) {
      const options = { ...city, seed };
      const first = pipeline(options);
      const second = pipeline(options);

      expect(second).toEqual(first);
      // This mirrors persistence: key insertion order must remain stable too.
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      for (const mode of ['with_relay', 'direct_only'] as const) {
        expect(JSON.stringify(second.modes[mode].stateFile))
          .toBe(JSON.stringify(first.modes[mode].stateFile));
      }
      assertIdFormats(first);
    }
  }, 120_000);

  it('changes generated scenarios when the seed changes', () => {
    const first = generateScenario({ ...DEFAULT_CITY, seed: 1 });
    const second = generateScenario({ ...DEFAULT_CITY, seed: 42 });

    expect(second).not.toEqual(first);
    expect(JSON.stringify(second)).not.toBe(JSON.stringify(first));
  }, 10_000);
});
