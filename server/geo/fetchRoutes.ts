// Everything `npm run fetch:routes` does except touching the disk and the environment (SPEC "Fetch script").
// `runFetchRoutes` runs the steps in order through an injected Google client and hands the files to `save` after
// every step that changed them; `estimateFetch` reports what a run would fetch without calling Google.
// No file access, no environment, no terminal output here: the script reads `.env` and `fixtures/nyc/`, passes
// the parsed files in, writes what `save` receives and prints what `log` and the formatters return.
// Rules it keeps (SPEC "MVP II" rules 2-4):
// - a time or a distance is only ever one Google returned; a step that lacks data is skipped, never estimated;
// - the cache comes first: a pair, a place or a route line that is already in the files is not asked for again;
// - the input files are never mutated, and no log line holds a key.

import { TravelDataMissingError } from '../../shared/v2/types';
import type {
  AssignmentResult,
  Home,
  NycBusinessesFile,
  NycDemoStoryFile,
  NycNeighborhoodsFile,
  Scenario,
  TravelMatrixFile,
  Trip,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { buildNycScenario, generateHomePool } from '../domain/v2/generator';
import { assignShipments } from '../domain/v2/matching';
import { buildTrips } from '../domain/v2/trips';
import type { TravelFiles } from './cache';
import { carrierCommutePairs, commutePairs, planGeocodes, planLegPairs, planMatrixPairs, planPolylines } from './fetchPlan';
import type { PlacePair } from './fetchPlan';
import { emptySummary, mergeSummaries, runGeocodes, runMatrix, runPolylines, scrubKeys } from './fetchRunner';
import type { FetchClient, FetchSummary, Log } from './fetchRunner';
import { createCachedProvider } from './providers';

/** The parsed inputs of a run: the travel cache so far and the three hand-written NYC fixture files. */
export interface FetchRoutesInput {
  files: TravelFiles;
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
}

/** The scenario the demo starts with: preset `demo` with the schema's defaults (60 employees, 24 packages). */
export const DEFAULT_SCENARIO_REQUEST: GenerateScenarioRequest = GenerateScenarioRequest.parse({ preset: 'demo' });

/** Every skip reason ends with this, because every skip is cured by running the script again. */
const RESUME = 'Run again to resume.';

/** A plan has one leg (direct) or two (relay), and a leg drives two stretches: origin → stop → destination. */
const MAX_ROUTE_LINES_PER_PLAN = 4;

/**
 * The dry run's line for the carriers' home ↔ work stretches (MVP IV F2), and what follows its number: these
 * lines are a part of the two counts printed above it, so the `Google requests` total does not add them again.
 */
export const CARRIER_COMMUTE_LINES_LABEL = 'commute route lines to fetch for carriers';
export const CARRIER_COMMUTE_LINES_NOTE = '(home ↔ work stretches of the employees who carry a package; part of the route lines above)';

export const PLAN_POLYLINES_NOTE =
  'The route lines of matched plans are known only after the matrix is fetched: the matcher has to run on the fetched times first.';

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** The 120-home pool plus the story's featured homes, each ID once. Every one is cached against all businesses. */
function allHomes(input: Pick<FetchRoutesInput, 'neighborhoodsFile' | 'storyFile'>): Home[] {
  const byId = new Map<string, Home>();
  for (const home of generateHomePool(input.neighborhoodsFile.neighborhoods)) byId.set(home.id, home);
  for (const { home } of input.storyFile.featuredEmployees) if (!byId.has(home.id)) byId.set(home.id, home);
  return [...byId.values()];
}

function businessesWithoutCoordinates(businessesFile: NycBusinessesFile, matrix: TravelMatrixFile): string[] {
  return businessesFile.businesses.map((business) => business.id).filter((id) => !hasOwn(matrix.places, id));
}

function idList(ids: readonly string[]): string {
  return ids.length <= 3 ? ids.join(', ') : `${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more`;
}

export type MatchOutcome =
  | { ok: true; scenario: Scenario; trips: Trip[]; assignments: AssignmentResult }
  | { ok: false; reason: string };

/**
 * Step 3: the default scenario, its trips and the matcher's result, all read from the cache files.
 * Pure. When the files cannot answer (a business without coordinates, a pair without a time) it returns the
 * reason in one line; it never fills a gap with a guess.
 * Exported for the `--dry-run` of fetchScript.ts, which explains the story rows that are not as written from it.
 */
export function matchDefaultScenario(input: FetchRoutesInput, files: TravelFiles): MatchOutcome {
  const ungeocoded = businessesWithoutCoordinates(input.businessesFile, files.matrix);
  if (ungeocoded.length > 0) {
    const subject = ungeocoded.length === 1 ? '1 business has' : `${ungeocoded.length} businesses have`;
    return {
      ok: false,
      reason:
        `${subject} no coordinates (${idList(ungeocoded)}), so the default scenario cannot be built. ` +
        `If Google cannot find an address, correct it in businesses.json. ${RESUME}`,
    };
  }

  const scenario = buildNycScenario({
    businessesFile: input.businessesFile,
    neighborhoodsFile: input.neighborhoodsFile,
    storyFile: input.storyFile,
    places: files.matrix.places,
    request: DEFAULT_SCENARIO_REQUEST,
  });

  // The matcher may send any commuter past any business (relay through any business), so the scenario needs
  // every business → business pair and both directions between each of its homes and every business.
  const needed = planMatrixPairs(
    { businessIds: scenario.businesses.map((business) => business.id), homeIds: scenario.homes.map((home) => home.id) },
    files.matrix,
  );
  if (needed.missingPairs > 0) {
    return {
      ok: false,
      reason:
        `the matrix lacks ${needed.missingPairs} of the ${needed.missingPairs + needed.cachedPairs} pairs the default scenario needs, ` +
        `so the matcher was not run. ${RESUME}`,
    };
  }

  try {
    const travel = createCachedProvider(files);
    const trips = scenario.employees.flatMap((employee) => buildTrips(employee, travel));
    const assignments = assignShipments(scenario.shipments, {
      travel,
      trips,
      employees: scenario.employees,
      businesses: scenario.businesses,
      settings: scenario.settings,
    });
    return { ok: true, scenario, trips, assignments };
  } catch (err) {
    if (!(err instanceof TravelDataMissingError)) throw err;
    return { ok: false, reason: `the matcher needs a travel time the matrix does not have (${err.from} -> ${err.to}). ${RESUME}` };
  }
}

/**
 * Who commutes between which business and which home in the default scenario.
 * The generator picks employers and homes by ID and seed only, so this is known before any business is geocoded.
 * A business that has no coordinates yet gets a not-a-number stand-in to get through the generator; the scenario
 * built here is thrown away and only the two IDs of each employee leave this function.
 */
function defaultCommuters(input: FetchRoutesInput): { businessId: string; homeId: string }[] {
  const places: TravelMatrixFile['places'] = {};
  for (const { id } of input.businessesFile.businesses) {
    places[id] = hasOwn(input.files.matrix.places, id) ? input.files.matrix.places[id] : { lat: Number.NaN, lng: Number.NaN };
  }
  const scenario = buildNycScenario({
    businessesFile: input.businessesFile,
    neighborhoodsFile: input.neighborhoodsFile,
    storyFile: input.storyFile,
    places,
    request: DEFAULT_SCENARIO_REQUEST,
  });
  return scenario.employees.map((employee) => ({ businessId: employee.businessId, homeId: employee.homeId }));
}

// ---------- the estimate (no Google call) ----------

export interface FetchEstimate {
  /** Businesses in businesses.json, and how many of them a run would geocode (one request each). */
  businesses: number;
  geocodes: number;
  /** Homes a run caches against every business: the pool plus the story's featured homes. */
  homes: number;
  matrixPairsCached: number;
  matrixPairsMissing: number;
  /** computeRouteMatrix requests for the missing pairs. */
  matrixRequests: number;
  /** Route lines to fetch for the default scenario's baseline commutes (one request each). */
  commutePolylines: number;
  /**
   * Route lines to fetch for the matched plans' legs (one request each), or null while the matrix cannot
   * answer the matcher yet. Never a guess: it is the matcher's own result on the cached matrix.
   */
  planPolylines: number | null;
  /** The most `planPolylines` can be: every package matched as a relay with no line cached. */
  planPolylinesAtMost: number;
  /**
   * Of the route lines above, the ones a carrier's home ↔ work drive lacks (MVP IV F2): the stretches of the
   * matched plans' legs that touch a home, and the baseline commutes of the employees who carry a leg
   * (`carrierCommutePairs`). They are part of `commutePolylines` and `planPolylines`, not requests on top.
   * Null while the matrix cannot answer the matcher, like `planPolylines`: who carries is the matcher's result.
   */
  carrierCommutePolylines: number | null;
  /** Always PLAN_POLYLINES_NOTE. */
  note: string;
}

/**
 * What `runFetchRoutes` would ask Google for on these files. Pure: no client, nothing is fetched or written.
 * It assumes every request succeeds, so on a first run the numbers are exactly the calls the run makes for
 * geocodes, matrix pairs and commute lines.
 * `carrierCommutePolylines` is not one more kind of request: it says how many of the route lines counted in
 * `commutePolylines` and `planPolylines` belong to a carrier's home ↔ work drive.
 */
export function estimateFetch(input: FetchRoutesInput): FetchEstimate {
  const { files, businessesFile } = input;
  const homes = allHomes(input);
  const matrixPlan = planMatrixPairs(
    { businessIds: businessesFile.businesses.map((business) => business.id), homeIds: homes.map((home) => home.id) },
    files.matrix,
  );
  const commutes = commutePairs(defaultCommuters(input));
  const commutePolylines = planPolylines(commutes, files.polylines).length;

  const matched = matchDefaultScenario(input, files);
  // Counted on top of the commute lines, so a line that serves both is counted once.
  const planLines = matched.ok
    ? planPolylines([...commutes, ...planLegPairs(matched.assignments.plans)], files.polylines).length - commutePolylines
    : null;
  const carrierLines = matched.ok
    ? planPolylines(carrierCommutePairs(matched.assignments.plans, matched.scenario.employees), files.polylines).length
    : null;

  return {
    businesses: businessesFile.businesses.length,
    geocodes: planGeocodes(businessesFile.businesses, files.matrix).length,
    homes: homes.length,
    matrixPairsCached: matrixPlan.cachedPairs,
    matrixPairsMissing: matrixPlan.missingPairs,
    matrixRequests: matrixPlan.batches.length,
    commutePolylines,
    planPolylines: planLines,
    planPolylinesAtMost: input.storyFile.shipments.length * MAX_ROUTE_LINES_PER_PLAN,
    carrierCommutePolylines: carrierLines,
    note: PLAN_POLYLINES_NOTE,
  };
}

/** True when a run on these files would make no Google call at all. */
export function nothingToFetch(estimate: FetchEstimate): boolean {
  return estimate.geocodes === 0 && estimate.matrixPairsMissing === 0 && estimate.commutePolylines === 0 && estimate.planPolylines === 0;
}

/** The estimate as lines for the terminal. */
export function formatEstimate(estimate: FetchEstimate): string[] {
  const known = estimate.geocodes + estimate.matrixRequests + estimate.commutePolylines;
  const lines = [
    'Fetch estimate (no Google call was made)',
    `  businesses to geocode: ${estimate.geocodes} of ${estimate.businesses}`,
    `  matrix pairs to fetch: ${estimate.matrixPairsMissing} in ${estimate.matrixRequests} requests ` +
      `(${estimate.businesses} businesses, ${estimate.homes} homes; already cached: ${estimate.matrixPairsCached})`,
    `  route lines to fetch for baseline commutes: ${estimate.commutePolylines}`,
  ];
  if (estimate.planPolylines === null) {
    lines.push(
      `  route lines to fetch for matched plans: not known yet, at most ${estimate.planPolylinesAtMost}`,
      `  ${CARRIER_COMMUTE_LINES_LABEL}: not known yet ${CARRIER_COMMUTE_LINES_NOTE}`,
      `  Google requests: ${known}, plus at most ${estimate.planPolylinesAtMost} for the matched plans`,
      `  ${estimate.note}`,
    );
  } else {
    lines.push(
      `  route lines to fetch for matched plans: ${estimate.planPolylines}`,
      `  ${CARRIER_COMMUTE_LINES_LABEL}: ${estimate.carrierCommutePolylines ?? 'not known yet'} ${CARRIER_COMMUTE_LINES_NOTE}`,
      `  Google requests: ${known + estimate.planPolylines}`,
    );
    if (nothingToFetch(estimate)) lines.push('  Nothing to fetch: the cache has everything the default scenario needs.');
  }
  return lines.map(scrubKeys);
}

// ---------- the run ----------

/** A step that could not run, and why in one line. The geocode and matrix steps report through `summary` instead. */
export interface SkippedStep {
  step: 'match' | 'polylines';
  reason: string;
}

export interface FetchRoutesResult {
  /** The cache after the run: the input files plus everything that was fetched. New objects; the input is untouched. */
  files: TravelFiles;
  /** All steps added up. `requests` is the number of calls made to the client. */
  summary: FetchSummary;
  /** The default scenario, the matcher's result on the fetched matrix and the trips it used; null and empty when step 3 was skipped. */
  scenario: Scenario | null;
  assignments: AssignmentResult | null;
  trips: Trip[];
  skipped: SkippedStep[];
}

const size = (record: object) => Object.keys(record).length;

/** The steps only ever add entries, so the files changed exactly when one of the three records grew. */
function grew(before: TravelFiles, after: TravelFiles): boolean {
  return (
    size(after.matrix.places) !== size(before.matrix.places) ||
    size(after.matrix.pairs) !== size(before.matrix.pairs) ||
    size(after.polylines.polylines) !== size(before.polylines.polylines)
  );
}

/**
 * The whole fetch, in the order of DECISIONS pass 45:
 * 1. geocode the businesses that have no coordinates yet;
 * 2. fetch every missing matrix pair between the homes (120-home pool + story homes) and the businesses;
 * 3. build the default scenario and run the matcher on the fetched matrix;
 * 4. fetch the missing route lines of the baseline commutes and of the matched plans' legs.
 * `save(files)` is awaited after each step that changed the files, so a crash or Ctrl-C keeps what was paid for.
 * A request that fails is a line in `summary.failures`, not an exception; a step that lacks data is in `skipped`.
 * Only an error from `save` or from a broken fixture file is thrown, and a FetchStopError the client threw to end
 * the run (fetchRunner.ts): the steps before it are saved.
 */
export async function runFetchRoutes(
  args: FetchRoutesInput & { client: FetchClient; log: Log; save: (files: TravelFiles) => void | Promise<void> },
): Promise<FetchRoutesResult> {
  const { businessesFile, client, save } = args;
  const log: Log = (line) => args.log(scrubKeys(line));
  const homes = allHomes(args); // before the first paid call: a broken neighborhoods file fails here

  let files: TravelFiles = {
    matrix: { schemaVersion: 1, places: { ...args.files.matrix.places }, pairs: { ...args.files.matrix.pairs } },
    polylines: { schemaVersion: 1, polylines: { ...args.files.polylines.polylines } },
  };
  const keep = async (next: TravelFiles) => {
    const changed = grew(files, next);
    files = next;
    if (changed) await save(files);
  };

  // 1. Geocode.
  const geocodePlan = planGeocodes(businessesFile.businesses, files.matrix);
  log(`Step 1/4 geocode: ${geocodePlan.length} of ${businessesFile.businesses.length} businesses have no coordinates yet`);
  let geocodeSummary = emptySummary();
  if (geocodePlan.length > 0) {
    const geocoded = await runGeocodes({ plan: geocodePlan, matrix: files.matrix, client, log });
    geocodeSummary = geocoded.summary;
    await keep({ matrix: geocoded.file, polylines: files.polylines });
  }

  // 2. Matrix. A business that still has no coordinates is left out, so none of its pairs is requested.
  const ungeocoded = new Set(businessesWithoutCoordinates(businessesFile, files.matrix));
  const businessIds = businessesFile.businesses.map((business) => business.id).filter((id) => !ungeocoded.has(id));
  const matrixPlan = planMatrixPairs({ businessIds, homeIds: homes.map((home) => home.id) }, files.matrix);
  log(
    `Step 2/4 matrix: ${matrixPlan.missingPairs} pairs to fetch in ${matrixPlan.batches.length} requests ` +
      `(${businessIds.length} businesses, ${homes.length} homes; already cached: ${matrixPlan.cachedPairs})`,
  );
  if (ungeocoded.size > 0) log(`matrix: leaving out ${idList([...ungeocoded])}: no coordinates`);
  const fetchedMatrix = await runMatrix({ plan: matrixPlan, matrix: files.matrix, homes, client, log });
  await keep({ matrix: fetchedMatrix.file, polylines: files.polylines });

  // 3. Default scenario and matcher, on what the cache now holds.
  const started = performance.now();
  const matched = matchDefaultScenario(args, files);
  if (!matched.ok) {
    const skipped: SkippedStep[] = [
      { step: 'match', reason: scrubKeys(matched.reason) },
      { step: 'polylines', reason: `there are no matched plans to draw, because the matcher was not run. ${RESUME}` },
    ];
    log(`Step 3/4 default scenario and matcher: SKIPPED: ${skipped[0].reason}`);
    log(`Step 4/4 route lines: SKIPPED: ${skipped[1].reason}`);
    return {
      files,
      summary: mergeSummaries(geocodeSummary, fetchedMatrix.summary),
      scenario: null,
      assignments: null,
      trips: [],
      skipped,
    };
  }
  const { scenario, trips } = matched;
  const assignments: AssignmentResult = { ...matched.assignments, computeMs: performance.now() - started };
  log(
    `Step 3/4 default scenario and matcher: ${scenario.employees.length} employees, ${scenario.shipments.length} packages, ` +
      `${assignments.plans.length} matched, ${assignments.unmatched.length} unmatched`,
  );

  // 4. Route lines: both baseline commutes of every employee, then each stretch the matched plans drive. The
  // carriers' home ↔ work stretches (MVP IV F2) are named last: each is already one of the pairs before it, so
  // the plan is the same list, and the log says how many of its lines a carrier's commute lacks.
  const carrierCommutes = carrierCommutePairs(assignments.plans, scenario.employees);
  const wanted: PlacePair[] = [...commutePairs(scenario.employees), ...planLegPairs(assignments.plans), ...carrierCommutes];
  const polylinePlan = planPolylines(wanted, files.polylines);
  log(
    `Step 4/4 route lines: ${polylinePlan.length} to fetch for the baseline commutes and the matched plans' legs, ` +
      `${planPolylines(carrierCommutes, files.polylines).length} of them for the carriers' commutes (home ↔ work)`,
  );
  let polylineSummary = emptySummary();
  if (polylinePlan.length > 0) {
    const fetchedLines = await runPolylines({ plan: polylinePlan, polylines: files.polylines, places: files.matrix.places, client, log });
    polylineSummary = fetchedLines.summary;
    await keep({ matrix: files.matrix, polylines: fetchedLines.file });
  }

  return {
    files,
    summary: mergeSummaries(geocodeSummary, fetchedMatrix.summary, polylineSummary),
    scenario,
    assignments,
    trips,
    skipped: [],
  };
}
