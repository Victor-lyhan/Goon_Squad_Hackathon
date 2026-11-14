import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/schemas';
import type { AssignmentResult, Scenario } from '../../shared/types';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, type MatchContext, type MatchMode } from '../../server/domain/matching';
import { buildTrips, createRouter } from '../../server/domain/routing';

const timeoutMs = 5_000;
const modes = ['with_relay', 'direct_only'] as const;

function city(seed: number): Scenario {
  return generateScenario(GenerateScenarioRequest.parse({ preset: 'random', seed }));
}

function context(scenario: Scenario): MatchContext {
  const router = createRouter(scenario.graph);
  return {
    ...scenario, router,
    trips: scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router)),
  };
}

/** Check the public output against §6, without calling the matcher's feasibility helpers. */
function valid(scenario: Scenario, ctx: MatchContext, result: AssignmentResult, mode: MatchMode) {
  const used = new Set<string>();
  expect([...result.plans, ...result.unmatched].map(item => item.shipmentId).sort())
    .toEqual(scenario.shipments.map(shipment => shipment.id).sort());
  for (const item of result.unmatched) {
    expect(item.reason.trim().length, `seed ${scenario.seed}, ${item.shipmentId}`).toBeGreaterThan(0);
  }
  for (const plan of result.plans) {
    const label = `seed ${scenario.seed}, ${mode}, ${plan.id}`;
    const shipment = scenario.shipments.find(item => item.id === plan.shipmentId)!;
    expect(plan.legs, label).toHaveLength(plan.kind === 'relay' ? 2 : 1);
    const stops = plan.legs.flatMap(leg => leg.stops);
    expect(stops.map(stop => stop.kind), label).toEqual(plan.kind === 'relay'
      ? ['pickup', 'hub_drop', 'hub_pickup', 'delivery'] : ['pickup', 'delivery']);
    expect(stops[0].serviceStartMin, label).toBeGreaterThanOrEqual(shipment.readyMin);
    expect(stops.at(-1)!.serviceEndMin, label).toBeLessThanOrEqual(shipment.deadlineMin);
    expect(plan.deliveryMin, label).toBe(stops.at(-1)!.serviceEndMin);
    if (mode === 'direct_only') expect(plan.kind, label).toBe('direct');
    if (plan.kind === 'direct') {
      expect(plan.hubId, label).toBeUndefined();
    } else {
      expect(plan.legs[0].employeeId, label).not.toBe(plan.legs[1].employeeId);
      const hub = scenario.hubs.find(item => item.id === plan.hubId);
      expect(hub, label).toBeDefined();
      expect(stops[1].nodeId, label).toBe(hub!.nodeId);
      expect(stops[2].nodeId, label).toBe(hub!.nodeId);
      expect(stops[2].serviceStartMin, label).toBeGreaterThanOrEqual(stops[1].serviceEndMin);
    }
    for (const leg of plan.legs) {
      const detail = `${label}, ${leg.tripId}`;
      expect(used.has(leg.tripId), detail).toBe(false);
      used.add(leg.tripId);
      const trip = ctx.trips.find(item => item.id === leg.tripId);
      const employee = ctx.employees.find(item => item.id === leg.employeeId);
      expect(trip, detail).toBeDefined();
      expect(employee, detail).toBeDefined();
      expect(trip!.employeeId, detail).toBe(employee!.id);
      expect(trip!.direction === 'evening' ? employee!.availableEvening : employee!.availableMorning,
        detail).toBe(true);
      expect(leg.routeNodeIds[0], detail).toBe(trip!.originNodeId);
      expect(leg.routeNodeIds.at(-1), detail).toBe(trip!.destinationNodeId);

      // Independently account for ALL driving, including after dropoff, plus
      // waiting and handling at both endpoints (DECISIONS planner rules).
      let drivingMin = 0;
      for (let i = 1; i < leg.routeNodeIds.length; i++) {
        const edge = scenario.graph.edges.find(item =>
          item.from === leg.routeNodeIds[i - 1] && item.to === leg.routeNodeIds[i]);
        expect(edge, detail).toBeDefined();
        drivingMin += edge!.durationMin;
      }
      let serviceMin = 0;
      for (const stop of leg.stops) {
        expect(leg.routeNodeIds, detail).toContain(stop.nodeId);
        expect(stop.serviceStartMin, detail).toBeGreaterThanOrEqual(stop.arrivalMin);
        expect(stop.serviceEndMin - stop.serviceStartMin, detail).toBe(scenario.settings.handlingMin);
        serviceMin += stop.serviceEndMin - stop.arrivalMin;
      }
      expect(leg.finishMin, detail).toBe(trip!.departureMin + drivingMin + serviceMin);
      const extraMin = leg.finishMin - trip!.departureMin - trip!.baselineDurationMin;
      expect(leg.extraMin, detail).toBe(extraMin);
      expect(extraMin, detail).toBeGreaterThanOrEqual(0);
      expect(extraMin, detail).toBeLessThanOrEqual(employee!.maxExtraMin);
    }
  }
}

function editCommutes(scenario: Scenario, protectedEmployees = new Set<string>()): Scenario {
  return {
    ...scenario,
    employees: scenario.employees.map((employee, index) => {
      if (protectedEmployees.has(employee.id) || index % 2 !== 0) return employee;
      const node = scenario.graph.nodes[(index * 7 + scenario.seed) % scenario.graph.nodes.length].id;
      return {
        ...employee, eveningViaNodeIds: [node], morningViaNodeIds: [node],
        availableEvening: index % 4 !== 0, availableMorning: index % 6 !== 0,
        maxExtraMin: index % 3 === 0 ? 0 : 12,
      };
    }),
  };
}

describe('§6 seeded plan validity', () => {
  for (const seed of Array.from({ length: 20 }, (_, index) => index + 1)) {
    for (const mode of modes) {
      it(`validates every default plan: seed ${seed}, ${mode}`, () => {
        const scenario = city(seed);
        const ctx = context(scenario);
        const result = assignShipments(scenario.shipments, ctx, { mode });
        expect(result.plans.length).toBeGreaterThan(0);
        valid(scenario, ctx, result, mode);
      }, timeoutMs);
    }
  }

  for (const seed of [1, 5, 10, 15, 20]) {
    for (const mode of modes) {
      it(`validates rebuilt commutes and reserved retries: seed ${seed}, ${mode}`, () => {
        const original = city(seed);
        const edited = editCommutes(original);
        const ctx = context(edited);
        expect(ctx.trips.length).toBeLessThan(context(original).trips.length);
        const result = assignShipments(edited.shipments, ctx, { mode });
        expect(result.plans.length).toBeGreaterThan(0);
        valid(edited, ctx, result, mode);

        // Existing plans are intentionally frozen. Edit only unreserved employees
        // on this retry, so their old plans remain valid against the same limits.
        const first = assignShipments(original.shipments.slice(0, 8), context(original), { mode });
        expect(first.plans.length).toBeGreaterThan(0);
        const reservedEmployees = new Set(first.plans.flatMap(plan => plan.legs.map(leg => leg.employeeId)));
        const retryScenario = editCommutes(original, reservedEmployees);
        const retryCtx = context(retryScenario);
        const existing = structuredClone(first.plans);
        const retry = assignShipments(retryScenario.shipments, retryCtx, { mode, existing });
        expect(existing).toEqual(first.plans);
        for (const plan of first.plans) {
          expect(retry.plans.find(item => item.id === plan.id), `seed ${seed}, ${plan.id}`).toEqual(plan);
        }
        valid(retryScenario, retryCtx, retry, mode);
      }, timeoutMs);
    }
  }
});
