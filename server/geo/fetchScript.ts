// `npm run fetch:routes` without the three lines that touch `process`: scripts/fetch-routes.ts passes the real
// arguments in and sets the exit code from what `runFetchScript` returns.
// This file reads `.env`, reads the three hand-written files of `fixtures/nyc/`, reads and writes the travel cache
// there (`matrix.json`, `polylines.json`) and prints. The fetch itself is server/geo/fetchRoutes.ts.
// Rules it keeps (SPEC "MVP II" rules 2-3, DECISIONS pass 46 and 48):
// - nothing is printed except through `out`, and every line is scrubbed of anything that looks like a key and
//   of the key itself; the key is never part of a message;
// - `--dry-run` calls nothing, writes nothing and needs no key;
// - every paid step is on disk before the next one starts;
// - the plan check and the cache report only report: no number is changed, estimated or filled in;
// - exit 0 means "complete and no error flagged", so a human can commit `fixtures/nyc/` after reading the reports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Home, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile } from '../../shared/v2/types';
import { generateHomePool } from '../domain/v2/generator';
import { checkPlans, checkStory, formatCheckReport } from '../domain/v2/planCheck';
import type { StoryExpectation } from '../domain/v2/planCheck';
import { MATRIX_FILE, POLYLINES_FILE, emptyTravelFiles, readTravelFiles, writeTravelFiles } from './cache';
import type { TravelFiles } from './cache';
import { coverage, formatCacheReport, sanity } from './cacheReport';
import { DEFAULT_ENV_PATH, SERVER_KEY_NAME, loadDotEnv, serverKey } from './env';
import { commutePairs, planLegPairs } from './fetchPlan';
import { estimateFetch, formatEstimate, runFetchRoutes } from './fetchRoutes';
import type { FetchEstimate, FetchRoutesInput, FetchRoutesResult, SkippedStep } from './fetchRoutes';
import { bindGoogleClient, formatSummary, scrubKeys } from './fetchRunner';
import type { FetchClient } from './fetchRunner';
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

export const USAGE: readonly string[] = [
  'Usage: npm run fetch:routes -- [--dry-run] [--help]',
  '',
  'Fills fixtures/nyc/matrix.json and fixtures/nyc/polylines.json from Google, in four steps:',
  '  1. geocodes the businesses of businesses.json;',
  '  2. fetches the travel time and distance between every business and every home;',
  '  3. builds the default scenario and runs the matcher on those times;',
  '  4. fetches the route lines of the baseline commutes and of the matched plans.',
  'Then it prints the fetch summary, the plan check and the travel cache report.',
  '',
  'Flags:',
  '  --dry-run   Show how many Google requests a run would make. Calls nothing, writes nothing, needs no key.',
  '  --help      Show this text.',
  '',
  `The key is read from ${SERVER_KEY_NAME}, in the environment or in .env at the repo root. It is never printed.`,
  'Re-running is safe: whatever is already in the two cache files is skipped, and every step is saved before the',
  'next one starts, so a run that stopped half way resumes where it was.',
  '',
  'Exit codes: 0 = complete and no error flagged (warnings do not count); 1 = not complete, or an error flagged',
  '(the last line says what to do); 2 = wrong usage.',
];

// ---------- the command line ----------

export interface FetchScriptOptions {
  dryRun: boolean;
  help: boolean;
}

export type ParsedArgs = { ok: true; options: FetchScriptOptions } | { ok: false; problem: string };

/**
 * The flags, one line each. `--refetch <placeId>` (DECISIONS pass 50) goes here as `{ takesValue: true, ... }`
 * with a field in FetchScriptOptions; the loop below already reads `--flag value` and `--flag=value`.
 */
const FLAGS: Record<string, { takesValue: boolean; set: (options: FetchScriptOptions, value: string) => void }> = {
  '--dry-run': { takesValue: false, set: (options) => void (options.dryRun = true) },
  '--help': { takesValue: false, set: (options) => void (options.help = true) },
  '-h': { takesValue: false, set: (options) => void (options.help = true) },
};

/**
 * `argv` is what follows the script name (`process.argv.slice(2)`).
 * A wrong argument is echoed only when it looks like a flag name: a key pasted on the command line is not repeated.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: FetchScriptOptions = { dryRun: false, help: false };
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
    if (value === undefined || value === '' || value.startsWith('-')) return { ok: false, problem: `${name} needs a value.` };
    flag.set(options, value);
  }
  if (options.help && argv.length > 1) return { ok: false, problem: '--help is used alone.' };
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

const STEP_NAMES: Record<SkippedStep['step'], string> = {
  match: 'default scenario and matcher',
  polylines: 'route lines',
};

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
      // The generator gives the story's shipments their IDs in file order, so row i of the file is shipment i.
      const expectations: StoryExpectation[] = input.storyFile.shipments.map((shipment, index) => ({
        shipmentId: scenario.shipments[index]?.id ?? `(no shipment for story row ${index + 1})`,
        label: shipment.label,
        expect: shipment.expect,
      }));
      const rows = checkStory(expectations, assignments);
      for (const line of formatCheckReport(issues, rows, assignments.plans.length)) print(`  ${line}`);
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
 * - 0: `--help`; a `--dry-run`; or a run with no failed request, no skipped step, no plan-check problem,
 *   every story package matched as written and no error in the cache report;
 * - 1: anything else that ran. The last line is RESUME_LINE or CHECK_LINE. What was fetched is saved either way;
 * - 2: an unknown flag or a misused one. The usage text is printed; nothing is read, called or written.
 */
