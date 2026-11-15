// Three server fixes from the production-mode QA (#727), on the real `startServer` / `createApp` of server/index.ts:
// - RELAY_STATE_PATH gives a server its own MVP II state file, so a QA or second server never creates or
//   changes the default one (`data/state-v2.json` in the app). The shell wins over `.env`, like PORT.
// - a missing file under /assets/ answers 404, never the app shell;
// - HEAD on a page path answers like GET (index.html's status and headers, no body), and HEAD and every
//   other method on an unknown /api or /api/v2 path stay JSON (404, or 503 while /api/v2 is not loaded).
// Everything runs on a temp folder (v2-bootstrap-helper.ts): its own `.env`, its own state folders, its own
// client/dist. The repo's data/, client/dist and `.env` are never read or written, `process.env` is never
// passed in, and nothing reaches the network.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  CLIENT_MISSING_LINE, STATE_PATH_NAME, createApp, startServer, statePathFrom, stateStartLine, type RelayServer,
} from '../../server/index';
import { DEFAULT_V2_STATE_PATH, sourcePathFor } from '../../server/api/v2/bootRun';
import type { SimulatorResponse } from '../../shared/v2/api';
import { FAKE_KEY, noNetwork, T, tempRepo, type CacheKind, type TempRepo } from './v2-bootstrap-helper';

const INDEX = '<!doctype html><html><head><title>Relay</title></head><body><div id="root">relay-shell</div></body></html>';
/** Made-up built files, named like Vite's output. The font bytes are not real fonts: only the serving is tested. */
const ASSETS: [name: string, body: string, type: string][] = [
  ['index-Cz_NeMQt.js', 'console.log("relay-asset");', 'text/javascript'],
  ['index-dmrJd8lK.css', 'body { margin: 0; }', 'text/css'],
  ['inter-latin-400-normal-C38fXH4l.woff2', 'inter-woff2', 'font/woff2'],
  ['inter-latin-400-normal-CyCys3Eg.woff', 'inter-woff', 'font/woff'],
];
const PAGES = [
  '/',
  '/simulator',
  '/simulator?package=x&play=1',
  '/business/biz-1',
  '/business/biz-1?shipment=shp-1',
  '/employee/emp-1?job=plan-shp-1-L0',
  '/nope',
];
const NOT_FOUND = JSON.stringify({ error: 'Not found' });

function writeDist(repo: TempRepo): string {
  const dist = path.join(repo.root, 'client', 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
  for (const [name, body] of ASSETS) fs.writeFileSync(path.join(dist, 'assets', name), body);
  return dist;
}

type Started = { server: RelayServer; repo: TempRepo; origin: string; lines: string[]; network: string[] };
type BootOptions = {
  /** An existing temp repo: a second server, or a restart, on the same folder. */
  repo?: TempRepo;
  cache?: CacheKind;
  /** The environment given to the server, next to `PORT=0`. */
  env?: Record<string, string | undefined>;
  /** The text of the temp folder's `.env`. Not written when left out. */
  dotEnv?: string;
  /** Write a built client into the temp folder's client/dist. */
  built?: boolean;
};

const started: Started[] = [];
const repos: TempRepo[] = [];

/** `npm start` on a temp repo. `statePath` is the repo's default, as `DEFAULT_V2_STATE_PATH` is in the app. */
async function boot(opts: BootOptions = {}): Promise<Started> {
  const repo = opts.repo ?? tempRepo(opts.cache ?? 'sample');
  if (!opts.repo) repos.push(repo);
  const envPath = path.join(repo.root, '.env');
  if (opts.dotEnv !== undefined) fs.writeFileSync(envPath, opts.dotEnv);
  if (opts.built) writeDist(repo);
  const lines: string[] = [];
  const network = noNetwork();
  const server = startServer({
    env: { PORT: '0', ...opts.env },
    envPath,
    log: (line) => void lines.push(line),
    clientDist: path.join(repo.root, 'client', 'dist'),
    fixturesDir: repo.fixturesDir,
    statePath: repo.statePath,
    fetch: network.fetch,
    exit: () => undefined,
  });
  const one: Started = { server, repo, origin: '', lines, network: network.calls };
  started.push(one);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  one.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return one;
}

/** Stops one server now, as Ctrl-C does: the ticker stops, the clock pauses and the state file is written. */
async function stop(one: Started): Promise<void> {
  await one.server.stop();
  started.splice(started.indexOf(one), 1);
}

const call = async (origin: string, method: string, url: string) => {
  const withBody = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method);
  const res = await fetch(origin + url, {
    method,
    headers: withBody ? { 'Content-Type': 'application/json' } : undefined,
    body: withBody ? '{}' : undefined,
  });
  return {
    status: res.status,
    type: (res.headers.get('content-type') ?? '').split(';')[0],
    length: res.headers.get('content-length'),
    etag: res.headers.get('etag'),
    modified: res.headers.get('last-modified'),
    text: await res.text(),
  };
};

