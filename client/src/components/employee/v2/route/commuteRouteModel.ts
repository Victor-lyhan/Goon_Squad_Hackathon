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
  summary: string[];
  notes: string[];
  /** True while the map response has not arrived. */
  loading: boolean;
};

/** "5:30 p.m." for minutes since Day 1 00:00 (day ignored). */
export function clockText(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h24 < 12 ? 'a.m.' : 'p.m.'}`;
}

/** "34 min" / "1 h 5 min". */
export function durationText(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const r = m % 60;
  return r === 0 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 60)} h ${r} min`;
}

/** "850 m" below 1 km, else "9.8 km". */
export function distanceText(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 m';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = Math.round(m / 100) / 10;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

/** "Evening: leaves 5:30 p.m., 34 min, 9.8 km" from the trip's own fields. */
export function tripLine(trip: Trip, available = true): string {
  const label = trip.direction === 'evening' ? 'Evening' : 'Morning';
  const base = `${label}: leaves ${clockText(trip.departureMin)}, ${durationText(trip.baselineDurationMin)}, ${distanceText(trip.baselineDistanceM)}`;
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
  if (evening) summary.push(tripLine(evening, employee.availableEvening));
  if (morning) summary.push(tripLine(morning, employee.availableMorning));

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
    return { places, routes: [], stops, stopLabels, fitTo, summary, notes: [], loading: true };
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

  return { places, routes, stops, stopLabels, fitTo, summary, notes: missing ? [ROUTE_NOT_LOADED] : [], loading: false };
}
