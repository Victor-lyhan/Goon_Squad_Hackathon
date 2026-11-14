// The pure steps of PUT /api/v2/employees/:id/commute (DECISIONS pass 46, 62):
//   resolveCommute -> (new home) fetch pairsToEnsure -> applyCommute -> changedTripIds -> dropPlansOnTrips
//   -> match the dropped and the unmatched shipments -> dropUnusedHomes.
// The route owns the HTTP handling, the live Google call and the matching. Nothing here reads fs, the
// network or process.env, and no message echoes request text, so no output can hold a street address.
import type { PutCommuteRequest } from '../../../shared/v2/schemas';
import type { Employee, Home, Run, TravelProvider, Trip } from '../../../shared/v2/types';
import { buildTrips } from '../../domain/v2/trips';

/**
 * The five boroughs' extent. Same numbers as `NYC_BOUNDS` in the geocode handler (server/api/geo.ts, #343),
 * so every point the address search returns can be saved.
 */
export const NYC_BOUNDS = { south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7002 } as const;

export const EMPLOYEE_NOT_FOUND = 'Employee not found';
export const COMMUTE_LOCKED = 'Start a new planning cycle to edit commutes';
export const INVALID_COMMUTE = 'Invalid commute';
export const UNKNOWN_BUSINESS = 'Unknown business';
export const UNKNOWN_HOME = 'Unknown home';
export const HOME_OUTSIDE_NYC = 'Choose a home inside New York City';

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

/** False for a point outside the box and for anything that is not a finite number. */
export function insideNyc(lat: number, lng: number): boolean {
  return lat >= NYC_BOUNDS.south && lat <= NYC_BOUNDS.north && lng >= NYC_BOUNDS.west && lng <= NYC_BOUNDS.east;
}

/** `home-c-<lat>_<lng>`, both rounded to exactly 5 decimals, so the travel cache key follows the point. */
export function homeIdForCoords(lat: number, lng: number): string {
  // Rounding first turns a tiny negative into -0, which prints as "0.00000".
  return `home-c-${round5(lat).toFixed(5)}_${round5(lng).toFixed(5)}`;
}

export type CommuteResolution =
  | { ok: true; employee: Employee; home: Home; isNewHome: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string; fieldErrors?: Record<string, string> };

/**
 * Decides what a commute request means. `body` is already parsed by `PutCommuteRequest`.
 * On success `employee` is the employee as it will be stored, and `isNewHome` tells the route
 * that the home is not in the scenario yet, so its travel pairs must be fetched before `applyCommute`.
 */
export function resolveCommute(run: Run, employeeId: string, body: PutCommuteRequest): CommuteResolution {
  const { scenario } = run;
  const existing = scenario.employees.find((e) => e.id === employeeId);
  if (!existing) return { ok: false, status: 404, error: EMPLOYEE_NOT_FOUND };
  if (run.clock.phase === 'locked') return { ok: false, status: 409, error: COMMUTE_LOCKED };

  const fieldErrors: Record<string, string> = {};
  if (!scenario.businesses.some((b) => b.id === body.businessId)) fieldErrors.businessId = UNKNOWN_BUSINESS;

  let home: Home | undefined;
  let isNewHome = false;
  if ('homeId' in body.home) {
    const { homeId } = body.home;
    home = scenario.homes.find((h) => h.id === homeId);
    if (!home) fieldErrors.home = UNKNOWN_HOME;
  } else {
    const lat = round5(body.home.lat);
    const lng = round5(body.home.lng);
    if (!insideNyc(lat, lng)) {
      fieldErrors.home = HOME_OUTSIDE_NYC;
    } else {
      const id = homeIdForCoords(lat, lng);
      const stored = scenario.homes.find((h) => h.id === id);
      home = stored ?? { id, neighborhood: body.home.neighborhood.trim(), lat, lng };
      isNewHome = !stored;
    }
  }
  if (!home || Object.keys(fieldErrors).length) {
    return { ok: false, status: 400, error: INVALID_COMMUTE, fieldErrors };
  }

  const employee: Employee = {
    id: existing.id,
    name: existing.name,
    businessId: body.businessId,
    homeId: home.id,
    eveningDepartureMin: body.eveningDepartureMin,
    morningDepartureMin: body.morningDepartureMin,
    maxExtraMin: body.maxExtraMin,
    availableEvening: body.availableEvening,
    availableMorning: body.availableMorning,
  };
  return { ok: true, employee, home, isNewHome };
}

export type PlacePair = { from: string; to: string };

/**
 * The travel data a home needs before it can be used: the matrix both ways between the home and
 * every business (the home's employee may be matched through any of them), and the two commute route lines.
 * The business IDs are deduplicated and sorted, so the result does not depend on the caller's order.
 * The workplace is always part of the matrix, even if `businessIds` leaves it out, because
 * `applyCommute` needs that pair.
 */
