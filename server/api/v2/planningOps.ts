// The pure steps behind the simulator's left-panel actions on MVP II (DECISIONS pass 6, 10, 45, 46, 47):
//   POST /api/v2/planning/reset      beginNewCycle     -> full match -> simulator view
//   POST /api/v2/matches/recompute   clearForRecompute -> full match -> simulator view
//   POST /api/v2/scenario/generate   planGenerate      -> createInitialRun -> runId = nextRunId(current) -> view
//   POST /api/v2/scenario/import     parseImportedRun  -> runId = nextRunId(current) -> view
//   GET  /api/v2/scenario/export     exportRun
// The route owns the HTTP handling, the store, the fixture files and the matching. Nothing here reads fs,
// a clock or randomness (the generator's seeded PRNG is the only random source), nothing mutates or aliases
// its input, and no message echoes text from a request or a file.
import { z } from 'zod';
import type { ExportFile, TravelUnavailable } from '../../../shared/v2/api';
import { GenerateScenarioRequest, type ApiError } from '../../../shared/v2/schemas';
import type {
  NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Run, Scenario, TravelMatrixFile,
} from '../../../shared/v2/types';
import { buildNycScenario } from '../../domain/v2/generator';

export const RECOMPUTE_LOCKED =
  'The simulation is playing. Press Back to start in the simulator to recompute.';
export const INVALID_GENERATE = 'Invalid scenario request';
export const NOT_A_RELAY_FILE = 'This file is not a Relay scenario export, so it was not loaded.';
export const MVP1_FILE =
  'This file is from the synthetic-city version of Relay and cannot be loaded into the NYC version.';
export const UNKNOWN_FILE_VERSION = 'This file has an unknown scenario version, so it was not loaded.';

/** Travel data is missing, so nothing was built or loaded. The route answers 503 with `error` as the body. */
export type PlanningUnavailable = {
  kind: 'unavailable'; status: 503; code: 'travel_data_missing';
  /** How many places have no travel data (also said in `error.error`). */
  missingPlaces: number;
  error: TravelUnavailable;
};
export type PlanningInvalid = { kind: 'invalid'; status: 400; error: ApiError };