const control = async (one: Started, body: unknown) => {
  const res = await fetch(`${one.origin}/api/v2/simulator/control`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SimulatorResponse;
};
const simulator = async (one: Started) => (await (await fetch(`${one.origin}/api/v2/simulator`)).json()) as SimulatorResponse;
const savedClock = (file: string) => (JSON.parse(fs.readFileSync(file, 'utf8')).run as { clock: SimulatorResponse['clock'] }).clock;

/** Every file under `dir` with its bytes and its modification time: equal before and after means untouched. */
function folderState(dir: string): Record<string, string> | null {
  if (!fs.existsSync(dir)) return null;
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    out[name] = `${fs.statSync(file).mtimeMs} ${fs.readFileSync(file, 'utf8')}`;
  }
  return out;
}

const stateLines = (one: Started) => one.lines.filter((line) => line.startsWith('State file'));
const dataDir = (repo: TempRepo) => path.dirname(repo.statePath);

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

afterEach(async () => {
  for (const one of started.splice(0)) await one.server.stop();
  for (const repo of repos.splice(0)) repo.remove();
});

describe('RELAY_STATE_PATH: a server with its own state file', () => {
  it('reads and writes that file, names it in the first start line, and never creates the default one', async () => {
    const repo = tempRepo('sample');
    repos.push(repo);
    const own = path.join(repo.root, 'qa', 'run', 'state-v2.json'); // a folder that does not exist yet
    const first = await boot({ repo, env: { [STATE_PATH_NAME]: own } });
    expect(first.lines[0]).toBe(`State file: ${own} (RELAY_STATE_PATH)`);
    expect(stateLines(first)).toHaveLength(1);
    await control(first, { action: 'play' });
    const seeked = await control(first, { action: 'seek', timeMin: 1422 });
    await stop(first);

    expect(fs.existsSync(own)).toBe(true);
    expect(fs.existsSync(sourcePathFor(own))).toBe(true); // the sidecar of pass 55 goes with the file
    expect(savedClock(own).timeMin).toBeGreaterThanOrEqual(1422);
    expect(fs.existsSync(dataDir(repo))).toBe(false); // not the default file, not its sidecar, not even its folder

    // A restart with the same variable resumes that run, paused; nothing is set aside.
    const second = await boot({ repo, env: { [STATE_PATH_NAME]: own } });
    expect(second.lines.filter((line) => line.includes('stale') || line.includes('.bad-'))).toStrictEqual([]);
    const restored = await simulator(second);
    expect(restored.clock).toStrictEqual(savedClock(own));
    expect(restored.clock.playing).toBe(false);
    expect(restored.runId).toBe(seeked.runId);
    expect(restored.plans).toStrictEqual(seeked.plans);
    expect(fs.existsSync(dataDir(repo))).toBe(false);
    expect(fs.readdirSync(path.dirname(own)).sort()).toStrictEqual(['state-v2.json', 'state-v2.source.json']);
    expect([...first.network, ...second.network]).toStrictEqual([]);
  }, 2 * T);

  it('a QA server next to a saved default run leaves data/state-v2.json and its sidecar byte for byte as they were', async () => {
    // The demo server: no variable, the default file.
    const demo = await boot();
    expect(stateLines(demo)).toStrictEqual([]);
    await control(demo, { action: 'seek', timeMin: 1300 });
    await stop(demo);
    const before = folderState(dataDir(demo.repo));
    expect(Object.keys(before ?? {})).toStrictEqual(['state-v2.json', 'state-v2.source.json']);

    // The QA server on the same folder, with its own file: it starts from the default run, not the saved one.
    const own = path.join(demo.repo.root, 'qa-state.json');
    const qa = await boot({ repo: demo.repo, env: { [STATE_PATH_NAME]: own } });
    expect((await simulator(qa)).clock.timeMin).toBeLessThan(1300);
    await control(qa, { action: 'play' });
    await control(qa, { action: 'seek', timeMin: 1422 });
    await stop(qa);
    expect(savedClock(own).timeMin).toBeGreaterThanOrEqual(1422);
    expect(folderState(dataDir(demo.repo))).toStrictEqual(before);

    // And the demo server still finds its own run, where it left it.
    const again = await boot({ repo: demo.repo });
    expect(stateLines(again)).toStrictEqual([]);
    expect((await simulator(again)).clock).toStrictEqual(savedClock(demo.repo.statePath));
    expect(savedClock(demo.repo.statePath).timeMin).toBe(1300);
  }, 2 * T);

  it('a path in .env is used, and one in the shell wins over it, like PORT', async () => {
    const repo = tempRepo('sample');
    repos.push(repo);
    const fromFile = path.join(repo.root, 'from-dotenv', 'state-v2.json');
    const fromShell = path.join(repo.root, 'from-shell', 'state-v2.json');
    const dotEnv = `GOOGLE_MAPS_SERVER_KEY=${FAKE_KEY}\n${STATE_PATH_NAME}=${fromFile}\n`;

    const file = await boot({ repo, dotEnv });
    expect(file.lines[0]).toBe(`State file: ${fromFile} (RELAY_STATE_PATH)`);
    await control(file, { action: 'seek', timeMin: 1300 });
    await stop(file);
    expect(fs.existsSync(fromFile)).toBe(true);
    expect(fs.existsSync(path.dirname(fromShell))).toBe(false);

    const shell = await boot({ repo, dotEnv, env: { [STATE_PATH_NAME]: fromShell } });
    expect(shell.lines[0]).toBe(`State file: ${fromShell} (RELAY_STATE_PATH)`);
    const fileBefore = folderState(path.dirname(fromFile));
    await control(shell, { action: 'seek', timeMin: 1400 });
    await stop(shell);
    expect(savedClock(fromShell).timeMin).toBe(1400);
    expect(folderState(path.dirname(fromFile))).toStrictEqual(fileBefore);
    expect(fs.existsSync(dataDir(repo))).toBe(false);

    // The state line holds a path and the key line says "set": no start line holds the key.
    for (const line of [...file.lines, ...shell.lines]) expect(line).not.toContain(FAKE_KEY);
    expect([...file.lines, ...shell.lines]).toContain('Google server key: set');
  }, 2 * T);

  it('unset, blank, or the default path itself: the default file as before, and no state line', async () => {
    const repo = tempRepo('sample');
    repos.push(repo);
    for (const env of [{}, { [STATE_PATH_NAME]: '' }, { [STATE_PATH_NAME]: '   ' }, { [STATE_PATH_NAME]: repo.statePath }]) {
      const one = await boot({ repo, env });
      expect([env, stateLines(one)]).toStrictEqual([env, []]);
      expect(one.lines[0]).toBe('Relay MVP II API ready at /api/v2 (NYC travel cache loaded)');
      await control(one, { action: 'seek', timeMin: 1300 });
      await stop(one);
      expect(savedClock(repo.statePath).timeMin).toBe(1300);
      expect(fs.readdirSync(repo.root).sort()).toStrictEqual(['data', 'fixtures']); // and nothing else appeared
      fs.rmSync(dataDir(repo), { recursive: true });
    }
  }, 2 * T);

  it('a folder means state-v2.json inside it: the folder itself is never renamed as a bad state file', async () => {
    const repo = tempRepo('sample');
    repos.push(repo);
    const folder = path.join(repo.root, 'qa');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'kept');
    for (const given of [folder, `${folder}${path.sep}`, `${path.join(repo.root, 'new-folder')}${path.sep}`]) {
      const inside = path.join(path.resolve(given), 'state-v2.json');
      const one = await boot({ repo, env: { [STATE_PATH_NAME]: given } });
      expect(one.lines[0]).toBe(`State file: ${inside} (RELAY_STATE_PATH)`);
      await control(one, { action: 'seek', timeMin: 1300 });
      await stop(one);
      expect(savedClock(inside).timeMin).toBe(1300);
    }
    expect(fs.readdirSync(repo.root).sort()).toStrictEqual(['fixtures', 'new-folder', 'qa']); // no qa.bad-1
    expect(fs.readdirSync(folder).sort()).toStrictEqual(['notes.txt', 'state-v2.json', 'state-v2.source.json']);
  }, 2 * T);

  it('while /api/v2 is not loaded the named file is not created either', async () => {
    const repo = tempRepo('empty');
    repos.push(repo);
    const own = path.join(repo.root, 'qa', 'state-v2.json');
    const one = await boot({ repo, env: { [STATE_PATH_NAME]: own } });
    expect(one.lines.slice(0, 2)).toStrictEqual([
      `State file: ${own} (RELAY_STATE_PATH)`,
      expect.stringContaining('is not loaded and answers 503'),
    ]);
    expect((await call(one.origin, 'GET', '/api/v2/simulator')).status).toBe(503);
    await stop(one);
    expect(fs.readdirSync(repo.root).sort()).toStrictEqual(['fixtures']);
  }, T);

  it('statePathFrom and stateStartLine: the rule without a server', () => {
    const fallback = path.join('/repo', 'data', 'state-v2.json');
    expect(statePathFrom({}, fallback)).toBe(fallback);
    expect(statePathFrom({ [STATE_PATH_NAME]: undefined }, fallback)).toBe(fallback);
    expect(statePathFrom({ [STATE_PATH_NAME]: ' ' }, fallback)).toBe(fallback);
    expect(statePathFrom({ [STATE_PATH_NAME]: ' /tmp/x/state-v2.json ' }, fallback)).toBe(path.resolve('/tmp/x/state-v2.json'));
    expect(statePathFrom({ [STATE_PATH_NAME]: 'qa/mine.json' }, fallback)).toBe(path.resolve(process.cwd(), 'qa/mine.json'));
    expect(statePathFrom({ [STATE_PATH_NAME]: '/tmp/relay-no-such-folder/' }, fallback)).toBe(path.resolve('/tmp/relay-no-such-folder/state-v2.json'));

    expect(stateStartLine(fallback, fallback)).toBeNull();
    expect(stateStartLine(path.join('/repo', 'data', '..', 'data', 'state-v2.json'), fallback)).toBeNull();
    expect(stateStartLine('/tmp/x/state-v2.json', fallback)).toBe('State file: /tmp/x/state-v2.json (RELAY_STATE_PATH)');
  });
});

