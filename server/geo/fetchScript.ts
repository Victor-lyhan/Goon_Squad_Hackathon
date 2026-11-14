// `npm run fetch:routes` without the three lines that touch `process`: scripts/fetch-routes.ts passes the real
// arguments in and sets the exit code from what `runFetchScript` returns.
// This file reads `.env`, reads the three hand-written files of `fixtures/nyc/`, reads and writes the travel cache
// there (`matrix.json`, `polylines.json`) and prints. The fetch itself is server/geo/fetchRoutes.ts.
// Rules it keeps (SPEC "MVP II" rules 2-3, DECISIONS pass 46 and 48):
// - nothing is printed except through `out`, and every line is scrubbed of anything that looks like a key and
//   of the key itself; the key is never part of a message. The same wrapper takes the ID of an entered home out
//   of every line (`hideEntered`), on every path and for every flag: a cache reader error quotes the entry it
//   could not read, and such an ID is an address (SPEC "MVP II" rule 6);
// - `--dry-run` calls nothing, writes nothing and needs no key;
// - every paid step is on disk before the next one starts;
// - a place that moved is never patched (DECISIONS pass 50): `--refetch <placeId>` drops it with all its pairs and
//   route lines and saves that before the first Google call. A home that is not where its cached point is stops a
//   run before any Google call, because every time fetched for the old point would be a stale one;
// - the plan check and the cache report only report: no number is changed, estimated or filled in;
// - `--check-key` is the three calls of server/geo/keyCheck.ts and nothing else: no cache file is read or written.
//   A run points at it when Google refuses the first request to an API, and stops there (DECISIONS pass 51 and 52);
// - a home typed into the commute editor has its coordinates as its ID (`home-c-<lat>_<lng>`), and the live server
//   writes it into the cache, which is a committed file. `--drop-entered` removes those homes with all their pairs
//   and route lines: no key, no `.env`, no Google call, and no line it prints holds an ID (SPEC "MVP II" rule 6).
//   A run and a dry run say how many of them the cache holds, with that command, before their last line;
// - a story row that is not as written and a package without a plan are explained, in a run and in a dry run:
//   the matcher's own options for that package (server/domain/v2/storyExplain.ts), from the cache alone. The
//   explanation only reports: it changes no plan and no exit code;
// - exit 0 means "complete and no error flagged", so a human can commit `fixtures/nyc/` after reading the reports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AssignmentResult, Home, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario, Trip } from '../../shared/v2/types';
import { generateHomePool } from '../domain/v2/generator';
import type { MatchContext } from '../domain/v2/matching';
import { checkPlans, checkStory, formatCheckReport } from '../domain/v2/planCheck';
import type { StoryExpectation, StoryRow } from '../domain/v2/planCheck';
import { explainShipment, formatExplain } from '../domain/v2/storyExplain';
import type { ExplainRow } from '../domain/v2/storyExplain';
import { MATRIX_FILE, POLYLINES_FILE, emptyTravelFiles, readTravelFiles, writeTravelFiles } from './cache';
import type { TravelFiles } from './cache';
import { ENTERED_HOME_PREFIX, dropEnteredHomes, dropPlaces, enteredHomes, formatCacheEdit, formatEnteredDrop, hideEnteredIds, movedHomes } from './cacheEdit';
import type { CacheEditResult, MovedHome } from './cacheEdit';
import { coverage, formatCacheReport, sanity } from './cacheReport';
import { DEFAULT_ENV_PATH, SERVER_KEY_NAME, loadDotEnv, serverKey } from './env';
import { commutePairs, planLegPairs } from './fetchPlan';
import { estimateFetch, formatEstimate, matchDefaultScenario, runFetchRoutes } from './fetchRoutes';
import type { FetchEstimate, FetchRoutesInput, FetchRoutesResult, MatchOutcome, SkippedStep } from './fetchRoutes';
import { FetchStopError, bindGoogleClient, formatSummary, scrubKeys } from './fetchRunner';
import type { FetchClient } from './fetchRunner';
import { GoogleApiError } from './googleClient';
import type { LatLng } from './googleClient';
import { checkGoogleAccess, failedRow, formatKeyCheck, keyCheckPassed } from './keyCheck';
import type { KeyCheckApi, KeyCheckProblem, KeyCheckRow } from './keyCheck';
import { createCachedProvider } from './providers';

/** `<repo root>/fixtures/nyc`, resolved from this file so it does not depend on the working directory. */
export const DEFAULT_FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');

export const BUSINESSES_FILE = 'businesses.json';
export const NEIGHBORHOODS_FILE = 'neighborhoods.json';
export const STORY_FILE = 'demoStory.json';

export const EXIT_OK = 0;
/** Not complete, or complete with something flagged. The last printed line says what to do. */
export const EXIT_INCOMPLETE = 1;
/** The command line was wrong. Nothing was read, called or written. */
export const EXIT_USAGE = 2;

export const RESUME_LINE = 'Run again to resume.';
export const CHECK_LINE = 'Check the flagged rows above.';

/** Printed before RESUME_LINE when the run that stopped had `--refetch`: the drop is done, so the next run is a plain one. */
export const RESUME_WITHOUT_REFETCH_LINE =
  'Leave --refetch out when you run again: those places are already dropped, and a plain run fetches what is missing.';

/** The last line of a run that Google refused. The check tells all three APIs apart; the run saw only one call. */
export const CHECK_KEY_LINE = 'Run `npm run fetch:routes -- --check-key` to see which setting is wrong.';

/** The free command that removes the homes typed into the commute editor. Also named by the guard test on the committed cache. */
export const DROP_ENTERED_COMMAND = 'npm run fetch:routes -- --drop-entered';

/**
 * What the drop means for a saved run: the server keeps a saved NYC run only when every place of it is in the
 * cache; otherwise it sets the state file aside (it is never deleted) and builds the default run (DECISIONS pass 49).
 */
export const DROP_ENTERED_RUN_NOTE = 'A saved NYC run that uses one of them starts fresh after the drop (the server sets its state file aside, it does not delete it).';

/** How many options of one package the explanation prints, best first. One more line says how many are left out. */
export const EXPLAIN_OPTIONS = 8;
/**
 * Of those, the places kept for the kind the story row expects. Without them "expected direct, got relay" could
 * print eight relays that work and not one direct option, which is the one the reader asks about.
 */
export const EXPLAIN_EXPECTED_KIND_OPTIONS = 3;

/** The first line of the explanation in a dry run, which prints no plan check above it. */
export const DRY_RUN_STORY_LINE = "Story check: the matcher's plans for the default scenario on the cached times (no Google call was made)";

