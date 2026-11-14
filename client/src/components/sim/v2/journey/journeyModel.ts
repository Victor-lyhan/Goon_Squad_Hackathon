// Package journey mode (docs/mvp2-ui-redesign.md §1): from the simulator + map responses and one
// shipment ID, derive exactly what the map and the right panel show for that package, plus the
// "Play journey" plan that skips the empty gaps. Pure: no React, no DOM, tested in Node.
//
// Nothing here computes a status, an ETA or money. Steps, times, extra minutes, rewards and the
// planned delivery time are read from the plan; step states from `snapshot.occurredEvents`; the
// status from `snapshot.shipmentStatus`; the delivered time from `snapshot.deliveredAtMin`.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { DeliveryPlan, Leg, ShipmentProgress, SimEventKind, StopKind } from '../../../../../../shared/v2/types';
import { decodePath } from '../../../map/layers';
import type { LatLngBounds, MapMover, MapPlace, MapRoute, MapStop, RouteTone } from '../../../map/types';

export const UNKNOWN_PLACE = 'Unknown place';
export const UNKNOWN_CARRIER = 'Unknown carrier';
export const UNKNOWN_NEIGHBORHOOD = 'Unknown neighborhood';
export const NO_PLAN_REASON = 'No delivery plan yet.';

export type StepState = 'done' | 'current' | 'upcoming';

export type JourneyStep = {
  n: number;
  kind: StopKind;
  label: string;
  placeId: string;
  /** Business name, or "Unknown place"; never a raw place ID. */
  placeName: string;
  /** serviceEndMin of this stop. */
  timeMin: number;
  /** arrivalMin of this stop (used by the play plan). */
  arrivalMin: number;
  legIndex: number;
  carrierName: string;
  /** Extra minutes of the leg this step belongs to. */
  extraMin: number;
  state: StepState;
  /** null when the place has no coordinates in the map response. */
  lat: number | null;
  lng: number | null;
};

export type JourneyCarrier = {
  employeeId: string;
  name: string;
  legIndex: number;
  tone: RouteTone;
  homeNeighborhood: string;
  /** `Leg.extraMin` of this carrier's leg. */
  extraMin: number;
  /** `Leg.rewardCents` of this carrier's leg. */
  rewardCents: number;
};

export type Journey = {
  kind: 'journey';
  shipmentId: string;
  title: string;
  planKind: DeliveryPlan['kind'];
  status: ShipmentProgress | null;
  statusLabel: string;
  /** `DeliveryPlan.deliveryMin`: the planned delivery time. */
  deliveryMin: number;
  /** `snapshot.deliveredAtMin[shipmentId]`, or null until the snapshot has it. */
  deliveredAtMin: number | null;
  steps: JourneyStep[];
  carriers: JourneyCarrier[];
  places: MapPlace[];
  routes: MapRoute[];
  stops: MapStop[];
  movers: MapMover[];
  bounds: LatLngBounds | null;
};

export type UnmatchedJourney = { kind: 'unmatched'; shipmentId: string; title: string; reason: string };

export type JourneyResult = Journey | UnmatchedJourney;

export type BuildJourneyInput = { shipmentId: string; sim: SimulatorResponse; map: MapResponse };

