// Package journey mode (docs/mvp2-ui-redesign.md §1): from the simulator + map responses and one
// shipment ID, derive exactly what the map and the right panel show for that package, plus the
// "Play journey" plan that skips the empty gaps. Pure: no React, no DOM, tested in Node.
//
// Nothing here computes a status, an ETA or money. Steps, times, extra minutes, rewards and the
// planned delivery time are read from the plan; step states from `snapshot.occurredEvents`; the
// status from `snapshot.shipmentStatus`; the delivered time from `snapshot.deliveredAtMin`.
//
// The map (docs/mvp3.md P1, P4): each carrier's whole commute of that trip thin in its colour, the part
// where it has the package thick; symbols instead of numbered stops (sender square, relay diamond, swap
// at the handoff, recipient flag) with short labels; carrier A and B letters on the vehicles.
// #851: a carrier's vehicle is on the map only during the commute in which it handles this package
// (relay: A's evening commute, B's next-morning commute; direct: the one commute). The same person
// driving another package the next morning or the evening before is not part of this journey.
import type { MapResponse, SimulatorResponse } from '../../../../../../shared/v2/api';
import type { DeliveryPlan, Leg, ShipmentProgress, SimEventKind, StopKind } from '../../../../../../shared/v2/types';
import { formatClock } from '../../../../ui/format';
import { decodePath, toneLetter } from '../../../map/layers';
import type { LatLngBounds, MapMover, MapPlace, MapRoute, MapStop, RouteTone, StopSymbol } from '../../../map/types';
import { commuteLabel, journeyLegLabel } from '../network/networkIndex';

export const UNKNOWN_PLACE = 'Unknown place';
export const UNKNOWN_CARRIER = 'Unknown carrier';
export const UNKNOWN_NEIGHBORHOOD = 'Unknown neighborhood';
export const NO_PLAN_REASON = 'No delivery plan yet.';

export type StepState = 'done' | 'current' | 'upcoming';

export type JourneyStep = {
  n: number;
  kind: StopKind;
  label: string;
  /**
   * The step as one plain sentence (`stepSentence`): who does what, where. It is the line the timeline
   * shows; `label` stays the short name of the stop for the map's tooltip and the Play bar's step text.
   */
  sentence: string;
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
  /** The map's symbol for this stop (sender square, relay diamond, swap, flag), as on its map stop. */
  symbol: StopSymbol;
  /** The short text the map draws next to the symbol ("Overnight · Roastery", "Delivered 9:12 AM"). */
  symbolLabel: string;
  /** null when the place has no coordinates in the map response. */
  lat: number | null;
  lng: number | null;
};

export type JourneyCarrier = {
  employeeId: string;
  name: string;
  legIndex: number;
  tone: RouteTone;
  /** "A" for the first leg's carrier, "B" for the second: the letter on the vehicle and in the legend. */
  letter: 'A' | 'B';
  homeNeighborhood: string;
  /** `Leg.extraMin` of this carrier's leg. */
  extraMin: number;
  /** `Leg.rewardCents` of this carrier's leg. */
  rewardCents: number;
};

/**
 * One carrier's whole commute on its leg, as planned: home to work in the morning, work to home in the
 * evening, through the stops. Read from the trip and the leg; nothing is computed.
 */
