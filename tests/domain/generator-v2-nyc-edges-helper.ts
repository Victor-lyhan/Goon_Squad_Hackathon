// Shared by tests/domain/generator-v2-nyc-edges.test.ts (issue #604): Random city at the edges of the simulator's
// Scenario form, on the committed NYC cache.
// - `formRanges()` reads the smallest, largest and default value of every field from the generate-request schema
//   (shared/v2/schemas.ts). No range is typed here, so a change of the form's limits moves the test with it.
// - `edgeRequests(seed)` is the grid: smallest and largest employee count x smallest and largest package count x
//   the detour limits (the smallest, one minute under the handling time of one delivery, exactly that handling
//   time, the largest), plus the request with every value at its default.
// - `edgeRun(request)` builds the scenario and the run the way POST /api/v2/scenario/generate does
//   (`buildNycScenario` on the parsed request, then `createInitialRun`), once per test file.
// - The checks return one readable line per broken rule; an empty list means the rule holds. The on-time check
//   (`canDeliverWithNoLimit`) walks the clock itself and does not import the matcher's scheduling.
// Nothing here names a person, a place or a count of matches (DECISIONS pass 54).
import { performance } from 'node:perf_hooks';
import {
  pairKey, TravelDataMissingError,
  type AssignmentResult, type LatLng, type Metrics, type Run, type Shipment, type ShipmentProgress, type Snapshot,
  type TravelProvider, type Trip,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { assignShipments } from '../../server/domain/v2/matching';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { buildCity, nycFiles, type NycCity } from './matching-v2-nyc-helper';

/** Explicit per-test limit (DECISIONS pass 19): the largest run builds and matches in about 0.5 s locally. */
export const EDGE_TEST_TIMEOUT_MS = 30_000;

// ---------- the form's ranges, read from the schema ----------

export type FieldRange = { min: number; max: number; default: number };
export type FormRanges = { seedDefault: number; employees: FieldRange; packages: FieldRange; maxExtraMin: FieldRange };

const RANGE_FIELDS = ['employees', 'packages', 'maxExtraMin'] as const;
export type RangeField = (typeof RANGE_FIELDS)[number];

/** The limits and defaults of the Scenario form, from `GenerateScenarioRequest`. Throws if a limit is not a whole number. */
export function formRanges(): FormRanges {
  const defaults = GenerateScenarioRequest.parse({ preset: 'random' });
  const range = (field: RangeField): FieldRange => {
    const numberSchema = GenerateScenarioRequest.shape[field].unwrap();
    const { minValue: min, maxValue: max } = numberSchema;
    if (min === null || max === null || !Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`GenerateScenarioRequest.${field} has no whole-number range (min ${min}, max ${max})`);
    }
    return { min, max, default: defaults[field] };
  };
  return {
    seedDefault: defaults.seed,
    employees: range('employees'), packages: range('packages'), maxExtraMin: range('maxExtraMin'),
  };
}

/** Whether the schema accepts `value` for `field` with every other value at its default. */
export function schemaAccepts(field: RangeField, value: number): boolean {
  return GenerateScenarioRequest.safeParse({ preset: 'random', [field]: value }).success;
}

/**
 * The added minutes of the shortest possible delivery: handling at the pickup and at the drop-off, with no
 * extra driving at all. Read from the settings every generated scenario starts from.
 */
export const HANDLING_ONLY_MIN = 2 * DEFAULT_SETTINGS.handlingMin;

/** Detour limits of the grid, in rising order: smallest, one under the handling time, the handling time, largest. */
export function detourLimits(ranges: FormRanges = formRanges()): number[] {
  const { min, max } = ranges.maxExtraMin;
  const wanted = [min, HANDLING_ONLY_MIN - 1, HANDLING_ONLY_MIN, max].filter(limit => limit >= min && limit <= max);
  return [...new Set(wanted)].sort((a, b) => a - b);
}

export type EdgeRequest = { label: string; atDefault: boolean; request: GenerateScenarioRequest };

