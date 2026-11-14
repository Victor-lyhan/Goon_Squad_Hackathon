// The server's entry (#600): `startServer` of server/index.ts, which `npm start` and `npm run dev` call.
// - `.env` is loaded before PORT is read; a PORT in `.env` is used and one in the environment wins.
// - The listening line prints the port the server is really bound to.
// - One start line each for the built client and for the Google server key (set or not set, never its value).
// - Without a build a page request answers 404 with what to do, not Express's "Cannot GET /".
// Everything runs on a temp folder (v2-bootstrap-helper.ts): its own `.env`, its own state files, a copy of
// the NYC fixture files with the sample travel cache. The repo's `.env` and data/ are never read or written,
// `process.env` is never passed in, and nothing reaches the network.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  CLIENT_MISSING_LINE, CLIENT_SERVED_LINE, KEY_NOT_SET_LINE, KEY_SET_LINE,
  clientStartLine, keyStartLine, portInUseMessage, startServer, v2StartLines, type RelayServer,
} from '../../server/index';
import { DEFAULT_V2_STATE_PATH } from '../../server/api/v2/bootRun';
import { TRAVEL_NOT_LOADED_MESSAGE } from '../../server/api/v2/errors';
import { FAKE_KEY, noNetwork, T, tempRepo, type CacheKind, type TempRepo } from './v2-bootstrap-helper';

const V2_READY_LINE = 'Relay MVP II API ready at /api/v2 (NYC travel cache loaded)';
const SHELL = '<!doctype html><html><body><div id="root">relay-shell</div></body></html>';

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

type Started = {
  server: RelayServer;
  repo: TempRepo;
  env: Record<string, string | undefined>;
  /** Every line `startServer` gave to `log`, in order. */
  lines: string[];
  /** The port the server is bound to. */
  port: number;
  origin: string;
  exits: number[];
  network: string[];
};

const started: Started[] = [];
/** Every console call of the test: the start lines must go to `log` and nowhere else. */
let printed: { method: string; args: unknown[] }[];

beforeEach(() => {
  printed = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void printed.push({ method, args }));
  }
});
afterEach(async () => {
  for (const one of started.splice(0)) {
    await one.server.stop();
    one.repo.remove();
  }
  vi.restoreAllMocks();
});

type BootOptions = {
  cache?: CacheKind;
  /** The environment given to the server. Default `{ PORT: '0' }`: any free port. */
  env?: Record<string, string | undefined>;
  /** The text of the temp folder's `.env`. Not written when left out. */
  dotEnv?: string;
  /** Write a built client into the temp folder's client/dist. */
  built?: boolean;
};

function begin(opts: BootOptions = {}): Started {
  const repo = tempRepo(opts.cache ?? 'sample');
  const envPath = path.join(repo.root, '.env');
  if (opts.dotEnv !== undefined) fs.writeFileSync(envPath, opts.dotEnv);
  const clientDist = path.join(repo.root, 'client', 'dist');
  if (opts.built) {
    fs.mkdirSync(clientDist, { recursive: true });
    fs.writeFileSync(path.join(clientDist, 'index.html'), SHELL);
  }
  const env = opts.env ?? { PORT: '0' };
  const lines: string[] = [];
  const exits: number[] = [];
  const network = noNetwork();
  const server = startServer({
    env,
    envPath,
    log: (line) => void lines.push(line),
    clientDist,
    fixturesDir: repo.fixturesDir,
    statePath: repo.statePath,
    fetch: network.fetch,
    exit: (code) => void exits.push(code),
  });
  const one: Started = { server, repo, env, lines, port: 0, origin: '', exits, network: network.calls };
  started.push(one);
  return one;
}

async function boot(opts: BootOptions = {}): Promise<Started> {
  const one = begin(opts);
  await new Promise<void>((resolve, reject) => {
    one.server.once('listening', () => resolve());
    one.server.once('error', reject);
  });
  one.port = (one.server.address() as AddressInfo).port;
  one.origin = `http://127.0.0.1:${one.port}`;
  return one;
}

/** `count` ports that are free right now, found by binding them the way the server does and letting go. */
async function freePorts(count: number): Promise<number[]> {
  const holders = await Promise.all(Array.from({ length: count }, () => new Promise<net.Server>((resolve) => {
    const holder = net.createServer();
    holder.listen(0, () => resolve(holder));
  })));
  const ports = holders.map((holder) => (holder.address() as AddressInfo).port);
  await Promise.all(holders.map((holder) => new Promise((resolve) => holder.close(resolve))));
  return ports;
}

const listeningLine = (port: number) => `Relay API listening on http://localhost:${port}`;

