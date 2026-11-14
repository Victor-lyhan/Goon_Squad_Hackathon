import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job, Run, Scenario, Shipment, Trip } from '../../shared/types';
import { applyControl } from '../../server/clock';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, type MatchContext } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTrips, createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

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

function runForScenario(scenario: Scenario): Run {
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
  const assignments = assignShipments(scenario.shipments, context);
  const jobs = jobsFor(assignments.plans);
  return {
    runId: `run-${scenario.seed}`,
    version: 1,
    scenario,
    trips,
    assignments,
    jobs,
    notifications: [],
    events: buildTimeline(assignments.plans, jobs, scenario.hubs),
    clock: { phase: 'locked', playing: false, timeMin: scenario.settings.simStartMin, speed: 30 },
  };
}

function expectFiniteSnapshot(run: Run, timeMin: number): void {
  const snapshot = snapshotAt(run, timeMin);
  for (const marker of snapshot.markers) {
    expect(Number.isFinite(marker.x)).toBe(true);
    expect(Number.isFinite(marker.y)).toBe(true);
  }
  for (const position of Object.values(snapshot.packagePositions)) {
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
  }
  for (const value of Object.values(snapshot.metrics)) {
    expect(value === null || Number.isFinite(value)).toBe(true);
  }
}

describe('simulation edge runs', () => {
  it('keeps every-unmatched runs finite and rewind-safe at window and event boundaries', () => {
    const run = UNMATCHED_RUN;
    const { scenario } = run;
    const { simStartMin, simEndMin } = scenario.settings;

    expect(run.assignments.plans).toEqual([]);
    expect(run.events).toEqual([]);
    for (const timeMin of [simStartMin, simStartMin + 1, simEndMin - 1, simEndMin]) {
      expectFiniteSnapshot(run, timeMin);
      const first = snapshotAt(run, timeMin);
      snapshotAt(run, simStartMin);
      expect(snapshotAt(run, timeMin)).toEqual(first);
    }

    const final = snapshotAt(run, simEndMin);
    expect(Object.values(final.shipmentStatus)).toEqual(['unmatched', 'unmatched', 'unmatched']);
    expect(final.metrics).toMatchObject({
      requested: 3, matched: 0, delivered: 0, unmatched: 3,
      avgExtraMinPerTrip: null, maxExtraMin: null,
      earnedRewardsCents: 0, projectedPlatformContributionCents: 0,
      earnedPlatformContributionCents: 0,
    });
  });

  it('supports a generated city with zero hubs, including snapshots before and after its timeline', () => {
    const run = ZERO_HUB_RUN;
    const { simStartMin, simEndMin } = run.scenario.settings;
    const firstEvent = run.events[0]?.timeMin;
    const lastEvent = run.events[run.events.length - 1]?.timeMin;

    expect(run.scenario.hubs).toEqual([]);
    for (const timeMin of [simStartMin, firstEvent === undefined ? simStartMin : firstEvent - 1,
      lastEvent === undefined ? simEndMin : lastEvent + 1, simEndMin]) {
      expectFiniteSnapshot(run, timeMin);
      const snapshot = snapshotAt(run, timeMin);
      snapshotAt(run, simStartMin);
      expect(snapshotAt(run, timeMin)).toEqual(snapshot);
    }

    const final = snapshotAt(run, simEndMin).metrics;
    expect(final.earnedRewardsCents).toBe(
      run.assignments.plans.flatMap((plan) => plan.legs).reduce((sum, leg) => sum + leg.rewardCents, 0),
    );
    expect(final.earnedPlatformContributionCents).toBe(final.projectedPlatformContributionCents);
  });

  it('uses stable same-minute hub handoff order and derives the final custody state', () => {
    const shipment: Shipment = {
      id: 'shp-1', clientRequestId: 'request-1', label: 'Parcel',
      originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 930, deadlineMin: 2160,
      category: 'envelope', description: '', weightGrams: 100,
      pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
    };
    const plan: DeliveryPlan = {
      id: 'plan-shp-1', shipmentId: shipment.id, kind: 'relay', hubId: 'hub-1', deliveryMin: 1010,
      customerPriceCents: 1000, platformContributionCents: 300,
      legs: [
        {
          tripId: 'emp-1-eve', employeeId: 'emp-1', routeNodeIds: ['A', 'H'], finishMin: 1000,
          extraMin: 0, extraDistanceM: 0, rewardCents: 300,
          stops: [
            { kind: 'pickup', nodeId: 'A', arrivalMin: 980, serviceStartMin: 980, serviceEndMin: 982 },
            { kind: 'hub_drop', nodeId: 'H', arrivalMin: 998, serviceStartMin: 998, serviceEndMin: 1000 },
          ],
        },
        {
          tripId: 'emp-2-morn', employeeId: 'emp-2', routeNodeIds: ['H', 'B'], finishMin: 1010,
          extraMin: 0, extraDistanceM: 0, rewardCents: 300,
          stops: [
            { kind: 'hub_pickup', nodeId: 'H', arrivalMin: 998, serviceStartMin: 998, serviceEndMin: 1000 },
            { kind: 'delivery', nodeId: 'B', arrivalMin: 1008, serviceStartMin: 1008, serviceEndMin: 1010 },
          ],
        },
      ],
    };
    const jobs = jobsFor([plan]);
    const run: Run = {
      runId: 'same-minute', version: 1,
      scenario: {
        schemaVersion: 1, name: 'Same minute', preset: 'custom', seed: 1,
        graph: { nodes: [{ id: 'A', x: 0, y: 0 }, { id: 'H', x: 1, y: 0 }, { id: 'B', x: 2, y: 0 }], edges: [] },
        businesses: [{ id: 'biz-a', name: 'A', nodeId: 'A', district: 'D' }, { id: 'biz-b', name: 'B', nodeId: 'B', district: 'D' }],
        hubs: [{ id: 'hub-1', name: 'Hub', nodeId: 'H' }], employees: [], shipments: [shipment], settings: { ...DEFAULT_SETTINGS },
      },
      trips: [] as Trip[], assignments: { plans: [plan], unmatched: [], computeMs: 0 }, jobs, notifications: [],
      events: buildTimeline([plan], jobs, [{ id: 'hub-1', name: 'Hub', nodeId: 'H' }]),
      clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
    };

    expect(run.events.filter((event) => event.timeMin === 1000).map((event) => event.kind))
      .toEqual(['hub_drop', 'hub_pickup']);
    expect(snapshotAt(run, 999).shipmentStatus[shipment.id]).toBe('picked_up');
    expect(snapshotAt(run, 1000).shipmentStatus[shipment.id]).toBe('out_for_delivery');
    expect(snapshotAt(run, 1000).occurredEvents.map((event) => event.kind))
      .toEqual(['pickup', 'hub_drop', 'hub_pickup']);
    const handoff = snapshotAt(run, 1000);
    snapshotAt(run, 930);
    expect(snapshotAt(run, 1000)).toEqual(handoff);
  });

  it('jumps to 1860 when there are no Day 2 events', () => {
    const clock = { phase: 'locked' as const, playing: false, timeMin: 930, speed: 30 as const };
    expect(applyControl(clock, { action: 'jump_to_morning' }, [], DEFAULT_SETTINGS).timeMin).toBe(1860);
  });
});

const UNMATCHED_RUN = runForScenario(generateScenario({
  preset: 'random', seed: 31, employees: 0, packages: 3, hubs: 0, maxExtraMin: 8,
}));
const ZERO_HUB_RUN = runForScenario(generateScenario({
  preset: 'random', seed: 11, employees: 60, packages: 12, hubs: 0, maxExtraMin: 8,
}));