/**
 * The two points of the check's 1x1 matrix and route line: Midtown Manhattan (near 5th Avenue and 34th Street)
 * and Downtown Brooklyn (near Borough Hall). They are only asked about. Nothing Google says about them is cached
 * or shown on a map, so they need not be exact: Google snaps each to the nearest road.
 */
export const KEY_CHECK_FROM: LatLng = { lat: 40.7484, lng: -73.9857 };
export const KEY_CHECK_TO: LatLng = { lat: 40.6928, lng: -73.9903 };

export const KEY_CHECK_HEADER =
  `Google access check: three billable calls with the key in ${SERVER_KEY_NAME} ` +
  '(one geocode, one 1x1 route matrix, one route line). Nothing is written.';

export const USAGE: readonly string[] = [
  'Usage: npm run fetch:routes -- [--dry-run] [--refetch <placeId>]... [--help]',
  '       npm run fetch:routes -- --check-key',
  '       npm run fetch:routes -- --drop-entered [--dry-run]',
  '',
  'Fills fixtures/nyc/matrix.json and fixtures/nyc/polylines.json from Google, in four steps:',
  '  1. geocodes the businesses of businesses.json;',
  '  2. fetches the travel time and distance between every business and every home;',
  '  3. builds the default scenario and runs the matcher on those times;',
  '  4. fetches the route lines of the baseline commutes and of the matched plans.',
  'Then it prints the fetch summary, the plan check and the travel cache report.',
  'For every story package that did not match as demoStory.json expects, and for every package without a plan,',
  `the plan check lists the package's options (at most ${EXPLAIN_OPTIONS}): each direct and relay option with the carrier's added`,
  'minutes and limit, and for an option that is ruled out the first rule that ruled it out.',
  '',
  'Flags:',
  '  --dry-run   Show how many Google requests a run would make, and list the homes that moved since their travel',
  '              times were fetched, with the command that fixes it. Calls nothing, writes nothing, needs no key.',
  '              Also says how many entered homes the cache holds (see --drop-entered), when there is one, and',
  '              explains the story packages that are not as written, when the cache can answer the matcher.',
  '  --refetch <placeId>',
  '              For a home that moved or a business whose address was corrected after the fetch. Drops the place',
  '              from the cache with all its pairs and route lines, saves that, then runs the normal fetch, which',
  '              refills only what is missing. Repeatable; --refetch=a,b works too. A place ID that is not in the',
  '              cache changes nothing and exits 1. With --dry-run: shows the estimate as it would be after the',
  '              drop and writes nothing.',
  '  --check-key',
  '              Checks the key before a paid run, with three small Google calls: one geocode (the first address of',
  '              businesses.json), one 1x1 route matrix and one route line between two fixed points in New York.',
  '              Prints one row per API: ok, or what is wrong and the Google Cloud setting to change. Costs three',
  '              billable calls. Reads no cache file, writes nothing and fetches nothing else. Used alone, without',
  '              --dry-run or --refetch. Exits 0 when all three calls worked, 1 when one did not or no key is set.',
  '  --drop-entered',
  '              Removes every home that was typed into the commute editor (place IDs that start with home-c-) from',
  '              the cache, with all its pairs and route lines. Such an ID holds the coordinates of the address, so',
  '              it must not be committed: run this before you commit fixtures/nyc. Free: needs no key, reads no',
  '              .env and makes no Google call. Prints how many places, pairs and route lines it removed, never an',
  '              ID. A saved NYC run that uses one of these homes starts fresh afterwards. Stop the server first: a',
  '              running one still holds them in memory and writes them back with its next live answer. With',
  '              --dry-run: shows the counts and writes nothing. Not with --refetch or --check-key. Exits 0, also',
  '              when there is nothing to drop, and 1 when the cache cannot be read or saved.',
  '  --help      Show this text.',
  '',
  `The key is read from ${SERVER_KEY_NAME}, in the environment or in .env at the repo root. It is never printed.`,
  'When the cache holds homes typed into the commute editor, a run says how many before its last lines, with the',
  '--drop-entered command: remove them before you commit.',
  'Re-running is safe: whatever is already in the two cache files is skipped, and every step is saved before the',
  'next one starts, so a run that stopped half way resumes where it was.',
  'A run never drops a place by itself. When a home is no longer where its cached point is, the run stops before',
  'any Google call, lists those homes and prints the --refetch command for them.',
  'When Google refuses the first request a run makes to an API (the API is not enabled, the key is restricted,',
  'billing is off), the run stops there, prints that row and points at --check-key. What was fetched is saved.',
  '',
  'Exit codes: 0 = complete and no error flagged (warnings do not count); 1 = not complete, or an error flagged',
  '(the last line says what to do); 2 = wrong usage.',
];

// ---------- the command line ----------

export interface FetchScriptOptions {
  dryRun: boolean;
  help: boolean;
  /** The place IDs of every `--refetch`, each once, in the order given. Empty for a plain run. */
  refetch: string[];
  /** `--check-key`: only the three-call Google access check. Never together with `dryRun` or `refetch`. */
  checkKey: boolean;
  /** `--drop-entered`: only the drop of the commute-editor homes. Never together with `refetch` or `checkKey`. */
  dropEntered: boolean;
}

export type ParsedArgs = { ok: true; options: FetchScriptOptions } | { ok: false; problem: string };

/** The flags, one line each. `set` returns true when the value was usable. */
const FLAGS: Record<string, { takesValue: boolean; set: (options: FetchScriptOptions, value: string) => boolean }> = {
  '--dry-run': { takesValue: false, set: (options) => (options.dryRun = true) },
  '--check-key': { takesValue: false, set: (options) => (options.checkKey = true) },
  '--drop-entered': { takesValue: false, set: (options) => (options.dropEntered = true) },
  '--help': { takesValue: false, set: (options) => (options.help = true) },
  '-h': { takesValue: false, set: (options) => (options.help = true) },
  // `--refetch a --refetch b` and `--refetch=a,b` mean the same. An empty ID between commas is a typing mistake.
  '--refetch': {
    takesValue: true,
    set: (options, value) => {
      const ids = value.split(',').map((id) => id.trim());
      if (ids.some((id) => id === '' || id.startsWith('-'))) return false;
      for (const id of ids) if (!options.refetch.includes(id)) options.refetch.push(id);
      return true;
    },
  },
};

