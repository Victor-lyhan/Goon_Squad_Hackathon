// The MVP II run boot (DECISIONS pass 49): travel cache + NYC fixture files -> a stored v2 run.
// The server start passes the result to `createV2Router(v2DepsFrom(boot))`.
// - No travel data, or a cache that lacks something the default run needs: `not_loaded` (the API answers
//   503 `travel_data_missing`). Nothing here estimates a travel time, and boot does not throw.
// - A saved v2 state is restored (paused) only if it is a v2 run whose places are all in the cache;
//   an unusable file is renamed to <file>.bad-<n>, never overwritten (MVP 1 behaviour, #184).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  TravelDataMissingError,
  type NycBusinessesFile, type NycDemoStoryFile, type NycNeighborhoodsFile,
  type TravelMatrixFile, type TravelProvider,
} from '../../../shared/v2/types';
import { GenerateScenarioRequest } from '../../../shared/v2/schemas';
import { buildNycScenario } from '../../domain/v2/generator';
import { buildTimeline } from '../../domain/v2/timeline';
import { createStore, type Store } from '../../store';
import { TRAVEL_NOT_LOADED_MESSAGE, travelErrorBody } from './errors';
import { createInitialRun } from './initialRun';
import { V2_DEPS_NOT_LOADED, type RunV2, type V2Deps } from './router';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `data/state-v2.json` at the repo root, next to the MVP 1 `data/state.json`. The root `data/` folder is gitignored. */
export const DEFAULT_V2_STATE_PATH = path.join(repoRoot, 'data', 'state-v2.json');
/** `fixtures/nyc/`: the three fixture files read here, and the travel cache files. */
export const NYC_FIXTURES_DIR = path.join(repoRoot, 'fixtures', 'nyc');

/** The default scenario: the demo preset with the contract's defaults (seed 42, 60 employees, 24 packages, 8 extra minutes). */
export const DEFAULT_RUN_REQUEST: GenerateScenarioRequest = GenerateScenarioRequest.parse({ preset: 'demo' });

export type Places = TravelMatrixFile['places'];

// ---------- fixture files ----------

export type NycFixtures = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
};

/** A fixture file that is missing, is not JSON or does not have the shape the generator reads. */
export class NycFixtureError extends Error {
  /** Path of the file the problem is in. */
  readonly file: string;
  constructor(file: string, problem: string) {
    super(`NYC fixture ${file}: ${problem}`);
    this.name = 'NycFixtureError';
    this.file = file;
  }
}

const text = z.string().min(1);
const num = z.number(); // Zod's number is finite: no NaN, no Infinity
const borough = z.enum(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);

// Only the fields the generator, the matcher and the views read. Extra fields are allowed and kept.
const BusinessesFile = z.object({
  businesses: z.array(z.object({
    id: text, name: text, address: text, neighborhood: text, borough, kind: z.enum(['office', 'shop', 'cafe']),
  })).min(2),
});
const NeighborhoodsFile = z.object({
  neighborhoods: z.array(z.object({
    id: text, name: text, borough,
    bbox: z.object({ south: num, west: num, north: num, east: num }),
  })).min(1),
});
const StoryFile = z.object({
  featuredEmployees: z.array(z.object({
    id: text, name: text, businessId: text,
    eveningDepartureMin: num, morningDepartureMin: num, maxExtraMin: num,
    availableEvening: z.boolean(), availableMorning: z.boolean(),
    home: z.object({ id: text, neighborhood: text, lat: num, lng: num }),
  })),
  shipments: z.array(z.object({
    label: z.string(), originBusinessId: text, destinationBusinessId: text,
    readyMin: num, deadlineMin: num, category: z.enum(['envelope', 'small_box']),
    description: z.string(), weightGrams: num,
    pickupInstructions: z.string(), dropoffInstructions: z.string(),
    expect: z.enum(['direct', 'relay', 'any']),
  })),
});

function readFixture<T>(dir: string, name: string, schema: z.ZodType): T {
  const file = path.join(dir, name);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new NycFixtureError(file, code === 'ENOENT' || code === 'ENOTDIR' ? 'the file is missing' : `cannot be read (${code ?? 'unknown error'})`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new NycFixtureError(file, 'is not valid JSON');
  }
  const checked = schema.safeParse(value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue.path.length > 0 ? issue.path.join('.') : 'the file';
    throw new NycFixtureError(file, `unexpected shape at ${where} (${issue.message})`);
  }
  return value as T; // the file as written: the generator gets exactly what the fetch script gets
}

