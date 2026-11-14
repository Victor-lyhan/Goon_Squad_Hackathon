import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/relayFixture.json';
import type { Edge, Employee, Graph } from '../../shared/types';
import { baselineRoute, bestInsertion, buildTrips, createRouter, insertionOptions } from '../../server/domain/routing';

const graphOf = (ids: string[], edges: Edge[]): Graph => ({
  nodes: ids.map((id, index) => ({ id, x: index % 2, y: Math.floor(index / 2) })), edges,
});
const road = (from: string, to: string, durationMin = 1, distanceM = 100): Edge =>
  ({ from, to, durationMin, distanceM });
const grid = graphOf(['A', 'B', 'C', 'D'], [
  road('A', 'B'), road('B', 'A'), road('A', 'C'), road('C', 'A'),
  road('B', 'D'), road('D', 'B'), road('C', 'D'), road('D', 'C'),
]);
const employee: Employee = {
  id: 'emp-1', name: 'Test employee', businessId: 'biz-a', homeNodeId: 'D',
  eveningDepartureMin: 1020, morningDepartureMin: 1935, maxExtraMin: 8,
  availableEvening: true, availableMorning: true,
  eveningViaNodeIds: ['C'], morningViaNodeIds: ['B'],
};

describe('createRouter', () => {
  it('uses the exact directed fixture and memoizes successful results', () => {
    const router = createRouter(fixture.graph);
    const route = router.shortestPath('A', 'X');
    expect(route).toEqual({ nodeIds: ['A', 'X'], durationMin: 20, distanceM: 7000 });
    expect(router.shortestPath('A', 'X')).toBe(route);
    expect(router.shortestPath('Y', 'B')).toEqual({ nodeIds: ['Y', 'B'], durationMin: 20, distanceM: 7000 });
    expect(router.shortestPath('X', 'A')).toBeNull();
    expect(router.shortestPath('X', 'A')).toBeNull();
    expect(router.shortestPath('A', 'Y')).toBeNull();
  });

  it('handles self paths, unknown nodes, and empty graphs', () => {
    const router = createRouter(fixture.graph);
    expect(router.shortestPath('H', 'H')).toEqual({ nodeIds: ['H'], durationMin: 0, distanceM: 0 });
    expect(router.shortestPath('missing', 'missing')).toBeNull();
    expect(router.shortestPath('A', 'missing')).toBeNull();
    expect(createRouter({ nodes: [], edges: [] }).shortestPath('A', 'A')).toBeNull();
  });

  it('prefers duration, then distance, then node ID regardless of graph order', () => {
    const graph = graphOf(['S', 'B', 'A', 'T'], [
      road('S', 'T', 3, 1), road('S', 'B'), road('B', 'T'),
      road('S', 'A'), road('A', 'T'), road('S', 'T', 2, 300),
    ]);
    for (const candidate of [graph, { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }]) {
      expect(createRouter(candidate).shortestPath('S', 'T')).toEqual({
        nodeIds: ['S', 'A', 'T'], durationMin: 2, distanceM: 200,
      });
    }
    graph.edges.push(road('S', 'T', 2, 150));
    expect(createRouter(graph).shortestPath('S', 'T')?.nodeIds).toEqual(['S', 'T']);
  });

  it('settles cycles, including zero-cost cycles', () => {
    const router = createRouter(graphOf(['A', 'B', 'C'], [
      road('A', 'B', 0, 0), road('B', 'A', 0, 0), road('B', 'C'), road('A', 'C', 3),
    ]));
    expect(router.shortestPath('A', 'C')).toEqual({ nodeIds: ['A', 'B', 'C'], durationMin: 1, distanceM: 100 });
  });
});

describe('baselineRoute', () => {
  it('chains ordered waypoints on a grid without duplicating junctions', () => {
    const router = createRouter(grid);
    expect(baselineRoute(router, 'A', ['C', 'A', 'B', 'B'], 'D')).toEqual({
      nodeIds: ['A', 'C', 'A', 'B', 'D'], durationMin: 4, distanceM: 400,
    });
    expect(baselineRoute(router, 'A', [], 'A')).toEqual({ nodeIds: ['A'], durationMin: 0, distanceM: 0 });
    expect(baselineRoute(createRouter(fixture.graph), 'A', ['Y'], 'X')).toBeNull();
  });
});

