// One command for the human on the demo machine, before presenting (#922):
//
//   npx tsx scripts/demo-check.ts
//
// It prints one line per check, each starting with OK, WARN or MISSING and saying in one plain sentence what
// to do, and then one closing line:
//   1. GEMINI_API_KEY                  WARN when not set: Parse and Options answer offline.
//   2. VITE_GOOGLE_MAPS_BROWSER_KEY    WARN when not set: the maps show a placeholder.
//   3. GOOGLE_MAPS_SERVER_KEY          WARN when not set: saving a new commute address fails.
//   4. the NYC travel data             MISSING (fatal) without fixtures/nyc/matrix.json + polylines.json, or
//                                      when the run every page starts from cannot be built from fixtures/nyc.
//   5. the saved run                   WARN unless data/state-v2.json is absent or at the start of the day.
//                                      The line says that npm run dev starts fresh (scripts/fresh-run.mjs
//                                      removes the file, #965) and how to reset for npm start, which keeps it.
//   6. the built client                WARN without client/dist, or when it was built without the browser key.
// Exit code: 0 when nothing is MISSING, 1 otherwise. A WARN never changes the exit code.
//
// `.env` is loaded the way server/index.ts loads it, and the saved run is the file the server would open
// (`RELAY_STATE_PATH` counts). The check only reads: it writes no file, starts no server and calls neither
// Google nor Gemini. No line is built from a key's value, and every line still goes through `withoutSecret`
// for each of the three keys before it is printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_ENV_PATH, GEMINI_KEY_NAME, geminiKey, loadDotEnv } from '../server/ai/env';
import { DEFAULT_V2_STATE_PATH, NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures, savedRunProblem } from '../server/api/v2/bootRun';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../server/geo/cache';
import { SERVER_KEY_NAME, serverKey } from '../server/geo/env';
import { createCachedProvider } from '../server/geo/providers';
import { hasBuiltClient, statePathFrom } from '../server/index';
import { withoutSecret } from './gemini-check';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read by Vite when `npm run build` (or `npm run dev`) runs: vite.config.ts, `envDir`. The server never reads it. */
export const BROWSER_KEY_NAME = 'VITE_GOOGLE_MAPS_BROWSER_KEY';
/** Where `npm run build` writes the client and `npm start` serves it from (vite.config.ts, server/index.ts). */
export const DEFAULT_CLIENT_DIST = path.join(repoRoot, 'client', 'dist');

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;

export type CheckStatus = 'OK' | 'WARN' | 'MISSING';
export type CheckLine = { status: CheckStatus; text: string };

/**
 * Whether the README demo needs the Google server key. Issue #899 checks it (the Employee step on `npm start`
 * with no server key) and was not merged when this was written, so the answer is "unknown". The follow-up
 * that brings #899's finding changes this one sentence.
 */
export const SERVER_KEY_DEMO_NEED = 'Whether the README demo needs it is unknown (issue #899 checks it)';

/** The closing line. `warnings` and `missing` are the numbers of WARN and MISSING lines above it. */
export function closingLine(warnings: number, missing: number): string {
  if (missing > 0) return `Not ready for the demo: fix the ${missing === 1 ? 'MISSING line' : `${missing} MISSING lines`} above first.`;
  if (warnings > 0) return `Ready for the demo, with ${warnings === 1 ? '1 warning' : `${warnings} warnings`}: read the WARN ${warnings === 1 ? 'line' : 'lines'} above.`;
  return 'Ready for the demo.';
}

/** One check as it is printed: the status in a column of its own, then the sentence. */
export function formatLine(line: CheckLine): string {
  return `${line.status.padEnd('MISSING'.length)}  ${line.text}`;
}

export type DemoCheckOptions = {
  /** `process.env` in the real command. `.env` is loaded into it; a variable that is already set wins. */
  env: Record<string, string | undefined>;
  /** `DEFAULT_ENV_PATH` (the repo-root `.env`) in the real command. Tests give a temp file. */
  envPath: string;
  /** Gets every line of the report. */
  out: (line: string) => void;
  /** Folder of the travel data and the NYC story files. Default: fixtures/nyc. */
  fixturesDir?: string;
  /** The saved run, unless `RELAY_STATE_PATH` names another file. Default: data/state-v2.json. */
  statePath?: string;
  /** The build output folder. Default: client/dist. */
  clientDist?: string;
  /** Paths inside this folder are printed relative to it (`data/state-v2.json`). Default: the repo root. */
  root?: string;
};