describe('a missing file under /assets/ with a built client', () => {
  it('answers 404, never index.html; existing assets, pages and deep links answer as before', async () => {
    const one = await boot({ built: true });
    const missing = [
      '/assets/does-not-exist.js',
      '/assets/index-OLDHASH0.css',
      '/assets/inter-latin-400-normal-OLDHASH0.woff2',
      '/assets/chunks/also-missing.js',
      '/assets/does-not-exist.js?v=2',
      '/assets/',
    ];
    for (const url of missing) {
      for (const method of ['GET', 'HEAD']) {
        const res = await call(one.origin, method, url);
        expect([method, url, res.status, res.type]).toStrictEqual([method, url, 404, 'text/plain']);
        expect(res.text).not.toContain('relay-shell');
        if (method === 'GET') expect(res.text).toBe('Not found');
      }
    }
    for (const [name, body, type] of ASSETS) {
      const res = await call(one.origin, 'GET', `/assets/${name}`);
      expect([name, res.status, res.type, res.text]).toStrictEqual([name, 200, type, body]);
      const head = await call(one.origin, 'HEAD', `/assets/${name}`);
      expect([name, head.status, head.type, head.length, head.text]).toStrictEqual([name, 200, type, String(body.length), '']);
    }
    for (const url of [...PAGES, '/assets-list', '/business/assets/x']) { // only the /assets/ folder is special
      const res = await call(one.origin, 'GET', url);
      expect([url, res.status, res.type, res.text]).toStrictEqual([url, 200, 'text/html', INDEX]);
    }
    expect(one.network).toStrictEqual([]);
  }, T);
});