export function pairsToEnsure(
  home: Pick<Home, 'id'>, workplaceId: string, businessIds: readonly string[],
): { matrix: PlacePair[]; polylines: PlacePair[] } {
  const ids = [...new Set([...businessIds, workplaceId])].filter((id) => id !== home.id).sort();
  return {
    matrix: [
      ...ids.map((id) => ({ from: home.id, to: id })),
      ...ids.map((id) => ({ from: id, to: home.id })),
    ],
    polylines: workplaceId === home.id ? [] : [
      { from: workplaceId, to: home.id },
      { from: home.id, to: workplaceId },
    ],
  };
}

/**
 * Writes a resolved commute into `run` (call it inside the store's mutation): replaces the employee,
 * lists the home, drops homes that are no longer used and rebuilds this employee's trips.
 * Plans are not touched here. Trip IDs depend only on the employee, so a plan made on a trip this call
 * changed now points at a different trip or at none: the route drops those plans next
 * (`changedTripIds`, `dropPlansOnTrips`), matches their shipments again and calls `dropUnusedHomes`.
 *
 * Everything that can fail runs before the first write, so a missing travel pair
 * (`TravelDataMissingError` from `buildTrips`) leaves `run` exactly as it was.
 */
export function applyCommute(
  run: Run, employee: Employee, home: Home, travel: TravelProvider,
): { employee: Employee; home: Home; trips: Trip[] } {
  const { scenario } = run;
  const index = scenario.employees.findIndex((e) => e.id === employee.id);
  if (index < 0) throw new Error(EMPLOYEE_NOT_FOUND);
  if (employee.homeId !== home.id) throw new Error('The employee and the home do not belong together');
  const trips = buildTrips(employee, travel);

  const stored = scenario.homes.find((h) => h.id === home.id) ?? home;
  scenario.employees[index] = employee;
  // A home stays listed while an employee lives there, or while a plan still drives to it. A plan on
  // the old trip is still in the run at this point; `dropUnusedHomes` runs again once it is re-planned.
  const inUse = new Set(scenario.employees.map((e) => e.homeId));
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) for (const placeId of leg.placeIds) inUse.add(placeId);
  }
  const homes = scenario.homes.includes(stored) ? scenario.homes : [...scenario.homes, stored];
  scenario.homes = homes.filter((h) => inUse.has(h.id));
  run.trips = [...run.trips.filter((t) => t.employeeId !== employee.id), ...trips];
  return { employee, home: stored, trips };
}

/**
 * The IDs of the trips in `before` that a plan can no longer ride as it was planned: the trip is not in
 * `after` (the direction was switched off), or it leaves at another minute, from another place or to
 * another place. A trip that is only in `after` carried nothing, so it is not listed.
 * `maxExtraMin` is not part of a trip, so a save that changes only the limit lists nothing (DECISIONS pass 8).
 */
export function changedTripIds(before: readonly Trip[], after: readonly Trip[]): string[] {
  const next = new Map(after.map((t) => [t.id, t]));
  return before
    .filter((old) => {
      const now = next.get(old.id);
      return !now
        || now.departureMin !== old.departureMin
        || now.originPlaceId !== old.originPlaceId
        || now.destinationPlaceId !== old.destinationPlaceId;
    })
    .map((t) => t.id);
}

/**
 * Removes every plan that has a leg on one of `tripIds` (call it inside the store's mutation). A plan goes
 * as a whole, so a relay loses both legs even when only one carrier's trip changed. Its jobs, its events
 * and its notifications go with it: a shipment that is matched again gets new ones, like a first match.
 * Returns the shipments that lost their plan, in the order of the plans. They are in neither `plans` nor
 * `unmatched` until the route matches them again.
 */
export function dropPlansOnTrips(run: Run, tripIds: readonly string[]): string[] {
  const changed = new Set(tripIds);
  const dropped = run.assignments.plans.filter((p) => p.legs.some((leg) => changed.has(leg.tripId)));
  if (dropped.length === 0) return [];
  const planIds = new Set(dropped.map((p) => p.id));
  run.assignments.plans = run.assignments.plans.filter((p) => !planIds.has(p.id));
  run.jobs = run.jobs.filter((j) => !planIds.has(j.planId));
  run.events = run.events.filter((e) => !planIds.has(e.planId));
  run.notifications = run.notifications.filter((n) => !planIds.has(n.planId));
  return dropped.map((p) => p.shipmentId);
}

/**
 * Removes every home that no employee lives at and no plan leg names (SPEC MVP II rule 5: a home is only
 * a commute endpoint). The list keeps its array when nothing goes.
 */
export function dropUnusedHomes(run: Run): void {
  const { scenario } = run;
  const inUse = new Set(scenario.employees.map((e) => e.homeId));
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) for (const placeId of leg.placeIds) inUse.add(placeId);
  }
  if (scenario.homes.some((h) => !inUse.has(h.id))) scenario.homes = scenario.homes.filter((h) => inUse.has(h.id));
}