const line = (status: CheckStatus, text: string): CheckLine => ({ status, text });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The trimmed value of `name`, or null when it is unset or blank. Only ever compared and searched for, never printed. */
function setValue(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name];
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** "Day 1, 3:30 PM" for 930, as the pages write a run's time. */
export function dayTime(min: number): string {
  const whole = Math.floor(min);
  const rest = ((whole % 1440) + 1440) % 1440;
  const hour = Math.floor(rest / 60);
  return `Day ${Math.floor(whole / 1440) + 1}, ${hour % 12 === 0 ? 12 : hour % 12}:${String(rest % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

// ---------- 4. the NYC travel data ----------

/** What the saved run is compared with: the run the server builds when there is no saved one. */
type FreshRun = { scenario: unknown; shipments: number; startMin: number; places: Record<string, unknown> };

function checkTravel(fixturesDir: string, show: (file: string) => string): { line: CheckLine; fresh: FreshRun | null } {
  const dir = show(fixturesDir);
  const restore = `Restore the folder ${dir} from the repository (git checkout -- ${dir}).`;
  const absent = [MATRIX_FILE, POLYLINES_FILE].filter((name) => !fs.existsSync(path.join(fixturesDir, name)));
  if (absent.length > 0) {
    const names = absent.map((name) => `${dir}/${name}`).join(' and ');
    return {
      line: line('MISSING', `NYC travel data: ${names} ${absent.length === 1 ? 'is' : 'are'} not there, so the app has no deliveries to show. ${restore}`),
      fresh: null,
    };
  }
  try {
    const files = readTravelFiles(fixturesDir);
    if (!files) throw new Error('no travel data');
    const run = buildDefaultRun({
      travel: createCachedProvider(files), places: files.matrix.places, fixtures: readNycFixtures(fixturesDir),
    });
    return {
      line: line('OK', `NYC travel data: ${dir}/${MATRIX_FILE} and ${POLYLINES_FILE} are there, and the fresh run builds from them (${run.scenario.shipments.length} deliveries).`),
      fresh: {
        // Through JSON, as the state file holds it: a field that is undefined is not there.
        scenario: JSON.parse(JSON.stringify(run.scenario)),
        shipments: run.scenario.shipments.length,
        startMin: run.scenario.settings.simStartMin,
        places: files.matrix.places,
      },
    };
  } catch {
    // The reason is left out on purpose: the fix is the same, and an error's text is not written for a presenter.
    return {
      line: line('MISSING', `NYC travel data: the files in ${dir} are there, but the run cannot be built from them, so the app has no deliveries to show. ${restore}`),
      fresh: null,
    };
  }
}

// ---------- 5. the saved run ----------

function checkSavedRun(statePath: string, fresh: FreshRun | null, show: (file: string) => string): CheckLine {
  const file = show(statePath);
  // `npm run dev` removes the file before the servers start (scripts/fresh-run.mjs, #965); `npm start` opens it.
  const reset = `npm run dev starts fresh (it removes ${file}). For npm start: stop the server, delete ${file}, start.`;
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return line('OK', `Saved run: ${file} is not there, so the server starts with the fresh run.`);
    return line('WARN', `Saved run: ${file} cannot be read. ${reset}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const run = isRecord(value) && isRecord(value.run) ? value.run : null;
  const clock = run && isRecord(run.clock) ? run.clock : null;
  const scenario = run && isRecord(run.scenario) ? run.scenario : null;
  const settings = scenario && isRecord(scenario.settings) ? scenario.settings : null;
  // The server's own check of a state file, when the travel data is there to check its places against.
  const unusable = fresh !== null && savedRunProblem(value, fresh.places as Parameters<typeof savedRunProblem>[1]) !== null;
  if (!clock || !scenario || !settings || typeof clock.timeMin !== 'number' || unusable) {
    return line('WARN', `Saved run: ${file} is not a run the server can use. ${reset}`);
  }

  const startMin = fresh?.startMin ?? settings.simStartMin;
  const why: string[] = [];
  if (clock.phase !== 'planning') why.push('the run is locked');
  if (clock.timeMin !== startMin) {
    why.push(typeof startMin === 'number' ? `its clock is at ${dayTime(clock.timeMin)}, not ${dayTime(startMin)}` : 'its clock has no start to compare with');
  }
  if (fresh !== null && !isDeepStrictEqual(scenario, fresh.scenario)) {
    const saved = Array.isArray(scenario.shipments) ? scenario.shipments.length : 0;
    why.push(saved !== fresh.shipments
      ? `it holds ${saved} ${saved === 1 ? 'delivery' : 'deliveries'}, the fresh run has ${fresh.shipments}`
      : 'a delivery, a commute or a setting differs from the fresh run');
  }
  if (why.length > 0) return line('WARN', `Saved run: ${file} is not at the start of the day (${why.join('; ')}). ${reset}`);

  const at = typeof startMin === 'number' ? ` (${dayTime(startMin)}${fresh ? `, the ${fresh.shipments} deliveries of the fresh run` : ''})` : '';
  // Without the travel data only the clock was compared: the MISSING line above is the one to fix first.
  return line('OK', `Saved run: ${file} is at the start of the day${at}.`);
}

