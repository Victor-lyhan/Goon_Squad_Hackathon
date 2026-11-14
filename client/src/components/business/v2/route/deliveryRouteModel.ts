// Pure model for the Business delivery route map (#549): one ShipmentView and the GET /api/v2/map
// response in, plain GoogleBaseMap props out. Same look as the simulator's package journey: sender,
// recipient and relay point as places, one `leg` route per carrier leg in LEG1 / LEG2, numbered stops.
//
// Nothing is computed here except the shape: names and coordinates come from `map.businesses`, the
// stops and their times from `view.plan`, route lines from `map.polylines`. A stop pair without a
// route line is drawn as the straight line between its two places (issue #549). Carrier homes are
// never places on this map (SPEC MVP II rules 5 and 6): only the three businesses of the delivery.
import type { MapResponse, ShipmentView } from '../../../../../../shared/v2/api';
import type { DeliveryPlan, NetworkBusiness, StopKind } from '../../../../../../shared/v2/types';
import { decodePath } from '../../../map/layers';
import type { LatLngBounds, MapPlace, MapRoute, MapStop, RouteTone } from '../../../map/types';
import { formatMin } from '../../../../ui/format';

export const UNKNOWN_PLACE = 'Unknown place';
export const STRAIGHT_NOTE = 'A straight line is shown where the road route is not loaded yet.';
export const NO_ROUTE_NOTE = 'No route yet: this delivery has no match.';

// Copy: the StopKind values keep their MVP 1 names; the UI says "relay point" (docs/mvp2-ui-redesign.md).
export const STOP_LABEL: Record<StopKind, string> = {
  pickup: 'Pickup',
  hub_drop: 'Drop at relay point',
  hub_pickup: 'Pickup next morning',
  delivery: 'Delivered',
};

export type RouteStopText = { n: number; label: string; placeName: string; time: string };

export type DeliveryRoute = {
  places: MapPlace[];
  routes: MapRoute[];
  stops: MapStop[];
  /** The stops as text under the map, so nothing depends on the map loading. */
  stopTexts: RouteStopText[];
  /** Tones of the legs drawn, in order (for the legend). */
  tones: RouteTone[];
  /** True when at least one stop pair is drawn as a straight line. */
  straight: boolean;
  fitTo: LatLngBounds | null;
};

const toneOf = (legIndex: number): RouteTone => (legIndex === 0 ? 'leg1' : 'leg2');

const hasPoint = (b: NetworkBusiness | undefined): b is NetworkBusiness =>
  !!b && Number.isFinite(b.lat) && Number.isFinite(b.lng);

/** The ordered place pairs a leg's route is drawn through: its stop places, repeats dropped. */
export function legStopPairs(leg: DeliveryPlan['legs'][number]): [string, string][] {
  const ids: string[] = [];
  for (const s of leg.stops) if (ids[ids.length - 1] !== s.placeId) ids.push(s.placeId);
  const pairs: [string, string][] = [];
  for (let i = 1; i < ids.length; i += 1) pairs.push([ids[i - 1], ids[i]]);
  return pairs;
}

/** A stable text of a plan's shape: when it changes, the map may lack the plan's pairs. */
export function planKey(plan: DeliveryPlan): string {
  return `${plan.id}:${plan.legs.map((l) => l.stops.map((s) => s.placeId).join('>')).join('|')}`;
}

/** True when the map lists every stop pair of the plan (with or without a cached line). */
export function mapCoversPlan(map: MapResponse, plan: DeliveryPlan): boolean {
  const listed = new Set(map.polylines.map((p) => `${p.from}\u0000${p.to}`));
  return plan.legs.every((leg) => legStopPairs(leg).every(([a, b]) => listed.has(`${a}\u0000${b}`)));
}

/** Decoded line [lng, lat][] for an ordered pair; null when not listed, not cached or unreadable. */
function lineFor(map: MapResponse, from: string, to: string): [number, number][] | null {
  const hit = map.polylines.find((p) => p.from === from && p.to === to && p.encoded);
  if (!hit?.encoded) return null;
  try {
    const path = decodePath(hit.encoded);
    return path.length >= 2 && path.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)) ? path : null;
  } catch {
    return null;
  }
}

function boundsOf(points: [number, number][], pad = 0.004): LatLngBounds | null {
  if (points.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const [lng, lat] of points) {
    north = Math.max(north, lat);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    west = Math.min(west, lng);
  }
  return { north: north + pad, south: south - pad, east: east + pad, west: west - pad };
}

export function buildDeliveryRoute(view: ShipmentView, map: MapResponse): DeliveryRoute {
  const byId = new Map(map.businesses.map((b) => [b.id, b]));
  const { shipment, plan } = view;
  const nameOf = (id: string) => byId.get(id)?.name ?? UNKNOWN_PLACE;

  // ---- Places: sender, recipient, relay point. Never a home. ----
  const places: MapPlace[] = [];
  const add = (id: string | undefined, role: string) => {
    const b = id ? byId.get(id) : undefined;
    if (!hasPoint(b) || places.some((p) => p.id === b.id)) return;
    places.push({ id: b.id, kind: 'business', lat: b.lat, lng: b.lng, label: b.name, sublabel: `${role} · ${b.neighborhood}` });
  };
  add(shipment.originBusinessId, 'Sender');
  add(shipment.destinationBusinessId, 'Recipient');
  if (plan?.kind === 'relay') add(plan.relayBusinessId, 'Relay point');

  const routes: MapRoute[] = [];
  const stops: MapStop[] = [];
  const stopTexts: RouteStopText[] = [];
  const tones: RouteTone[] = [];
  let straight = false;

  if (plan) {
    plan.legs.forEach((leg, legIndex) => {
      // ---- Stops, numbered across legs ----
      for (const s of leg.stops) {
        const n = stopTexts.length + 1;
        const label = STOP_LABEL[s.kind] ?? 'Stop';
        const placeName = nameOf(s.placeId);
        stopTexts.push({ n, label, placeName, time: formatMin(s.serviceStartMin) });
        const b = byId.get(s.placeId);
        if (hasPoint(b)) stops.push({ id: `stop-${shipment.id}-${n}`, n, lat: b.lat, lng: b.lng, label: `${label} · ${placeName}` });
      }

      // ---- One route per leg: the cached road line per stop pair, else the straight line ----
      let path: [number, number][] = [];
      for (const [from, to] of legStopPairs(leg)) {
        const a = byId.get(from);
        const b = byId.get(to);
        let seg = lineFor(map, from, to);
        if (!seg) {
          if (!hasPoint(a) || !hasPoint(b)) continue;
          seg = [[a.lng, a.lat], [b.lng, b.lat]];
          straight = true;
        }
        path = path.length ? [...path, ...seg.slice(1)] : seg;
      }
      if (path.length >= 2) {
        const tone = toneOf(legIndex);
        tones.push(tone);
        routes.push({ id: `delivery-${shipment.id}-leg${legIndex + 1}`, kind: 'leg', tone, path, ownerIds: [shipment.id, plan.id] });
      }
    });
  }

  const points: [number, number][] = [
    ...places.map((p) => [p.lng, p.lat] as [number, number]),
    ...routes.flatMap((r) => r.path),
  ];
  return { places, routes, stops, stopTexts, tones, straight, fitTo: boundsOf(points) };
}
