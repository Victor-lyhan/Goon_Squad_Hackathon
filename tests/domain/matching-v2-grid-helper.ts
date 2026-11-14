import fixture from '../../fixtures/relayFixture.json';
import { pairKey } from '../../shared/v2/types';
import { TableTravel } from './matching-v2-helpers';

/**
 * The fake travel provider of the spec §9 relay fixture (SPEC MVP II rule 7).
 * It reads the one-way roads of fixtures/relayFixture.json and finds shortest
 * paths with its own code, so the tests of the MVP II matcher need no MVP 1 file.
 */
export type GridGraph = {
  nodes: { id: string }[];
  edges: { from: string; to: string; durationMin: number; distanceM: number }[];
};
export type GridCost = { durationMin: number; distanceM: number };

/** Place ID of the MVP II matcher -> node of the §9 grid. */
export const RELAY_FIXTURE_PLACES = {
  'biz-a': 'A', 'biz-b': 'B', 'biz-h': 'H', 'home-x': 'X', 'home-y': 'Y',
} as const;

/** Fewest minutes first, then fewest metres. */
const cheaper = (a: GridCost, b: GridCost) =>
  a.durationMin < b.durationMin || (a.durationMin === b.durationMin && a.distanceM < b.distanceM);

/** Cost of the shortest path from one node to every node it can reach (Dijkstra; roads are one-way). */
export function gridCostsFrom(graph: GridGraph, from: string): Map<string, GridCost> {
  const best = new Map<string, GridCost>();
  const open = new Set(graph.nodes.map(node => node.id));
  if (!open.has(from)) return best;
  best.set(from, { durationMin: 0, distanceM: 0 });
  // The grid has five nodes; scanning for the cheapest open node is enough.
  while (true) {
    let current: string | undefined;
    for (const id of open) {
      const cost = best.get(id);
      if (cost && (current === undefined || cheaper(cost, best.get(current)!))) current = id;
    }
    if (current === undefined) return best;
    open.delete(current);
    const cost = best.get(current)!;
    for (const edge of graph.edges) {
      // A road to a node the graph does not list leads nowhere.
      if (edge.from !== current || !open.has(edge.to)) continue;
      const next = { durationMin: cost.durationMin + edge.durationMin, distanceM: cost.distanceM + edge.distanceM };
      const known = best.get(edge.to);
      if (!known || cheaper(next, known)) best.set(edge.to, next);
    }
  }
}

/**
 * A complete table for the given places: whole minutes and metres of the shortest path.
 * The fixture explicitly has no other roads. Infinity is the known shortest
 * path distance for unreachable pairs, not missing/estimated travel data.
 */
export function gridTravel(graph: GridGraph, places: Record<string, string>): TableTravel {
  const travel = new TableTravel();
  for (const [from, nodeFrom] of Object.entries(places)) {
    const costs = gridCostsFrom(graph, nodeFrom);
    for (const [to, nodeTo] of Object.entries(places)) {
      const cost = costs.get(nodeTo);
      travel.pairs[pairKey(from, to)] = {
        durationMin: cost?.durationMin ?? Infinity, distanceM: cost?.distanceM ?? Infinity,
      };
    }
  }
  return travel;
}

/** A fresh table of the five §9 places on every call, so a test may change its own copy. */
export function relayFixtureTravel(): TableTravel {
  return gridTravel(fixture.graph, RELAY_FIXTURE_PLACES);
}