const unavailable = (missingPlaces: number, message: string): PlanningUnavailable => ({
  kind: 'unavailable', status: 503, code: 'travel_data_missing', missingPlaces,
  error: { error: message, code: 'travel_data_missing' },
});
const invalid = (error: string, fieldErrors?: Record<string, string>): PlanningInvalid => ({
  kind: 'invalid', status: 400,
  error: fieldErrors && Object.keys(fieldErrors).length > 0 ? { error, fieldErrors } : { error },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const fieldOf = (path: readonly PropertyKey[]) => path.map(String).join('.') || 'body';

// ---------- Planning cycle and recompute ----------

/** `run-<n>` -> `run-<n+1>`; anything unparseable counts as n = 0 (same rule as MVP 1). */
export function nextRunId(current: string): string {
  const n = /^run-(\d+)$/.exec(current)?.[1];
  return `run-${(n ? Number(n) : 0) + 1}`;
}

/**
 * The run with everything the matcher produces removed: businesses, homes, employees, shipments,
 * settings and trips stay; plans, the unmatched list, jobs, notifications and events are empty.
 * A deep copy, so the full match that follows can write into it freely.
 */
function emptied(run: Run): Run {
  return {
    runId: run.runId,
    version: run.version + 1,
    scenario: structuredClone(run.scenario),
    trips: structuredClone(run.trips),
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [],
    notifications: [],
    events: [],
    clock: { ...run.clock },
  };
}

/**
 * "Start new planning cycle" (DECISIONS pass 6): a new `runId`, the clock back at `simStartMin`, paused,
 * in `planning`, at the speed it had. Entities, packages and trips are kept and nothing of the old cycle's
 * matching survives; the route runs the full match on the result at once, so the portals are never empty.
 * Allowed in any phase. It also unlocks, but with a new run; "Back to start" unlocks the same run (#734).
 */
export function beginNewCycle(run: Run): Run {
  const next = emptied(run);
  next.runId = nextRunId(run.runId);
  next.clock = {
    phase: 'planning', playing: false, timeMin: run.scenario.settings.simStartMin, speed: run.clock.speed,
  };
  return next;
}

export type RecomputePlan =
  | { kind: 'locked'; status: 409; error: ApiError }
  | { kind: 'recompute'; run: Run }; // then the full match

/** "Recompute": the emptied run with the same `runId` and clock, or a refusal while playback is locked. */
export function clearForRecompute(run: Run): RecomputePlan {
  if (run.clock.phase === 'locked') return { kind: 'locked', status: 409, error: { error: RECOMPUTE_LOCKED } };
  return { kind: 'recompute', run: emptied(run) };
}

// ---------- Generate ----------

/** The parsed `fixtures/nyc/` files and `matrix.json` `places`; the route reads them, this module never does. */
export type GenerateInputs = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  places: TravelMatrixFile['places'];
};

export type GeneratePlan =
  | PlanningInvalid
  | PlanningUnavailable
  | { kind: 'scenario'; scenario: Scenario }; // then createInitialRun, with runId = nextRunId(current)

// Zod's default texts name JavaScript types, so each field has one sentence of its own.
const GENERATE_COPY: Record<string, string> = {
  body: 'Send the scenario options as a JSON object',
  preset: 'Choose demo or random',
  seed: 'Seed must be a whole number',
  employees: 'Employees must be a whole number from 10 to 120',
  packages: 'Packages must be a whole number from 5 to 60',
  maxExtraMin: 'Max added time must be a whole number from 0 to 30 minutes',
};

const isCoordinate = (value: unknown, limit: number) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * "Generate scenario": validates the request, then builds the demo or the seeded random scenario on the
 * cached NYC home pool. A business with no geocoded point in `places` is `travel_data_missing`:
 * a location is never guessed (SPEC MVP II rule 2). A missing or null body counts as `{}`, like MVP 1.
 * Broken fixture files (for example no neighborhoods) make the generator throw; that is a server fault
 * for the route's 500, not a request problem.
 */
export function planGenerate(body: unknown, inputs: GenerateInputs): GeneratePlan {
  const parsed = GenerateScenarioRequest.safeParse(body ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = fieldOf(issue.path);
      fieldErrors[field] ??= GENERATE_COPY[field] ?? 'This value is not valid';
    }
    return invalid(INVALID_GENERATE, fieldErrors);
  }

  const { businesses } = inputs.businessesFile;
  const missing = businesses.filter(({ id }) => {
    const place = Object.hasOwn(inputs.places, id) ? inputs.places[id] : undefined;
    return !place || !isCoordinate(place.lat, 90) || !isCoordinate(place.lng, 180);
  }).length;
  if (missing > 0) {
    return unavailable(
      missing,
      `${missing} of ${businesses.length} businesses ${missing === 1 ? 'has' : 'have'} no geocoded location. `
        + 'Run npm run fetch:routes and commit fixtures/nyc/.',
    );
  }

  // The generator reuses the story file's home objects; the copy keeps the scenario free of the inputs.
  return { kind: 'scenario', scenario: structuredClone(buildNycScenario({ ...inputs, request: parsed.data })) };
}

// ---------- Import and export ----------

// The Run contract (shared/v2/types.ts) as a runtime check. Unknown keys are allowed and kept;
// `satisfies z.ZodType<Run>` fails the typecheck when the contract gains a field this schema lacks.
const idText = z.string().min(1);
const num = z.number(); // finite: Zod refuses NaN and Infinity
// A point in time, by the rule the request schemas apply to a form (shared/schemas.ts): a whole minute of
// the two simulated days. So a file cannot bring in a time that no create, edit, commute save or seek could.
const minute = z.number().int().min(0).max(2 * 1440);
const borough = z.enum(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);
const point = { lat: num.min(-90).max(90), lng: num.min(-180).max(180) };

