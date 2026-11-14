import type { MapResponse, ShipmentView } from '../../../../shared/api';
import type { Business, Hub } from '../../../../shared/types';
import type { CityMapProps } from '../CityMap';
import { projectNodes, type Point } from '../sim/mapGeometry';

export type MiniMapInput = {
  originNodeId: string;
  destinationNodeId: string;
  hubId?: string;
  /** Routes returned by the API (one per carrier leg). The frontend never computes routes. */
  legRoutes?: string[][];
  baselineRoutes?: string[][];
};

export type MiniMapProps = Pick<CityMapProps, 'graph' | 'businesses' | 'hubs' | 'highlightRoutes' | 'baselineRoutes'>;

/** Pure: pick the businesses, hub and routes CityMap should draw. Unknown ids are dropped. */
export function miniMapProps(map: MapResponse, input: MiniMapInput): MiniMapProps {
  const ends = new Set([input.originNodeId, input.destinationNodeId]);
  const businesses: Business[] = map.businesses.filter((b) => ends.has(b.nodeId));
  const hubs: Hub[] = input.hubId ? map.hubs.filter((h) => h.id === input.hubId) : [];
  const known = new Set(map.graph.nodes.map((n) => n.id));
  const usable = (rs?: string[][]) => (rs ?? []).filter((r) => r.length >= 2 && r.every((id) => known.has(id)));
  return {
    graph: map.graph,
    businesses,
    hubs,
    highlightRoutes: usable(input.legRoutes),
    baselineRoutes: usable(input.baselineRoutes),
  };
}

/** Pure: ShipmentView + MapResponse -> CityMap props. Unmatched shipments have no legs, so no routes. */
export function routeMapFromView(view: ShipmentView, map: MapResponse): MiniMapProps {
  const byId = (id: string) => map.businesses.find((b) => b.id === id)?.nodeId ?? '';
  return miniMapProps(map, {
    originNodeId: byId(view.shipment.originBusinessId),
    destinationNodeId: byId(view.shipment.destinationBusinessId),
    hubId: view.plan?.kind === 'relay' ? view.plan.hubId : undefined,
    legRoutes: view.plan?.legs.map((l) => l.routeNodeIds) ?? [],
  });
}

// ---------- Business route map (own SVG; draws only API routes, never pathfinds) ----------

export type RouteMapKind = 'direct' | 'relay' | 'preview';
export type RouteMapLeg = { index: number; points: Point[]; label: Point; dashed: boolean; names: string };
export type RouteMapMarker = { id: string; name: string; at: Point; kind: 'business' | 'hub' };
export type RouteMapModel = {
  kind: RouteMapKind;
  summary: string;
  /** Short visible caption, e.g. "Relay via Harbor Hub: 2 legs". */
  caption: string;
  viewBox: { x: number; y: number; width: number; height: number };
  roads: { a: Point; b: Point }[];
  legs: RouteMapLeg[];
  markers: RouteMapMarker[];
};
export type RouteMapResult = { ok: true; model: RouteMapModel } | { ok: false; reason: string };

export const ROUTE_MAP_PAD_X = 170;
export const ROUTE_MAP_PAD_Y = 120;

const STALE = 'This route map is out of date. Refresh to see the current plan.';

/**
 * Pure: MapResponse + API plan -> everything the SVG needs, or a friendly fallback when the
 * plan mentions a node/hub the current city does not have (stale data).
 */