export async function runFetchScript(args: FetchScriptArgs): Promise<number> {
  const env = args.env ?? process.env;
  const dir = args.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const makeClient = args.makeClient ?? ((key: string) => bindGoogleClient({ apiKey: key }));
  const out = args.out ?? ((line: string) => console.log(line));

  // Every line goes through here. `scrubKeys` removes what looks like a key; once the real key is known, its
  // exact text (raw and URL-encoded) is removed too, whatever it looks like.
  let secrets: string[] = [];
  const print = (line: string) => {
    let safe = scrubKeys(line);
    for (const secret of secrets) safe = safe.split(secret).join('[redacted]');
    out(safe);
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
    const { dryRun } = parsed.options;

    loadDotEnv(args.envPath ?? DEFAULT_ENV_PATH, env);
    const key = serverKey(env);
    if (key !== null) {
      secrets = [...new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)])];
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
      // A FixtureFileError or a TravelCacheError: both messages name the file.
      print(`Cannot start: ${messageOf(err)} No Google call was made.`);
      return EXIT_INCOMPLETE;
    }

    // The estimate is free and builds the default scenario's commuters, so fixture files that parse but that
    // the generator cannot use stop here, before a paid call.
    let estimate: FetchEstimate;
    try {
      estimate = estimateFetch(input);
    } catch (err) {
      print(`Cannot start: the files in ${shownPath(dir)} do not fit together (${messageOf(err)}). No Google call was made.`);
      return EXIT_INCOMPLETE;
    }

    const orphanProblem =
      `${shownPath(path.join(dir, POLYLINES_FILE))} exists but ${MATRIX_FILE} does not, and a run would replace it. ` +
      `Restore ${MATRIX_FILE} or delete ${POLYLINES_FILE}, then run again.`;

    if (dryRun) {
      for (const line of formatEstimate(estimate)) print(line);
      if (orphanLines) print(`A run would stop: ${orphanProblem}`);
      print(
        key === null
          ? `Key: ${SERVER_KEY_NAME} was not found. A run without --dry-run needs it in .env at the repo root.`
          : `Key: ${SERVER_KEY_NAME} was found (it is never printed).`,
      );
      print(`Nothing was written. Cache folder: ${shownPath(dir)}`);
      return EXIT_OK;
    }

    if (orphanLines) {
      print(`Cannot start: ${orphanProblem} No Google call was made.`);
      return EXIT_INCOMPLETE;
    }
    if (key === null) {
      print(
        `${SERVER_KEY_NAME} is not set. Put ${SERVER_KEY_NAME}=<your server key> in .env at the repo root, then run again. ` +
          'No Google call was made. (--dry-run needs no key.)',
      );
      return EXIT_INCOMPLETE;
    }

    let result: FetchRoutesResult;
    try {
      result = await runFetchRoutes({
        ...input,
        client: makeClient(key),
        log: print,
        save: (files) => writeTravelFiles(dir, files),
      });
    } catch (err) {
      // A save that failed, or fixture files that do not fit together. Steps saved before this are on disk.
      print('');
      print(`Stopped: ${messageOf(err)}`);
      print(`Every step that finished before this is saved in ${shownPath(dir)}. Fix the problem above first.`);
      print(RESUME_LINE);
      return EXIT_INCOMPLETE;
    }

    print('');
    const verdict = report(input, result, print);

    print('');
    if (verdict.reasons.length === 0) {
      print(`Done: the cache is complete and no error is flagged. Read the two reports above (warnings too), then commit ${shownPath(dir)}.`);
      return EXIT_OK;
    }
    print('NOT complete:');
    for (const reason of verdict.reasons) print(`  - ${reason}`);
    print(`Everything fetched so far is saved in ${shownPath(dir)}.`);
    print(verdict.resume ? RESUME_LINE : CHECK_LINE);
    return EXIT_INCOMPLETE;
  } catch (err) {
    // Nothing above is expected to land here. A stack trace could hold request text, so only the message is shown.
    print(`Stopped by an unexpected error: ${messageOf(err)}`);
    print('Every step that finished before this is saved.');
    print(RESUME_LINE);
    return EXIT_INCOMPLETE;
  }
}