// ---------- 6. the built client ----------

/** True when a `.js` file under `dir` holds `text`. Read only; a file that cannot be read holds nothing. */
function someScriptHolds(dir: string, text: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return someScriptHolds(file, text);
    if (!entry.isFile() || !entry.name.endsWith('.js')) return false;
    try {
      return fs.readFileSync(file, 'utf8').includes(text);
    } catch {
      return false;
    }
  });
}

function checkBuild(clientDist: string, browserKey: string | null, show: (file: string) => string): CheckLine {
  const dir = show(clientDist);
  if (!hasBuiltClient(clientDist)) {
    return line('WARN', `Built client: ${dir} is not there, so npm start serves no page (npm run dev still does). Run npm run build.`);
  }
  if (browserKey === null) return line('OK', `Built client: ${dir} is there.`);
  // The key is written into the build when `npm run build` runs; a later change of .env does not reach it.
  if (!someScriptHolds(clientDist, browserKey)) {
    return line('WARN', `Built client: ${dir} was built without the ${BROWSER_KEY_NAME} that is set now, so npm start shows the map placeholder. Run npm run build.`);
  }
  return line('OK', `Built client: ${dir} is there and was built with ${BROWSER_KEY_NAME}.`);
}

// ---------- the command ----------

/** Runs every check, prints the lines and returns the exit code (see the head of this file). It never throws. */
export function runDemoCheck(opts: DemoCheckOptions): number {
  const { env } = opts;
  // As server/index.ts does: `.env` first, then everything is read from the environment.
  loadDotEnv(opts.envPath, env);
  const root = opts.root ?? repoRoot;
  const show = (file: string): string => {
    const relative = path.relative(root, file);
    const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    return inside ? relative.split(path.sep).join('/') : file;
  };

  const gemini = geminiKey(env);
  const browser = setValue(env, BROWSER_KEY_NAME);
  const server = serverKey(env);

  const lines: CheckLine[] = [
    gemini !== null
      ? line('OK', `${GEMINI_KEY_NAME} is set: Parse and Options ask Gemini. Try the key once with npx tsx scripts/gemini-check.ts.`)
      : line('WARN', `${GEMINI_KEY_NAME} is not set: Parse and Options answer offline. Add it to .env and restart the server to use Gemini.`),
    browser !== null
      ? line('OK', `${BROWSER_KEY_NAME} is set: the pages show the Google map.`)
      : line('WARN', `${BROWSER_KEY_NAME} is not set: the maps show a placeholder. Add it to .env and run npm run build.`),
    server !== null
      ? line('OK', `${SERVER_KEY_NAME} is set: a new commute address can be searched and saved.`)
      : line('WARN', `${SERVER_KEY_NAME} is not set: saving a new commute address fails. ${SERVER_KEY_DEMO_NEED}. Add it to .env and restart the server to be safe.`),
  ];

  let travel: ReturnType<typeof checkTravel>;
  try {
    travel = checkTravel(opts.fixturesDir ?? NYC_FIXTURES_DIR, show);
  } catch {
    travel = { line: line('MISSING', 'NYC travel data: the check could not read the travel data folder.'), fresh: null };
  }
  lines.push(travel.line);

  try {
    // The file the server would open: RELAY_STATE_PATH (the environment or .env) wins over the default.
    lines.push(checkSavedRun(statePathFrom(env, opts.statePath ?? DEFAULT_V2_STATE_PATH), travel.fresh, show));
  } catch {
    lines.push(line('WARN', 'Saved run: the check could not read the saved run. npm run dev starts fresh (it removes the saved run file). For npm start: stop the server, delete the saved run file, start.'));
  }

  try {
    lines.push(checkBuild(opts.clientDist ?? DEFAULT_CLIENT_DIST, browser, show));
  } catch {
    lines.push(line('WARN', 'Built client: the check could not read the build output folder. Run npm run build.'));
  }

  const count = (status: CheckStatus) => lines.filter((line) => line.status === status).length;
  const report = [...lines.map(formatLine), closingLine(count('WARN'), count('MISSING'))];
  for (const line of report) {
    let safe = line;
    for (const secret of [gemini, browser, server]) safe = withoutSecret(safe, secret);
    opts.out(safe);
  }
  return count('MISSING') > 0 ? EXIT_NOT_READY : EXIT_READY;
}

const isEntry = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isEntry) {
  process.exitCode = runDemoCheck({
    env: process.env,
    envPath: DEFAULT_ENV_PATH,
    out: (line) => console.log(line),
  });
}