const StopSchema = z.object({
  placeId: idText, kind: z.enum(['pickup', 'hub_drop', 'hub_pickup', 'delivery']),
  arrivalMin: minute, serviceStartMin: minute, serviceEndMin: minute,
});
const LegSchema = z.object({
  tripId: idText, employeeId: idText, placeIds: z.array(idText), stops: z.array(StopSchema).min(1),
  finishMin: minute, extraMin: num, extraDistanceM: num, rewardCents: num,
});
const PlanSchema = z.object({
  id: idText, shipmentId: idText, kind: z.enum(['direct', 'relay']), legs: z.array(LegSchema).min(1),
  relayBusinessId: idText.optional(), deliveryMin: minute, customerPriceCents: num, platformContributionCents: num,
});
const ScenarioSchema = z.object({
  schemaVersion: z.literal(2),
  name: z.string(), preset: z.enum(['demo', 'random', 'custom']), seed: num,
  businesses: z.array(z.object({
    id: idText, name: z.string(), address: z.string(), neighborhood: z.string(), borough,
    kind: z.enum(['office', 'shop', 'cafe']), ...point,
  })),
  homes: z.array(z.object({ id: idText, neighborhood: z.string(), ...point })),
  employees: z.array(z.object({
    id: idText, name: z.string(), businessId: idText, homeId: idText,
    eveningDepartureMin: minute, morningDepartureMin: minute, maxExtraMin: num,
    availableEvening: z.boolean(), availableMorning: z.boolean(),
  })),
  shipments: z.array(z.object({
    id: idText, clientRequestId: z.string(), label: z.string(),
    originBusinessId: idText, destinationBusinessId: idText, readyMin: minute, deadlineMin: minute,
    category: z.enum(['envelope', 'small_box']), description: z.string(), weightGrams: num,
    pickupInstructions: z.string(), dropoffInstructions: z.string(), createdSeq: num,
  })),
  settings: z.object({
    handlingMin: num, defaultMaxExtraMin: num, priceCents: num, legRewardCents: num, hubCostCents: num,
    platformVariableCostCents: num, courierPriceCents: num, simStartMin: minute, simEndMin: minute,
    allowRelay: z.boolean(),
  }),
});
const RunSchema = z.object({
  runId: idText,
  version: num,
  scenario: ScenarioSchema,
  trips: z.array(z.object({
    id: idText, employeeId: idText, direction: z.enum(['evening', 'morning']),
    originPlaceId: idText, destinationPlaceId: idText, departureMin: minute,
    baselineDurationMin: num, baselineDistanceM: num,
  })),
  assignments: z.object({
    plans: z.array(PlanSchema),
    unmatched: z.array(z.object({ shipmentId: idText, reason: z.string() })),
    computeMs: num,
  }),
  jobs: z.array(z.object({
    id: idText, planId: idText, shipmentId: idText, employeeId: idText, legIndex: num, tripId: idText,
    pickup: StopSchema, dropoff: StopSchema, rewardCents: num,
  })),
  notifications: z.array(z.object({
    id: idText, audience: z.enum(['business', 'employee']), audienceId: idText,
    kind: z.enum(['delivery_matched', 'job_assigned']), shipmentId: idText, planId: idText,
    jobId: idText.optional(), message: z.string(), createdSeq: num,
  })),
  events: z.array(z.object({
    id: idText, timeMin: minute, shipmentId: idText, planId: idText, jobId: idText,
    kind: z.enum(['pickup', 'hub_drop', 'hub_pickup', 'delivered']), employeeId: idText,
    relayBusinessId: idText.optional(), seq: num,
  })),
  clock: z.object({
    phase: z.enum(['planning', 'locked']), playing: z.boolean(), timeMin: minute,
    speed: z.union([z.literal(30), z.literal(120), z.literal(600)]),
  }),
}) satisfies z.ZodType<Run>;

/** The part of the travel provider an import needs (`CachedProvider.has` in server/geo/providers.ts). */
export type TravelPairs = { has(fromPlaceId: string, toPlaceId: string): boolean };

export type ImportPlan =
  | PlanningInvalid
  | PlanningUnavailable
  | { kind: 'run'; run: Run }; // stored with runId = nextRunId(current), so clients refetch the map

const MAX_FIELD_ERRORS = 10;

const valueAt = (root: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (value, key) => (typeof value === 'object' && value !== null ? (value as Record<PropertyKey, unknown>)[key] : undefined),
    root,
  );

/** The first shape problems of a file, by path: `scenario.employees.3.homeId` -> `Missing`. */
function shapeProblems(body: unknown, issues: readonly { path: PropertyKey[] }[]): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const issue of issues) {
    if (Object.keys(problems).length >= MAX_FIELD_ERRORS) break;
    problems[fieldOf(issue.path)] ??= valueAt(body, issue.path) === undefined ? 'Missing' : 'Not a valid value';
  }
  return problems;
}

type Problem = { sentence: string; path: string; label: string };