/**
 * `argv` is what follows the script name (`process.argv.slice(2)`).
 * A wrong argument is echoed only when it looks like a flag name: a key pasted on the command line is not repeated.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: FetchScriptOptions = { dryRun: false, help: false, refetch: [], checkKey: false, dropEntered: false };
  const shown = (name: string) => (/^--?[a-z][a-z-]{0,30}$/.test(name) ? ` ${name}` : '');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const cut = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = cut === -1 ? arg : arg.slice(0, cut);
    if (!arg.startsWith('-')) return { ok: false, problem: 'Unexpected argument: this command takes only flags.' };
    if (!Object.hasOwn(FLAGS, name)) return { ok: false, problem: `Unknown flag${shown(name)}.` };
    const flag = FLAGS[name];
    if (!flag.takesValue) {
      if (cut !== -1) return { ok: false, problem: `${name} takes no value.` };
      flag.set(options, '');
      continue;
    }
    const value = cut !== -1 ? arg.slice(cut + 1) : argv[++i];
    if (value === undefined || value === '' || value.startsWith('-') || !flag.set(options, value)) {
      return { ok: false, problem: `${name} needs a value.` };
    }
  }
  if (options.help && argv.length > 1) return { ok: false, problem: '--help is used alone.' };
  if (options.checkKey && options.dryRun) {
    return { ok: false, problem: '--check-key cannot be used with --dry-run: the check is three Google calls, and a dry run makes none.' };
  }
  if (options.checkKey && options.refetch.length > 0) {
    return { ok: false, problem: '--check-key cannot be used with --refetch: the check writes nothing, and --refetch changes the cache.' };
  }
  if (options.dropEntered && options.checkKey) {
    return { ok: false, problem: '--drop-entered cannot be used with --check-key: the drop makes no Google call, and the check is three of them.' };
  }
  if (options.dropEntered && options.refetch.length > 0) {
    return {
      ok: false,
      problem: '--drop-entered cannot be used with --refetch: the drop makes no Google call, and --refetch fetches from Google. Run them one after the other.',
    };
  }
  return { ok: true, options };
}

// ---------- the three hand-written fixture files ----------

// shared/v2 types these files (NycBusinessesFile, NycNeighborhoodsFile, NycDemoStoryFile) but has no Zod schema
// for them, so the shape is checked here against those types: the fields the generator, the matcher and the
// reports read. Extra fields are allowed and kept.
const text = z.string().min(1);
const num = z.number(); // finite: Zod refuses NaN and Infinity
const borough = z.enum(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);

const BusinessesFileSchema = z.object({
  businesses: z
    .array(z.object({ id: text, name: text, address: text, neighborhood: text, borough, kind: z.enum(['office', 'shop', 'cafe']) }))
    .min(2),
});
const NeighborhoodsFileSchema = z.object({
  neighborhoods: z
    .array(z.object({ id: text, name: text, borough, bbox: z.object({ south: num, west: num, north: num, east: num }) }))
    .min(1),
});
const StoryFileSchema = z.object({
  featuredEmployees: z.array(
    z.object({
      id: text,
      name: text,
      businessId: text,
      home: z.object({ id: text, neighborhood: text, lat: num, lng: num }),
      eveningDepartureMin: num,
      morningDepartureMin: num,
      maxExtraMin: num,
      availableEvening: z.boolean(),
      availableMorning: z.boolean(),
    }),
  ),
  shipments: z.array(
    z.object({
      label: z.string(),
      description: z.string(),
      category: z.enum(['envelope', 'small_box']),
      weightGrams: num,
      originBusinessId: text,
      destinationBusinessId: text,
      readyMin: num,
      deadlineMin: num,
      pickupInstructions: z.string(),
      dropoffInstructions: z.string(),
      expect: z.enum(['direct', 'relay', 'any']),
    }),
  ),
});

// A schema that drifts from the shared type stops compiling here.
type Covers<Parsed, _Contract extends Parsed> = true;
type _Checks = [
  Covers<z.infer<typeof BusinessesFileSchema>, NycBusinessesFile>,
  Covers<z.infer<typeof NeighborhoodsFileSchema>, NycNeighborhoodsFile>,
  Covers<z.infer<typeof StoryFileSchema>, NycDemoStoryFile>,
];

/** A fixture file that is missing, is not JSON or does not have the shape the fetch reads. The message names the file. */
class FixtureFileError extends Error {}

function readFixtureFile<T>(dir: string, name: string, schema: z.ZodType): T {
  const file = shownPath(path.join(dir, name));
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(dir, name), 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new FixtureFileError(`${file} ${code === 'ENOENT' || code === 'ENOTDIR' ? 'is missing' : `cannot be read (${code ?? 'unknown error'})`}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new FixtureFileError(`${file} is not valid JSON.`);
  }
  const checked = schema.safeParse(value);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue.path.length > 0 ? issue.path.join('.') : 'the top level';
    throw new FixtureFileError(`${file} does not have the expected shape at ${where} (${oneLine(issue.message)}).`);
  }
  return value as T; // the file as written, so the fetch and the app's generator read the same thing
}

/**
 * The one link between the files that the shapes cannot show: every business the story names must be in
 * businesses.json. Without this the run would pay for the matrix first and only then skip the matcher.
 */
function checkStoryBusinesses(dir: string, businessesFile: NycBusinessesFile, storyFile: NycDemoStoryFile): void {
  const known = new Set(businessesFile.businesses.map((business) => business.id));
  const named: [string, string][] = [
    ...storyFile.featuredEmployees.map((employee, index): [string, string] => [`featuredEmployees.${index}.businessId`, employee.businessId]),
    ...storyFile.shipments.flatMap((shipment, index): [string, string][] => [
      [`shipments.${index}.originBusinessId`, shipment.originBusinessId],
      [`shipments.${index}.destinationBusinessId`, shipment.destinationBusinessId],
    ]),
  ];
  const wrong = named.find(([, id]) => !known.has(id));
  if (wrong) {
    throw new FixtureFileError(`${shownPath(path.join(dir, STORY_FILE))} names a business at ${wrong[0]} that is not in ${BUSINESSES_FILE}.`);
  }
}

// ---------- small helpers ----------

/** A path the way a human would type it: relative when it is inside the working directory, else absolute. */
function shownPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative === '' || relative.startsWith('..') || path.isAbsolute(relative) ? target : relative;
}

const oneLine = (message: string) => message.replace(/\s+/g, ' ').trim();

/** Only an Error's message is used: any other thrown value could hold a request, and so a key. */
const messageOf = (err: unknown) => (err instanceof Error && err.message !== '' ? oneLine(err.message) : 'unknown error');

const count = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The 120-home pool plus the story's featured homes, each ID once: what the fetch caches against every business. */
function fetchedHomes(input: Pick<FetchRoutesInput, 'neighborhoodsFile' | 'storyFile'>): Home[] {
  const byId = new Map<string, Home>();
  for (const home of generateHomePool(input.neighborhoodsFile.neighborhoods)) byId.set(home.id, home);
  for (const { home } of input.storyFile.featuredEmployees) if (!byId.has(home.id)) byId.set(home.id, home);
  return [...byId.values()];
}

// ---------- places that moved after the fetch ----------

/** A place ID as one shell word. The IDs of the fixtures need no quotes; anything else gets single quotes. */
const shellWord = (id: string) => (/^[\w.-]+$/.test(id) ? id : `'${id.replace(/'/g, `'\\''`)}'`);

