import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job, Run, Scenario } from '../../shared/types';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, type MatchContext } from '../../server/domain/matching';
import { createRouter, buildTrips } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

const DEFAULT_RANDOM_OPTIONS = {
  preset: 'random' as const,
  employees: 60,
  packages: 24,
  hubs: 6,
  maxExtraMin: 8,
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

function generatedRun(scenario: Scenario): Run {
  const router = createRouter(scenario.graph);
  const context: MatchContext = {
    router,
    employees: scenario.employees,
    businesses: scenario.businesses,
    hubs: scenario.hubs,
    settings: scenario.settings,
    trips: scenario.employees.flatMap((employee) => buildTrips(employee, scenario.businesses, router)),
  };
  const assignments = assignShipments(scenario.shipments, context);
  const jobs = jobsFor(assignments.plans);

  return {
    runId: `invariant-${scenario.seed}`,
    version: 1,
    scenario,
    trips: context.trips,
    assignments,
    jobs,
    notifications: [],
    events: buildTimeline(assignments.plans, jobs, scenario.hubs),
    clock: { phase: 'locked', playing: false, timeMin: scenario.settings.simStartMin, speed: 30 },
  };
}

const shipmentProgressRank = {
  scheduled: 0,
  picked_up: 1,
  at_hub: 2,
  out_for_delivery: 3,
  delivered: 4,
} as const;

const jobStatusRank = { assigned: 0, in_progress: 1, completed: 2 } as const;

function assertRunInvariants(run: Run): void {
  const { simStartMin, simEndMin } = run.scenario.settings;
  const plannedShipmentIds = new Set(run.assignments.plans.map((plan) => plan.shipmentId));
  const previousShipmentProgress = new Map<string, number>();
  const previousJobStatus = new Map<string, number>();
  let previousEarnings = 0;

  for (let timeMin = simStartMin; timeMin <= simEndMin; timeMin += 15) {
    const snapshot = snapshotAt(run, timeMin);
    const earnings = Object.values(snapshot.earningsCents).reduce((sum, cents) => sum + cents, 0);

    expect(earnings).toBeGreaterThanOrEqual(previousEarnings);
    previousEarnings = earnings;

    for (const shipmentId of plannedShipmentIds) {
      const rank = shipmentProgressRank[snapshot.shipmentStatus[shipmentId] as keyof typeof shipmentProgressRank];
      expect(rank).toBeDefined();
      expect(rank).toBeGreaterThanOrEqual(previousShipmentProgress.get(shipmentId) ?? 0);
      previousShipmentProgress.set(shipmentId, rank);
    }

    for (const [jobId, status] of Object.entries(snapshot.jobStatus)) {
      const rank = jobStatusRank[status];
      expect(rank).toBeGreaterThanOrEqual(previousJobStatus.get(jobId) ?? 0);
      previousJobStatus.set(jobId, rank);
    }

    for (const marker of snapshot.markers) {
      expect(Number.isFinite(marker.x)).toBe(true);
      expect(Number.isFinite(marker.y)).toBe(true);
    }
  }

  const finalSnapshot = snapshotAt(run, simEndMin);
  for (const plan of run.assignments.plans) {
    expect(finalSnapshot.shipmentStatus[plan.shipmentId]).toBe('delivered');
  }
  for (const status of Object.values(finalSnapshot.jobStatus)) expect(status).toBe('completed');

  const allRewards = run.assignments.plans.flatMap((plan) => plan.legs)
    .reduce((sum, leg) => sum + leg.rewardCents, 0);
  expect(finalSnapshot.metrics.earnedRewardsCents).toBe(allRewards);
  expect(Object.values(finalSnapshot.earningsCents).reduce((sum, cents) => sum + cents, 0)).toBe(allRewards);

  for (const plan of run.assignments.plans) {
    const events = run.events.filter((event) => event.planId === plan.id);
    if (plan.kind === 'relay') {
      const [pickup, hubDrop, hubPickup, delivered] = events;
      expect(pickup?.kind).toBe('pickup');
      expect(hubDrop?.kind).toBe('hub_drop');
      expect(hubPickup?.kind).toBe('hub_pickup');
      expect(delivered?.kind).toBe('delivered');
      expect(pickup!.timeMin).toBeLessThan(hubDrop!.timeMin);
      expect(hubDrop!.timeMin).toBeLessThanOrEqual(hubPickup!.timeMin);
      expect(hubPickup!.timeMin).toBeLessThan(delivered!.timeMin);
    } else {
      expect(events.map((event) => event.kind)).toEqual(['pickup', 'delivered']);
      expect(events[0]!.timeMin).toBeLessThan(events[1]!.timeMin);
    }
  }

  for (const job of run.jobs) {
    const events = run.events.filter((event) => event.jobId === job.id);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(snapshotAt(run, simStartMin).jobStatus[job.id]).toBe('assigned');
    expect(snapshotAt(run, events[0]!.timeMin).jobStatus[job.id]).toBe('in_progress');
    expect(snapshotAt(run, events[events.length - 1]!.timeMin).jobStatus[job.id]).toBe('completed');
  }
}

describe('generated-city simulation invariants', () => {
  const seeds = Array.from({ length: 15 }, (_, index) => index + 1);
  const runs = new Map<number, Run>();

  beforeAll(() => {
    for (const seed of seeds) runs.set(seed, generatedRun(generateScenario({ ...DEFAULT_RANDOM_OPTIONS, seed })));
    runs.set(16, generatedRun(generateScenario({
      preset: 'random', seed: 16, employees: 200, packages: 60, hubs: 10, maxExtraMin: 8,
    })));
  }, 30_000);

  it.each(seeds)('keeps timeline snapshots monotonic and complete for random seed %i', (seed) => {
    assertRunInvariants(runs.get(seed)!);
  }, 10_000);

  it('handles the maximum generated city and snapshots it in under 50 ms', () => {
    const run = runs.get(16)!;
    assertRunInvariants(run);

    let slowestMs = 0;
    // assertRunInvariants above warms the snapshot caches before timing.
    for (let timeMin = run.scenario.settings.simStartMin;
      timeMin <= run.scenario.settings.simEndMin; timeMin += 15) {
      const startedAt = performance.now();
      snapshotAt(run, timeMin);
      slowestMs = Math.max(slowestMs, performance.now() - startedAt);
    }
    console.info(`Maximum city invariants: slowest ${slowestMs.toFixed(3)} ms per snapshot`);
    // Preserve the existing 50 ms poll budget per DECISIONS pass 52.
    // Local slowest: 0.155 ms; concurrent-suite outlier 14.040 ms (2026-11-14), reported in SUMMARY.md.
    expect(slowestMs).toBeLessThan(50);
  }, 30_000);
});