/** The first ID that is used twice or the first reference that does not resolve, or null. */
function referenceProblem(run: Run): Problem | null {
  const { scenario } = run;
  const { plans } = run.assignments;

  const lists: [string, string, { id: string }[]][] = [
    ['scenario.businesses', 'business', scenario.businesses],
    ['scenario.homes', 'home', scenario.homes],
    ['scenario.employees', 'employee', scenario.employees],
    ['scenario.shipments', 'delivery', scenario.shipments],
    ['assignments.plans', 'delivery plan', plans],
    ['jobs', 'job', run.jobs],
  ];
  for (const [path, noun, items] of lists) {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.id)) {
        return {
          sentence: `This file lists the same ${noun} ID twice, so it was not loaded.`,
          path: `${path}.${index}.id`, label: 'Duplicate ID',
        };
      }
      seen.add(item.id);
    }
  }

  const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));
  const businesses = ids(scenario.businesses);
  const homes = ids(scenario.homes);
  const employees = ids(scenario.employees);
  const shipments = ids(scenario.shipments);
  const planIds = ids(plans);
  const jobIds = ids(run.jobs);
  // A place is a business or a home of this file: the only IDs the travel cache and the matcher know.
  const places = new Set([...businesses, ...homes]);

  // [path, owner (with article), target (with article), the referenced ID, the set it must be in]
  type Ref = [string, string, string, string | undefined, Set<string>];
  const refs: Ref[] = [
    ...scenario.employees.flatMap((e, i): Ref[] => [
      [`scenario.employees.${i}.businessId`, 'An employee', 'a business', e.businessId, businesses],
      [`scenario.employees.${i}.homeId`, 'An employee', 'a home', e.homeId, homes],
    ]),
    ...scenario.shipments.flatMap((s, i): Ref[] => [
      [`scenario.shipments.${i}.originBusinessId`, 'A delivery', 'a business', s.originBusinessId, businesses],
      [`scenario.shipments.${i}.destinationBusinessId`, 'A delivery', 'a business', s.destinationBusinessId, businesses],
    ]),
    ...run.trips.flatMap((t, i): Ref[] => [
      [`trips.${i}.employeeId`, 'A commute trip', 'an employee', t.employeeId, employees],
      [`trips.${i}.originPlaceId`, 'A commute trip', 'a place', t.originPlaceId, places],
      [`trips.${i}.destinationPlaceId`, 'A commute trip', 'a place', t.destinationPlaceId, places],
    ]),
    ...plans.flatMap((p, i): Ref[] => [
      [`assignments.plans.${i}.shipmentId`, 'A delivery plan', 'a delivery', p.shipmentId, shipments],
      [`assignments.plans.${i}.relayBusinessId`, 'A delivery plan', 'a business', p.relayBusinessId, businesses],
      ...p.legs.flatMap((leg, j): Ref[] => [
        [`assignments.plans.${i}.legs.${j}.employeeId`, 'A delivery plan', 'an employee', leg.employeeId, employees],
        ...leg.placeIds.map((placeId, k): Ref => [
          `assignments.plans.${i}.legs.${j}.placeIds.${k}`, 'A delivery plan', 'a place', placeId, places,
        ]),
        ...leg.stops.map((stop, k): Ref => [
          `assignments.plans.${i}.legs.${j}.stops.${k}.placeId`, 'A delivery plan', 'a place', stop.placeId, places,
        ]),
      ]),
    ]),
    ...run.assignments.unmatched.map((u, i): Ref => [
      `assignments.unmatched.${i}.shipmentId`, 'An unmatched delivery', 'a delivery', u.shipmentId, shipments,
    ]),
    ...run.jobs.flatMap((job, i): Ref[] => [
      [`jobs.${i}.planId`, 'A job', 'a delivery plan', job.planId, planIds],
      [`jobs.${i}.shipmentId`, 'A job', 'a delivery', job.shipmentId, shipments],
      [`jobs.${i}.employeeId`, 'A job', 'an employee', job.employeeId, employees],
      [`jobs.${i}.pickup.placeId`, 'A job', 'a place', job.pickup.placeId, places],
      [`jobs.${i}.dropoff.placeId`, 'A job', 'a place', job.dropoff.placeId, places],
    ]),
    ...run.events.flatMap((event, i): Ref[] => [
      [`events.${i}.jobId`, 'A timeline event', 'a job', event.jobId, jobIds],
      [`events.${i}.relayBusinessId`, 'A timeline event', 'a business', event.relayBusinessId, businesses],
    ]),
  ];
  for (const [path, owner, target, ref, known] of refs) {
    if (ref !== undefined && !known.has(ref)) {
      return {
        sentence: `${owner} in this file refers to ${target} that is not in the file, so it was not loaded.`,
        path, label: `Unknown ${target.replace(/^an? /, '')}`,
      };
    }
  }
  return null;
}

/**
 * How many employee homes have a commute this server has no travel time for. A home counts once,
 * when the pair to or from the workplace of any employee living there is not in the cache.
 */
function uncachedHomes(run: Run, travel: TravelPairs): number {
  const missing = new Set<string>();
  for (const { businessId, homeId } of run.scenario.employees) {
    if (!travel.has(businessId, homeId) || !travel.has(homeId, businessId)) missing.add(homeId);
  }
  return missing.size;
}

