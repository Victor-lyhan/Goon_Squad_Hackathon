// Shared lookups for the simulator network view (networkModel.ts) and selection (selectionModel.ts).
// Pure: no React, no DOM. It only reads the two polled API responses; it never computes a match,
// a status, a time or a position.
//
// Map item IDs:
//   place    = the place ID (biz-…, home-…)
//   vehicle  = the employee ID (one marker per employee)
//   package  = the shipment ID
//   baseline = `baseline:<tripId>`            e.g. baseline:emp-3-eve
//   leg      = `leg:<planId>:<legIndex>`      plus `:<part>` (2, 3, …) when a missing polyline splits the line
//
// Each route also carries its hover label (`MapRoute.label`, the tooltip's first line; the role
// "Delivery route" / "Normal commute" is the second). The words are those of `hoverText` in
// networkModel.ts, minus the role: "Ceramic samples · leg 2 of 2 · carried by Li Chen", "Li Chen · morning".
import { decodePath } from '../../../map/layers';
import type { MapPlace, MapRoute } from '../../../map/types';
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { DeliveryPlan, Home, NetworkBusiness, Shipment } from '../../../../../../shared/v2/types';
import { pairKey, tripId } from '../../../../../../shared/v2/types';

export type MapEmployee = MapResponse['employees'][number];
type Path = [number, number][];

/** A drawn route plus what it belongs to. `placeIds` are the places it passes, drawn or not. */
export type RouteMeta = {
  route: MapRoute;
  employeeId: string;
  planId: string | null;
  shipmentId: string | null;
  /** Index of the leg in its plan; null for a baseline. */
  legIndex: number | null;
  placeIds: string[];
};

/** Plain string order (not locale-dependent), so output is identical on every machine. */
export const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const sortedUnique = (ids: Iterable<string>) => [...new Set(ids)].sort(byId);

// ---------- Hover labels of routes ----------
const joinParts = (...parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p).join(' · ');
const clean = (text: string | null | undefined) => (text ?? '').trim();

/**
 * A commute line's label: the employee's name, plus "evening" or "morning" when the trip ID says which.
 * undefined without a name, so the map keeps its generic text (never an ID, never a made-up name).
 */
export function commuteLabel(employeeName: string | null | undefined, tripIdOfCommute: string): string | undefined {
  const name = clean(employeeName);
  if (!name) return undefined;
  const when = tripIdOfCommute.endsWith('-eve') ? 'evening' : tripIdOfCommute.endsWith('-morn') ? 'morning' : null;
  return joinParts(name, when);
}

/**
 * A delivery line's label in the network view: package name, "leg n of m" for a relay, "carried by <name>".
 * A missing package name reads "Package"; a missing carrier leaves its part out. undefined when neither
 * name is known, so the map keeps its generic text.
 */
export function deliveryLabel(
  packageName: string | null | undefined,
  carrierName: string | null | undefined,
  legIndex: number,
  legCount: number,
): string | undefined {
  const pkg = clean(packageName);
  const carrier = clean(carrierName);
  if (!pkg && !carrier) return undefined;
  return joinParts(pkg || 'Package', legCount > 1 && `leg ${legIndex + 1} of ${legCount}`, carrier && `carried by ${carrier}`);
}

/**
 * A leg line's label in a package journey (the map shows one package, so it is not named again):
 * "Leg 1 · carried by Cy Lam", in the journey legend's words. Without a carrier name, just "Leg 1".
 */
export function journeyLegLabel(carrierName: string | null | undefined, legIndex: number): string {
  const carrier = clean(carrierName);
  return joinParts(`Leg ${legIndex + 1}`, carrier && `carried by ${carrier}`);
}

// ---------- Static part: depends only on MapResponse, cached per response object ----------
type MapIndex = {
  businesses: Map<string, NetworkBusiness>;
  homes: Map<string, Home>;
  employees: Map<string, MapEmployee>;
  /** Employees sorted by ID. */
  employeeList: MapEmployee[];
  places: MapPlace[];
  baselines: RouteMeta[];
  /** Decoded line per ordered place pair; null = not cached (draw nothing). */
  pairPath(from: string, to: string): Path | null;
  /** Contiguous drawn runs along a place sequence, cached by the sequence. */
  runs(placeIds: string[]): Path[];
};

