// No other program on 127.0.0.1 can answer for a test server of tests/api (#820).
//
// What went wrong: a test server listened on every address (`listen(0)`, which binds `::`) and the test called
// `http://127.0.0.1:<port>`. On this Mac a program that listens on 127.0.0.1 alone may hold the same port
// number, and it then gets every one of those calls (`Unexpected token 'M', "MCP server"... is not valid JSON`).
//
// Here that program is `startDummy`: an HTTP server on 127.0.0.1 that answers "MCP server" to everything.
//   1. Each helper that builds its own server now listens on 127.0.0.1 only: the dummy cannot take the helper's
//      port there, and the helper's own calls reach the Relay server.
//   2. A `startServer` server (every address) is started on the dummy's very port. Where the system allows that
//      (macOS), 127.0.0.1 answers "MCP server" and `ownOrigin` gives the address the Relay server answers on.
//   3. The files of this folder keep to the two rules of own-origin-helper.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createApp, portInUseMessage, startServer, type RelayServer } from '../../server/index';
import { ownAddress, ownOrigin } from './own-origin-helper';
import { noNetwork, startBootstrapApi, tempRepo, type TempRepo } from './v2-bootstrap-helper';
import { sampleCityTravel } from './v2-compare-helper';
import { startCommuteApp } from './v2-commute-route-helpers';
import { runWith, startControlServer } from './v2-control-helpers';
import { initialRun, smallScenario, startPlanningApi } from './v2-planning-routes-helper';
import { startPollApi } from './v2-poll-budget-helper';
import { startReadApi } from './v2-read-routes-helper';
import { startShipmentApp } from './v2-shipment-route-helpers';

const T = 30_000; // the longest `T` of the helpers started here (v2-poll-budget-helper.ts boots the NYC run)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP_TEXT = 'MCP server';

// ---------- the other program ----------

type Dummy = { server: http.Server; port: number; /** Every request it answered: "<method> <url>". */ hits: string[] };
const dummies: Dummy[] = [];

/**
 * Another program on this Mac: an HTTP server on 127.0.0.1 alone that answers plain "MCP server" to every
 * request. `port` 0 is any free port. Resolves to 'in_use' when 127.0.0.1:<port> is taken.
 */
function startDummy(port = 0): Promise<Dummy | 'in_use'> {
  return new Promise((resolve, reject) => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'text/plain');
      res.end(MCP_TEXT);
    });
    server.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve('in_use') : reject(e)));
    server.listen(port, '127.0.0.1', () => {
      const dummy: Dummy = { server, port: (server.address() as AddressInfo).port, hits };
      dummies.push(dummy);
      resolve(dummy);
    });
  });
}

async function mustStartDummy(): Promise<Dummy> {
  const dummy = await startDummy();
  if (dummy === 'in_use') throw new Error('own-origin: no free port on 127.0.0.1');
  return dummy;
}

/** GET over node:http (the global `fetch` is left alone): the status and the body as text. */
function getText(host: string, port: number, url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host, port, path: url, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closers.splice(0).reverse()) await close();
  for (const dummy of dummies.splice(0)) {
    dummy.server.closeAllConnections();
    await new Promise((resolve) => dummy.server.close(resolve));
  }
});

// ---------- 1. the helpers that build their own server ----------

type Reply = { status: number; body: unknown };
type HelperCase = {
  /** The helper file and its start function. */
  name: string;
  /** Starts the helper's server and returns one call made the helper's own way, plus its `close`. */
  start(): Promise<{ ask(): Promise<Reply>; close(): Promise<unknown> }>;
  /** What the Relay server answers to that call. */
  expected: { status: number; has: string };
};

const HELPERS: HelperCase[] = [
  {
    name: 'v2-bootstrap-helper.ts startBootstrapApi',
    start: async () => {
      const api = await startBootstrapApi({ cache: 'sample' });
      return { ask: () => api.v2.get('/simulator'), close: api.close };
    },
    expected: { status: 200, has: 'runId' },
  },
  {
    name: 'v2-commute-route-helpers.ts startCommuteApp',
    start: async () => {
      const app = await startCommuteApp();
      return { ask: () => app.put('emp-1', {}), close: () => app.close() };
    },
    expected: { status: 400, has: 'error' },
  },
  {
    name: 'v2-control-helpers.ts startControlServer',
    start: async () => {
      const server = await startControlServer(runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 }));
      return { ask: () => server.control({ action: 'play' }), close: () => server.close() };
    },
    expected: { status: 200, has: 'runId' },
  },
  {
    name: 'v2-planning-routes-helper.ts startPlanningApi',
    start: async () => {
      const api = await startPlanningApi({ run: initialRun(smallScenario()) });
      return { ask: () => api.get('/simulator'), close: api.close };
    },
    expected: { status: 200, has: 'runId' },
  },
  {
    name: 'v2-poll-budget-helper.ts startPollApi',
    start: async () => {
      const api = await startPollApi();
      return { ask: async () => ({ status: 200, body: await api.simulator() }), close: api.close }; // `simulator` itself expects 200
    },
    expected: { status: 200, has: 'runId' },
  },
  {
    name: 'v2-read-routes-helper.ts startReadApi',
    start: async () => {
      const api = await startReadApi({ travel: sampleCityTravel() });
      return { ask: () => api.get('/simulator'), close: api.close };
    },
    expected: { status: 200, has: 'runId' },
  },
  {
    name: 'v2-shipment-route-helpers.ts startShipmentApp',
    start: async () => {
      const app = await startShipmentApp();
      return { ask: () => app.create({}), close: () => app.close() };
    },
    expected: { status: 400, has: 'error' },
  },
];