/** Every corner of the form for one seed, then the default request. Labels are unique per seed. */
export function edgeRequests(seed: number, ranges: FormRanges = formRanges()): EdgeRequest[] {
  const edges: EdgeRequest[] = [];
  const add = (employees: number, packages: number, maxExtraMin: number, atDefault: boolean) => {
    edges.push({
      label: `${employees} employees, ${packages} packages, detour limit ${maxExtraMin}${atDefault ? ' (the defaults)' : ''}`,
      atDefault,
      request: GenerateScenarioRequest.parse({ preset: 'random', seed, employees, packages, maxExtraMin }),
    });
  };
  for (const employees of [ranges.employees.min, ranges.employees.max]) {
    for (const packages of [ranges.packages.min, ranges.packages.max]) {
      for (const maxExtraMin of detourLimits(ranges)) add(employees, packages, maxExtraMin, false);
    }
  }
  add(ranges.employees.default, ranges.packages.default, ranges.maxExtraMin.default, true);
  return edges;
}

// ---------- one run per request ----------

/** Runs `work`; a missing travel pair fails with both place IDs instead of a bare throw (it would be a 503 in the app). */
export function withoutMissingPairs<T>(what: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TravelDataMissingError) {
      throw new Error(`${what} needs a pair the committed cache lacks: ${error.from} -> ${error.to} (${error.message})`);
    }
    throw error;
  }
}

export type EdgeRun = {
  request: GenerateScenarioRequest;
  /** The scenario with its trips and the matcher's context. */
  city: NycCity;
  /** The run as Generate creates it: trips, plans, jobs, timeline. `computeMs` is set to 0 (it is a wall-clock value). */
  run: Run;
  travel: TravelProvider;
};

const describeRequest = (request: GenerateScenarioRequest) =>
  `Random city seed ${request.seed}, ${request.employees} employees, ${request.packages} packages, detour limit ${request.maxExtraMin}`;

const built = new Map<string, EdgeRun>();

/** The run of one request, built on first use and kept for the rest of the test file. */
export function edgeRun(request: GenerateScenarioRequest): EdgeRun {
  const key = JSON.stringify(request);
  const known = built.get(key);
  if (known) return known;
  const fresh = withoutMissingPairs(describeRequest(request), () => {
    const city = buildCity(request);
    const travel = nycFiles().travel;
    const created = createInitialRun(city.scenario, { travel, buildEvents: buildTimeline });
    const run: Run = { ...created, assignments: { ...created.assignments, computeMs: 0 } };
    return { request, city, run, travel };
  });
  built.set(key, fresh);
  return fresh;
}

/** The same request built and matched again from nothing, with the wall-clock time of the matching alone. */
export function matchAgain(request: GenerateScenarioRequest): { city: NycCity; result: AssignmentResult; ms: number } {
  return withoutMissingPairs(describeRequest(request), () => {
    const city = buildCity(request);
    const start = performance.now();
    const result = assignShipments(city.scenario.shipments, city.ctx);
    return { city, result, ms: performance.now() - start };
  });
}

// ---------- travel pairs ----------

/**
 * Every ordered pair a commute or a plan of this run can ask for (business to business, business to home, home
 * to business) that the committed matrix does not hold. The matcher only looks up the pairs it needs for the
 * packages at hand; this list also covers the ones a live delivery request would need later.
 */
export function missingTravelPairs(edge: EdgeRun): string[] {
  const pairs = nycFiles().travelFiles.matrix.pairs;
  const businessIds = edge.run.scenario.businesses.map(business => business.id);
  const homeIds = [...new Set(edge.run.scenario.employees.map(employee => employee.homeId))];
  const missing: string[] = [];
  const need = (from: string, to: string) => {
    if (from !== to && !Object.hasOwn(pairs, pairKey(from, to))) missing.push(pairKey(from, to));
  };
  for (const businessId of businessIds) {
    for (const other of businessIds) need(businessId, other);
    for (const homeId of homeIds) { need(businessId, homeId); need(homeId, businessId); }
  }
  return missing;
}

// ---------- unmatched reasons ----------

export const NO_COMMUTE_REASON = 'No sender evening commute or recipient morning commute is available';
export const ADDED_TIME_REASON = "Every route would exceed the employees' added-time limit";
export const DEADLINE_AND_ADDED_TIME_REASON = 'Delivery requires both a later deadline and a larger added-time limit';

/** Every sentence `assignShipments` can give for an unmatched package (server/domain/v2/matching.ts). */
export const MATCHER_SENTENCES: readonly string[] = [
  'Every matching commute is already carrying a package',
  'Sender and recipient must be different businesses',
  'Sender or recipient business is missing',
  'No employees are available to carry packages',
  'No commute is available after the package is ready',
  NO_COMMUTE_REASON,
  'The delivery window is too short for pickup and delivery handling',
  'No commute can arrive before the deadline',
  ADDED_TIME_REASON,
  DEADLINE_AND_ADDED_TIME_REASON,
  'No available commute route can visit the required pickup and drop-off stops',
];

