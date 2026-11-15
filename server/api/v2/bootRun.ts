// The MVP II run boot (DECISIONS pass 49): travel cache + NYC fixture files -> a stored v2 run.
// The server start passes the result to `createV2Router(v2DepsFrom(boot))`.
// - No travel data, or a cache that lacks something the default run needs: `not_loaded` (the API answers
//   503 `travel_data_missing`). Nothing here estimates a travel time, and boot does not throw.
// - A saved v2 state is restored (paused) only if it is a v2 run whose places are all in the cache;
//   an unusable file is renamed to <file>.bad-<n>, never overwritten (MVP 1 behaviour, #184).
// - A usable saved state is restored only if it was built from the same default inputs (DECISIONS pass 55):
//   a fingerprint of the three fixture files and the default request is kept in a sidecar file next to the
//   state file. A missing or different sidecar: the state file is renamed to <file>.stale-<n>, never deleted,
//   and the default run is built from the current files. The boot result then carries a `notice` sentence.
import { createHash } from 'node:crypto';
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
import { DEFAULT_SETTINGS } from '../../domain/pricing';
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

// ---------- the fingerprint of the default inputs ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** JSON with the keys of every object sorted, so key order and whitespace in a file do not matter. List order is kept: it matters to the generator. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 (hex) over everything the default run is defined by: the three parsed fixture files, the
 * default generate request and the default settings (a run saved under other prices or rules is stale: #861
 * added pricing settings an older saved run does not have). The travel cache (`matrix.json`, `polylines.json`) is not part of it: it grows
 * with every live commute save, and a place missing from it is already caught by `savedRunProblem`.
 */
export function defaultRunFingerprint(fixtures: NycFixtures, request: GenerateScenarioRequest): string {
  const inputs = {
    businesses: fixtures.businessesFile,
    neighborhoods: fixtures.neighborhoodsFile,
    story: fixtures.storyFile,
    request,
    settings: DEFAULT_SETTINGS,
  };
  return createHash('sha256').update(stableJson(inputs)).digest('hex');
}

const SOURCE_FILE_VERSION = 1;

/** The sidecar file of a state file: `data/state-v2.source.json` for `data/state-v2.json`. */
export function sourcePathFor(statePath: string): string {
  return `${statePath.endsWith('.json') ? statePath.slice(0, -'.json'.length) : statePath}.source.json`;
}

/** The fingerprint in the sidecar file, or null if the file is missing, unreadable or not a sidecar. */
function readSourceFingerprint(sourcePath: string): string | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (!isRecord(value) || value.schemaVersion !== SOURCE_FILE_VERSION || !isText(value.fingerprint)) return null;
    return value.fingerprint;
  } catch {
    return null;
  }
}

/** Through a temp file and a rename, so a crash never leaves half a sidecar. Creates the folder if needed. */
function writeSourceFingerprint(sourcePath: string, fingerprint: string): void {
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  const tmp = `${sourcePath}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ schemaVersion: SOURCE_FILE_VERSION, fingerprint }, null, 2)}\n`);
    fs.renameSync(tmp, sourcePath);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** A path as the log shows it: relative to the repo root when it is inside the repo (`data/state-v2.json`). */
