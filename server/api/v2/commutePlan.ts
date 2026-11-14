// The pure steps of PUT /api/v2/employees/:id/commute (DECISIONS pass 46):
//   resolveCommute -> (new home) fetch pairsToEnsure -> applyCommute -> retry unmatched shipments.
// The route owns the HTTP handling, the live Google call and the retry. Nothing here reads fs, the
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
 * Existing plans are left as they are, like MVP 1; retrying unmatched shipments is the route's next step.
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
  // A home stays listed while an employee lives there, or while a plan that was made before this save
  // still drives to it (plans are not re-planned here, and the simulator needs the point to draw that leg).
  const inUse = new Set(scenario.employees.map((e) => e.homeId));
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) for (const placeId of leg.placeIds) inUse.add(placeId);
  }
  const homes = scenario.homes.includes(stored) ? scenario.homes : [...scenario.homes, stored];
  scenario.homes = homes.filter((h) => inUse.has(h.id));
  run.trips = [...run.trips.filter((t) => t.employeeId !== employee.id), ...trips];
  return { employee, home: stored, trips };
}
