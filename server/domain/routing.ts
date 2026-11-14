import { tripId, type Business, type Edge, type Employee, type Graph, type Trip } from '../../shared/types';

export type Route = { nodeIds: string[]; durationMin: number; distanceM: number };
export type Router = { shortestPath(fromNodeId: string, toNodeId: string): Route | null };
export type InsertionOption = {
  routeNodeIds: string[];
  stopRouteIndex: number;
  extraDurationMin: number;
  extraDistanceM: number;
};

const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const compareCost = (a: Route, b: Route) =>
  a.durationMin - b.durationMin || a.distanceM - b.distanceM;

/** The graph is captured once; create a new router when the graph changes. */
export function createRouter(graph: Graph): Router {
  const outgoing = new Map<string, Edge[]>(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    if (outgoing.has(edge.to)) outgoing.get(edge.from)?.push({ ...edge });
  }
  const cache = new Map<string, Map<string, Route | null>>();

  function shortestPath(from: string, to: string): Route | null {
    let sourceCache = cache.get(from);
    if (!sourceCache) {
      sourceCache = new Map();
      cache.set(from, sourceCache);
    }
    if (sourceCache.has(to)) return sourceCache.get(to)!;

    let result: Route | null = null;
    if (outgoing.has(from) && outgoing.has(to)) {
      const labels = new Map<string, Route>([[from, { nodeIds: [from], durationMin: 0, distanceM: 0 }]]);
      const settled = new Set<string>();
      // The synthetic city is small; scanning the frontier keeps Dijkstra simple.
      while (true) {
        let current: string | undefined;
        for (const [id, route] of labels) {
          if (settled.has(id)) continue;
          if (current === undefined || compareCost(route, labels.get(current)!) < 0 ||
            (compareCost(route, labels.get(current)!) === 0 && compareId(id, current) < 0)) current = id;
        }
        if (current === undefined) break;
        const route = labels.get(current)!;
        if (current === to) {
          result = route;
          break;
        }
        settled.add(current);
        for (const edge of outgoing.get(current)!) {
          if (settled.has(edge.to)) continue;
          const candidate: Route = {
            nodeIds: [...route.nodeIds, edge.to],
            durationMin: route.durationMin + edge.durationMin,
            distanceM: route.distanceM + edge.distanceM,
          };
          const existing = labels.get(edge.to);
          if (!existing || compareCost(candidate, existing) < 0) labels.set(edge.to, candidate);
        }
      }
    }
    sourceCache.set(to, result);
    return result;
  }
  return { shortestPath };
}

export function baselineRoute(
  router: Router, originNodeId: string, viaNodeIds: string[], destinationNodeId: string,
): Route | null {
  const stops = [originNodeId, ...viaNodeIds, destinationNodeId];
  const result: Route = { nodeIds: [originNodeId], durationMin: 0, distanceM: 0 };
  for (let i = 1; i < stops.length; i++) {
    const segment = router.shortestPath(stops[i - 1], stops[i]);
    if (!segment) return null;
    result.nodeIds.push(...segment.nodeIds.slice(1));
    result.durationMin += segment.durationMin;
    result.distanceM += segment.distanceM;
  }
  return result;
}

/** baselineNodeIds is the expanded route returned by baselineRoute/buildTrips. */
export function insertionOptions(router: Router, baselineNodeIds: string[], stopNodeId: string): InsertionOption[] {
  const existing = baselineNodeIds.flatMap((id, index) => id === stopNodeId ? [{
    routeNodeIds: [...baselineNodeIds], stopRouteIndex: index, extraDurationMin: 0, extraDistanceM: 0,
  }] : []);
  if (existing.length) return existing;

  const options: InsertionOption[] = [];
  for (let i = 0; i < baselineNodeIds.length - 1; i++) {
    const from = baselineNodeIds[i];
    const to = baselineNodeIds[i + 1];
    const original = router.shortestPath(from, to);
    const before = router.shortestPath(from, stopNodeId);
    const after = router.shortestPath(stopNodeId, to);
    if (!original || !before || !after) continue;
    options.push({
      routeNodeIds: [...baselineNodeIds.slice(0, i), ...before.nodeIds, ...after.nodeIds.slice(1),
        ...baselineNodeIds.slice(i + 2)],
      stopRouteIndex: i + before.nodeIds.length - 1,
      extraDurationMin: before.durationMin + after.durationMin - original.durationMin,
      extraDistanceM: before.distanceM + after.distanceM - original.distanceM,
    });
  }
  return options.sort((a, b) => a.extraDurationMin - b.extraDurationMin ||
    a.extraDistanceM - b.extraDistanceM || a.stopRouteIndex - b.stopRouteIndex);
}

export function bestInsertion(router: Router, baselineNodeIds: string[], stopNodeId: string): InsertionOption | null {
  return insertionOptions(router, baselineNodeIds, stopNodeId)[0] ?? null;
}

/** Missing employers and unreachable directions cannot produce a usable trip. */
export function buildTrips(employee: Employee, businesses: Business[], router: Router): Trip[] {
  const business = businesses.find(item => item.id === employee.businessId);
  if (!business) return [];
  const trips: Trip[] = [];
  for (const direction of ['evening', 'morning'] as const) {
    const evening = direction === 'evening';
    if (!(evening ? employee.availableEvening : employee.availableMorning)) continue;
    const originNodeId = evening ? business.nodeId : employee.homeNodeId;
    const destinationNodeId = evening ? employee.homeNodeId : business.nodeId;
    const route = baselineRoute(router, originNodeId,
      evening ? employee.eveningViaNodeIds : employee.morningViaNodeIds, destinationNodeId);
    if (!route) continue;
    trips.push({
      id: tripId(employee.id, evening ? 'eve' : 'morn'), employeeId: employee.id, direction,
      originNodeId, destinationNodeId,
      departureMin: evening ? employee.eveningDepartureMin : employee.morningDepartureMin,
      baselineNodeIds: route.nodeIds, baselineDurationMin: route.durationMin, baselineDistanceM: route.distanceM,
    });
  }
  return trips;
}