/** The exact command that drops these places and fetches them again: each ID once, in code-unit order. */
export function refetchCommand(placeIds: readonly string[]): string {
  return `npm run fetch:routes --${[...new Set(placeIds)].sort().map((id) => ` --refetch ${shellWord(id)}`).join('')}`;
}

const movedDistance = (movedM: number) => (movedM < 1 ? 'less than 1 m' : `${Math.round(movedM)} m`);

/**
 * The homes whose cached point is not the fixtures' point, and the command that fixes it. A dry run and a real
 * run print the same lines. Only IDs and distances: no coordinates.
 * `alsoRefetch` holds the IDs of this command line's own `--refetch`, so the printed command does both.
 */
function movedHomeLines(moved: readonly MovedHome[], alsoRefetch: readonly string[]): string[] {
  if (moved.length === 0) return ['Moved homes: none (every cached home is where the fixtures put it).'];
  return [
    `Moved homes: ${moved.length} (the fixtures no longer have ${moved.length === 1 ? 'it' : 'them'} where the cached travel times were fetched for)`,
    ...moved.map(({ id, movedM }) => `  - ${id}: moved ${movedDistance(movedM)}`),
    `To drop ${moved.length === 1 ? 'it' : 'them'} and fetch only what is then missing, run:`,
    `  ${refetchCommand([...alsoRefetch, ...moved.map((home) => home.id)])}`,
  ];
}

// ---------- homes entered in the commute editor ----------

/** What `hideEnteredIds` leaves in the place of an ID. */
const HIDDEN_ENTERED_ID = hideEnteredIds(ENTERED_HOME_PREFIX);

/**
 * `line` without entered-home IDs: `hideEnteredIds` for every `home-c-` in it. Used by the print wrapper of
 * `runFetchScript` and nowhere else, so no path can print an ID.
 * One thing stays as written: the prefix with nothing of an ID after it, which is how the usage text names these
 * homes ("place IDs that start with home-c-"). It holds no coordinates, and `hideEnteredIds` would turn it into
 * "home-c (entered address)". Whatever follows such a prefix is what `hideEnteredIds` leaves there too, so this
 * hides exactly as much as that function does.
 */
export function hideEntered(line: string): string {
  const [start, ...rest] = line.split(ENTERED_HOME_PREFIX);
  const parts = rest.map((after) => {
    const hidden = hideEnteredIds(ENTERED_HOME_PREFIX + after);
    // Equal when nothing after the prefix was taken as part of an ID: the prefix stood alone.
    return hidden === HIDDEN_ENTERED_ID + after ? ENTERED_HOME_PREFIX + after : hidden;
  });
  return start + parts.join('');
}

/**
 * The one line a run and a dry run add when the cache holds entered homes: a run before its `Done:` or
 * `NOT complete:` lines, because the first of them tells the human to commit. A count and the command: never an ID.
 */
function enteredHomesLine(entered: number): string {
  return (
    `Entered homes: ${entered} (${entered === 1 ? 'an address' : 'addresses'} typed into the commute editor; ` +
    `${entered === 1 ? 'its ID holds its' : 'their IDs hold their'} coordinates, so do not commit the cache with ${entered === 1 ? 'it' : 'them'}). ` +
    `Free to remove: ${DROP_ENTERED_COMMAND}. ${DROP_ENTERED_RUN_NOTE}`
  );
}

/**
 * `--drop-entered`, the whole command: read the two cache files, drop the entered homes, save. It reads no
 * fixture file, no `.env` and no key, and builds no client, so a broken story file or a missing key does not
 * stand in the way of taking addresses out of the cache.
 * A reader error quotes the entry it could not read: `print` (the wrapper of `runFetchScript`) hides the ID.
 * Exit 0: dropped and saved, or nothing to drop (then nothing is written). Exit 1: the cache could not be read or saved.
 */
function runDropEntered(dir: string, dryRun: boolean, print: (line: string) => void): number {
  const untouched = 'Nothing was dropped or written.';

  let cached: TravelFiles | null;
  try {
    cached = readTravelFiles(dir);
  } catch (err) {
    print(`Cannot start: ${messageOf(err)} ${untouched}`);
    return EXIT_INCOMPLETE;
  }
  if (cached === null) {
    // Route lines without a matrix cannot be read through the cache reader, so "none" would be a guess.
    if (fs.existsSync(path.join(dir, POLYLINES_FILE))) {
      print(
        `Cannot start: ${shownPath(path.join(dir, POLYLINES_FILE))} exists but ${MATRIX_FILE} does not, so its route lines cannot be checked. ` +
          `Restore ${MATRIX_FILE} or delete ${POLYLINES_FILE}, then run again. ${untouched}`,
      );
      return EXIT_INCOMPLETE;
    }
    print(`Entered homes: none. There is no travel cache in ${shownPath(dir)}. ${untouched}`);
    return EXIT_OK;
  }

  const edit = dropEnteredHomes(cached);
  if (edit.dropped.length === 0) {
    print(`Entered homes: none in the travel cache (${shownPath(dir)}). ${untouched}`);
    return EXIT_OK;
  }
  if (dryRun) {
    print(formatEnteredDrop(edit, 'Would drop'));
    print(`${DROP_ENTERED_RUN_NOTE} Nothing was written. Cache folder: ${shownPath(dir)}`);
    return EXIT_OK;
  }
  try {
    // The existing atomic save: polylines.json first, matrix.json last, so a save that fails half way leaves
    // the homes in the matrix and the same command drops them again.
    writeTravelFiles(dir, edit.files);
  } catch (err) {
    print(`Stopped: ${messageOf(err)}`);
    print('The drop may be half saved: fix the problem above, then run the same command again.');
    return EXIT_INCOMPLETE;
  }
  print(formatEnteredDrop(edit));
  print(`The drop is saved in ${shownPath(dir)}. No Google call was made, and nothing has to be fetched again.`);
  print(`${DROP_ENTERED_RUN_NOTE} If the server is running, restart it: it still holds these homes in memory and writes them back with its next live answer.`);
  return EXIT_OK;
}

// ---------- a run that Google refuses ----------

/** The problems of keyCheck.ts that mean "Google refuses this key for this API". Each has one setting to change. */
const ACCESS_PROBLEMS: ReadonlySet<KeyCheckProblem> = new Set<KeyCheckProblem>(['key_invalid', 'api_not_enabled', 'billing_off', 'key_restricted']);
/** Google's statuses for a refused call. They say that access was refused, not why. */
const DENIED_STATUSES = new Set(['REQUEST_DENIED', 'PERMISSION_DENIED', 'UNAUTHENTICATED']);