/** Reads `businesses.json`, `neighborhoods.json` and `demoStory.json` from `dir`. Throws NycFixtureError naming the file. */
export function readNycFixtures(dir: string): NycFixtures {
  return {
    businessesFile: readFixture<NycBusinessesFile>(dir, 'businesses.json', BusinessesFile),
    neighborhoodsFile: readFixture<NycNeighborhoodsFile>(dir, 'neighborhoods.json', NeighborhoodsFile),
    storyFile: readFixture<NycDemoStoryFile>(dir, 'demoStory.json', StoryFile),
  };
}

// ---------- the default run ----------

/**
 * The default NYC run: the demo preset, trips built and every package matched, timeline included.
 * Reads only its arguments (no fs). Same arguments, same run, except `assignments.computeMs`, which is measured.
 * Throws TravelDataMissingError if `travel` lacks a pair, and an Error if `places` lacks a business.
 */
export function buildDefaultRun(input: { travel: TravelProvider; places: Places; fixtures: NycFixtures }): RunV2 {
  const scenario = buildNycScenario({ ...input.fixtures, places: input.places, request: DEFAULT_RUN_REQUEST });
  return createInitialRun(scenario, { travel: input.travel, buildEvents: buildTimeline });
}

// ---------- the saved state ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// The wrapper `{ schemaVersion, run }` that server/store.ts writes (the same for MVP 1 and MVP II).
const STORE_FILE_VERSION = 1;

/** `value[key]` as a list of objects, or a thrown sentence saying what is wrong. */
function rows(value: Record<string, unknown>, key: string, label = key): Record<string, unknown>[] {
  const list = value[key];
  if (!Array.isArray(list) || !list.every(isRecord)) throw new Error(`${label} is not a list of objects`);
  return list;
}

/**
 * Why a parsed state file cannot be used as the v2 run, or null if it can.
 * It must have every section the server reads, and every place it uses must be in `places`:
 * a run with an unknown place would need a travel time nobody has (DECISIONS pass 47).
 */
export function savedRunProblem(value: unknown, places: Places): string | null {
  try {
    if (!isRecord(value) || !isRecord(value.run)) return 'it does not hold a run';
    if (value.schemaVersion !== STORE_FILE_VERSION) return 'unexpected schemaVersion';
    const run = value.run;
    const scenario = run.scenario;
    if (!isRecord(scenario) || scenario.schemaVersion !== 2) return 'it is not an MVP II run (scenario.schemaVersion is not 2)';
    if (!isText(run.runId) || !isNum(run.version)) return 'the run has no runId or version';
    const clock = run.clock;
    if (!isRecord(clock) || !isText(clock.phase) || typeof clock.playing !== 'boolean' || !isNum(clock.timeMin) || !isNum(clock.speed)) {
      return 'the run has no usable clock';
    }
    if (!isRecord(scenario.settings)) return 'scenario.settings is missing';
    if (!isRecord(run.assignments)) return 'assignments is missing';

    const used = new Set<string>();
    const use = (id: unknown, what: string) => {
      if (!isText(id)) throw new Error(`${what} is missing`);
      used.add(id);
    };
    const useStops = (list: Record<string, unknown>[], what: string) => list.forEach((stop) => use(stop.placeId, `${what} place`));

    for (const b of rows(scenario, 'businesses', 'scenario.businesses')) use(b.id, 'a business ID');
    for (const h of rows(scenario, 'homes', 'scenario.homes')) use(h.id, 'a home ID');
    for (const e of rows(scenario, 'employees', 'scenario.employees')) {
      use(e.businessId, 'an employee\'s business');
      use(e.homeId, 'an employee\'s home');
    }
    for (const s of rows(scenario, 'shipments', 'scenario.shipments')) {
      use(s.originBusinessId, 'a shipment\'s sender');
      use(s.destinationBusinessId, 'a shipment\'s recipient');
    }
    for (const t of rows(run, 'trips')) {
      use(t.originPlaceId, 'a trip\'s origin');
      use(t.destinationPlaceId, 'a trip\'s destination');
    }
    for (const plan of rows(run.assignments, 'plans', 'assignments.plans')) {
      if (plan.relayBusinessId !== undefined) use(plan.relayBusinessId, 'a plan\'s relay business');
      for (const leg of rows(plan, 'legs', 'a plan\'s legs')) {
        if (!Array.isArray(leg.placeIds)) throw new Error('a leg has no placeIds');
        leg.placeIds.forEach((id) => use(id, 'a leg place'));
        useStops(rows(leg, 'stops', 'a leg\'s stops'), 'a stop');
      }
    }
    rows(run.assignments, 'unmatched', 'assignments.unmatched');
    for (const job of rows(run, 'jobs')) {
      if (!isRecord(job.pickup) || !isRecord(job.dropoff)) throw new Error('a job has no pickup or drop-off');
      useStops([job.pickup, job.dropoff], 'a job');
    }
    rows(run, 'notifications');
    rows(run, 'events');

    const unknown = [...used].filter((id) => !Object.hasOwn(places, id)).sort();
    if (unknown.length > 0) {
      const more = unknown.length > 1 ? ` and ${unknown.length - 1} more` : '';
      return `place ${unknown[0]}${more} is not in the travel cache`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

type SavedState = { kind: 'none' } | { kind: 'usable' } | { kind: 'unusable'; problem: string };

function inspectState(statePath: string, places: Places): SavedState {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'none' };
    return { kind: 'unusable', problem: `it cannot be read (${code ?? 'unknown error'})` };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'unusable', problem: 'it is not valid JSON' };
  }
  const problem = savedRunProblem(value, places);
  return problem === null ? { kind: 'usable' } : { kind: 'unusable', problem };
}