/** The commutes that could carry the package at all: evening trips from the sender, morning trips to the recipient. */
function usableCommutes(run: Run, shipment: Shipment): { evenings: Trip[]; mornings: Trip[] } {
  const worksAt = new Map(run.scenario.employees.map(employee => [employee.id, employee.businessId]));
  return {
    evenings: run.trips.filter(trip => trip.direction === 'evening' && worksAt.get(trip.employeeId) === shipment.originBusinessId),
    mornings: run.trips.filter(trip => trip.direction === 'morning' && worksAt.get(trip.employeeId) === shipment.destinationBusinessId),
  };
}

export function hasUsableCommute(run: Run, shipment: Shipment): boolean {
  const { evenings, mornings } = usableCommutes(run, shipment);
  return evenings.length + mornings.length > 0;
}

/**
 * Whether some direct or one-relay route would hand the package over by its deadline if no carrier had an
 * added-time limit. The clock is walked here from the trips and the travel provider alone: departure, drive,
 * wait until the package is there, handling at the pickup, drive, handling at the drop-off.
 */
export function canDeliverWithNoLimit(run: Run, travel: TravelProvider, shipment: Shipment): boolean {
  const handling = run.scenario.settings.handlingMin;
  const { originBusinessId: sender, destinationBusinessId: recipient, readyMin, deadlineMin } = shipment;
  const { evenings, mornings } = usableCommutes(run, shipment);
  // An evening carrier starts at the sender; a morning carrier drives from home to the pickup first.
  const eveningDropEnd = (trip: Trip, dropAt: string) =>
    Math.max(trip.departureMin, readyMin) + handling + travel.durationMin(sender, dropAt) + handling;
  const morningDropEnd = (trip: Trip, pickupAt: string, thereFromMin: number) =>
    Math.max(trip.departureMin + travel.durationMin(trip.originPlaceId, pickupAt), thereFromMin) + handling
      + travel.durationMin(pickupAt, recipient) + handling;

  if (evenings.some(trip => eveningDropEnd(trip, recipient) <= deadlineMin)) return true;
  if (mornings.some(trip => morningDropEnd(trip, sender, readyMin) <= deadlineMin)) return true;
  for (const relay of run.scenario.businesses) {
    if (relay.id === sender || relay.id === recipient) continue;
    for (const evening of evenings) {
      const droppedMin = eveningDropEnd(evening, relay.id);
      if (mornings.some(morning => morning.employeeId !== evening.employeeId
        && morningDropEnd(morning, relay.id, droppedMin) <= deadlineMin)) return true;
    }
  }
  return false;
}

/**
 * Rules for the unmatched list of any run: every package is matched or unmatched, never both; every unmatched
 * package has one of the matcher's sentences; and the "no commute" sentence is given exactly to the packages
 * that no evening commute from the sender and no morning commute to the recipient could carry.
 */
export function unmatchedProblems(edge: EdgeRun): string[] {
  const { run } = edge;
  const { plans, unmatched } = run.assignments;
  const planned = new Set(plans.map(plan => plan.shipmentId));
  const reasons = new Map<string, string>();
  const problems: string[] = [];
  for (const { shipmentId, reason } of unmatched) {
    if (reasons.has(shipmentId)) problems.push(`${shipmentId}: listed as unmatched twice`);
    reasons.set(shipmentId, reason);
  }
  for (const shipment of run.scenario.shipments) {
    const reason = reasons.get(shipment.id);
    if (planned.has(shipment.id)) {
      if (reason !== undefined) problems.push(`${shipment.id}: has a plan and an unmatched reason "${reason}"`);
      continue;
    }
    if (reason === undefined) { problems.push(`${shipment.id}: no plan and no reason`); continue; }
    if (typeof reason !== 'string' || reason.trim() === '') { problems.push(`${shipment.id}: empty reason`); continue; }
    if (!MATCHER_SENTENCES.includes(reason)) problems.push(`${shipment.id}: "${reason}" is not one of the matcher's sentences`);
    const commute = hasUsableCommute(run, shipment);
    if (commute && reason === NO_COMMUTE_REASON) problems.push(`${shipment.id}: "${reason}" although a commute exists`);
    if (!commute && reason !== NO_COMMUTE_REASON) problems.push(`${shipment.id}: "${reason}" although no commute exists`);
  }
  const known = new Set(run.scenario.shipments.map(shipment => shipment.id));
  for (const shipmentId of reasons.keys()) {
    if (!known.has(shipmentId)) problems.push(`${shipmentId}: unmatched reason for a package the run does not have`);
  }
  return problems;
}

