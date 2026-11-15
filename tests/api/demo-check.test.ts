// scripts/demo-check.ts (#922), the one command a human runs on the demo machine before presenting, run here
// through its main function on temp folders laid out like the repo: `<root>/.env`, `<root>/fixtures/nyc`
// (a copy of the committed folder), `<root>/data/state-v2.json` and `<root>/client/dist`.
// Every line and the exit code are pinned as text. Saved runs are written by the real runtime
// (`createV2Runtime`), so "at the start of the day" is what a stopped server really leaves on disk.
// The repo's `.env`, data/ and client/dist are never read; `process.env` is never passed in; every run is
// checked to have written nothing and to have called `fetch` zero times.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BROWSER_KEY_NAME, DEFAULT_CLIENT_DIST, EXIT_NOT_READY, EXIT_READY, SERVER_KEY_DEMO_NEED,
  closingLine, dayTime, formatLine, runDemoCheck,
} from '../../scripts/demo-check';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { DEFAULT_V2_STATE_PATH, NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { planControl } from '../../server/api/v2/controlOps';
import type { RunV2 } from '../../server/api/v2/router';
import { DEFAULT_ENV_PATH } from '../../server/ai/env';
import mvp1Scenario from '../../fixtures/demoScenario.json';

const T = 60_000; // every check builds the default NYC run; the limit is wide for a loaded machine

// Not real keys. Each has characters of its own, so a leak of any of them is found by name.
const GEMINI = 'AQ.FAKE_gemini-111+/=';
const BROWSER = 'AIzaFAKE-browser-222';
const SERVER = 'FAKE-server-key-333';
const ALL_KEYS = `GEMINI_API_KEY=${GEMINI}\nVITE_GOOGLE_MAPS_BROWSER_KEY=${BROWSER}\nGOOGLE_MAPS_SERVER_KEY=${SERVER}\n`;

// The lines, as a presenter reads them.
const GEMINI_OK = 'OK       GEMINI_API_KEY is set: Parse and Options ask Gemini. Try the key once with npx tsx scripts/gemini-check.ts.';
const GEMINI_WARN = 'WARN     GEMINI_API_KEY is not set: Parse and Options answer offline. Add it to .env and restart the server to use Gemini.';
const BROWSER_OK = 'OK       VITE_GOOGLE_MAPS_BROWSER_KEY is set: the pages show the Google map.';
const BROWSER_WARN = 'WARN     VITE_GOOGLE_MAPS_BROWSER_KEY is not set: the maps show a placeholder. Add it to .env and run npm run build.';
const SERVER_OK = 'OK       GOOGLE_MAPS_SERVER_KEY is set: a new commute address can be searched and saved.';
const SERVER_WARN = 'WARN     GOOGLE_MAPS_SERVER_KEY is not set: saving a new commute address fails. Whether the README demo needs it is unknown (issue #899 checks it). Add it to .env and restart the server to be safe.';
const TRAVEL_OK = 'OK       NYC travel data: fixtures/nyc/matrix.json and polylines.json are there, and the fresh run builds from them (24 deliveries).';
const RESTORE = 'Restore the folder fixtures/nyc from the repository (git checkout -- fixtures/nyc).';
const TRAVEL_UNUSABLE = `MISSING  NYC travel data: the files in fixtures/nyc are there, but the run cannot be built from them, so the app has no deliveries to show. ${RESTORE}`;
const RUN_ABSENT = 'OK       Saved run: data/state-v2.json is not there, so the server starts with the fresh run.';
const RUN_AT_START = 'OK       Saved run: data/state-v2.json is at the start of the day (Day 1, 3:30 PM, the 24 deliveries of the fresh run).';
// #965: npm run dev removes the saved run by itself (scripts/fresh-run.mjs); npm start opens it.
const RESET = 'npm run dev starts fresh (it removes data/state-v2.json). For npm start: stop the server, delete data/state-v2.json, start.';
const runNotAtStart = (why: string) => `WARN     Saved run: data/state-v2.json is not at the start of the day (${why}). ${RESET}`;
const RUN_UNUSABLE = `WARN     Saved run: data/state-v2.json is not a run the server can use. ${RESET}`;
const BUILD_OK = 'OK       Built client: client/dist is there.';
const BUILD_WITH_KEY = 'OK       Built client: client/dist is there and was built with VITE_GOOGLE_MAPS_BROWSER_KEY.';
const BUILD_ABSENT = 'WARN     Built client: client/dist is not there, so npm start serves no page (npm run dev still does). Run npm run build.';
const BUILD_WITHOUT_KEY = 'WARN     Built client: client/dist was built without the VITE_GOOGLE_MAPS_BROWSER_KEY that is set now, so npm start shows the map placeholder. Run npm run build.';
const READY = 'Ready for the demo.';

// ---------- the temp repo ----------

type Repo = { root: string; envPath: string; fixturesDir: string; statePath: string; clientDist: string };

const roots: string[] = [];
/** A folder laid out like the repo: the committed fixtures/nyc, no `.env`, no saved run, no build. */
function tempRepo(): Repo {
  // realpath: on macOS the temp folder is behind a symlink, and the lines name paths relative to the root.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-check-')));
  roots.push(root);
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.cpSync(NYC_FIXTURES_DIR, fixturesDir, { recursive: true });
  return {
    root,
    envPath: path.join(root, '.env'),
    fixturesDir,
    statePath: path.join(root, 'data', 'state-v2.json'),
    clientDist: path.join(root, 'client', 'dist'),
  };
}

/** A built client as `npm run build` leaves it: index.html and a script, which holds `key` when one is given. */
function build(repo: Repo, key: string | null): void {
  const assets = path.join(repo.clientDist, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(repo.clientDist, 'index.html'), '<!doctype html><div id="root"></div>');
  fs.writeFileSync(path.join(assets, 'index-abc123.js'), `const env={VITE_GOOGLE_MAPS_BROWSER_KEY:${JSON.stringify(key ?? '')}};`);
}

/**
 * A saved run as the server leaves it: the real runtime boots on the temp repo (no key), `change` is applied
 * through its store, and the runtime is shut down, which pauses the clock and writes the state file.
 */
async function savedRun(repo: Repo, change?: (run: RunV2) => void): Promise<void> {
  const runtime = createV2Runtime({ fixturesDir: repo.fixturesDir, statePath: repo.statePath, key: null });
  if (runtime.status !== 'ready' || !runtime.deps.store) throw new Error(`expected a ready runtime, got: ${runtime.reason}`);
  if (change) await runtime.deps.store.mutate(change);
  await runtime.shutdown();
}

/** What a control of the simulator does to the run, as POST /api/v2/simulator/control applies it. */
function control(run: RunV2, body: unknown): void {
  const plan = planControl(run, body);
  if (plan.kind !== 'apply') throw new Error('the control was refused');
  run.clock = plan.clock;
}

/** Every file and folder under `dir` with its bytes (as a hash) and its modification time. */
function tree(dir: string): Record<string, string> {
  const seen: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const file = path.join(at, entry.name);
      const stat = fs.statSync(file);
      if (entry.isDirectory()) {
        seen[`${file}/`] = String(stat.mtimeMs);
        walk(file);
      } else {
        seen[file] = `${stat.mtimeMs} ${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
      }
    }
  };
  walk(dir);
  return seen;
}

/**
 * Runs the check on the temp repo with an environment of its own. Around every run: nothing under the root
 * changed (no file written, renamed or removed) and the global `fetch` was never called.
 */
function check(repo: Repo, env: Record<string, string | undefined> = {}) {
  const before = tree(repo.root);
  const fetchSpy = vi.fn(async () => {
    throw new Error('the demo check must not reach the network');
  });
  vi.stubGlobal('fetch', fetchSpy);
  const lines: string[] = [];
  let code: number;
  try {
    code = runDemoCheck({
      env, envPath: repo.envPath, out: (line) => lines.push(line),
      fixturesDir: repo.fixturesDir, statePath: repo.statePath, clientDist: repo.clientDist, root: repo.root,
    });
  } finally {
    vi.unstubAllGlobals();
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(tree(repo.root)).toStrictEqual(before);
  return { lines, code, text: lines.join('\n') };
}

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
let processEnvBefore: string;
beforeAll(() => {
  repoDataBefore = repoDataNames();
  processEnvBefore = JSON.stringify(process.env);
});
afterAll(() => {
  expect(repoDataNames()).toStrictEqual(repoDataBefore); // the repo's data/ folder is untouched
  expect(JSON.stringify(process.env)).toBe(processEnvBefore); // and nothing was loaded into the real environment
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

// ---------- the tests ----------

describe('demo check: a ready demo machine', () => {
  it('the three keys in .env, the travel data, no saved run and a build with the key: six OK lines, exit 0', () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    build(repo, BROWSER);
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([GEMINI_OK, BROWSER_OK, SERVER_OK, TRAVEL_OK, RUN_ABSENT, BUILD_WITH_KEY, READY]);
    expect(code).toBe(EXIT_READY);
    expect(code).toBe(0);
  }, T);

  it('a server that was started and stopped leaves a run at the start of the day: still all OK', async () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    build(repo, BROWSER);
    await savedRun(repo);
    expect(fs.existsSync(repo.statePath)).toBe(true);
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([GEMINI_OK, BROWSER_OK, SERVER_OK, TRAVEL_OK, RUN_AT_START, BUILD_WITH_KEY, READY]);
    expect(code).toBe(0);
  }, T);

  it('every line starts with its status in one column, and the defaults are the paths the server uses', () => {
    expect(formatLine({ status: 'OK', text: 'x' })).toBe('OK       x');
    expect(formatLine({ status: 'WARN', text: 'x' })).toBe('WARN     x');
    expect(formatLine({ status: 'MISSING', text: 'x' })).toBe('MISSING  x');
    expect(BROWSER_KEY_NAME).toBe('VITE_GOOGLE_MAPS_BROWSER_KEY');
    expect(path.relative(path.dirname(DEFAULT_ENV_PATH), DEFAULT_CLIENT_DIST)).toBe(path.join('client', 'dist'));
    expect(SERVER_KEY_DEMO_NEED).toContain('unknown'); // #899 was not merged; its finding replaces this sentence
    expect(dayTime(930)).toBe('Day 1, 3:30 PM');
    expect(dayTime(1950)).toBe('Day 2, 8:30 AM');
    expect(dayTime(1440)).toBe('Day 2, 12:00 AM');
    expect(dayTime(2160)).toBe('Day 2, 12:00 PM');
  });

  it('the closing line counts the WARN and MISSING lines', () => {
    expect(closingLine(0, 0)).toBe('Ready for the demo.');
    expect(closingLine(1, 0)).toBe('Ready for the demo, with 1 warning: read the WARN line above.');
    expect(closingLine(4, 0)).toBe('Ready for the demo, with 4 warnings: read the WARN lines above.');
    expect(closingLine(0, 1)).toBe('Not ready for the demo: fix the MISSING line above first.');
    expect(closingLine(3, 2)).toBe('Not ready for the demo: fix the 2 MISSING lines above first.');
  });
});

describe('demo check: the keys', () => {
  it('no .env and no key in the environment: three WARN lines saying what each key is for, exit 0', () => {
    const repo = tempRepo();
    build(repo, null);
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([
      GEMINI_WARN, BROWSER_WARN, SERVER_WARN, TRAVEL_OK, RUN_ABSENT, BUILD_OK,
      'Ready for the demo, with 3 warnings: read the WARN lines above.',
    ]);
    expect(code).toBe(0); // a WARN never fails the check
  }, T);

  it('a key in the environment counts like one in .env, and a blank one counts as not set', () => {
    const repo = tempRepo();
    build(repo, null);
    fs.writeFileSync(repo.envPath, `GEMINI_API_KEY=${GEMINI}\nGOOGLE_MAPS_SERVER_KEY=\n`);
    // The environment wins over .env, as at server start: the blank Gemini key hides the one in the file.
    const { lines } = check(repo, { GEMINI_API_KEY: '  ', GOOGLE_MAPS_SERVER_KEY: SERVER });
    expect(lines.slice(0, 3)).toStrictEqual([GEMINI_WARN, BROWSER_WARN, SERVER_OK]);
  }, T);

  it('one key set, two not: each line stands for its own key', () => {
    const repo = tempRepo();
    build(repo, null);
    fs.writeFileSync(repo.envPath, `GEMINI_API_KEY=${GEMINI}\n`);
    expect(check(repo).lines.slice(0, 3)).toStrictEqual([GEMINI_OK, BROWSER_WARN, SERVER_WARN]);
  }, T);

  it('no key value is ever printed, in any state of the machine', async () => {
    const leaks = (text: string) => [GEMINI, BROWSER, SERVER, encodeURIComponent(GEMINI)].filter((key) => text.includes(key));

    const ready = tempRepo();
    fs.writeFileSync(ready.envPath, ALL_KEYS);
    build(ready, BROWSER);
    expect(leaks(check(ready).text)).toStrictEqual([]);

    // Everything wrong at once: no travel data, a saved run mid-day, a build without the key.
    const broken = tempRepo();
    fs.writeFileSync(broken.envPath, ALL_KEYS);
    build(broken, null);
    await savedRun(broken, (run) => control(run, { action: 'seek', timeMin: 1950 }));
    fs.rmSync(path.join(broken.fixturesDir, 'matrix.json'));
    const report = check(broken);
    expect(report.code).toBe(1);
    expect(leaks(report.text)).toStrictEqual([]);

    // Even a path that holds a key is printed without it: every line is cleaned before it goes out.
    const odd = tempRepo();
    fs.writeFileSync(odd.envPath, ALL_KEYS);
    const { text } = check(odd, { RELAY_STATE_PATH: path.join(os.tmpdir(), `demo-check-${SERVER}`, 'state-v2.json') });
    expect(leaks(text)).toStrictEqual([]);
    expect(text).toContain('demo-check-[hidden]');
  }, T);
});

describe('demo check: the NYC travel data', () => {
  it('no matrix.json: MISSING, exit 1, and the closing line says not ready', () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    build(repo, BROWSER);
    fs.rmSync(path.join(repo.fixturesDir, 'matrix.json'));
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([
      GEMINI_OK, BROWSER_OK, SERVER_OK,
      `MISSING  NYC travel data: fixtures/nyc/matrix.json is not there, so the app has no deliveries to show. ${RESTORE}`,
      RUN_ABSENT, BUILD_WITH_KEY,
      'Not ready for the demo: fix the MISSING line above first.',
    ]);
    expect(code).toBe(EXIT_NOT_READY);
    expect(code).toBe(1);
  }, T);

  it('no polylines.json, or neither file: MISSING names what is not there', () => {
    const repo = tempRepo();
    fs.rmSync(path.join(repo.fixturesDir, 'polylines.json'));
    const one = check(repo);
    expect(one.lines[3]).toBe(`MISSING  NYC travel data: fixtures/nyc/polylines.json is not there, so the app has no deliveries to show. ${RESTORE}`);
    expect(one.code).toBe(1);

    fs.rmSync(path.join(repo.fixturesDir, 'matrix.json'));
    const both = check(repo);
    expect(both.lines[3]).toBe(`MISSING  NYC travel data: fixtures/nyc/matrix.json and fixtures/nyc/polylines.json are not there, so the app has no deliveries to show. ${RESTORE}`);
    expect(both.code).toBe(1);

    fs.rmSync(repo.fixturesDir, { recursive: true });
    const none = check(repo);
    expect(none.lines[3]).toBe(both.lines[3]);
    expect(none.code).toBe(1);
  }, T);

  it('files the run cannot be built from (a broken cache, a missing story file) are MISSING too', () => {
    const broken = tempRepo();
    fs.writeFileSync(path.join(broken.fixturesDir, 'matrix.json'), '{ not json');
    const first = check(broken);
    expect(first.lines[3]).toBe(TRAVEL_UNUSABLE);
    expect(first.code).toBe(1);

    const empty = tempRepo();
    fs.writeFileSync(path.join(empty.fixturesDir, 'matrix.json'), JSON.stringify({ schemaVersion: 1, places: {}, pairs: {} }));
    expect(check(empty).lines[3]).toBe(TRAVEL_UNUSABLE);

    const noStory = tempRepo();
    fs.rmSync(path.join(noStory.fixturesDir, 'demoStory.json'));
    const last = check(noStory);
    expect(last.lines[3]).toBe(TRAVEL_UNUSABLE);
    expect(last.code).toBe(1);
  }, T);

  it('without travel data a saved run is still checked by its clock', async () => {
    const repo = tempRepo();
    await savedRun(repo);
    fs.rmSync(path.join(repo.fixturesDir, 'matrix.json'));
    expect(check(repo).lines[4]).toBe('OK       Saved run: data/state-v2.json is at the start of the day (Day 1, 3:30 PM).');

    const later = tempRepo();
    await savedRun(later, (run) => control(run, { action: 'seek', timeMin: 1950 }));
    fs.rmSync(path.join(later.fixturesDir, 'matrix.json'));
    const { lines, code } = check(later);
    expect(lines[4]).toBe(runNotAtStart('its clock is at Day 2, 8:30 AM, not Day 1, 3:30 PM'));
    expect(code).toBe(1); // because of the travel data, not the saved run
  }, T);
});

describe('demo check: the saved run', () => {
  it('a run saved mid-day: WARN with the clock and the reset, exit 0', async () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    build(repo, BROWSER);
    await savedRun(repo, (run) => control(run, { action: 'seek', timeMin: 1950 }));
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([
      GEMINI_OK, BROWSER_OK, SERVER_OK, TRAVEL_OK,
      'WARN     Saved run: data/state-v2.json is not at the start of the day (its clock is at Day 2, 8:30 AM, not Day 1, 3:30 PM). npm run dev starts fresh (it removes data/state-v2.json). For npm start: stop the server, delete data/state-v2.json, start.',
      BUILD_WITH_KEY,
      'Ready for the demo, with 1 warning: read the WARN line above.',
    ]);
    expect(code).toBe(0);
  }, T);

  it('a journey that was watched and sent Back to start is at the start again', async () => {
    const repo = tempRepo();
    await savedRun(repo, (run) => {
      control(run, { action: 'seek', timeMin: 1950 });
      control(run, { action: 'reset_playback' });
    });
    expect(check(repo).lines[4]).toBe(RUN_AT_START);
  }, T);

  it('a locked run is not at the start, even with the clock there', async () => {
    const repo = tempRepo();
    await savedRun(repo, (run) => control(run, { action: 'play' }));
    expect(check(repo).lines[4]).toBe(runNotAtStart('the run is locked'));

    const later = tempRepo();
    await savedRun(later, (run) => {
      control(run, { action: 'play' });
      control(run, { action: 'seek', timeMin: 1000 });
    });
    expect(check(later).lines[4]).toBe(runNotAtStart('the run is locked; its clock is at Day 1, 4:40 PM, not Day 1, 3:30 PM'));
  }, T);

  it('a rehearsal that added a delivery, or changed a commute, is not the fresh run', async () => {
    const added = tempRepo();
    await savedRun(added, (run) => {
      run.scenario.shipments.push({ ...run.scenario.shipments[0], id: 'shp-rehearsal' });
    });
    expect(check(added).lines[4]).toBe(runNotAtStart('it holds 25 deliveries, the fresh run has 24'));

    const commute = tempRepo();
    await savedRun(commute, (run) => {
      run.scenario.employees[0].eveningDepartureMin += 5;
    });
    expect(check(commute).lines[4]).toBe(runNotAtStart('a delivery, a commute or a setting differs from the fresh run'));

    const both = tempRepo();
    await savedRun(both, (run) => {
      run.scenario.shipments.pop();
      control(run, { action: 'seek', timeMin: 1950 });
    });
    expect(check(both).lines[4]).toBe(
      runNotAtStart('its clock is at Day 2, 8:30 AM, not Day 1, 3:30 PM; it holds 23 deliveries, the fresh run has 24'),
    );
  }, T);

  it('a file that is no v2 run (not JSON, an MVP 1 state, a folder) gets the same reset sentence', () => {
    const repo = tempRepo();
    fs.mkdirSync(path.dirname(repo.statePath), { recursive: true });
    for (const bytes of ['{ not json', 'null', JSON.stringify({ schemaVersion: 1, run: { scenario: mvp1Scenario, clock: { phase: 'planning', playing: false, timeMin: 930, speed: 120 } } })]) {
      fs.writeFileSync(repo.statePath, bytes);
      const { lines, code } = check(repo);
      expect(lines[4]).toBe(RUN_UNUSABLE);
      expect(code).toBe(0);
      expect(fs.readFileSync(repo.statePath, 'utf8')).toBe(bytes); // kept as it is: nothing is set aside by the check
    }
    fs.rmSync(repo.statePath);
    fs.mkdirSync(repo.statePath);
    expect(check(repo).lines[4]).toBe(`WARN     Saved run: data/state-v2.json cannot be read. ${RESET}`);
  }, T);

  it('RELAY_STATE_PATH, from the environment or from .env, names the file that is checked', async () => {
    const repo = tempRepo();
    const other = path.join(repo.root, 'qa', 'state-v2.json');
    await savedRun({ ...repo, statePath: other }, (run) => control(run, { action: 'seek', timeMin: 1950 }));

    // The default file is absent, the QA one is mid-day.
    expect(check(repo).lines[4]).toBe(RUN_ABSENT);
    const qa = 'WARN     Saved run: qa/state-v2.json is not at the start of the day (its clock is at Day 2, 8:30 AM, not Day 1, 3:30 PM). npm run dev starts fresh (it removes qa/state-v2.json). For npm start: stop the server, delete qa/state-v2.json, start.';
    expect(check(repo, { RELAY_STATE_PATH: other }).lines[4]).toBe(qa);
    fs.writeFileSync(repo.envPath, `RELAY_STATE_PATH=${other}\n`);
    expect(check(repo).lines[4]).toBe(qa);

    // A file outside the repo is named by its full path.
    const outside = tempRepo();
    expect(check(repo, { RELAY_STATE_PATH: outside.statePath }).lines[4])
      .toBe(`OK       Saved run: ${outside.statePath} is not there, so the server starts with the fresh run.`);
  }, T);
});

describe('demo check: the built client', () => {
  it('no build: WARN with npm run build, exit 0', () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    const { lines, code } = check(repo);
    expect(lines).toStrictEqual([
      GEMINI_OK, BROWSER_OK, SERVER_OK, TRAVEL_OK, RUN_ABSENT, BUILD_ABSENT,
      'Ready for the demo, with 1 warning: read the WARN line above.',
    ]);
    expect(code).toBe(0);

    // A folder without index.html is no build either (`hasBuiltClient` of the server).
    fs.mkdirSync(path.join(repo.clientDist, 'assets'), { recursive: true });
    expect(check(repo).lines[5]).toBe(BUILD_ABSENT);
  }, T);

  it('a build made before the browser key was added: WARN, because the key is written in at build time', () => {
    const repo = tempRepo();
    fs.writeFileSync(repo.envPath, ALL_KEYS);
    build(repo, null);
    expect(check(repo).lines[5]).toBe(BUILD_WITHOUT_KEY);

    build(repo, 'AIzaFAKE-another-key'); // built with a key that was replaced since
    expect(check(repo).lines[5]).toBe(BUILD_WITHOUT_KEY);

    build(repo, BROWSER);
    expect(check(repo).lines[5]).toBe(BUILD_WITH_KEY);
  }, T);

  it('a build and no browser key: the build line is OK and the key line carries the warning', () => {
    const repo = tempRepo();
    build(repo, BROWSER);
    const { lines } = check(repo);
    expect(lines[1]).toBe(BROWSER_WARN);
    expect(lines[5]).toBe(BUILD_OK);
  }, T);
});