describe('HEAD', () => {
  it('on a page path or a deep link answers 200 with the index.html headers and no body', async () => {
    const one = await boot({ built: true });
    for (const url of PAGES) {
      const get = await call(one.origin, 'GET', url);
      const head = await call(one.origin, 'HEAD', url);
      expect([url, head.status, head.type, head.text]).toStrictEqual([url, 200, 'text/html', '']);
      expect([url, head.length, head.etag, head.modified]).toStrictEqual([url, String(INDEX.length), get.etag, get.modified]);
      expect(head.etag).toBeTruthy();
    }
    expect(one.network).toStrictEqual([]);
  }, T);

  it('and every other method on an unknown /api or /api/v2 path stay the JSON 404, with a built client', async () => {
    const one = await boot({ built: true });
    for (const url of ['/api/x', '/api/v2/x', '/api/v2/x/y?z=1', '/api/v2/simulator/nope', '/api/assets/x.js']) {
      for (const method of ['HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const res = await call(one.origin, method, url);
        expect([method, url, res.status, res.type]).toStrictEqual([method, url, 404, 'application/json']);
        expect([method, url, res.text]).toStrictEqual([method, url, method === 'HEAD' ? '' : NOT_FOUND]);
        if (method === 'HEAD') expect(res.length).toBe(String(NOT_FOUND.length)); // the JSON body's headers, not index.html's
      }
    }
    const health = await call(one.origin, 'HEAD', '/api/health');
    expect([health.status, health.type, health.text]).toStrictEqual([200, 'application/json', '']);
    expect(one.network).toStrictEqual([]);
  }, T);

  it('while /api/v2 is not loaded every method on /api/v2 is the JSON 503, /api/x the 404, and pages still answer', async () => {
    const repo = tempRepo('empty');
    repos.push(repo);
    const server = createApp({ clientDist: writeDist(repo) }).listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const method of ['HEAD', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const v2 = await call(origin, method, '/api/v2/x');
        expect([method, v2.status, v2.type]).toStrictEqual([method, 503, 'application/json']);
        expect(v2.text).not.toContain('relay-shell');
        if (method !== 'HEAD') expect(typeof JSON.parse(v2.text).error).toBe('string');
        const other = await call(origin, method, '/api/x');
        expect([method, other.status, other.type, other.text]).toStrictEqual([method, 404, 'application/json', method === 'HEAD' ? '' : NOT_FOUND]);
      }
      const page = await call(origin, 'HEAD', '/business/biz-1?shipment=shp-1');
      expect([page.status, page.type, page.length, page.text]).toStrictEqual([200, 'text/html', String(INDEX.length), '']);
      expect((await call(origin, 'HEAD', '/assets/does-not-exist.js')).status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, T);

  it('other methods on a page path are still no page, and without a build HEAD gets the same 404 as GET', async () => {
    const built = await boot({ built: true });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await call(built.origin, method, '/simulator');
      expect([method, res.status]).toStrictEqual([method, 404]);
      expect(res.text).not.toContain('relay-shell');
    }
    const bare = await boot();
    const get = await call(bare.origin, 'GET', '/simulator');
    const head = await call(bare.origin, 'HEAD', '/simulator');
    expect([get.status, get.type, get.text]).toStrictEqual([404, 'text/plain', CLIENT_MISSING_LINE]);
    expect([head.status, head.type, head.length, head.text]).toStrictEqual([404, 'text/plain', String(CLIENT_MISSING_LINE.length), '']);
  }, T);
});