describe('PORT', () => {
  it('a PORT in .env is used: .env is loaded before PORT is read', async () => {
    const [port] = await freePorts(1);
    const one = await boot({ env: {}, dotEnv: `# the demo machine\nPORT=${port}\n` });
    expect(one.port).toBe(port);
    expect(one.lines.at(-1)).toBe(listeningLine(port));
    expect(one.env.PORT).toBe(String(port)); // loaded into the environment it was given
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
  }, T);

  it('a PORT in the environment wins over the one in .env', async () => {
    const [fromFile, fromEnv] = await freePorts(2);
    const one = await boot({ env: { PORT: String(fromEnv) }, dotEnv: `PORT=${fromFile}\n` });
    expect(one.port).toBe(fromEnv);
    expect(one.lines.at(-1)).toBe(listeningLine(fromEnv));
    expect(one.env.PORT).toBe(String(fromEnv));
  }, T);

  it('the listening line prints the bound port, not the configured one (PORT=0 and an empty PORT)', async () => {
    const [fromFile] = await freePorts(1);
    for (const configured of ['0', '']) {
      // An empty PORT in the environment is still "set", so the file's port is not used.
      const one = await boot({ env: { PORT: configured }, dotEnv: `PORT=${fromFile}\n` });
      expect(one.port).toBeGreaterThan(0);
      expect(one.lines.at(-1)).toBe(listeningLine(one.port));
      expect(one.lines.join('\n')).not.toContain('localhost:0');
      expect(one.lines.filter((line) => line.startsWith('Relay API listening'))).toHaveLength(1);
    }
  }, T);

  it('with no PORT anywhere the port is 3001', async () => {
    // 3001 may be taken on this machine (a running `npm run dev`). Either way the server asked for 3001.
    const one = begin({ env: {} });
    const outcome = await new Promise<'listening' | 'busy'>((resolve) => {
      one.server.once('listening', () => resolve('listening'));
      one.server.once('error', () => resolve('busy'));
    });
    if (outcome === 'listening') {
      expect((one.server.address() as AddressInfo).port).toBe(3001);
      expect(one.lines.at(-1)).toBe(listeningLine(3001));
      expect(one.exits).toStrictEqual([]);
    } else {
      expect(printed.filter((p) => p.method === 'error').map((p) => p.args)).toStrictEqual([[portInUseMessage(3001)]]);
      expect(one.exits).toStrictEqual([1]);
    }
  }, T);

  it('a busy port prints the one-line hint with the configured port and exits with code 1', async () => {
    const first = await boot();
    const second = begin({ env: { PORT: String(first.port) } });
    await new Promise((resolve) => second.server.once('error', resolve));
    expect(printed).toStrictEqual([{ method: 'error', args: [portInUseMessage(first.port)] }]);
    expect(second.exits).toStrictEqual([1]);
    expect(second.lines.some((line) => line.startsWith('Relay API listening'))).toBe(false);
    expect((await fetch(`${first.origin}/api/health`)).status).toBe(200); // the first server is not disturbed
  }, T);
});