describe('a helper that builds its own server listens on 127.0.0.1 only', () => {
  it.each(HELPERS)('$name: the dummy cannot take its port, and its calls reach the Relay server', async ({ start, expected }) => {
    const dummy = await mustStartDummy(); // the other program is running before the test server starts

    // The server the helper starts: every `listen` from here on is noted with the server it was called on.
    const real = net.Server.prototype.listen;
    const listening: net.Server[] = [];
    vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (this: net.Server, ...args: unknown[]) {
      listening.push(this);
      return (real as (...a: unknown[]) => net.Server).apply(this, args);
    });
    const helper = await start();
    closers.push(helper.close);
    vi.restoreAllMocks();

    expect(listening).toHaveLength(1);
    const address = listening[0].address() as AddressInfo;
    expect({ address: address.address, family: address.family }).toStrictEqual({ address: '127.0.0.1', family: 'IPv4' });
    expect(address.port).not.toBe(dummy.port);

    // The other program asks for the helper's port on 127.0.0.1 and does not get it. (While the helper listened
    // on every address, macOS gave it the port, and the helper's calls then went to the dummy.)
    const thief = await startDummy(address.port);
    expect(thief).toBe('in_use');

    const health = await getText('127.0.0.1', address.port, '/api/health');
    expect(health).toStrictEqual({ status: 200, text: '{"ok":true}' });

    const reply = await helper.ask();
    expect(reply.status).toBe(expected.status);
    expect(reply.body).toHaveProperty(expected.has);
    expect(dummies.flatMap((one) => one.hits)).toStrictEqual([]); // nothing went to the other program
  }, T);
});

// ---------- 2. `startServer`, which listens on every address ----------

type Booted = { server: RelayServer; repo: TempRepo; exits: number[]; outcome: 'listening' | 'in_use' };

/** `npm start` on a temp repo with `PORT` set to `port`. 'in_use': the system refused the port (the app then exits with 1). */
async function bootOn(port: number): Promise<Booted> {
  const repo = tempRepo('sample');
  const exits: number[] = [];
  const server = startServer({
    env: { PORT: String(port) },
    envPath: path.join(repo.root, '.env'),
    log: () => undefined,
    clientDist: path.join(repo.root, 'client', 'dist'),
    fixturesDir: repo.fixturesDir,
    statePath: repo.statePath,
    fetch: noNetwork().fetch,
    exit: (code) => void exits.push(code),
  });
  closers.push(async () => {
    await server.stop();
    repo.remove();
  });
  const outcome = await new Promise<Booted['outcome']>((resolve) => {
    server.once('listening', () => resolve('listening'));
    server.once('error', () => resolve('in_use'));
  });
  return { server, repo, exits, outcome };
}

