// Pure model for the Employee commute route preview (#419). Turns the dashboard pieces, the
// network businesses, the GET /api/v2/map response and an optional selected job into plain props
// for GoogleBaseMap. No time, distance, status or reward is computed here: every number shown is
// a field of a Trip. Route lines come only from `map.polylines`; a missing line draws nothing
// (DECISIONS pass 44), never a straight line.
import type { EmployeeJobView, MapResponse } from '../../../../../../shared/v2/api';
import type { Employee, Home, NetworkBusiness, StopKind, Trip } from '../../../../../../shared/v2/types';
import { decodePath } from '../../../map/layers';
import { placesBounds } from '../../../map/mapModel';
import type { LatLngBounds, MapPlace, MapRoute, MapStop } from '../../../map/types';
import { formatClock, formatDuration } from '../../../../ui/format';

export const UNKNOWN_PLACE = 'Unknown place';
export const ROUTE_NOT_LOADED = 'Route line not loaded yet';

// Copy: the StopKind values keep their MVP 1 names; the UI says "relay point". The two relay
// kinds are the ones that are neither 'pickup' nor 'delivery', so their names never appear here.
export function stopLabel(kind: StopKind): string {
  const atRelay = kind !== 'pickup' && kind !== 'delivery';
  const isPickup = kind.endsWith('pickup');
  if (isPickup) return atRelay ? 'Pickup at relay point' : 'Pickup';
  return atRelay ? 'Drop at relay point' : 'Deliver';
}

export type CommuteRouteInput = {
  employee: Employee;
  home: Home;
  trips: Trip[];
  businesses: NetworkBusiness[];
  map: MapResponse | null;
  job: EmployeeJobView | null;
};

export type CommuteRoute = {
  places: MapPlace[];
  routes: MapRoute[];
  stops: MapStop[];
  /** Stop labels as text ("1 Pickup · Name"), listed under the map so they never depend on it loading. */
  stopLabels: string[];
  fitTo: LatLngBounds | null;
  /**
   * One line per commute direction, so both are named even when the map cannot load. On the
   * workspace (no job) the commute card above the map already gives each departure, so the lines
   * hold travel time and distance only; with a job open there is no card and they name it too.
   */
  summary: string[];
  /** True when a delivery leg is drawn, so the legend lists "Delivery route" only then. */
  hasDeliveryRoute: boolean;
  notes: string[];
  /** True while the map response has not arrived. */
  loading: boolean;
};

/** "850 m" below 1 km, else "9.8 km". */
export function distanceText(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = Math.round(m / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/**
 * The text line of one commute direction, from the trip's own fields: "Evening: 34 min, 9.8 km".
 * With `departure` it also names the daily departure in the one clock format (DECISIONS pass 60):
 * "Evening: leaves 5:30 PM, 34 min, 9.8 km".
 */
export function tripLine(trip: Trip, { available = true, departure = false } = {}): string {
  const label = trip.direction === 'evening' ? 'Evening' : 'Morning';
  const facts = [
    ...(departure ? [`leaves ${formatClock(trip.departureMin)}`] : []),
    formatDuration(trip.baselineDurationMin),
    distanceText(trip.baselineDistanceM),
  ];
  const base = `${label}: ${facts.join(', ')}`;
  return available ? base : `${base} (not available for deliveries)`;
}

export function homeLabel(home: Home): string {
  const n = home.neighborhood?.trim();
  return n ? `Home · ${n}` : 'Home';
}

/** Decoded line for an ordered pair, or null when the pair is missing, not cached or unusable. */
function lineFor(map: MapResponse, from: string, to: string): [number, number][] | null {
  for (const p of map.polylines) {
    if (p.from !== from || p.to !== to || !p.encoded) continue;
    try {
      const path = decodePath(p.encoded);
      if (path.length >= 2 && path.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))) return path;
    } catch {
      // An unreadable line is treated like a missing one.
    }
  }
  return null;
}

export function buildCommuteRoute({ employee, home, trips, businesses, map, job }: CommuteRouteInput): CommuteRoute {
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const work = byId.get(employee.businessId);

  // ---- Places: workplace and home (neighborhood only) ----
  const places: MapPlace[] = [];
  const seen = new Set<string>();
  const addBusiness = (id: string, sublabel: string) => {
    const b = byId.get(id);
    if (!b || seen.has(b.id) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return;
    seen.add(b.id);
    places.push({ id: b.id, kind: 'business', lat: b.lat, lng: b.lng, label: b.name, sublabel });
  };
  addBusiness(employee.businessId, work?.neighborhood ? `Workplace · ${work.neighborhood}` : 'Workplace');
  if (Number.isFinite(home.lat) && Number.isFinite(home.lng)) {
    seen.add(home.id);
    places.push({ id: home.id, kind: 'home', lat: home.lat, lng: home.lng, label: homeLabel(home) });
  }

  // ---- Summary: the trips' own numbers ----
  const summary: string[] = [];
  const tripOf = (d: Trip['direction']) => trips.find((t) => t.direction === d && t.employeeId === employee.id)
    ?? trips.find((t) => t.direction === d);
  const evening = tripOf('evening');
  const morning = tripOf('morning');
  const departure = job !== null; // the job view has no commute card; the workspace has one above the map
  if (evening) summary.push(tripLine(evening, { available: employee.availableEvening, departure }));
  if (morning) summary.push(tripLine(morning, { available: employee.availableMorning, departure }));

  // ---- Job stops (numbered within this job's leg, business names only) ----
  const leg = job ? job.plan.legs[job.job.legIndex] : undefined;
  const jobStops = job ? (leg?.stops.length ? leg.stops : [job.job.pickup, job.job.dropoff]) : [];
  const stopLabels: string[] = [];
  const stops: MapStop[] = [];
  jobStops.forEach((s, i) => {
    const n = i + 1;
    const b = byId.get(s.placeId);
    const label = `${stopLabel(s.kind)} · ${b?.name ?? UNKNOWN_PLACE}`;
    stopLabels.push(`${n} ${label}`);
    if (b && Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
      stops.push({ id: `stop-${job!.job.id}-${n}`, n, lat: b.lat, lng: b.lng, label });
      addBusiness(b.id, stopLabel(s.kind));
    }
  });

  const fitTo = placesBounds(places);

  if (!map) {
    return { places, routes: [], stops, stopLabels, fitTo, summary, hasDeliveryRoute: false, notes: [], loading: true };
  }

  // ---- Routes: faint commute lines, then the job's leg in the accent tone ----
  const routes: MapRoute[] = [];
  let missing = false;
  const commute = (id: string, trip: Trip | undefined, from: string, to: string) => {
    const path = lineFor(map, trip?.originPlaceId ?? from, trip?.destinationPlaceId ?? to);
    if (path) routes.push({ id, kind: 'baseline', path, ownerIds: [employee.id] });
    else missing = true;
  };
  commute('commute-evening', evening, employee.businessId, home.id);
  commute('commute-morning', morning, home.id, employee.businessId);

  if (job && leg) {
    leg.placeIds.forEach((from, i) => {
      const to = leg.placeIds[i + 1];
      if (to === undefined) return;
      const path = lineFor(map, from, to);
      if (path) routes.push({ id: `job-${job.job.id}-${i}`, kind: 'leg', tone: 'leg1', path, ownerIds: [job.job.id] });
      else missing = true;
    });
  }

  const hasDeliveryRoute = routes.some((r) => r.kind === 'leg');
  return { places, routes, stops, stopLabels, fitTo, summary, hasDeliveryRoute, notes: missing ? [ROUTE_NOT_LOADED] : [], loading: false };
}