export type JourneyCommute = {
  legIndex: number;
  /** `Trip.departureMin` of the leg's trip; null when the simulator answer has no such trip. */
  departureMin: number | null;
  /** `Leg.finishMin`: the carrier is at the end of its commute. */
  finishMin: number;
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
  /** One per leg, for Play (`playPlan`) and for when a carrier's vehicle is on the map (#851). */
  commutes: JourneyCommute[];
  /**
   * Where the last leg's carrier ends its commute after the delivery: `home` on an evening trip, `work`
   * on a morning trip (the last of `Leg.placeIds` is the carrier's home or business); null when unknown.
   * The step line says the carrier is heading there while Play still runs after the delivery (#780).
   */
  endOfCommute: 'home' | 'work' | null;
  places: MapPlace[];
  routes: MapRoute[];
  stops: MapStop[];
  /**
   * The package, and each carrier's vehicle while the snapshot's minute is inside the commute in which
   * that carrier handles the package (#851). No vehicle before a carrier sets off or after it arrives.
   */
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

/** Who a step's sentence names when the map has no name for the carrier. */
export const SOMEONE = 'A commuter';
/** The place a step's sentence names when the map has no name for the business. */
const PLACE_ROLE: Record<StopKind, string> = {
  pickup: 'the sender',
  hub_drop: 'the relay point',
  hub_pickup: 'the relay point',
  delivery: 'the recipient',
};

/**
 * One step of a journey as a plain sentence (issue 908): "Samira picks up the package at Blue Bottle
 * Coffee." `who` is the carrier's first name and `place` the business's name, both read from the map
 * response; without one the sentence says "A commuter" or the place's role. Only words: the step's
 * time and state stay the plan's and the snapshot's.
 */
export function stepSentence(kind: StopKind, who: string, place: string): string {
  const name = who.trim() || SOMEONE;
  const at = place.trim() || PLACE_ROLE[kind] || 'the next stop';
  switch (kind) {
    case 'pickup': return `${name} picks up the package at ${at}.`;
    case 'hub_drop': return `${name} leaves it at ${at} for the night.`;
    case 'hub_pickup': return `${name} picks it up at ${at}.`;
    case 'delivery': return `${name} delivers it to ${at}.`;
    default: return `${name} stops at ${at}.`;
  }
}

/** Where "See the numbers" goes: the study page, a static file (the homepage's button has the same two values). */
export const NUMBERS_HREF = '/study.html';
export const NUMBERS_LABEL = 'See the numbers';

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
  // For the step sentences: the first name only ("Samira"), '' when the map has no name.
  const firstName = (employeeId: string) => employees.get(employeeId)?.name?.trim().split(/\s+/)[0] ?? '';

  // ---- Stop symbols with short labels (times are clock times; the day/night badge gives the day) ----
  // Shared by the map's stops and the timeline's steps, so both read the same.
  const deliveredAt = sim.snapshot.deliveredAtMin?.[shipmentId];
  const deliveredAtMin = typeof deliveredAt === 'number' && Number.isFinite(deliveredAt) ? deliveredAt : null;
  const knownName = (id: string) => businesses.get(id)?.name?.trim() || '';
  const carrierB = plan.legs[1] ? employees.get(plan.legs[1].employeeId)?.name?.trim() : undefined;
  const symbolOf = (kind: StopKind, placeId: string): { symbol: StopSymbol; label: string } => {
    switch (kind) {
      case 'pickup':
        return { symbol: 'sender', label: knownName(placeId) || 'Sender' };
      case 'hub_drop':
        return { symbol: 'relay', label: joinLabel('Overnight', knownName(placeId)) };
      case 'hub_pickup':
        return { symbol: 'swap', label: carrierB ? `Handed to ${carrierB}` : 'Handed to carrier B' };
      default:
        return {
          symbol: 'recipient',
          label: deliveredAtMin !== null
            ? `Delivered ${formatClock(deliveredAtMin)}`
            : knownName(placeId) ? `To ${knownName(placeId)}` : 'To recipient',
        };
    }
  };

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
      const sym = symbolOf(stop.kind, stop.placeId);
      steps.push({
        n: steps.length + 1,
        kind: stop.kind,
        label: STEP_LABEL[stop.kind] ?? 'Stop',
        sentence: stepSentence(stop.kind, firstName(leg.employeeId), knownName(stop.placeId)),
        placeId: stop.placeId,
        placeName: placeName(stop.placeId),
        timeMin: stop.serviceEndMin,
        arrivalMin: stop.arrivalMin,
        legIndex,
        carrierName: carrierName(leg.employeeId),
        extraMin: leg.extraMin,
        state: occurred.has(EVENT_OF[stop.kind]) ? 'done' : 'upcoming',
        symbol: sym.symbol,
        symbolLabel: sym.label,
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
      letter: toneLetter(toneOf(legIndex)),
      homeNeighborhood: (homeId && homes.get(homeId)?.neighborhood) || UNKNOWN_NEIGHBORHOOD,
      extraMin: leg.extraMin,
      rewardCents: leg.rewardCents,
    };
  });

  // ---- Each carrier's whole commute: the trip's departure and the leg's finish (#761) ----
  const trips = new Map((sim.trips ?? []).map((t) => [t.id, t]));
  const commutes: JourneyCommute[] = plan.legs.map((leg, legIndex) => {
    const departure = trips.get(leg.tripId)?.departureMin;
    return {
      legIndex,
      departureMin: typeof departure === 'number' && Number.isFinite(departure) ? departure : null,
      finishMin: leg.finishMin,
    };
  });

  // ---- Where the delivering carrier drives on to: the last place of its leg, its home or its work ----
  const lastLeg = plan.legs[plan.legs.length - 1];
  const lastEmployee = employees.get(lastLeg.employeeId);
  const lastPlace = lastLeg.placeIds[lastLeg.placeIds.length - 1];
  const endOfCommute = !lastEmployee || !lastPlace ? null
    : lastPlace === lastEmployee.homeId ? 'home' : lastPlace === lastEmployee.businessId ? 'work' : null;

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

  // ---- Routes: per carrier, the whole commute (thin) and the part with the package (thick) ----
  const routes = buildRoutes(plan, shipmentId, map, (employeeId) => employees.get(employeeId)?.name);

  // ---- Map stops: each step's symbol and short label ----
  const stops: MapStop[] = steps
    .filter((s): s is JourneyStep & { lat: number; lng: number } => s.lat !== null && s.lng !== null)
    .map((s) => ({
      id: `stop-${shipmentId}-${s.n}`,
      n: s.n,
      lat: s.lat,
      lng: s.lng,
      symbol: s.symbol,
      label: s.symbolLabel,
      detail: `${s.label} · ${s.placeName}`,
    }));

  // ---- Movers: the package and its carriers' vehicles, as the snapshot places them ----
  const movers: MapMover[] = [];
  const pkg = sim.snapshot.packagePositions[shipmentId];
  if (pkg && Number.isFinite(pkg.lat) && Number.isFinite(pkg.lng)) {
    movers.push({ id: shipmentId, kind: 'package', lat: pkg.lat, lng: pkg.lng, label: title });
  }
  // Each carrier's vehicle has its leg's tone and letter (first carrier leg1 "A", second leg2 "B"). If one
  // person carries both legs, the vehicle keeps the first leg's tone and letter.
  const carrierOf = new Map<string, JourneyCarrier>();
  for (const c of carriers) if (!carrierOf.has(c.employeeId)) carrierOf.set(c.employeeId, c);
  // #851: only while the carrier is on the commute in which it handles this package. The snapshot also
  // places a carrier while it drives another package (its next morning, its evening before); that marker
  // is not this journey's. The windows are Play's own (`legWindows`), so what Play steps through is what moves.
  const snapshotMin = Number.isFinite(sim.snapshot.timeMin) ? sim.snapshot.timeMin : sim.clock.timeMin;
  const handling = new Set(
    legWindows(steps, commutes)
      .filter((w) => snapshotMin >= w.startMin && snapshotMin <= w.endMin)
      .map((w) => plan.legs[w.legIndex]?.employeeId),
  );
  for (const m of sim.snapshot.markers) {
    const c = carrierOf.get(m.employeeId);
    if (!c || !handling.has(m.employeeId) || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    movers.push({ id: m.employeeId, kind: 'vehicle', lat: m.lat, lng: m.lng, label: carrierName(m.employeeId), tone: c.tone, badge: c.letter });
  }

  const points: [number, number][] = [
    ...places.map((p) => [p.lng, p.lat] as [number, number]),
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
    ...routes.flatMap((r) => r.path),
  ];

  const status = sim.snapshot.shipmentStatus[shipmentId] ?? null;
  return {
    kind: 'journey',
    shipmentId,
    title,
    planKind: plan.kind,
    status,
    statusLabel: statusLabelOf(status),
    deliveryMin: plan.deliveryMin,
    deliveredAtMin,
    steps,
    carriers,
    commutes,
    endOfCommute,
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

/** "Overnight · Roastery", or "Overnight" alone when the name is unknown. */
function joinLabel(head: string, name: string): string {
  return name ? `${head} · ${name}` : head;
}

/**
 * Per carrier, two kinds of `leg` route in the carrier's tone:
 * - `carried: false`: the whole trip of that commute (`Leg.placeIds`: home to work in the morning, work to
 *   home in the evening, through the stops), drawn thin;
 * - `carried: true`: the part from the carrier's pickup stop to its drop stop, drawn thick on top.
 * Each is one line per run of consecutive place pairs that all have a polyline: a missing pair splits
 * the line instead of bridging the gap with an invented straight segment (DECISIONS pass 44). The grey
 * normal commute (origin to destination without stops) is not drawn in a journey.
 */
function buildRoutes(
  plan: DeliveryPlan,
  shipmentId: string,
  map: MapResponse,
  nameOf: (employeeId: string) => string | undefined,
): MapRoute[] {
  const routes: MapRoute[] = [];
  plan.legs.forEach((leg: Leg, legIndex) => {
    const ownerIds = [shipmentId, plan.id, leg.employeeId];
    const tone = toneOf(legIndex);
    const ids = leg.placeIds;
    // Hover labels (the tooltip's first line): the real name only, never "Unknown carrier" or an ID.
    const name = nameOf(leg.employeeId);
    const commute = commuteLabel(name, leg.tripId);
    const label = journeyLegLabel(name, legIndex);
    runsOf(map, ids).forEach((path, part) => {
      routes.push({ id: `journey-${shipmentId}-L${legIndex}-trip-${part}`, kind: 'leg', tone, carried: false, path, ownerIds, ...(commute ? { label: commute } : {}) });
    });
    // The carried part: from the first stop's place to the last stop's place, in travel order.
    const first = leg.stops[0]?.placeId;
    const last = leg.stops[leg.stops.length - 1]?.placeId;
    const from = first ? ids.indexOf(first) : -1;
    const to = last && from >= 0 ? ids.indexOf(last, from + 1) : -1;
    if (from < 0 || to < 0) return;
    runsOf(map, ids.slice(from, to + 1)).forEach((path, part) => {
      routes.push({ id: `journey-${shipmentId}-L${legIndex}-leg-${part}`, kind: 'leg', tone, carried: true, path, ownerIds, label });
    });
  });
  return routes;
}

/** The decoded lines through `ids` in order, split where a pair has no cached polyline. */
function runsOf(map: MapResponse, ids: string[]): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length >= 2) runs.push(run);
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
  return runs;
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

/**
 * One leg of Play. `startMin` to `endMin` is the carrier's whole commute; `carryStartMin` to
 * `carryEndMin` is the part around the package (one minute before the carrier reaches the leg's first
 * stop, to the `serviceEndMin` of its last), which Play steps through more slowly.
 */
export type PlayWindow = { legIndex: number; startMin: number; endMin: number; carryStartMin: number; carryEndMin: number };
export type PlayPlan = { windows: PlayWindow[] };

/**
 * One window per leg: the carrier's whole commute, from one minute before the leg's trip departs
 * (`Trip.departureMin`, sent in `SimulatorResponse.trips`) to the leg's `finishMin`. So the morning
 * carrier is seen from leaving home to arriving at work and the evening carrier from leaving work to
 * arriving home (docs/mvp4.md F2). A leg whose trip is not in the answer (a sample written before
 * `trips`) keeps the stop-based window: only the part around the package.
 */
export function playPlan(journey: Journey): PlayPlan {
  return { windows: legWindows(journey.steps, journey.commutes) };
}

/**
 * The windows of `playPlan`, from the steps and the commutes. Also the minutes in which a carrier's
 * vehicle is on the journey map (#851): outside its window a carrier does not handle this package.
 */
function legWindows(journeySteps: JourneyStep[], commutes: JourneyCommute[]): PlayWindow[] {
  const byLeg = new Map<number, JourneyStep[]>();
  for (const s of journeySteps) {
    const list = byLeg.get(s.legIndex) ?? [];
    list.push(s);
    byLeg.set(s.legIndex, list);
  }
  const commuteOf = new Map(commutes.map((c) => [c.legIndex, c]));
  return [...byLeg.entries()]
    .map(([legIndex, steps]) => {
      const carryStartMin = Math.min(...steps.map((s) => s.arrivalMin)) - 1;
      const carryEndMin = Math.max(...steps.map((s) => s.timeMin));
      const commute = commuteOf.get(legIndex);
      const whole = commute && commute.departureMin !== null && Number.isFinite(commute.finishMin);
      return {
        legIndex,
        // Never narrower than the part around the package, whatever the trip says.
        startMin: whole ? Math.min(commute.departureMin! - 1, carryStartMin) : carryStartMin,
        endMin: whole ? Math.max(commute.finishMin, carryEndMin) : carryEndMin,
        carryStartMin,
        carryEndMin,
      };
    })
    .filter((w) => Number.isFinite(w.startMin) && Number.isFinite(w.endMin) && w.endMin >= w.startMin)
    .sort((a, b) => a.startMin - b.startMin);
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