describe('the start line about the built client', () => {
  it('with client/dist: says it is served, once, and a page request gets the app shell', async () => {
    const one = await boot({ built: true });
    expect(one.lines.filter((line) => line.includes('client/dist'))).toStrictEqual(['Serving the built client from client/dist']);
    for (const url of ['/', '/simulator?package=shp-1', '/employee/emp-1']) {
      const res = await fetch(one.origin + url);
      expect([url, res.status]).toStrictEqual([url, 200]);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('relay-shell');
    }
  }, T);

  it('without client/dist: says what to run, once, and GET / answers 404 with the same short text', async () => {
    const one = await boot();
    const missing = 'client/dist not found: run npm run build, or use npm run dev';
    expect(one.lines.filter((line) => line.includes('client/dist'))).toStrictEqual([missing]);
    for (const url of ['/', '/simulator?package=shp-1', '/business/x']) {
      const res = await fetch(one.origin + url);
      expect([url, res.status]).toStrictEqual([url, 404]);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toBe(missing);
      expect(text).not.toContain('Cannot GET');
    }
    // The API is served all the same, and an unknown API path stays a JSON 404.
    expect(await (await fetch(`${one.origin}/api/health`)).json()).toStrictEqual({ ok: true });
    const unknown = await fetch(`${one.origin}/api/no-such-route`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toStrictEqual({ error: 'Not found' });
    expect(printed).toStrictEqual([]); // a 404 logs nothing
  }, T);

  it('a client/dist folder without index.html counts as missing', () => {
    const repo = tempRepo('empty');
    try {
      const emptyDist = path.join(repo.root, 'client', 'dist');
      expect(clientStartLine(emptyDist)).toBe(CLIENT_MISSING_LINE); // no folder
      fs.mkdirSync(emptyDist, { recursive: true });
      expect(clientStartLine(emptyDist)).toBe(CLIENT_MISSING_LINE); // a folder a failed build left behind
      fs.writeFileSync(path.join(emptyDist, 'index.html'), SHELL);
      expect(clientStartLine(emptyDist)).toBe(CLIENT_SERVED_LINE);
    } finally {
      repo.remove();
    }
  }, T);
});

describe('the start line about the Google server key', () => {
  const keyLines = (one: Started) => one.lines.filter((line) => line.startsWith('Google server key'));

  it('a key in .env: "set", and the key is in no log line', async () => {
    const one = await boot({ dotEnv: `GOOGLE_MAPS_SERVER_KEY=${FAKE_KEY}\nVITE_GOOGLE_MAPS_BROWSER_KEY=FAKE-browser-key-77c1\n` });
    expect(one.env.GOOGLE_MAPS_SERVER_KEY).toBe(FAKE_KEY); // the server really started with it
    expect(keyLines(one)).toStrictEqual(['Google server key: set']);
    expect((await fetch(`${one.origin}/api/v2/simulator`)).status).toBe(200);
    for (const line of one.lines) {
      expect(line).not.toContain(FAKE_KEY);
      expect(line).not.toContain('FAKE-browser-key-77c1');
      expect(line).not.toContain(String(FAKE_KEY.length));
    }
    expect(JSON.stringify(printed)).not.toContain(FAKE_KEY);
    expect(printed).toStrictEqual([]);
    expect(one.network).toStrictEqual([]); // starting with a key calls nothing
  }, T);

  it('a key in the environment: "set", without the value', async () => {
    const one = await boot({ env: { PORT: '0', GOOGLE_MAPS_SERVER_KEY: FAKE_KEY } });
    expect(keyLines(one)).toStrictEqual(['Google server key: set']);
    expect(one.lines.join('\n')).not.toContain(FAKE_KEY);
    expect(JSON.stringify(printed)).not.toContain(FAKE_KEY);
  }, T);

  it('no key, or a blank one: "not set", with what answers 503', async () => {
    const notSet = 'Google server key: not set (address search and a commute save with a new address answer 503)';
    const none = await boot();
    expect(keyLines(none)).toStrictEqual([notSet]);
    const blank = await boot({ dotEnv: 'GOOGLE_MAPS_SERVER_KEY=   \n' });
    expect(keyLines(blank)).toStrictEqual([notSet]);

    // The line is true: the address search of this server answers the documented 503.
    const search = await fetch(`${none.origin}/api/v2/geocode?q=350%20Fifth%20Avenue`);
    expect(search.status).toBe(503);
    expect(((await search.json()) as { code: string }).code).toBe('google_key_missing');
    expect(none.network).toStrictEqual([]);
  }, T);

  it('keyStartLine never holds what it was given', () => {
    expect(keyStartLine(FAKE_KEY)).toBe(KEY_SET_LINE);
    for (const empty of [null, undefined, '', '  ']) expect(keyStartLine(empty)).toBe(KEY_NOT_SET_LINE);
  });
});

describe('all start lines', () => {
  it('NYC cache loaded, built client, key: four lines in this order, through `log` only', async () => {
    const one = await boot({ built: true, dotEnv: `GOOGLE_MAPS_SERVER_KEY=${FAKE_KEY}\n` });
    expect(one.lines).toStrictEqual([
      V2_READY_LINE,
      'Serving the built client from client/dist',
      'Google server key: set',
      listeningLine(one.port),
    ]);
    expect(one.lines.slice(0, 1)).toStrictEqual(v2StartLines({ status: 'ready' })); // the MVP II lines are unchanged
    expect(printed).toStrictEqual([]);
  }, T);

  it('no travel cache, no build, no key: the 503 reason, then the two "missing" lines, then the address', async () => {
    const one = await boot({ cache: 'empty' });
    expect(one.lines).toStrictEqual([
      `Relay MVP II API (/api/v2) is not loaded and answers 503: ${TRAVEL_NOT_LOADED_MESSAGE}`,
      'client/dist not found: run npm run build, or use npm run dev',
      'Google server key: not set (address search and a commute save with a new address answer 503)',
      listeningLine(one.port),
    ]);
    expect((await fetch(`${one.origin}/api/v2/simulator`)).status).toBe(503);
    expect((await fetch(`${one.origin}/api/simulator`)).status).toBe(200); // MVP 1 still answers
    expect(fs.existsSync(one.repo.statePath)).toBe(false);
  }, T);
});

describe('stop()', () => {
  it('closes the server and saves both runs paused in the temp folder; a second call is the same promise', async () => {
    const one = await boot();
    const play = await fetch(`${one.origin}/api/v2/simulator/control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'play' }),
    });
    expect(play.status).toBe(200);
    expect(((await play.json()) as { clock: { playing: boolean } }).clock.playing).toBe(true);

    const stopping = one.server.stop();
    expect(one.server.stop()).toBe(stopping);
    await stopping;
    expect(one.server.listening).toBe(false);
    await expect(fetch(`${one.origin}/api/health`)).rejects.toThrow();

    const v2 = JSON.parse(fs.readFileSync(one.repo.statePath, 'utf8'));
    expect(v2.run.clock).toMatchObject({ phase: 'locked', playing: false });
    // The MVP 1 state file is next to it, by default.
    const mvp1 = JSON.parse(fs.readFileSync(one.repo.mvp1StatePath, 'utf8'));
    expect(mvp1.run.clock.playing).toBe(false);
  }, T);
});