const NO_TRAVEL_TIME = 'No travel time';

/**
 * The first pair of places that a trip or a plan leg drives and the cache has no travel time for, or null
 * (SPEC MVP II rule 2: a missing pair is a refusal, never a guess). A new planning cycle and Recompute keep
 * the trips and match them again, and the matcher may route a trip through any business of the file (the
 * other side of a delivery, or a relay point), so for each trip it needs origin -> destination,
 * origin -> every business and every business -> destination. A leg needs each hop of its `placeIds`.
 * With these pairs cached, a stored run can always be planned again.
 */
function travelProblem(run: Run, travel: TravelPairs): Problem | null {
  const businessIds = run.scenario.businesses.map((business) => business.id);
  for (const [i, trip] of run.trips.entries()) {
    const from = trip.originPlaceId;
    const to = trip.destinationPlaceId;
    // [from, to, the end of the trip a missing pair is blamed on]
    type Pair = [string, string, 'originPlaceId' | 'destinationPlaceId'];
    const pairs: Pair[] = [
      [from, to, 'destinationPlaceId'],
      ...businessIds.flatMap((id): Pair[] => [
        [from, id, 'originPlaceId'],
        [id, to, 'destinationPlaceId'],
      ]),
    ];
    const missing = pairs.find(([a, b]) => a !== b && !travel.has(a, b));
    if (missing) {
      return {
        sentence: 'A commute trip in this file drives between places this server has no travel time for, so it was not loaded.',
        path: `trips.${i}.${missing[2]}`, label: NO_TRAVEL_TIME,
      };
    }
  }
  for (const [i, plan] of run.assignments.plans.entries()) {
    for (const [j, leg] of plan.legs.entries()) {
      for (let k = 1; k < leg.placeIds.length; k++) {
        if (leg.placeIds[k - 1] !== leg.placeIds[k] && !travel.has(leg.placeIds[k - 1], leg.placeIds[k])) {
          return {
            sentence: 'A delivery plan in this file drives between places this server has no travel time for, so it was not loaded.',
            path: `assignments.plans.${i}.legs.${j}.placeIds.${k}`, label: NO_TRAVEL_TIME,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Decides whether an uploaded file may replace the run. Accepted only when it is a complete MVP II run
 * (`scenario.schemaVersion === 2`), every reference resolves (every place ID is a business or a home of
 * the file), every employee's commute is in the travel cache (else 503) and every pair a trip or a plan
 * leg drives is too (else 400, see `travelProblem`), so a new planning cycle and Recompute work on it;
 * otherwise it is refused with a one-sentence reason and never repaired or estimated
 * (DECISIONS pass 10, 47). The accepted run is a copy of the file with `clock.playing = false`;
 * it keeps the file's `runId`, and the route sets `nextRunId(current.runId)` when it stores it.
 */
export function parseImportedRun(body: unknown, travel: TravelPairs): ImportPlan {
  if (!isRecord(body) || !isRecord(body.scenario)) return invalid(NOT_A_RELAY_FILE);
  const { scenario } = body;
  if (scenario.schemaVersion !== 2) {
    // MVP 1 files say `schemaVersion: 1` and carry the synthetic grid (`graph`) and the hub list.
    const mvp1 = scenario.schemaVersion === 1 || 'graph' in scenario || 'hubs' in scenario;
    return invalid(mvp1 ? MVP1_FILE : UNKNOWN_FILE_VERSION);
  }

  const parsed = RunSchema.safeParse(body);
  if (!parsed.success) {
    return invalid(
      'This file is not a complete Relay scenario export, so it was not loaded.',
      shapeProblems(body, parsed.error.issues),
    );
  }
  // The file itself, not Zod's output, so nothing the file holds is dropped.
  const run = structuredClone(body) as Run;

  const problem = referenceProblem(run);
  if (problem) return invalid(problem.sentence, { [problem.path]: problem.label });

  const missing = uncachedHomes(run, travel);
  if (missing > 0) {
    return unavailable(
      missing,
      `Travel times are not cached on this server for ${missing} ${missing === 1 ? 'place' : 'places'} in this file, `
        + 'so it was not loaded.',
    );
  }

  const travelGap = travelProblem(run, travel);
  if (travelGap) return invalid(travelGap.sentence, { [travelGap.path]: travelGap.label });

  run.clock.playing = false;
  return { kind: 'run', run };
}

/** `GET /scenario/export`: the run exactly as stored, as a copy the caller may keep or change. */
export function exportRun(run: Run): ExportFile {
  return structuredClone(run);
}