/**
 * The key-check row of a failed call when the failure is an access error, else null (a quota, a dead network, a
 * server error or "no route" are left to the run, which retries and resumes).
 * A refusal whose message names no cause is still a refusal: its row says `unknown` with Google's status
 * (DECISIONS pass 51), never a guessed cause.
 */
function accessRefusal(api: KeyCheckApi, err: unknown): KeyCheckRow | null {
  const row = failedRow(api, err);
  if (ACCESS_PROBLEMS.has(row.problem)) return row;
  const denied =
    err instanceof GoogleApiError && (err.status === 401 || err.status === 403 || (err.googleStatus !== null && DENIED_STATUSES.has(err.googleStatus)));
  return row.problem === 'unknown' && denied ? row : null;
}

/** Ends the run (fetchRunner.ts lets a FetchStopError through). `row` is what the command prints. */
class AccessRefusedError extends FetchStopError {
  constructor(readonly row: KeyCheckRow) {
    super('Google refused the request');
    this.name = 'AccessRefusedError';
  }
}

/**
 * The client of a run. It makes the same calls, but when the first call to one of the three (geocode, route
 * matrix, route line) fails with an access error it throws AccessRefusedError, which stops the run before the
 * next request. Every later request to that API would be refused the same way: for the matrix alone that is three
 * failed requests, each retried, before the step gives up.
 * Only the first call of each kind: once a call has worked, a failure is a matter for the run's own retry rules.
 */
function stopWhenRefused(client: FetchClient): FetchClient {
  const called = new Set<KeyCheckApi>();
  const guard = async <T>(api: KeyCheckApi, call: () => Promise<T>): Promise<T> => {
    const first = !called.has(api);
    called.add(api);
    try {
      return await call();
    } catch (err) {
      const row = first ? accessRefusal(api, err) : null;
      if (row === null) throw err;
      throw new AccessRefusedError(row);
    }
  };
  return {
    geocodeAddress: (address) => guard('geocoding', () => client.geocodeAddress(address)),
    computeRouteMatrix: (origins, destinations) => guard('route_matrix', () => client.computeRouteMatrix(origins, destinations)),
    computeRoutePolyline: (origin, destination) => guard('routes', () => client.computeRoutePolyline(origin, destination)),
  };
}

const STEP_NAMES: Record<SkippedStep['step'], string> = {
  match: 'default scenario and matcher',
  polylines: 'route lines',
};

// ---------- why a story row is not as written ----------

/** The matcher's result and the cache it ran on: step 3 of a run, or `matchDefaultScenario` in a dry run. */
interface Matched {
  scenario: Scenario;
  trips: Trip[];
  assignments: AssignmentResult;
  files: TravelFiles;
}

/** The story file's rows against the matcher's result. */
function storyRows(storyFile: NycDemoStoryFile, { scenario, assignments }: Matched): StoryRow[] {
  // The generator gives the story's shipments their IDs in file order, so row i of the file is shipment i.
  const expectations: StoryExpectation[] = storyFile.shipments.map((shipment, index) => ({
    shipmentId: scenario.shipments[index]?.id ?? `(no shipment for story row ${index + 1})`,
    label: shipment.label,
    expect: shipment.expect,
  }));
  return checkStory(expectations, assignments);
}

/**
 * The options to print, in the explainer's own order: the feasible ones as the matcher ranks them, then the ruled-out
 * ones, nearest miss first. At most EXPLAIN_OPTIONS; when the story expects a kind, its EXPLAIN_EXPECTED_KIND_OPTIONS
 * best options are among them even if that many others rank higher.
 */
function bestOptions(options: readonly ExplainRow[], expect: StoryExpectation['expect']): ExplainRow[] {
  const miss = (row: ExplainRow) => row.missMin ?? Infinity;
  const ordered = [
    ...options.filter((row) => row.feasible),
    ...options.filter((row) => !row.feasible).sort((a, b) => (miss(a) === miss(b) ? 0 : miss(a) - miss(b))),
  ];
  const expected = (row: ExplainRow) => expect !== 'any' && (row.kind === 'relay') === (expect === 'relay');
  const kept = new Set(ordered.filter(expected).slice(0, EXPLAIN_EXPECTED_KIND_OPTIONS));
  for (const row of ordered) {
    if (kept.size >= EXPLAIN_OPTIONS) break;
    kept.add(row);
  }
  return ordered.filter((row) => kept.has(row));
}

/**
 * Why the story is not as written: for every story row that is not ok and every other package without a plan, one
 * line with the package and then the explainer's lines for its best options (indented), and one line with how many
 * options are left out. Empty when every story row is as written and every package has a plan.
 *
 * The explainer looks at one package alone. A package can also lose an option to another package: the matcher gives
 * a commute to one package only. So a feasible option says when one of its commutes carries another package in the
 * matcher's result, and which option is the plan the package got.
 * The lines hold names, minutes and times of day: no place ID, no coordinates (an error message may quote an ID;
 * the print wrapper hides it). Nothing here changes a plan.
 */
