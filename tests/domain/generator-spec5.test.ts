import { describe, expect, it } from 'vitest';
import { generateScenario } from '../../server/domain/generator.js';
import { buildTrips, createRouter } from '../../server/domain/routing.js';
import type { Graph, Scenario } from '../../shared/types.js';

const baseOptions = {
  packages: 60,
  hubs: 10,
  maxExtraMin: 8,
  preset: 'random' as const,
};

function tripsFor(scenario: Scenario) {
  const router = createRouter(scenario.graph);
  return scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router));
}

function reachableNodeIds(graph: Graph, startNodeId: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const destinations = outgoing.get(edge.from) ?? [];
    destinations.push(edge.to);
    outgoing.set(edge.from, destinations);
  }

  const visited = new Set([startNodeId]);
  const queue = [startNodeId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const destination of outgoing.get(queue[index]!) ?? []) {
      if (!visited.has(destination)) {
        visited.add(destination);
        queue.push(destination);
      }
    }
  }
  return visited;
}

describe('generateScenario §5', () => {
  it.each([1, 7, 42])('uses the same roster prefix and city for seed %i', (seed) => {
    const smallest = generateScenario({ ...baseOptions, seed, employees: 10 });
    const medium = generateScenario({ ...baseOptions, seed, employees: 60 });
    const largest = generateScenario({ ...baseOptions, seed, employees: 200 });

    expect(smallest.employees).toEqual(largest.employees.slice(0, 10));
    expect(medium.employees).toEqual(largest.employees.slice(0, 60));
    expect(tripsFor(smallest)).toEqual(tripsFor(largest).slice(0, 20));
    expect(tripsFor(medium)).toEqual(tripsFor(largest).slice(0, 120));

    for (const scenario of [smallest, medium]) {
      expect(scenario.businesses).toEqual(largest.businesses);
      expect(scenario.hubs).toEqual(largest.hubs);
      expect(scenario.graph).toEqual(largest.graph);
      expect(scenario.shipments).toEqual(largest.shipments);
    }
  });

  it('changes only the detour configuration when maxExtraMin changes', () => {
    const lowLimit = generateScenario({ ...baseOptions, seed: 7, employees: 60, maxExtraMin: 0 });
    const highLimit = generateScenario({ ...baseOptions, seed: 7, employees: 60, maxExtraMin: 15 });

    expect(lowLimit.settings).toEqual({
      ...highLimit.settings,
      defaultMaxExtraMin: 0,
    });
    expect(lowLimit.employees.map(({ maxExtraMin, ...employee }) => employee))
      .toEqual(highLimit.employees.map(({ maxExtraMin, ...employee }) => employee));
    expect(lowLimit.employees.map(employee => employee.maxExtraMin)).toEqual(Array(60).fill(0));
    expect(highLimit.employees.map(employee => employee.maxExtraMin)).toEqual(Array(60).fill(15));
    expect({ ...lowLimit, employees: undefined, settings: undefined })
      .toEqual({ ...highLimit, employees: undefined, settings: undefined });
    expect(tripsFor(lowLimit)).toEqual(tripsFor(highLimit));
  });

  it('creates §5 commute and package defaults', () => {
    const scenario = generateScenario({ ...baseOptions, seed: 42, employees: 60 });
    const businesses = new Map(scenario.businesses.map(business => [business.id, business]));

    expect(scenario.employees).toHaveLength(60);
    for (const employee of scenario.employees) {
      expect(employee.eveningDepartureMin).toBeGreaterThanOrEqual(1020);
      expect(employee.eveningDepartureMin).toBeLessThanOrEqual(1080);
      expect(employee.morningDepartureMin).toBeGreaterThanOrEqual(1860);
      expect(employee.morningDepartureMin).toBeLessThanOrEqual(1950);
      expect(employee.availableEvening).toBe(true);
      expect(employee.availableMorning).toBe(true);
      expect(employee.eveningViaNodeIds).toEqual([]);
      expect(employee.morningViaNodeIds).toEqual([]);
    }

    const trips = tripsFor(scenario);
    expect(trips).toHaveLength(120);
    for (const trip of trips) {
      const employee = scenario.employees.find(candidate => candidate.id === trip.employeeId)!;
      const employer = businesses.get(employee.businessId)!;
      if (trip.direction === 'evening') {
        expect(trip.originNodeId).toBe(employer.nodeId);
        expect(trip.destinationNodeId).toBe(employee.homeNodeId);
        expect(trip.departureMin).toBe(employee.eveningDepartureMin);
      } else {
        expect(trip.originNodeId).toBe(employee.homeNodeId);
        expect(trip.destinationNodeId).toBe(employer.nodeId);
        expect(trip.departureMin).toBe(employee.morningDepartureMin);
      }
    }

    for (const shipment of scenario.shipments) {
      expect(shipment.originBusinessId).not.toBe(shipment.destinationBusinessId);
      expect(shipment.readyMin).toBe(960);
      expect(shipment.deadlineMin).toBe(2040);
    }
  });

  it('creates a strongly connected 12 by 12, two-way grid with uniform road costs', () => {
    const graph = generateScenario({ ...baseOptions, seed: 1, employees: 10 }).graph;

    expect(graph.nodes).toHaveLength(12 * 12);
    expect(graph.edges).toHaveLength(2 * ((12 * 11) + (12 * 11)));
    expect(graph.edges.every(edge => edge.distanceM === 500 && edge.durationMin === 2)).toBe(true);
    for (const node of graph.nodes) {
      expect(reachableNodeIds(graph, node.id).size).toBe(graph.nodes.length);
    }
  });

  it('generates the largest supported scenario in under 300 ms', () => {
    const startedAt = performance.now();
    const scenario = generateScenario({ ...baseOptions, seed: 42, employees: 200 });
    const elapsedMs = performance.now() - startedAt;

    expect(scenario.employees).toHaveLength(200);
    expect(scenario.shipments).toHaveLength(60);
    expect(scenario.hubs).toHaveLength(10);
    console.info(`Largest generator: ${elapsedMs.toFixed(3)} ms`);
    // Local generation: 0.164 ms (2026-11-14); retained 300 ms limit gives >10x headroom.
    expect(elapsedMs).toBeLessThan(300);
  }, 20_000);
});