/**
 * The sentence a package must get when the detour limit leaves no room for a stop (handling alone is over it):
 * no commute at all; or the added-time limit; or, where even a carrier with no limit would be past the
 * deadline, the sentence that names the deadline and the added-time limit together.
 */
export function reasonWithNoRoomForAStop(edge: EdgeRun, shipment: Shipment): string {
  if (!hasUsableCommute(edge.run, shipment)) return NO_COMMUTE_REASON;
  return canDeliverWithNoLimit(edge.run, edge.travel, shipment) ? ADDED_TIME_REASON : DEADLINE_AND_ADDED_TIME_REASON;
}

// ---------- snapshots ----------

/** The start of the simulated day, five minutes spread evenly over it, and its end. */
export function daySampleMinutes(run: Run): number[] {
  const { simStartMin, simEndMin } = run.scenario.settings;
  const inside = [1, 2, 3, 4, 5].map(step => Math.round(simStartMin + ((simEndMin - simStartMin) * step) / 6));
  return [simStartMin, ...inside, simEndMin];
}

/**
 * The minute halfway through every planned leg, with the carrier who must be on the map then. The evenly
 * spread minutes mostly fall in the night, when nobody drives; these make the marker check see real markers.
 */
export function midLegMinutes(run: Run): Map<number, string[]> {
  const departure = new Map(run.trips.map(trip => [trip.id, trip.departureMin]));
  const byMinute = new Map<number, string[]>();
  for (const plan of run.assignments.plans) {
    for (const leg of plan.legs) {
      const departMin = departure.get(leg.tripId);
      if (departMin === undefined) continue; // the plan check reports a leg without a trip
      const minute = Math.floor((departMin + leg.finishMin) / 2);
      byMinute.set(minute, [...(byMinute.get(minute) ?? []), leg.employeeId]);
    }
  }
  return byMinute;
}

export type Box = { south: number; west: number; north: number; east: number };

/** The smallest box around every business and every home of the run. */
export function placesBox(run: Run): Box {
  const places: LatLng[] = [...run.scenario.businesses, ...run.scenario.homes];
  return {
    south: Math.min(...places.map(place => place.lat)), north: Math.max(...places.map(place => place.lat)),
    west: Math.min(...places.map(place => place.lng)), east: Math.max(...places.map(place => place.lng)),
  };
}

// One ten-thousandth of a second of arc (about 3 mm): room for floating-point rounding only.
const BOX_EPSILON_DEG = 1e-9;

const inBox = (box: Box, point: LatLng) =>
  point.lat >= box.south - BOX_EPSILON_DEG && point.lat <= box.north + BOX_EPSILON_DEG
  && point.lng >= box.west - BOX_EPSILON_DEG && point.lng <= box.east + BOX_EPSILON_DEG;

// `satisfies` makes the typecheck fail when the contract gains a status or a summary field this list lacks.
const KNOWN_STATUS = {
  unmatched: true, scheduled: true, picked_up: true, at_hub: true, out_for_delivery: true, delivered: true,
} satisfies Record<ShipmentProgress, true>;

/** How each summary value must look: a count or cents (whole, never negative), or any finite number. */
const SUMMARY_FIELDS = {
  requested: 'count', matched: 'count', delivered: 'count', direct: 'count', relay: 'count', unmatched: 'count',
  avgExtraMinPerTrip: 'finite-or-null', maxExtraMin: 'finite-or-null',
  earnedRewardsCents: 'count', projectedCustomerSavingsCents: 'count', projectedCustomerSpendCents: 'count',
  projectedPlatformContributionCents: 'count', earnedPlatformContributionCents: 'count',
  extraDistanceM: 'finite',
} satisfies Record<keyof Metrics, 'count' | 'finite' | 'finite-or-null'>;