function explainStory(matched: Matched, rows: readonly StoryRow[]): string[] {
  const { scenario, trips, assignments, files } = matched;
  const failed = rows.filter((row) => !row.ok);
  const inStory = new Set(failed.map((row) => row.shipmentId));
  const labels = new Map(scenario.shipments.map((shipment) => [shipment.id, shipment.label]));
  const others = assignments.unmatched.filter((entry) => !inStory.has(entry.shipmentId));
  const subjects: { shipmentId: string; title: string; expect: StoryExpectation['expect'] }[] = [
    ...failed.map((row) => ({
      shipmentId: row.shipmentId,
      title: `${row.shipmentId} ${row.label}: expected ${row.expect}, got ${row.actual}${row.reason ? ` — ${row.reason}` : ''}`,
      expect: row.expect,
    })),
    ...others.map((entry) => ({
      shipmentId: entry.shipmentId,
      title: `${entry.shipmentId} ${labels.get(entry.shipmentId) ?? '(not in the default scenario)'}: unmatched — ${entry.reason}`,
      expect: 'any' as const,
    })),
  ];
  if (subjects.length === 0) return [];

  const ctx: MatchContext = {
    travel: createCachedProvider(files),
    trips,
    employees: scenario.employees,
    businesses: scenario.businesses,
    settings: scenario.settings,
  };
  const names: Record<string, string> = {};
  for (const { id, name } of [...scenario.businesses, ...scenario.employees]) names[id] = name;
  const planOf = new Map(assignments.plans.map((plan) => [plan.shipmentId, plan]));
  const carries = new Map(assignments.plans.flatMap((plan) => plan.legs.map((leg): [string, string] => [leg.tripId, plan.shipmentId])));

  /** What the matcher's result adds to a feasible option of `shipmentId`. */
  const outcome = (shipmentId: string, row: ExplainRow): string => {
    const plan = planOf.get(shipmentId);
    const sameTrips = plan !== undefined && plan.legs.length === row.carriers.length && plan.legs.every((leg, i) => leg.tripId === row.carriers[i].tripId);
    if (sameTrips && plan.relayBusinessId === row.relayBusinessId) return ' — the plan it got';
    const taken = row.carriers.flatMap((carrier) => {
      const other = carrier.tripId === null ? undefined : carries.get(carrier.tripId);
      return other === undefined || other === shipmentId ? [] : [`the ${carrier.direction} commute of ${names[carrier.employeeId] ?? carrier.employeeId} carries ${other}`];
    });
    return taken.length > 0 ? ` — not free: ${taken.join(' and ')}` : '';
  };

  const parts = [
    ...(failed.length > 0 ? [`${count(failed.length, 'story package')} not as written`] : []),
    ...(others.length > 0 ? [`${count(others.length, failed.length > 0 ? 'other package' : 'package')} without a plan`] : []),
  ];
  const lines = [
    `Why (${parts.join(', ')}): the options of each package taken alone, on the cached times. ` +
      `At most ${EXPLAIN_OPTIONS} each: those that work first, in the matcher's order, then the nearest misses.`,
  ];
  for (const { shipmentId, title, expect } of subjects) {
    lines.push(title);
    const shipment = scenario.shipments.find((candidate) => candidate.id === shipmentId);
    if (shipment === undefined) {
      lines.push('  The default scenario has no package for this row, so there is nothing to explain.');
      continue;
    }
    let options: ExplainRow[];
    try {
      options = explainShipment(shipment, ctx);
    } catch (err) {
      lines.push(`  The options could not be listed: ${messageOf(err)}`);
      continue;
    }
    const best = bestOptions(options, expect);
    const text = formatExplain(best, names, EXPLAIN_OPTIONS);
    // formatExplain prints the rows in the order they are given here, after one "no feasible option" line when
    // none of them works. If that ever changes, the lines are printed as they are, without the outcome.
    const first = best.length > 0 && !best.some((row) => row.feasible) ? 1 : 0;
    if (text.length === first + best.length) {
      best.forEach((row, i) => {
        if (row.feasible) text[first + i] += outcome(shipmentId, row);
      });
    }
    for (const line of text) lines.push(`  ${line}`);
    const left = options.length - best.length;
    if (left > 0) {
      const feasibleLeft = options.filter((row) => row.feasible).length - best.filter((row) => row.feasible).length;
      lines.push(`  … ${count(left, 'more option')} (${feasibleLeft} feasible, ${left - feasibleLeft} ruled out)`);
    }
  }
  return lines;
}

// ---------- the reports after a run ----------

interface Verdict {
  /** Lines for the reasons a run is not complete. Empty when the exit code is 0. */
  reasons: string[];
  /** True when running again is the cure (a failed request, a step that stopped or was skipped, a gap in the cache). */
  resume: boolean;
}

/** Prints the plan check and the cache report of DECISIONS pass 46 and says why the run is not complete, if it is not. */
function report(input: FetchRoutesInput, result: FetchRoutesResult, print: (line: string) => void): Verdict {
  const { summary, skipped, scenario, assignments } = result;
  const reasons: string[] = [];
  let resume = false;

  for (const line of formatSummary(summary)) print(line);
  if (summary.failures.length > 0) {
    reasons.push(`${count(summary.failures.length, 'failure')} in the fetch summary`);
    resume = true;
  }
  if (summary.stopped.length > 0) {
    reasons.push(`${count(summary.stopped.length, 'step')} stopped early`);
    resume = true;
  }

  print('');
  if (skipped.length === 0) {
    print('Skipped steps: none');
  } else {
    print(`Skipped steps: ${skipped.length}`);
    for (const { step, reason } of skipped) print(`  - ${STEP_NAMES[step]}: ${reason}`);
    reasons.push(`${count(skipped.length, 'step was', 'steps were')} skipped`);
    resume = true;
  }

  // The plan check: every plan's times re-derived from the cache, and the story packages against `expect`.
  print('');
  if (scenario === null || assignments === null) {
    print('Plan check: not run, because the matcher was not run.');
  } else {
    print('Plan check');
    try {
      const issues = checkPlans({
        plans: assignments.plans,
        shipments: scenario.shipments,
        employees: scenario.employees,
        trips: result.trips,
        businesses: scenario.businesses,
        settings: scenario.settings,
        travel: createCachedProvider(result.files),
      });
      const matched: Matched = { scenario, trips: result.trips, assignments, files: result.files };
      const rows = storyRows(input.storyFile, matched);
      for (const line of formatCheckReport(issues, rows, assignments.plans.length)) print(`  ${line}`);
      for (const line of explainStory(matched, rows)) print(`  ${line}`);
      if (issues.length > 0) reasons.push(`the plan check found ${count(issues.length, 'problem')}`);
      const failed = rows.filter((row) => !row.ok).length;
      if (failed > 0) reasons.push(`${count(failed, 'story package')} did not match as written in ${STORY_FILE}`);
    } catch (err) {
      print(`  The plan check could not finish: ${messageOf(err)}`);
      reasons.push('the plan check could not finish');
    }
  }

  // The travel cache report: what the two files cover and which of Google's numbers look wrong.
  print('');
  const homes = fetchedHomes(input);
  const businesses = input.businessesFile.businesses;
  const matcherRan = scenario !== null && assignments !== null;
  const cov = coverage({
    matrix: result.files.matrix,
    polylines: result.files.polylines,
    businessIds: businesses.map((business) => business.id),
    homes,
    polylinePairs: matcherRan ? [...commutePairs(scenario.employees), ...planLegPairs(assignments.plans)] : [],
  });
  const findings = sanity({ matrix: result.files.matrix, businesses, homes });
  if (!matcherRan) print('Route polylines are not checked below: which lines are needed is known only after the matcher has run.');
  for (const line of formatCacheReport({ coverage: cov, sanity: findings, businesses, homes })) print(line);

  const gaps = cov.businesses.missing.length + cov.businessPairs.missing.length + cov.homePairs.missing.length;
  const sanityErrors = findings.filter((finding) => finding.level === 'error').length;
  if (gaps > 0) {
    reasons.push(`the travel cache has ${count(gaps, 'gap')}`);
    resume = true;
  }
  if (sanityErrors > 0) reasons.push(`the travel cache report has ${count(sanityErrors, 'error')}`);

  return { reasons, resume };
}

// ---------- the command ----------