describe('insertionOptions', () => {
  it.each([['A', 'X'], ['Y', 'B']])('inserts fixture hub between %s and %s', (from, to) => {
    expect(bestInsertion(createRouter(fixture.graph), [from, to], 'H')).toEqual({
      routeNodeIds: [from, 'H', to], stopRouteIndex: 1, extraDurationMin: 2, extraDistanceM: 700,
    });
  });

  it('returns all existing occurrences with no extra driving, including endpoints', () => {
    const router = createRouter(grid);
    for (const stop of ['A', 'B', 'D']) {
      const baseline = ['A', 'B', 'A', 'B', 'D'];
      const options = insertionOptions(router, baseline, stop);
      expect(options.map(option => option.stopRouteIndex)).toEqual(
        baseline.flatMap((node, i) => node === stop ? [i] : []),
      );
      for (const option of options) expect(option).toEqual({
        routeNodeIds: baseline, stopRouteIndex: option.stopRouteIndex, extraDurationMin: 0, extraDistanceM: 0,
      });
    }
    expect(bestInsertion(router, ['A'], 'A')?.stopRouteIndex).toBe(0);
  });

  it('preserves the baseline prefix and suffix and returns every insertion in sorted order', () => {
    const router = createRouter(graphOf(['A', 'B', 'C', 'D', 'H'], [
      road('A', 'B'), road('B', 'C'), road('C', 'D'),
      road('A', 'H', 3, 300), road('H', 'B'), road('B', 'H'),
      road('H', 'C'), road('C', 'H'), road('H', 'D'),
    ]));
    const baseline = ['A', 'B', 'C', 'D'];
    const options = insertionOptions(router, baseline, 'H');
    expect(options).toEqual([
      { routeNodeIds: ['A', 'B', 'H', 'C', 'D'], stopRouteIndex: 2, extraDurationMin: 1, extraDistanceM: 100 },
      { routeNodeIds: ['A', 'B', 'C', 'H', 'D'], stopRouteIndex: 3, extraDurationMin: 1, extraDistanceM: 100 },
      { routeNodeIds: ['A', 'B', 'H', 'B', 'C', 'D'], stopRouteIndex: 2, extraDurationMin: 2, extraDistanceM: 200 },
    ]);
    expect(baseline).toEqual(['A', 'B', 'C', 'D']);
  });

  it('uses distance before stop index when extra durations tie', () => {
    const router = createRouter(graphOf(['A', 'B', 'C', 'H'], [
      road('A', 'B'), road('B', 'C'), road('A', 'H', 1, 200), road('H', 'B'),
      road('B', 'H'), road('H', 'C'),
    ]));
    expect(insertionOptions(router, ['A', 'B', 'C'], 'H').map(option => option.stopRouteIndex)).toEqual([2, 1]);
  });

  it('returns no options for an unreachable stop or a route with no insertion gap', () => {
    const router = createRouter(fixture.graph);
    expect(insertionOptions(router, ['A', 'X'], 'Y')).toEqual([]);
    expect(bestInsertion(router, ['A', 'X'], 'Y')).toBeNull();
    expect(bestInsertion(router, [], 'H')).toBeNull();
    expect(bestInsertion(router, ['A'], 'H')).toBeNull();
  });
});

describe('buildTrips', () => {
  it('builds both directions with ordered waypoints, deterministic IDs, and exact departure times', () => {
    expect(buildTrips(employee, fixture.businesses, createRouter(grid))).toEqual([
      { id: 'emp-1-eve', employeeId: 'emp-1', direction: 'evening', originNodeId: 'A', destinationNodeId: 'D',
        departureMin: 1020, baselineNodeIds: ['A', 'C', 'D'], baselineDurationMin: 2, baselineDistanceM: 200 },
      { id: 'emp-1-morn', employeeId: 'emp-1', direction: 'morning', originNodeId: 'D', destinationNodeId: 'A',
        departureMin: 1935, baselineNodeIds: ['D', 'B', 'A'], baselineDurationMin: 2, baselineDistanceM: 200 },
    ]);
  });

  it('respects availability independently', () => {
    const router = createRouter(grid);
    expect(buildTrips({ ...employee, availableEvening: false }, fixture.businesses, router).map(t => t.direction)).toEqual(['morning']);
    expect(buildTrips({ ...employee, availableMorning: false }, fixture.businesses, router).map(t => t.direction)).toEqual(['evening']);
    expect(buildTrips({ ...employee, availableEvening: false, availableMorning: false }, fixture.businesses, router)).toEqual([]);
  });

  it('skips missing businesses and unreachable directions on the partial fixture', () => {
    const router = createRouter(fixture.graph);
    expect(buildTrips(employee, [], router)).toEqual([]);
    const trips = buildTrips({ ...employee, homeNodeId: 'X', eveningViaNodeIds: [], morningViaNodeIds: [] }, fixture.businesses, router);
    expect(trips.map(t => t.id)).toEqual(['emp-1-eve']);
    expect(trips[0].baselineDurationMin).toBe(20);
  });
});