/**
 * Rules for one snapshot of a run: the summary holds only finite numbers (the two averages over trips may be
 * null, and only while no package is matched), no count is negative and the counts add up; every package has
 * a known status that fits the minute; every marker is a finite point inside the box of the run's places.
 * `mustBeOnMap` lists carriers that are in the middle of a leg at this minute.
 */
export function snapshotProblems(edge: EdgeRun, snapshot: Snapshot, mustBeOnMap: readonly string[] = []): string[] {
  const { run } = edge;
  const at = `minute ${snapshot.timeMin}`;
  const problems: string[] = [];
  const planned = new Set(run.assignments.plans.map(plan => plan.shipmentId));

  const summary = snapshot.metrics as Record<string, unknown>;
  for (const [field, kind] of Object.entries(SUMMARY_FIELDS)) {
    const value = summary[field];
    if (value === null && kind === 'finite-or-null' && planned.size === 0) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${at}: summary ${field} is ${String(value)}`);
    else if (kind === 'count' && (value < 0 || !Number.isInteger(value))) problems.push(`${at}: summary ${field} is ${value}`);
  }
  for (const field of Object.keys(summary)) {
    if (!Object.hasOwn(SUMMARY_FIELDS, field)) problems.push(`${at}: summary has an unknown field ${field}`);
  }
  const { requested, matched, delivered, direct, relay, unmatched } = snapshot.metrics;
  if (requested !== run.scenario.shipments.length) problems.push(`${at}: requested ${requested}, the run has ${run.scenario.shipments.length} packages`);
  if (matched + unmatched !== requested) problems.push(`${at}: matched ${matched} + unmatched ${unmatched} is not requested ${requested}`);
  if (direct + relay !== matched) problems.push(`${at}: direct ${direct} + relay ${relay} is not matched ${matched}`);
  if (delivered > matched) problems.push(`${at}: delivered ${delivered} of ${matched} matched`);

  const { simStartMin, simEndMin } = run.scenario.settings;
  let deliveredNow = 0;
  for (const shipment of run.scenario.shipments) {
    const status = snapshot.shipmentStatus[shipment.id];
    if (status === undefined || !Object.hasOwn(KNOWN_STATUS, status)) {
      problems.push(`${at}: ${shipment.id} has status ${String(status)}`);
      continue;
    }
    if (status === 'delivered') deliveredNow += 1;
    if ((status === 'unmatched') === planned.has(shipment.id)) {
      problems.push(`${at}: ${shipment.id} is "${status}" but ${planned.has(shipment.id) ? 'has a plan' : 'has no plan'}`);
    } else if (planned.has(shipment.id)) {
      // Nothing moves before the day starts, and every deadline is inside the day.
      if (snapshot.timeMin <= simStartMin && status !== 'scheduled') problems.push(`${at}: ${shipment.id} is "${status}" at the start of the day`);
      if (snapshot.timeMin >= simEndMin && status !== 'delivered') problems.push(`${at}: ${shipment.id} is "${status}" at the end of the day`);
    }
  }
  for (const shipmentId of Object.keys(snapshot.shipmentStatus)) {
    if (!run.scenario.shipments.some(shipment => shipment.id === shipmentId)) problems.push(`${at}: status for unknown package ${shipmentId}`);
  }
  if (deliveredNow !== delivered) problems.push(`${at}: summary says ${delivered} delivered, ${deliveredNow} packages have that status`);

  const box = placesBox(run);
  const employees = new Set(run.scenario.employees.map(employee => employee.id));
  const onMap = new Set<string>();
  for (const marker of snapshot.markers) {
    const who = `${at}: marker of ${marker.employeeId}`;
    if (!employees.has(marker.employeeId)) problems.push(`${who} is not an employee of the run`);
    if (onMap.has(marker.employeeId)) problems.push(`${who} is on the map twice`);
    onMap.add(marker.employeeId);
    if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) problems.push(`${who} is at ${marker.lat}, ${marker.lng}`);
    else if (!inBox(box, marker)) {
      problems.push(`${who} at ${marker.lat}, ${marker.lng} is outside the run's places `
        + `(${box.south}..${box.north}, ${box.west}..${box.east})`);
    }
  }
  for (const employeeId of mustBeOnMap) {
    if (!onMap.has(employeeId)) problems.push(`${at}: ${employeeId} is halfway through a leg but has no marker`);
  }
  return problems;
}
