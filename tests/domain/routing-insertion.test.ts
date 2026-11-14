import { describe, expect, it } from 'vitest';
import type { Business, Edge, Employee, Graph, Shipment } from '../../shared/types';
import { assignShipments } from '../../server/domain/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { baselineRoute, bestInsertion, buildTrips, createRouter, insertionOptions } from '../../server/domain/routing';

const road = (from: string, to: string, durationMin: number, distanceM: number): Edge =>
  ({ from, to, durationMin, distanceM });
const graphOf = (ids: string[], edges: Edge[]): Graph => ({
  nodes: ids.map((id, x) => ({ id, x, y: 0 })), edges,
});

// Independent edge accounting: never ask the router to recompute the reported path.
function pathTotals(graph: Graph, nodeIds: string[]) {
  return nodeIds.slice(1).reduce((total, to, index) => {
    const edges = graph.edges.filter(edge => edge.from === nodeIds[index] && edge.to === to);
    expect(edges).toHaveLength(1);
    return {
      durationMin: total.durationMin + edges[0].durationMin,
      distanceM: total.distanceM + edges[0].distanceM,
    };
  }, { durationMin: 0, distanceM: 0 });
}

describe('spec §6: saved baselines and single-stop insertion', () => {
  const chain = ['S', 'a', 'W1', 'b', 'W2', 'c', 'W3', 'd', 'T'];
  const waypointGraph = graphOf(chain, [
    ...chain.slice(1).map((to, i) => road(chain[i], to, 2, 100 + i * 10)),
    road('S', 'T', 1, 900), road('W1', 'T', 1, 700),
  ]);

  it.each([
    { via: [], expected: ['S', 'T'], minutes: 1, meters: 900 },
    { via: ['W1'], expected: ['S', 'a', 'W1', 'T'], minutes: 5, meters: 910 },
    { via: ['W1', 'W2', 'W3'], expected: chain, minutes: 16, meters: 1080 },
  ])('concatenates shortest paths through $via in saved order', ({ via, expected, minutes, meters }) => {
    const router = createRouter(waypointGraph);
    const baseline = baselineRoute(router, 'S', via, 'T');
    expect(baseline).toEqual({ nodeIds: expected, durationMin: minutes, distanceM: meters });
    const stops = ['S', ...via, 'T'];
    const segments = stops.slice(1).map((to, i) => router.shortestPath(stops[i], to)!);
    expect(baseline).toEqual({
      nodeIds: ['S', ...segments.flatMap(segment => segment.nodeIds.slice(1))],
      durationMin: segments.reduce((sum, segment) => sum + segment.durationMin, 0),
      distanceM: segments.reduce((sum, segment) => sum + segment.distanceM, 0),
    });
    expect(pathTotals(waypointGraph, expected)).toEqual({ durationMin: minutes, distanceM: meters });
  });

  const baselineNodes = ['A', 'B', 'C', 'D', 'E'];
  const insertionGraph = graphOf([...baselineNodes, 'X'], [
    ...baselineNodes.slice(1).map((to, i) => road(baselineNodes[i], to, 5, 100)),
    ...[9, 7, 3, 6].map((minutes, i) => road(baselineNodes[i], 'X', minutes, minutes * 100)),
    ...baselineNodes.slice(1).map(to => road('X', to, 3, 80)),
  ]);

  it('evaluates every gap, preserves both sides, and selects the least extra driving', () => {
    const router = createRouter(insertionGraph);
    // Saved waypoints prevent the shorter A → X → E route replacing this commute.
    const baseline = baselineRoute(router, 'A', ['B', 'C', 'D'], 'E')!;
    expect(baseline.nodeIds).toEqual(baselineNodes);
    const options = insertionOptions(router, baseline.nodeIds, 'X');
    const expected = [9, 7, 3, 6].map((minutes, i) => ({
      routeNodeIds: [...baselineNodes.slice(0, i + 1), 'X', ...baselineNodes.slice(i + 1)],
      stopRouteIndex: i + 1,
      extraDurationMin: minutes + 3 - 5,
      extraDistanceM: minutes * 100 + 80 - 100,
    }));
    expect(options).toEqual([expected[2], expected[3], expected[1], expected[0]]);
    expect(bestInsertion(router, baseline.nodeIds, 'X')).toEqual(expected[2]);
    for (const option of options) {
      const totals = pathTotals(insertionGraph, option.routeNodeIds);
      expect(totals.durationMin).toBe(baseline.durationMin + option.extraDurationMin);
      expect(totals.distanceM).toBe(baseline.distanceM + option.extraDistanceM);
    }
    expect(baseline.nodeIds).toEqual(baselineNodes);
  });

  it('breaks equal-time, equal-distance insertion ties stably across graph ordering and cache hits', () => {
    const graph = graphOf(['A', 'B', 'C', 'X'], [
      road('A', 'B', 5, 100), road('B', 'C', 5, 100),
      road('A', 'X', 3, 100), road('B', 'X', 3, 100),
      road('X', 'B', 3, 100), road('X', 'C', 3, 100),
    ]);
    for (const candidate of [graph, { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }]) {
      const router = createRouter(candidate);
      for (let repeat = 0; repeat < 2; repeat++) {
        expect(insertionOptions(router, ['A', 'B', 'C'], 'X')).toEqual([
          { routeNodeIds: ['A', 'X', 'B', 'C'], stopRouteIndex: 1, extraDurationMin: 1, extraDistanceM: 100 },
          { routeNodeIds: ['A', 'B', 'X', 'C'], stopRouteIndex: 2, extraDurationMin: 1, extraDistanceM: 100 },
        ]);
        expect(bestInsertion(router, ['A', 'B', 'C'], 'X')?.routeNodeIds).toEqual(['A', 'X', 'B', 'C']);
      }
    }
  });

  it('adds only pickup and delivery handling when the delivery stop is already on the baseline', () => {
    const graph = graphOf(['A', 'B', 'C'], [road('A', 'B', 5, 700), road('B', 'C', 7, 300)]);
    const router = createRouter(graph);
    const businesses: Business[] = [
      { id: 'biz-a', name: 'Sender', nodeId: 'A', district: 'Test' },
      { id: 'biz-b', name: 'Recipient', nodeId: 'B', district: 'Test' },
    ];
    const employee: Employee = {
      id: 'emp-1', name: 'Carrier', businessId: 'biz-a', homeNodeId: 'C',
      eveningDepartureMin: 1020, morningDepartureMin: 1920, maxExtraMin: 4,
      availableEvening: true, availableMorning: false, eveningViaNodeIds: ['B'], morningViaNodeIds: [],
    };
    const trips = buildTrips(employee, businesses, router);
    expect(trips).toHaveLength(1);
    expect(bestInsertion(router, trips[0].baselineNodeIds, 'B')).toEqual({
      routeNodeIds: ['A', 'B', 'C'], stopRouteIndex: 1, extraDurationMin: 0, extraDistanceM: 0,
    });
    const shipment: Shipment = {
      id: 'shp-1', clientRequestId: 'on-route', label: 'On-route parcel',
      originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 1020, deadlineMin: 1100,
      category: 'envelope', description: '', weightGrams: 100,
      pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
    };
    const result = assignShipments([shipment], {
      router, trips, employees: [employee], businesses, hubs: [], settings: DEFAULT_SETTINGS,
    });
    expect(result.unmatched).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].kind).toBe('direct');
    expect(result.plans[0].legs).toHaveLength(1);
    const leg = result.plans[0].legs[0];
    expect(leg).toMatchObject({ routeNodeIds: ['A', 'B', 'C'], extraMin: 4, extraDistanceM: 0, finishMin: 1036 });
    expect(leg.stops).toEqual([
      { nodeId: 'A', kind: 'pickup', arrivalMin: 1020, serviceStartMin: 1020, serviceEndMin: 1022 },
      { nodeId: 'B', kind: 'delivery', arrivalMin: 1027, serviceStartMin: 1027, serviceEndMin: 1029 },
    ]);
    expect(leg.finishMin - trips[0].departureMin - pathTotals(graph, leg.routeNodeIds).durationMin).toBe(4);
    expect(result.plans[0].deliveryMin).toBe(1029);
  });

  it('reports distance along the fastest path even when a slower path is much shorter', () => {
    const graph = graphOf(['S', 'F', 'T'], [
      road('S', 'T', 9, 10), road('S', 'F', 2, 900), road('F', 'T', 3, 800),
    ]);
    const route = createRouter(graph).shortestPath('S', 'T')!;
    expect(route).toEqual({ nodeIds: ['S', 'F', 'T'], durationMin: 5, distanceM: 1700 });
    expect(pathTotals(graph, route.nodeIds)).toEqual({ durationMin: route.durationMin, distanceM: route.distanceM });
  });

  it('isolates cached paths and unreachable results between graphs reusing node IDs', () => {
    const first = createRouter(graphOf(['A', 'B', 'C'], [
      road('A', 'B', 2, 200), road('B', 'C', 3, 300), road('A', 'C', 9, 50),
    ]));
    const firstRoute = { nodeIds: ['A', 'B', 'C'], durationMin: 5, distanceM: 500 };
    expect(first.shortestPath('A', 'C')).toEqual(firstRoute);
    expect(first.shortestPath('C', 'A')).toBeNull();
    const second = createRouter(graphOf(['A', 'B', 'C'], [
      road('A', 'B', 8, 800), road('B', 'C', 7, 700), road('A', 'C', 1, 90), road('C', 'A', 4, 400),
    ]));
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(second.shortestPath('A', 'C')).toEqual({ nodeIds: ['A', 'C'], durationMin: 1, distanceM: 90 });
      expect(second.shortestPath('C', 'A')).toEqual({ nodeIds: ['C', 'A'], durationMin: 4, distanceM: 400 });
      expect(first.shortestPath('A', 'C')).toEqual(firstRoute);
      expect(first.shortestPath('C', 'A')).toBeNull();
    }
  });
});