/**
 * Moves an unusable state file to <file>.bad-<n> (first free n) and returns the new path, or null if it
 * could not be moved. A rename, not a copy: the generic store must not find the file again, and a second
 * restart must not make a second copy.
 */
function setAside(statePath: string): string | null {
  for (let n = 1; n < 1000; n++) {
    const dest = `${statePath}.bad-${n}`;
    if (fs.existsSync(dest)) continue;
    try {
      fs.renameSync(statePath, dest);
      return dest;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------- boot ----------

export type V2Boot =
  | { status: 'ready'; store: Store<RunV2>; travel: TravelProvider }
  | { status: 'not_loaded'; reason: string };

export type BootV2RunInput = {
  /** The travel data, e.g. `createCachedProvider(files)`; null while there is no travel cache. */
  travel: TravelProvider | null;
  /** `matrix.json` `places`: the geocoded businesses and every home with travel data. */
  places: Places | null;
  /** Folder with businesses.json, neighborhoods.json and demoStory.json (`NYC_FIXTURES_DIR` in the app). */
  fixturesDir: string;
  /** The v2 state file (`DEFAULT_V2_STATE_PATH` in the app). Its folder is created on the first save. */
  statePath: string;
};

const notLoaded = (reason: string): V2Boot => ({ status: 'not_loaded', reason });

/**
 * Builds the default run first, so `ready` always means "the cache holds everything the demo needs",
 * then opens the store on `statePath`. While the result is `not_loaded` the state file is not touched.
 */
export function bootV2Run(input: BootV2RunInput): V2Boot {
  const { travel, places, fixturesDir, statePath } = input;
  if (!travel || !places) return notLoaded(TRAVEL_NOT_LOADED_MESSAGE);

  let initial: RunV2;
  try {
    initial = buildDefaultRun({ travel, places, fixtures: readNycFixtures(fixturesDir) });
  } catch (e) {
    if (e instanceof TravelDataMissingError) return notLoaded(travelErrorBody(e)!.error); // names the pair
    if (e instanceof NycFixtureError) return notLoaded(e.message); // names the file
    return notLoaded(`The default NYC run could not be built: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const saved = inspectState(statePath, places);
    if (saved.kind === 'unusable') {
      const copy = setAside(statePath);
      if (copy === null) {
        return notLoaded(`The v2 state file ${statePath} is unusable (${saved.problem}) and could not be renamed. Move it away and restart.`);
      }
      console.warn(`[v2 boot] ${statePath} is unusable (${saved.problem}); starting from the default NYC run, bad file kept at ${copy}`);
    }
    // The store loads a usable file (paused) and calls `initial` only when there is none.
    return { status: 'ready', store: createStore<RunV2>({ filePath: statePath, initial: () => initial }), travel };
  } catch (e) {
    return notLoaded(`The v2 state file ${statePath} could not be opened: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The deps for `createV2Router`. Add `extraRoutes` by spreading: `{ ...v2DepsFrom(boot), extraRoutes }`. */
export function v2DepsFrom(boot: V2Boot): V2Deps {
  return boot.status === 'ready' ? { travel: boot.travel, store: boot.store } : V2_DEPS_NOT_LOADED;
}