// Copy: the enum values keep "hub" in their names, the UI says "relay point" (DECISIONS pass 44).
const STATUS_LABEL: Record<ShipmentProgress, string> = {
  unmatched: 'Unmatched',
  scheduled: 'Waiting for pickup',
  picked_up: 'Picked up, on the way',
  at_hub: 'At the relay point',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

const STEP_LABEL: Record<StopKind, string> = {
  pickup: 'Pickup at sender',
  hub_drop: 'Drop at relay point',
  hub_pickup: 'Pickup at relay point',
  delivery: 'Delivered to recipient',
};

const EVENT_OF: Record<StopKind, SimEventKind> = {
  pickup: 'pickup',
  hub_drop: 'hub_drop',
  hub_pickup: 'hub_pickup',
  delivery: 'delivered',
};

export function statusLabelOf(status: ShipmentProgress | null | undefined): string {
  return status ? STATUS_LABEL[status] ?? 'Status unavailable' : 'Status unavailable';
}

const toneOf = (legIndex: number): RouteTone => (legIndex === 0 ? 'leg1' : 'leg2');

/**
 * The journey of one package. `null` for an unknown shipment; `{ kind: 'unmatched' }` for a
 * shipment without a delivery plan.
 */
export function buildJourney({ shipmentId, sim, map }: BuildJourneyInput): JourneyResult | null {
  const shipment = sim.shipments.find((s) => s.id === shipmentId);
  if (!shipment) return null;

  const businesses = new Map(map.businesses.map((b) => [b.id, b]));
  const homes = new Map(map.homes.map((h) => [h.id, h]));
  const employees = new Map(map.employees.map((e) => [e.id, e]));
  const placeName = (id: string) => businesses.get(id)?.name ?? UNKNOWN_PLACE;
  const title = shipment.label?.trim()
    ? shipment.label.trim()
    : `${placeName(shipment.originBusinessId)} to ${placeName(shipment.destinationBusinessId)}`;

  const plan = sim.plans.find((p) => p.shipmentId === shipmentId);
  if (!plan || plan.legs.length === 0) {
    const reason = sim.unmatched.find((u) => u.shipmentId === shipmentId)?.reason?.trim();
    return { kind: 'unmatched', shipmentId, title, reason: reason || NO_PLAN_REASON };
  }

  const carrierName = (employeeId: string) => employees.get(employeeId)?.name ?? UNKNOWN_CARRIER;

  // ---- Steps, numbered across legs; states from the events that already happened ----
  const occurred = new Set(
    sim.snapshot.occurredEvents
      .filter((e) => e.shipmentId === shipmentId && e.planId === plan.id)
      .map((e) => e.kind),
  );
  const steps: JourneyStep[] = [];
  plan.legs.forEach((leg, legIndex) => {
    for (const stop of leg.stops) {
      const b = businesses.get(stop.placeId);
      steps.push({
        n: steps.length + 1,
        kind: stop.kind,
        label: STEP_LABEL[stop.kind] ?? 'Stop',
        placeId: stop.placeId,
        placeName: placeName(stop.placeId),
        timeMin: stop.serviceEndMin,
        arrivalMin: stop.arrivalMin,
        legIndex,
        carrierName: carrierName(leg.employeeId),
        extraMin: leg.extraMin,
        state: occurred.has(EVENT_OF[stop.kind]) ? 'done' : 'upcoming',
        lat: b ? b.lat : null,
        lng: b ? b.lng : null,
      });
    }
  });
  const firstOpen = steps.find((s) => s.state !== 'done');
  if (firstOpen) firstOpen.state = 'current';

  // ---- Carriers, one per leg ----
  const carriers: JourneyCarrier[] = plan.legs.map((leg, legIndex) => {
    const homeId = employees.get(leg.employeeId)?.homeId;
    return {
      employeeId: leg.employeeId,
      name: carrierName(leg.employeeId),
      legIndex,
      tone: toneOf(legIndex),
      homeNeighborhood: (homeId && homes.get(homeId)?.neighborhood) || UNKNOWN_NEIGHBORHOOD,
      extraMin: leg.extraMin,
      rewardCents: leg.rewardCents,
    };
  });

  // ---- Places: sender, recipient, relay business, carrier homes. Nothing else. ----
  const places: MapPlace[] = [];
  const seen = new Set<string>();
  const addBusiness = (id: string | undefined, role: string) => {
    const b = id ? businesses.get(id) : undefined;
    if (!b || seen.has(b.id)) return;
    seen.add(b.id);
    places.push({ id: b.id, kind: 'business', lat: b.lat, lng: b.lng, label: b.name, sublabel: `${role} · ${b.neighborhood}` });
  };
  addBusiness(shipment.originBusinessId, 'Sender');
  addBusiness(shipment.destinationBusinessId, 'Recipient');
  addBusiness(plan.relayBusinessId, 'Relay point');
  for (const c of carriers) {
    const homeId = employees.get(c.employeeId)?.homeId;
    const h = homeId ? homes.get(homeId) : undefined;
    if (!h || seen.has(h.id)) continue;
    seen.add(h.id);
    places.push({ id: h.id, kind: 'home', lat: h.lat, lng: h.lng, label: `Home of ${c.name}`, sublabel: h.neighborhood });
  }

  // ---- Routes: per carrier, the faint normal commute and the actual route through the stops ----
  const routes = buildRoutes(plan, shipmentId, map);

  // ---- Numbered stop markers ----
  const stops: MapStop[] = steps
    .filter((s): s is JourneyStep & { lat: number; lng: number } => s.lat !== null && s.lng !== null)
    .map((s) => ({ id: `stop-${shipmentId}-${s.n}`, n: s.n, lat: s.lat, lng: s.lng, label: `${s.label} · ${s.placeName}` }));

  // ---- Movers: the package and its carriers' vehicles, as the snapshot places them ----
  const movers: MapMover[] = [];
  const pkg = sim.snapshot.packagePositions[shipmentId];
  if (pkg && Number.isFinite(pkg.lat) && Number.isFinite(pkg.lng)) {
    movers.push({ id: shipmentId, kind: 'package', lat: pkg.lat, lng: pkg.lng, label: title });
  }
  // Each carrier's vehicle has its leg's tone (first carrier leg1, second leg2). If one person carries
  // both legs, the vehicle keeps the first leg's tone, the same dot JourneyLegend shows for them.
  const toneOfCarrier = new Map<string, RouteTone>();
  for (const c of carriers) if (!toneOfCarrier.has(c.employeeId)) toneOfCarrier.set(c.employeeId, c.tone);
  for (const m of sim.snapshot.markers) {
    const tone = toneOfCarrier.get(m.employeeId);
    if (!tone || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    movers.push({ id: m.employeeId, kind: 'vehicle', lat: m.lat, lng: m.lng, label: carrierName(m.employeeId), tone });
  }

  const points: [number, number][] = [
    ...places.map((p) => [p.lng, p.lat] as [number, number]),
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
    ...routes.flatMap((r) => r.path),
  ];

  const status = sim.snapshot.shipmentStatus[shipmentId] ?? null;
  const delivered = sim.snapshot.deliveredAtMin?.[shipmentId];
  return {
    kind: 'journey',
    shipmentId,
    title,
    planKind: plan.kind,
    status,
    statusLabel: statusLabelOf(status),
    deliveryMin: plan.deliveryMin,
    deliveredAtMin: typeof delivered === 'number' && Number.isFinite(delivered) ? delivered : null,
    steps,
    carriers,
    places,
    routes,
    stops,
    movers,
    bounds: boundsOf(points),
  };
}

/** Decoded path for one ordered pair; null when the pair has no cached polyline (never invented). */
function pairPath(map: MapResponse, from: string, to: string): [number, number][] | null {
  const hit = map.polylines.find((p) => p.from === from && p.to === to);
  if (!hit || !hit.encoded) return null;
  try {
    const path = decodePath(hit.encoded).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    return path.length >= 2 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Baseline = the trip's origin → destination (first and last `Leg.placeIds`). Leg = the actual route,
 * one line per run of consecutive place pairs that all have a polyline: a missing pair splits the
 * line instead of bridging the gap with an invented straight segment (DECISIONS pass 44).
 */
function buildRoutes(plan: DeliveryPlan, shipmentId: string, map: MapResponse): MapRoute[] {
  const routes: MapRoute[] = [];
  plan.legs.forEach((leg: Leg, legIndex) => {
    const ownerIds = [shipmentId, plan.id, leg.employeeId];
    const tone = toneOf(legIndex);
    const ids = leg.placeIds;
    if (ids.length >= 2) {
      const base = pairPath(map, ids[0], ids[ids.length - 1]);
      if (base) routes.push({ id: `journey-${shipmentId}-L${legIndex}-baseline`, kind: 'baseline', path: base, ownerIds });
    }
    let run: [number, number][] = [];
    let part = 0;
    const flush = () => {
      if (run.length >= 2) {
        routes.push({ id: `journey-${shipmentId}-L${legIndex}-leg-${part}`, kind: 'leg', tone, path: run, ownerIds });
        part += 1;
      }
      run = [];
    };
    for (let i = 0; i + 1 < ids.length; i += 1) {
      const seg = pairPath(map, ids[i], ids[i + 1]);
      if (!seg) {
        flush();
        continue;
      }
      // Consecutive segments share their joining place; drop the duplicate first point.
      run = run.length ? [...run, ...seg.slice(1)] : seg;
    }
    flush();
  });
  return routes;
}

/** Bounds of [lng, lat] points, padded slightly; null when there are none. */
export function boundsOf(points: [number, number][], pad = 0.004): LatLngBounds | null {
  const ok = points.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (ok.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const [lng, lat] of ok) {
    north = Math.max(north, lat);
    south = Math.min(south, lat);
    east = Math.max(east, lng);
    west = Math.min(west, lng);
  }
  return { north: north + pad, south: south - pad, east: east + pad, west: west - pad };
}

// ---------- Play journey ----------

export type PlayWindow = { legIndex: number; startMin: number; endMin: number };
export type PlayPlan = { windows: PlayWindow[] };

/**
 * One active window per leg: from one minute before the carrier reaches the leg's first stop to the
 * `serviceEndMin` of its last stop. SimulatorResponse carries no trip departure time, so the leg's
 * first arrival is the earliest "moving" minute the browser can read without computing one.
 */
export function playPlan(journey: Journey): PlayPlan {
  const byLeg = new Map<number, JourneyStep[]>();
  for (const s of journey.steps) {
    const list = byLeg.get(s.legIndex) ?? [];
    list.push(s);
    byLeg.set(s.legIndex, list);
  }
  const windows: PlayWindow[] = [...byLeg.entries()]
    .map(([legIndex, steps]) => ({
      legIndex,
      startMin: Math.min(...steps.map((s) => s.arrivalMin)) - 1,
      endMin: Math.max(...steps.map((s) => s.timeMin)),
    }))
    .filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.endMin >= w.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  return { windows };
}

/** Total minutes inside the windows (overlaps counted once). */
export function activeMinutes(plan: PlayPlan): number {
  let total = 0;
  let coveredTo = -Infinity;
  for (const w of plan.windows) {
    const from = Math.max(w.startMin, coveredTo);
    if (w.endMin > from) total += w.endMin - from;
    coveredTo = Math.max(coveredTo, w.endMin);
  }
  return total;
}

/**
 * The minute to seek to when `timeMin` is in a gap (before the first window, or between two), or
 * `null` inside a window and after the last one.
 */
export function nextSeek(plan: PlayPlan, timeMin: number): number | null {
  if (!Number.isFinite(timeMin)) return null;
  for (const w of plan.windows) {
    if (timeMin < w.startMin) return w.startMin;
    if (timeMin <= w.endMin) return null;
  }
  return null;
}

/** True once the time is at or past the end of the last window (or there is nothing to play). */
export function isFinished(plan: PlayPlan, timeMin: number): boolean {
  if (plan.windows.length === 0) return true;
  const last = Math.max(...plan.windows.map((w) => w.endMin));
  return timeMin >= last;
}