describe('ownOrigin: a startServer server and another program on 127.0.0.1 with the same port', () => {
  it('gives the address where the Relay server answers, not the one where "MCP server" answers', async () => {
    const printed: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => void printed.push(args));
    const fetched = vi.spyOn(globalThis, 'fetch');
    const dummy = await mustStartDummy();

    const relay = await bootOn(dummy.port);

    if (relay.outcome === 'in_use') {
      // Linux (CI): a port held on 127.0.0.1 is refused to a server on every address, so the clash cannot
      // happen there. The app says so and exits; nothing is left to prove about the origin.
      expect(printed).toStrictEqual([[portInUseMessage(dummy.port)]]);
      expect(relay.exits).toStrictEqual([1]);
      return;
    }

    // macOS: both listen on the port. The server is on every address...
    expect(printed).toStrictEqual([]);
    expect(relay.server.address()).toStrictEqual({ address: '::', family: 'IPv6', port: dummy.port });
    // ...and the address the tests used to call is the other program's.
    expect(await getText('127.0.0.1', dummy.port, '/api/health')).toStrictEqual({ status: 200, text: MCP_TEXT });
    expect(dummy.hits).toStrictEqual(['GET /api/health']);

    const own = await ownAddress(relay.server);

    expect(own).toStrictEqual({ host: '::1', port: dummy.port, origin: `http://[::1]:${dummy.port}` });
    expect(await ownOrigin(relay.server)).toBe(own.origin);
    expect(fetched).not.toHaveBeenCalled(); // the proof goes over node:http: a test's `fetch` spy does not see it
    fetched.mockRestore();
    const health = await fetch(`${own.origin}/api/health`);
    expect(await health.json()).toStrictEqual({ ok: true });
    const simulator = await fetch(`${own.origin}/api/v2/simulator`);
    expect(simulator.status).toBe(200);
    expect(await simulator.json()).toHaveProperty('runId');
    expect(dummy.hits).toStrictEqual(['GET /api/health']); // only the one call this test made on purpose
  }, T);

  it('throws when only another program answers on the port: the test never goes on to call it', async () => {
    const dummy = await mustStartDummy();

    // The dummy itself as "the server": it listens on 127.0.0.1 and answers /api/health with 200 "MCP server".
    await expect(ownOrigin(dummy.server)).rejects.toThrow(
      `ownOrigin: the test server on port ${dummy.port} does not answer /api/health on http://127.0.0.1:${dummy.port}`,
    );
    expect(dummy.hits).toStrictEqual(['GET /api/health']);

    // A server on every address that has stopped, with the dummy on its port: `::1` is asked first, then 127.0.0.1.
    const gone = { address: () => ({ address: '::', family: 'IPv6', port: dummy.port }) } as unknown as net.Server;
    await expect(ownOrigin(gone)).rejects.toThrow(`on http://[::1]:${dummy.port} or http://127.0.0.1:${dummy.port}`);
    expect(dummy.hits).toStrictEqual(['GET /api/health', 'GET /api/health']);
  }, T);

  it('a server on 127.0.0.1 only is called on 127.0.0.1, and one on ::1 only on [::1]', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-origin-'));
    closers.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
    const dummy = await mustStartDummy();
    const listen = async (port: number, host: string): Promise<http.Server | null> => {
      const server = createApp({ clientDist: path.join(dir, 'no-dist') }).listen(port, host);
      const ok = await new Promise<boolean>((resolve) => {
        server.once('listening', () => resolve(true));
        server.once('error', () => resolve(false)); // no IPv6 loopback on this machine
      });
      if (ok) closers.push(() => new Promise((resolve) => server.close(resolve)));
      return ok ? server : null;
    };

    const v4 = await listen(0, '127.0.0.1');
    expect(v4).not.toBeNull();
    const port = (v4!.address() as AddressInfo).port;
    expect(await ownAddress(v4!)).toStrictEqual({ host: '127.0.0.1', port, origin: `http://127.0.0.1:${port}` });

    // The Relay app on ::1 with the dummy's port: allowed on every system (another address), and the same view
    // from a test as the clash above: 127.0.0.1:<port> is the other program, [::1]:<port> is the Relay server.
    const v6 = await listen(dummy.port, '::1');
    if (v6) {
      expect(await ownAddress(v6)).toStrictEqual({ host: '::1', port: dummy.port, origin: `http://[::1]:${dummy.port}` });
      expect(await (await fetch(`http://[::1]:${dummy.port}/api/health`)).json()).toStrictEqual({ ok: true });
    }
    expect(dummy.hits).toStrictEqual([]);
  }, T);
});

// ---------- 3. the files of this folder ----------

describe('the test files of tests/api keep to the two rules', () => {
  const files = fs.readdirSync(HERE).filter((name) => name.endsWith('.ts')).sort();
  const source = (name: string) => fs.readFileSync(path.join(HERE, name), 'utf8');
  const listenLines = (name: string) => source(name).split('\n').map((line) => line.trim()).filter((line) => /\.listen\(/.test(line));

  /**
   * `listen` calls that keep every address, with the reason. server-entry.test.ts: `freePorts` holds ports
   * "the way the server does" to find ones that are free for `startServer`; nothing ever calls the holders.
   */
  const EVERY_ADDRESS: Record<string, string[]> = {
    // Written in two parts so that this line is not itself a `listen` call to the scan.
    'server-entry.test.ts': [['holder', 'listen(0, () => resolve(holder));'].join('.')],
  };

  it('every server a test builds itself listens on 127.0.0.1 (or ::1), never on every address', () => {
    const open = files.flatMap((name) => listenLines(name)
      .filter((line) => !/\.listen\([^)]*'(127\.0\.0\.1|::1)'/.test(line) && !/\.listen\(port, host\)/.test(line))
      .filter((line) => !(EVERY_ADDRESS[name] ?? []).includes(line))
      .map((line) => `${name}: ${line}`));
    expect(open).toStrictEqual([]);
    // The exceptions are still there as written (a changed line must be looked at again).
    for (const [name, lines] of Object.entries(EVERY_ADDRESS)) expect(listenLines(name)).toEqual(expect.arrayContaining(lines));
    expect(files.filter((name) => listenLines(name).length > 0).length).toBeGreaterThanOrEqual(19); // the scan finds them
  });

  it('every file that starts the whole server (startServer) asks own-origin-helper.ts for its address', () => {
    const starters = files.filter((name) => /\bstartServer\(\{/.test(source(name)));
    expect(starters.length).toBeGreaterThanOrEqual(8); // the scan finds them (seven test files and this one)
    const unproved = starters.filter((name) => !/await own(Origin|Address)\(/.test(source(name)) || !source(name).includes("from './own-origin-helper'"));
    expect(unproved).toStrictEqual([]);
  });
});