function shown(file: string): string {
  const relative = path.relative(repoRoot, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

// ---------- the saved state ----------

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
 * Moves a state file to <file>.<kind>-<n> (first free n) and returns the new path, or null if it could not
 * be moved. `bad`: an unusable file. `stale`: a usable run built from other default inputs.
 * A rename, not a copy: the generic store must not find the file again, and a second restart must not make
 * a second copy. An existing name is never reused, so nothing is overwritten.
 */
function setAside(statePath: string, kind: 'bad' | 'stale'): string | null {
  for (let n = 1; n < 1000; n++) {
    const dest = `${statePath}.${kind}-${n}`;
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
  | {
      status: 'ready';
      store: Store<RunV2>;
      travel: TravelProvider;
      /**
       * One sentence for the server log, only when a saved run was set aside as stale and the default run was
       * built in its place. It names paths only: never a key, never file contents.
       */
      notice?: string;
    }
  | { status: 'not_loaded'; reason: string };

export type BootV2RunInput = {
  /** The travel data, e.g. `createCachedProvider(files)`; null while there is no travel cache. */
  travel: TravelProvider | null;
  /** `matrix.json` `places`: the geocoded businesses and every home with travel data. */
  places: Places | null;
  /** Folder with businesses.json, neighborhoods.json and demoStory.json (`NYC_FIXTURES_DIR` in the app). */
  fixturesDir: string;
  /**
   * The v2 state file (`DEFAULT_V2_STATE_PATH` in the app), written on the first save. A ready boot writes
   * its sidecar (`sourcePathFor(statePath)`) and creates the folder for it.
   */
  statePath: string;
};

const notLoaded = (reason: string): V2Boot => ({ status: 'not_loaded', reason });

/**
 * Builds the default run first, so `ready` always means "the cache holds everything the demo needs",
 * then opens the store on `statePath`. While the result is `not_loaded` neither the state file nor its
 * sidecar is touched.
 */
export function bootV2Run(input: BootV2RunInput): V2Boot {
  const { travel, places, fixturesDir, statePath } = input;
  if (!travel || !places) return notLoaded(TRAVEL_NOT_LOADED_MESSAGE);

  let initial: RunV2;
  let fingerprint: string;
  try {
    const fixtures = readNycFixtures(fixturesDir);
    initial = buildDefaultRun({ travel, places, fixtures });
    fingerprint = defaultRunFingerprint(fixtures, DEFAULT_RUN_REQUEST);
  } catch (e) {
    if (e instanceof TravelDataMissingError) return notLoaded(travelErrorBody(e)!.error); // names the pair
    if (e instanceof NycFixtureError) return notLoaded(e.message); // names the file
    return notLoaded(`The default NYC run could not be built: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const sourcePath = sourcePathFor(statePath);
    const savedFingerprint = readSourceFingerprint(sourcePath);
    const saved = inspectState(statePath, places);
    let notice: string | undefined;
    if (saved.kind === 'unusable') {
      const copy = setAside(statePath, 'bad');
      if (copy === null) {
        return notLoaded(`The v2 state file ${statePath} is unusable (${saved.problem}) and could not be renamed. Move it away and restart.`);
      }
      console.warn(`[v2 boot] ${statePath} is unusable (${saved.problem}); starting from the default NYC run, bad file kept at ${copy}`);
    } else if (saved.kind === 'usable' && savedFingerprint !== fingerprint) {
      // A good run, but built from other default inputs (or nobody recorded which): keep it, do not show it.
      const copy = setAside(statePath, 'stale');
      if (copy === null) {
        return notLoaded(`The v2 state file ${statePath} was saved from other NYC story files and could not be renamed. Move it away and restart.`);
      }
      const why = savedFingerprint === null
        ? `${shown(statePath)} has no record of the NYC story files it was saved from (${shown(sourcePath)} is missing or unreadable).`
        : `The NYC story files, the default detour limit or the default prices changed since ${shown(statePath)} was saved.`;
      notice = `${why} Started from the new default run; the old run is kept as ${shown(copy)}.`;
    }
    // After the set-aside, so a crash in between leaves no state file and an old sidecar: the next boot
    // builds the default run. Not rewritten when it already holds this fingerprint.
    if (savedFingerprint !== fingerprint) {
      try {
        writeSourceFingerprint(sourcePath, fingerprint);
      } catch (e) {
        // The run still works. Without the sidecar the next restart sets a saved run aside as stale: kept, not shown.
        console.warn(`[v2 boot] ${sourcePath} could not be written (${(e as NodeJS.ErrnoException).code ?? 'unknown error'}); a run saved now will be set aside at the next restart`);
      }
    }
    // The store loads a usable file (paused) and calls `initial` only when there is none.
    const store = createStore<RunV2>({ filePath: statePath, initial: () => initial });
    return notice === undefined ? { status: 'ready', store, travel } : { status: 'ready', store, travel, notice };
  } catch (e) {
    return notLoaded(`The v2 state file ${statePath} could not be opened: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The deps for `createV2Router`. Add `extraRoutes` by spreading: `{ ...v2DepsFrom(boot), extraRoutes }`. */
export function v2DepsFrom(boot: V2Boot): V2Deps {
  return boot.status === 'ready' ? { travel: boot.travel, store: boot.store } : V2_DEPS_NOT_LOADED;
}
