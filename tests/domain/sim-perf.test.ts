import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { DeliveryPlan, Job, MarkerPosition, Run, Scenario } from '../../shared/types';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, type MatchContext } from '../../server/domain/matching';
import { buildTrips, createRouter } from '../../server/domain/routing';
import { buildTimeline, snapshotAt } from '../../server/domain/simulation';

const EPSILON = 0.000_001;

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

function largestRun(): Run {
  const scenario: Scenario = generateScenario({
    preset: 'random', seed: 198, employees: 200, packages: 60, hubs: 10, maxExtraMin: 8,
  });
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap((employee) => buildTrips(employee, scenario.businesses, router));
  const context: MatchContext = {
    router, trips, employees: scenario.employees, businesses: scenario.businesses,
    hubs: scenario.hubs, settings: scenario.settings,
  };
  const assignments = assignShipments(scenario.shipments, context);
  const jobs = jobsFor(assignments.plans);
  return {
    runId: 'largest-city-perf', version: 1, scenario, trips, assignments, jobs, notifications: [],
    events: buildTimeline(assignments.plans, jobs, scenario.hubs),
    clock: { phase: 'locked', playing: false, timeMin: 930, speed: 30 },
  };
}

function pointIsOnRoute(marker: MarkerPosition, plans: DeliveryPlan[], run: Run): boolean {
  const points = new Map(run.scenario.graph.nodes.map((node) => [node.id, node]));
  for (const plan of plans) {
    for (const leg of plan.legs.filter((candidate) => candidate.employeeId === marker.employeeId)) {
      for (let index = 0; index < leg.routeNodeIds.length - 1; index += 1) {
        const start = points.get(leg.routeNodeIds[index]!);
        const end = points.get(leg.routeNodeIds[index + 1]!);
        if (start === undefined || end === undefined) continue;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const cross = (marker.x - start.x) * dy - (marker.y - start.y) * dx;
        const dot = (marker.x - start.x) * dx + (marker.y - start.y) * dy;
        const lengthSquared = dx * dx + dy * dy;
        if (Math.abs(cross) <= EPSILON && dot >= -EPSILON && dot <= lengthSquared + EPSILON) return true;
      }
    }
  }
  return plans.some((plan) => plan.legs.some((leg) => leg.employeeId === marker.employeeId && leg.routeNodeIds.some((nodeId) => {
    const node = points.get(nodeId);
    return node !== undefined && Math.abs(marker.x - node.x) <= EPSILON && Math.abs(marker.y - node.y) <= EPSILON;
  })));
}

describe('largest random city snapshot performance and marker continuity', () => {
  it('keeps every-minute markers continuous and snapshotAt comfortably below the poll budget', () => {
    const run = LARGEST_RUN;
    const samples = [930, 1022, 1100, 1947, 2040, 2160].map((timeMin) => snapshotAt(run, timeMin));
    const plansByEmployeeId = new Map<string, DeliveryPlan[]>();
    const nodeById = new Map(run.scenario.graph.nodes.map((node) => [node.id, node]));
    const edgeDuration = new Map(run.scenario.graph.edges.map((edge) => [`${edge.from}\u0000${edge.to}`, edge.durationMin]));
    const maxDistancePerMinute = new Map<string, number>();

    for (const plan of run.assignments.plans) {
      for (const leg of plan.legs) {
        const employeePlans = plansByEmployeeId.get(leg.employeeId) ?? [];
        employeePlans.push(plan);
        plansByEmployeeId.set(leg.employeeId, employeePlans);
        for (let index = 0; index < leg.routeNodeIds.length - 1; index += 1) {
          const from = nodeById.get(leg.routeNodeIds[index]!);
          const to = nodeById.get(leg.routeNodeIds[index + 1]!);
          const duration = edgeDuration.get(`${leg.routeNodeIds[index]}\u0000${leg.routeNodeIds[index + 1]}`);
          if (from === undefined || to === undefined || duration === undefined) continue;
          const speed = Math.hypot(to.x - from.x, to.y - from.y) / duration;
          maxDistancePerMinute.set(leg.employeeId, Math.max(maxDistancePerMinute.get(leg.employeeId) ?? 0, speed));
        }
      }
    }

    let previousMarkers = new Map<string, MarkerPosition>();
    for (let timeMin = 930; timeMin <= 2160; timeMin += 1) {
      const snapshot = snapshotAt(run, timeMin);
      const markers = new Map(snapshot.markers.map((marker) => [marker.employeeId, marker]));
      for (const position of Object.values(snapshot.packagePositions)) {
        expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
      }
      for (const marker of snapshot.markers) {
        const plans = plansByEmployeeId.get(marker.employeeId)!;
        expect(Number.isFinite(marker.x) && Number.isFinite(marker.y)).toBe(true);
        expect(pointIsOnRoute(marker, plans, run)).toBe(true);
        const previous = previousMarkers.get(marker.employeeId);
        if (previous !== undefined) {
          expect(Math.hypot(marker.x - previous.x, marker.y - previous.y))
            .toBeLessThanOrEqual((maxDistancePerMinute.get(marker.employeeId) ?? 0) + EPSILON);
        }
        if (marker.carryingShipmentId !== undefined) {
          expect(snapshot.packagePositions[marker.carryingShipmentId]).toEqual({ x: marker.x, y: marker.y });
        }
      }

      for (const plan of run.assignments.plans.filter((candidate) => candidate.kind === 'relay')) {
        const hubDrop = plan.legs[0]!.stops[plan.legs[0]!.stops.length - 1]!;
        const hubPickup = plan.legs[1]!.stops[0]!;
        if (timeMin >= hubDrop.serviceEndMin && timeMin < hubPickup.serviceEndMin) {
          const hub = nodeById.get(hubDrop.nodeId)!;
          expect(snapshot.packagePositions[plan.shipmentId]).toEqual({ x: hub.x, y: hub.y });
        }
      }
      previousMarkers = markers;
    }

    // The cached lookup tables must not affect observable snapshots.
    expect([930, 1022, 1100, 1947, 2040, 2160].map((timeMin) => snapshotAt(run, timeMin))).toEqual(samples);

    // The invariant sweep above warms the lookup caches.
    // Local median: 0.091 ms/call (2026-11-14); retained 5 ms limit gives >10x headroom.
    // Measure the median of three full 1,231-call sweeps.
    const perCallMs = [0, 1, 2].map(() => {
      const startedAt = performance.now();
      for (let timeMin = 930; timeMin <= 2160; timeMin += 1) snapshotAt(run, timeMin);
      return (performance.now() - startedAt) / 1231;
    }).sort((left, right) => left - right);
    console.info(`Largest city: median ${perCallMs[1]!.toFixed(3)} ms per snapshot`);
    expect(perCallMs[1]).toBeLessThan(5);
  }, 30_000);
});

const LARGEST_RUN = largestRun();