export interface FetchScriptArgs {
  /** What follows the script name: `process.argv.slice(2)`. */
  argv: readonly string[];
  /** Default `process.env`. `.env` is loaded into it; a variable that is already set wins. */
  env?: Record<string, string | undefined>;
  /** Folder with the three fixture files and the two cache files. Default `<repo root>/fixtures/nyc`. */
  fixturesDir?: string;
  /** Default `<repo root>/.env`. A missing file is fine. */
  envPath?: string;
  /** Builds the Google client from the key. Default: the real client. Tests pass a fake. */
  makeClient?: (key: string) => FetchClient;
  /** The only way a line leaves this file. Default `console.log`. */
  out?: (line: string) => void;
}

/**
 * The whole command. Returns the exit code and never throws:
 * - 0: `--help`; a `--dry-run` (moved homes are listed, not counted); or a run with no failed request, no skipped
 *   step, no plan-check problem, every story package matched as written and no error in the cache report;
 * - 1: anything else that ran. The last line is RESUME_LINE or CHECK_LINE. What was fetched is saved either way.
 *   Also: a `--refetch` ID the cache does not hold (nothing is changed, with or without `--dry-run`), and a run
 *   that finds moved homes (nothing is dropped; the last line is the `--refetch` command), and a run that Google
 *   refuses at the first request to an API (it stops there; the last line is CHECK_KEY_LINE);
 * - 2: an unknown flag or a misused one. The usage text is printed; nothing is read, called or written.
 * The explanation of a story row that is not as written (`explainStory`) and the entered-homes line change none of
 * these codes: a dry run that explains a wrong row still exits 0, and a run with entered homes in the cache exits
 * as it would without them.
 * With `--refetch` the order is: drop in memory, save, print, and only then the first Google call.
 * `--check-key` is its own command: exactly the three calls of `checkGoogleAccess`, 0 when all three rows are ok,
 * 1 when one is not or there is no key (then no call is made). It reads `.env` and businesses.json and writes nothing.
 * `--drop-entered` is its own command too (`runDropEntered`): it reads only the two cache files, never `.env`, a
 * key or a fixture file, builds no client, and exits 0 when the entered homes are gone or there were none.
 */