export function buildRouteMap(map: MapResponse, input: MiniMapInput): RouteMapResult {
  const nodes = new Map(map.graph.nodes.map((n) => [n.id, n]));
  const legRoutes = input.legRoutes ?? [];
  const origin = map.businesses.find((b) => b.nodeId === input.originNodeId);
  const dest = map.businesses.find((b) => b.nodeId === input.destinationNodeId);
  const hub = input.hubId ? map.hubs.find((h) => h.id === input.hubId) : undefined;
  if (!origin || !dest || !nodes.has(origin.nodeId) || !nodes.has(dest.nodeId)) return { ok: false, reason: STALE };
  if (input.hubId && (!hub || !nodes.has(hub.nodeId))) return { ok: false, reason: STALE };
  if (legRoutes.some((r) => r.some((id) => !nodes.has(id)))) return { ok: false, reason: STALE };
  const routes = legRoutes.filter((r) => r.length >= 2);

  const kind: RouteMapKind = hub && routes.length > 0 ? 'relay' : routes.length > 0 ? 'direct' : 'preview';
  const involved = new Set<string>([origin.nodeId, dest.nodeId, ...(hub ? [hub.nodeId] : []), ...routes.flat()]);

  // Crop to the involved area (plus a margin) so the route fills the map instead of the whole city.
  const inv = [...involved].map((id) => nodes.get(id)!);
  const minX = Math.min(...inv.map((n) => n.x)); const maxX = Math.max(...inv.map((n) => n.x));
  const minY = Math.min(...inv.map((n) => n.y)); const maxY = Math.max(...inv.map((n) => n.y));
  const edgeLens = map.graph.edges.map((e) => {
    const a = nodes.get(e.from); const b = nodes.get(e.to);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }).filter((d) => d > 0);
  const step = edgeLens.length ? Math.min(...edgeLens) : 1;
  const margin = Math.max(0.15 * Math.max(maxX - minX, maxY - minY), 1.5 * step);
  const cropped = map.graph.nodes.filter((n) => n.x >= minX - margin && n.x <= maxX + margin && n.y >= minY - margin && n.y <= maxY + margin);
  const pos = projectNodes(cropped);
  const keep = new Set(cropped.map((n) => n.id));
  const roads = map.graph.edges
    .filter((e) => keep.has(e.from) && keep.has(e.to))
    .map((e) => ({ a: pos.get(e.from)!, b: pos.get(e.to)! }));

  const pts = [...pos.values()];
  const x0 = Math.min(...pts.map((p) => p.x)) - ROUTE_MAP_PAD_X;
  const y0 = Math.min(...pts.map((p) => p.y)) - ROUTE_MAP_PAD_Y;
  const viewBox = {
    x: x0, y: y0,
    width: Math.max(...pts.map((p) => p.x)) + ROUTE_MAP_PAD_X - x0,
    height: Math.max(...pts.map((p) => p.y)) + ROUTE_MAP_PAD_Y - y0,
  };

  const nodeName = (id: string) => nodes.get(id)?.label ?? 'a street corner';
  const legs: RouteMapLeg[] = routes.map((r, i) => {
    const points = r.map((id) => pos.get(id)!);
    const mid = points[Math.floor((points.length - 1) / 2)];
    const next = points[Math.floor((points.length - 1) / 2) + 1] ?? mid;
    const from = i === 0 ? origin.name : hub?.name ?? nodeName(r[0]);
    const to = kind === 'relay' && i === 0 ? hub!.name : dest.name;
    return { index: i, points, label: { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 }, dashed: i % 2 === 1, names: `${from} to ${to}` };
  });

  const markers: RouteMapMarker[] = [
    { id: `b-${origin.id}`, name: origin.name, at: pos.get(origin.nodeId)!, kind: 'business' },
    { id: `b-${dest.id}`, name: dest.name, at: pos.get(dest.nodeId)!, kind: 'business' },
  ];
  if (hub && kind === 'relay') markers.push({ id: `h-${hub.id}`, name: hub.name, at: pos.get(hub.nodeId)!, kind: 'hub' });

  const n = legs.length;
  const summary = kind === 'relay'
    ? `Relay via ${hub!.name}: ${n} legs. Leg 1 (solid line): ${legs[0].names}. Leg 2 (dashed line): ${legs[1]?.names ?? `${hub!.name} to ${dest.name}`}.`
    : kind === 'direct'
      ? `Direct route: ${n} leg${n === 1 ? '' : 's'}, ${origin.name} to ${dest.name}.`
      : `Route from ${origin.name} to ${dest.name}. The carrier route is shown once a match is found.`;
  const caption = kind === 'relay' ? `Relay via ${hub!.name}: ${n} legs` : summary;
  return { ok: true, model: { kind, summary, caption, viewBox, roads, legs, markers } };
}