const mapCache = new WeakMap<MapResponse, MapIndex>();

function buildMapIndex(map: MapResponse): MapIndex {
  const businesses = new Map(map.businesses.map((b) => [b.id, b]));
  const homes = new Map(map.homes.map((h) => [h.id, h]));
  const employeeList = [...map.employees].sort((a, b) => byId(a.id, b.id));
  const employees = new Map(employeeList.map((e) => [e.id, e]));

  // Pick one encoded string per pair, independent of input order: a cached line beats null,
  // and between two cached lines the smaller string wins.
  const encodedByPair = new Map<string, string | null>();
  for (const p of map.polylines) {
    const key = pairKey(p.from, p.to);
    const prev = encodedByPair.get(key);
    const next = p.encoded || null;
    if (prev === undefined || (prev === null && next !== null) || (prev !== null && next !== null && next < prev)) {
      encodedByPair.set(key, next);
    }
  }
  const decoded = new Map<string, Path | null>();
  const pairPath = (from: string, to: string): Path | null => {
    const key = pairKey(from, to);
    if (decoded.has(key)) return decoded.get(key)!;
    const enc = encodedByPair.get(key) ?? null;
    let path: Path | null = null;
    if (enc) {
      try {
        const pts = decodePath(enc).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
        path = pts.length >= 2 ? pts : null;
      } catch {
        path = null;
      }
    }
    decoded.set(key, path);
    return path;
  };

  const runCache = new Map<string, Path[]>();
  const runs = (placeIds: string[]): Path[] => {
    const key = placeIds.join('|');
    const hit = runCache.get(key);
    if (hit) return hit;
    const out: Path[] = [];
    let current: Path | null = null;
    for (let i = 0; i + 1 < placeIds.length; i++) {
      const seg = pairPath(placeIds[i], placeIds[i + 1]);
      if (!seg) {
        // A missing line ends the run: joining across it would draw a straight line nobody drove.
        if (current) out.push(current);
        current = null;
        continue;
      }
      if (!current) {
        current = [...seg];
      } else {
        const last = current[current.length - 1];
        const start = seg[0][0] === last[0] && seg[0][1] === last[1] ? 1 : 0;
        for (let k = start; k < seg.length; k++) current.push(seg[k]);
      }
    }
    if (current) out.push(current);
    runCache.set(key, out);
    return out;
  };

  // Places: every business, then every home somebody lives in. Homes are labelled by neighborhood only.
  const places: MapPlace[] = [];
  for (const b of [...map.businesses].sort((x, y) => byId(x.id, y.id))) {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;
    places.push({ id: b.id, kind: 'business', lat: b.lat, lng: b.lng, label: b.name || 'Network business', sublabel: b.neighborhood || undefined });
  }
  const usedHomes = new Set(employeeList.map((e) => e.homeId));
  for (const h of [...homes.values()].sort((x, y) => byId(x.id, y.id))) {
    if (!usedHomes.has(h.id) || !Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
    places.push({ id: h.id, kind: 'home', lat: h.lat, lng: h.lng, label: homeLabel(h) });
  }

  // Baselines: evening = workplace → home, morning = home → workplace (the employee's two trips).
  const baselines: RouteMeta[] = [];
  for (const e of employeeList) {
    const trips: [string, string, string][] = [
      [tripId(e.id, 'eve'), e.businessId, e.homeId],
      [tripId(e.id, 'morn'), e.homeId, e.businessId],
    ];
    for (const [tid, from, to] of trips) {
      const path = pairPath(from, to);
      if (!path) continue;
      baselines.push({
        route: withLabel({ id: `baseline:${tid}`, kind: 'baseline', path, ownerIds: [e.id] }, commuteLabel(e.name, tid)),
        employeeId: e.id,
        planId: null,
        shipmentId: null,
        legIndex: null,
        placeIds: [from, to],
      });
    }
  }
  baselines.sort((a, b) => byId(a.route.id, b.route.id));

  return { businesses, homes, employees, employeeList, places, baselines, pairPath, runs };
}

/** The route with its hover label; no `label` key at all when there is none. */
function withLabel(route: MapRoute, label: string | undefined): MapRoute {
  return label ? { ...route, label } : route;
}

/** Neighborhood only; never an address or coordinates (SPEC MVP II rule 6). */
export function homeLabel(h: Pick<Home, 'neighborhood'>): string {
  const n = (h.neighborhood ?? '').trim();
  return n && !/\d/.test(n) ? n : 'Home';
}

function mapIndex(map: MapResponse): MapIndex {
  let idx = mapCache.get(map);
  if (!idx) {
    idx = buildMapIndex(map);
    mapCache.set(map, idx);
  }
  return idx;
}

// ---------- Full index: static part + the current simulator response ----------
export type NetworkIndex = MapIndex & {
  shipments: Map<string, Shipment>;
  /** Plans sorted by ID. */
  plans: DeliveryPlan[];
  planByShipment: Map<string, DeliveryPlan>;
  /** Baselines and leg routes, sorted by ID. */
  routes: RouteMeta[];
  routeById: Map<string, RouteMeta>;
};

/** The businesses a plan involves: sender, recipient and the relay point (if any). */
export function planBusinessIds(plan: DeliveryPlan | undefined, shipment: Shipment | undefined): string[] {
  const ids: string[] = [];
  if (shipment) ids.push(shipment.originBusinessId, shipment.destinationBusinessId);
  if (plan?.relayBusinessId) ids.push(plan.relayBusinessId);
  if (!shipment && plan) for (const leg of plan.legs) for (const s of leg.stops) ids.push(s.placeId);
  return sortedUnique(ids);
}

export function buildIndex(map: MapResponse, sim: SimulatorResponse): NetworkIndex {
  const base = mapIndex(map);
  const shipments = new Map(sim.shipments.map((s) => [s.id, s]));
  const plans = [...sim.plans].sort((a, b) => byId(a.id, b.id));
  const planByShipment = new Map(plans.map((p) => [p.shipmentId, p]));

  const legs: RouteMeta[] = [];
  for (const plan of plans) {
    const businessIds = planBusinessIds(plan, shipments.get(plan.shipmentId));
    plan.legs.forEach((leg, i) => {
      // Carrier, package, then the businesses: selecting any of them highlights this line.
      const ownerIds = [...new Set([leg.employeeId, plan.shipmentId, ...businessIds])];
      const label = deliveryLabel(shipments.get(plan.shipmentId)?.label, base.employees.get(leg.employeeId)?.name, i, plan.legs.length);
      base.runs(leg.placeIds).forEach((path, part) => {
        legs.push({
          route: withLabel(
            { id: part === 0 ? `leg:${plan.id}:${i}` : `leg:${plan.id}:${i}:${part + 1}`, kind: 'leg', path, ownerIds },
            label,
          ),
          employeeId: leg.employeeId,
          planId: plan.id,
          shipmentId: plan.shipmentId,
          legIndex: i,
          placeIds: leg.placeIds,
        });
      });
    });
  }
  const routes = [...base.baselines, ...legs].sort((a, b) => byId(a.route.id, b.route.id));
  const routeById = new Map(routes.map((r) => [r.route.id, r]));
  return { ...base, shipments, plans, planByShipment, routes, routeById };
}

/** Shipment IDs the employee carries on at least one leg. */
export function shipmentsCarriedBy(idx: NetworkIndex, employeeId: string): string[] {
  return sortedUnique(idx.plans.filter((p) => p.legs.some((l) => l.employeeId === employeeId)).map((p) => p.shipmentId));
}

/** Shipment IDs a business sends, receives or holds as relay point (matched or not). */
export function shipmentsOfBusiness(idx: NetworkIndex, businessId: string): string[] {
  const ids: string[] = [];
  for (const s of idx.shipments.values()) {
    if (s.originBusinessId === businessId || s.destinationBusinessId === businessId) ids.push(s.id);
  }
  for (const p of idx.plans) if (p.relayBusinessId === businessId) ids.push(p.shipmentId);
  return sortedUnique(ids);
}