export async function runFetchScript(args: FetchScriptArgs): Promise<number> {
  const env = args.env ?? process.env;
  const dir = args.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const makeClient = args.makeClient ?? ((key: string) => bindGoogleClient({ apiKey: key }));
  const out = args.out ?? ((line: string) => console.log(line));

  // Every line goes through here. `scrubKeys` removes what looks like a key; once the real key is known, its
  // exact text (raw and URL-encoded) is removed too, whatever it looks like. Then the entered-home IDs go
  // (`hideEntered`): keys first, so a key is taken out whole before anything else changes the line.
  let secrets: string[] = [];
  const print = (line: string) => {
    let safe = scrubKeys(line);
    for (const secret of secrets) safe = safe.split(secret).join('[redacted]');
    out(hideEntered(safe));
  };

  try {
    const parsed = parseArgs(args.argv);
    if (!parsed.ok) {
      print(parsed.problem);
      print('');
      for (const line of USAGE) print(line);
      return EXIT_USAGE;
    }
    if (parsed.options.help) {
      for (const line of USAGE) print(line);
      return EXIT_OK;
    }
    const { dryRun, refetch, checkKey, dropEntered } = parsed.options;

    // --drop-entered: before `.env` is even looked at, so it cannot need a key.
    if (dropEntered) return runDropEntered(dir, dryRun, print);

    loadDotEnv(args.envPath ?? DEFAULT_ENV_PATH, env);
    const key = serverKey(env);
    if (key !== null) {
      secrets = [...new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])];
    }

    // --check-key: the three calls and their rows. Only businesses.json is read (for the address to geocode); the
    // cache files are not opened, so a cache that cannot be read does not stand in the way of checking the key.
    if (checkKey) {
      if (key === null) {
        print(
          `${SERVER_KEY_NAME} is not set, so there is no key to check. It is read from the environment or from .env at the repo root: ` +
            `put ${SERVER_KEY_NAME}=<your server key> in .env, then run the check again. No Google call was made.`,
        );
        return EXIT_INCOMPLETE;
      }
      let address: string;
      try {
        address = readFixtureFile<NycBusinessesFile>(dir, BUSINESSES_FILE, BusinessesFileSchema).businesses[0].address;
      } catch (err) {
        print(`Cannot start: ${messageOf(err)} No Google call was made.`);
        return EXIT_INCOMPLETE;
      }
      print(KEY_CHECK_HEADER);
      const rows = await checkGoogleAccess({ client: makeClient(key), address, from: KEY_CHECK_FROM, to: KEY_CHECK_TO });
      for (const line of formatKeyCheck(rows)) print(line);
      return keyCheckPassed(rows) ? EXIT_OK : EXIT_INCOMPLETE;
    }

    // Inputs. A file that cannot be used stops the command before any Google call.
    let input: FetchRoutesInput;
    let orphanLines = false;
    try {
      const businessesFile = readFixtureFile<NycBusinessesFile>(dir, BUSINESSES_FILE, BusinessesFileSchema);
      const neighborhoodsFile = readFixtureFile<NycNeighborhoodsFile>(dir, NEIGHBORHOODS_FILE, NeighborhoodsFileSchema);
      const storyFile = readFixtureFile<NycDemoStoryFile>(dir, STORY_FILE, StoryFileSchema);
      checkStoryBusinesses(dir, businessesFile, storyFile);
      const cached: TravelFiles | null = readTravelFiles(dir);
      // readTravelFiles gives null without matrix.json. Starting from empty files then would replace route lines
      // that were paid for, so a real run stops instead.
      orphanLines = cached === null && fs.existsSync(path.join(dir, POLYLINES_FILE));
      input = { files: cached ?? emptyTravelFiles(), businessesFile, neighborhoodsFile, storyFile };
    } catch (err) {
      // A FixtureFileError or a TravelCacheError: both messages name the file. The second also quotes the bad
      // place ID or pair key, which may be an entered home: `print` hides it.
      print(`Cannot start: ${messageOf(err)} No Google call was made.`);
      return EXIT_INCOMPLETE;
    }

    const orphanProblem =
      `${shownPath(path.join(dir, POLYLINES_FILE))} exists but ${MATRIX_FILE} does not, and a run would replace it. ` +
      `Restore ${MATRIX_FILE} or delete ${POLYLINES_FILE}, then run again.`;
    if (orphanLines && !dryRun) {
      print(`Cannot start: ${orphanProblem} No Google call was made.`);
      return EXIT_INCOMPLETE;
    }

    // --refetch: the drop, in memory only. Everything below (the estimate, the moved homes, the fetch) reads the
    // cache as it is after the drop; the disk is touched further down, once nothing else can stop the run.
    let edit: CacheEditResult | null = null;
    if (refetch.length > 0) {
      edit = dropPlaces(input.files, refetch);
      if (edit.unknown.length > 0) {
        // All or nothing: one mistyped ID must not leave the other places dropped behind a failed command.
        for (const line of formatCacheEdit({ dropped: [], removed: { places: 0, pairs: 0, polylines: 0 }, unknown: edit.unknown })) print(line);
        print(
          'Nothing was dropped or written, and no Google call was made. ' +
            `A place ID is a key of "places" in ${shownPath(path.join(dir, MATRIX_FILE))}. ` +
            'A place that is not in the cache needs no --refetch: a run without it fetches whatever is missing.',
        );
        return EXIT_INCOMPLETE;
      }
      input = { ...input, files: edit.files };
    }

    // The estimate is free and builds the default scenario's commuters, so fixture files that parse but that
    // the generator cannot use stop here, before a paid call. The same goes for the moved homes.
    let estimate: FetchEstimate;
    let moved: MovedHome[];
    let dryMatch: MatchOutcome | null = null;
    try {
      estimate = estimateFetch(input);
      // A dry run explains the story from the cache as it is. `planPolylines` is null exactly when the matcher
      // cannot run on it yet; then there is nothing to explain.
      if (dryRun && estimate.planPolylines !== null) dryMatch = matchDefaultScenario(input, input.files);
      // Tolerance 0: any difference counts, as in the matrix step, which refuses a home that is not exactly on its cached point.
      moved = movedHomes({ files: input.files, homes: fetchedHomes(input), toleranceM: 0 });
    } catch (err) {
      print(`Cannot start: the files in ${shownPath(dir)} do not fit together (${messageOf(err)}). No Google call was made.`);
      return EXIT_INCOMPLETE;
    }

    if (dryRun) {
      if (edit !== null) {
        print('--refetch in a dry run: nothing is dropped. A run would first drop and report:');
        for (const line of formatCacheEdit(edit)) print(`  ${line}`);
        print('The estimate below is for the cache as it would be after that drop.');
        print('');
      }
      for (const line of formatEstimate(estimate)) print(line);
      if (dryMatch !== null && dryMatch.ok) {
        const matched: Matched = { ...dryMatch, files: input.files };
        const why = explainStory(matched, storyRows(input.storyFile, matched));
        if (why.length > 0) print(DRY_RUN_STORY_LINE);
        for (const line of why) print(`  ${line}`);
      }
      for (const line of movedHomeLines(moved, refetch)) print(line);
      const entered = enteredHomes(input.files).length;
      if (entered > 0) print(enteredHomesLine(entered));
      if (orphanLines) print(`A run would stop: ${orphanProblem}`);
      print(
        key === null
          ? `Key: ${SERVER_KEY_NAME} was not found. A run without --dry-run needs it in .env at the repo root.`
          : `Key: ${SERVER_KEY_NAME} was found (it is never printed).`,
      );
      print(`Nothing was written. Cache folder: ${shownPath(dir)}`);
      return EXIT_OK;
    }

    if (moved.length > 0) {
      // Not dropped by a run on its own (DECISIONS pass 52), and not fetched around either: a route line or a
      // plan fetched now would be for the old point. The command is the last line.
      print('Cannot start: the travel cache no longer matches the fixtures. Nothing was dropped or written, and no Google call was made.');
      for (const line of movedHomeLines(moved, refetch)) print(line);
      return EXIT_INCOMPLETE;
    }
    if (key === null) {
      print(
        `${SERVER_KEY_NAME} is not set. Put ${SERVER_KEY_NAME}=<your server key> in .env at the repo root, then run again. ` +
          'No Google call was made. (--dry-run needs no key.)',
      );
      return EXIT_INCOMPLETE;
    }

    // The drop goes to disk before the client exists. writeTravelFiles replaces polylines.json first and
    // matrix.json last, so a save that fails half way leaves the place in the matrix and the same command drops it again.
    if (edit !== null) {
      try {
        writeTravelFiles(dir, edit.files);
      } catch (err) {
        print(`Stopped: ${messageOf(err)}`);
        print('No Google call was made. The drop may be half saved: fix the problem above, then run the same command again, with --refetch.');
        return EXIT_INCOMPLETE;
      }
      for (const line of formatCacheEdit(edit)) print(line);
      print(`The drop is saved in ${shownPath(dir)}. The fetch below refills what is now missing.`);
      print('');
    }
    const resume = () => {
      if (edit !== null) print(RESUME_WITHOUT_REFETCH_LINE);
      print(RESUME_LINE);
    };

    let result: FetchRoutesResult;
    try {
      result = await runFetchRoutes({
        ...input,
        client: stopWhenRefused(makeClient(key)),
        log: print,
        save: (files) => writeTravelFiles(dir, files),
      });
    } catch (err) {
      if (err instanceof AccessRefusedError) {
        // The first request to an API was refused, so the rest of the run would be refused too. Same row as
        // --check-key prints for that call; the check itself is the last line.
        print('');
        print('Stopped: Google refused the request below, the first one this run made to that API. No request was made after it.');
        print(formatKeyCheck([err.row])[0]);
        print(`Every step that finished before this is saved in ${shownPath(dir)}.`);
        if (edit !== null) print(RESUME_WITHOUT_REFETCH_LINE);
        print(CHECK_KEY_LINE);
        return EXIT_INCOMPLETE;
      }
      // A save that failed, or fixture files that do not fit together. Steps saved before this are on disk.
      print('');
      print(`Stopped: ${messageOf(err)}`);
      print(`Every step that finished before this is saved in ${shownPath(dir)}. Fix the problem above first.`);
      resume();
      return EXIT_INCOMPLETE;
    }

    print('');
    const verdict = report(input, result, print);

    print('');
    // The cache as the run leaves it. The live server may have put entered homes in it; a run never drops them.
    const entered = enteredHomes(result.files).length;
    if (entered > 0) print(enteredHomesLine(entered));
    if (verdict.reasons.length === 0) {
      print(`Done: the cache is complete and no error is flagged. Read the two reports above (warnings too), then commit ${shownPath(dir)}.`);
      return EXIT_OK;
    }
    print('NOT complete:');
    for (const reason of verdict.reasons) print(`  - ${reason}`);
    print(`Everything fetched so far is saved in ${shownPath(dir)}.`);
    if (verdict.resume) resume();
    else print(CHECK_LINE);
    return EXIT_INCOMPLETE;
  } catch (err) {
    // Nothing above is expected to land here. A stack trace could hold request text, so only the message is shown.
    print(`Stopped by an unexpected error: ${messageOf(err)}`);
    print('Every step that finished before this is saved.');
    print(RESUME_LINE);
    return EXIT_INCOMPLETE;
  }
}
