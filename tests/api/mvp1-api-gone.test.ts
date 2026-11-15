// The MVP 1 API is deleted (#628, step 2 of DECISIONS pass 58). On the real server (`startServer` of
// server/index.ts, as `npm start` runs it):
// - every path the MVP 1 API had answers the JSON 404 of an unknown /api path, with any method and body;
// - /api/health answers 200 and the /api/v2 reads answer as before;
// - no MVP 1 run is created: the data folder holds the v2 state files only, also after a stop.
// Everything runs on a temp folder (v2-bootstrap-helper.ts) with the sample travel cache. The repo's data/
// and `.env` are never read or written, and nothing reaches the network.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createApp, startServer, type RelayServer } from '../../server/index';
import { DEFAULT_V2_STATE_PATH } from '../../server/api/v2/bootRun';
import { TRAVEL_NOT_LOADED_MESSAGE } from '../../server/api/v2/errors';
import type { BusinessesResponse, SimulatorResponse } from '../../shared/v2/api';
import { noNetwork, T, tempRepo, type CacheKind, type TempRepo } from './v2-bootstrap-helper';
import { ownOrigin } from './own-origin-helper';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The 19 routes server/index.ts registered for MVP 1 (git tag `mvp1`), with a body a write would have taken. */
const MVP1_ROUTES: [method: string, url: string, body?: unknown][] = [
  ['GET', '/api/businesses'],
  ['GET', '/api/employees'],
  ['GET', '/api/map'],
  ['PUT', '/api/employees/emp-1/commute', { maxExtraMin: 8 }],
  ['GET', '/api/simulator'],
  ['POST', '/api/simulator/control', { action: 'play' }],
  ['GET', '/api/businesses/biz-1/dashboard'],
  ['GET', '/api/employees/emp-1/dashboard'],
  ['POST', '/api/shipments', { clientRequestId: 'r1' }],
  ['PATCH', '/api/shipments/shp-1', { label: 'x' }],
  ['POST', '/api/shipments/shp-1/match'],
  ['GET', '/api/shipments/shp-1'],
  ['GET', '/api/jobs/job-1'],
  ['POST', '/api/matches/compare', {}],
  ['POST', '/api/matches/recompute'],
  ['POST', '/api/planning/reset'],
  ['POST', '/api/scenario/generate', { preset: 'demo' }],
  ['GET', '/api/scenario/export'],
  ['POST', '/api/scenario/import', { runId: 'run-1' }],
];

const NOT_FOUND = { error: 'Not found' };

type Started = { server: RelayServer; repo: TempRepo; origin: string; lines: string[]; network: string[] };
const started: Started[] = [];

async function boot(cache: CacheKind = 'sample'): Promise<Started> {
  const repo = tempRepo(cache);
  const lines: string[] = [];
  const network = noNetwork();
  const server = startServer({
    env: { PORT: '0' },
    envPath: path.join(repo.root, '.env'),
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
  one.origin = await ownOrigin(server); // not 127.0.0.1:<port>: another program may answer there (own-origin-helper.ts)
  return one;
}

const call = async (one: Started, method: string, url: string, body?: unknown) => {
  const res = await fetch(one.origin + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
};

const dataFiles = (repo: TempRepo) => {
  const dir = path.dirname(repo.statePath);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

const repoDataDir = path.dirname(DEFAULT_V2_STATE_PATH);
const repoDataNames = () => (fs.existsSync(repoDataDir) ? fs.readdirSync(repoDataDir).sort() : null);
let repoDataBefore: string[] | null;
beforeAll(() => { repoDataBefore = repoDataNames(); });
afterAll(() => expect(repoDataNames()).toStrictEqual(repoDataBefore)); // the repo's data/ folder is untouched

afterEach(async () => {
  for (const one of started.splice(0)) {
    await one.server.stop();
    one.repo.remove();
  }
  vi.restoreAllMocks();
});

describe('the MVP 1 paths on the running server', () => {
  it('every former MVP 1 route answers the JSON 404, with its old method and a body', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const one = await boot();
    expect(MVP1_ROUTES).toHaveLength(19);
    for (const [method, url, body] of MVP1_ROUTES) {
      const res = await call(one, method, url, body);
      expect([method, url, res.status]).toStrictEqual([method, url, 404]);
      expect(res.type).toContain('application/json');
      expect(JSON.parse(res.text)).toStrictEqual(NOT_FOUND);
    }
    expect(errors).not.toHaveBeenCalled(); // a 404 logs nothing
    expect(one.network).toStrictEqual([]);
  }, T);

  it('the same paths are the JSON 404 with every other method, never the app shell', async () => {
    const one = await boot();
    for (const [, url] of MVP1_ROUTES) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await call(one, method, url, method === 'GET' ? undefined : {});
        expect([method, url, res.status, res.text]).toStrictEqual([method, url, 404, JSON.stringify(NOT_FOUND)]);
      }
    }
  }, T);

  it('they are the 404, not the 503, also when /api/v2 is not loaded', async () => {
    const one = await boot('empty');
    expect(one.lines[0]).toBe(`Relay MVP II API (/api/v2) is not loaded and answers 503: ${TRAVEL_NOT_LOADED_MESSAGE}`);
    expect((await call(one, 'GET', '/api/v2/simulator')).status).toBe(503);
    for (const url of ['/api/simulator', '/api/businesses', '/api/map', '/api/shipments/shp-1']) {
      expect([url, (await call(one, 'GET', url)).status]).toStrictEqual([url, 404]);
    }
    const health = await call(one, 'GET', '/api/health');
    expect([health.status, JSON.parse(health.text)]).toStrictEqual([200, { ok: true }]);
  }, T);

  it('with a built client they still never fall through to index.html', async () => {
    const repo = tempRepo('empty');
    const dist = path.join(repo.root, 'client', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body>relay-shell</body></html>');
    const server = createApp({ clientDist: dist }).listen(0, '127.0.0.1');
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const url of ['/api/simulator', '/api/businesses/biz-1/dashboard', '/api/scenario/export']) {
        const res = await fetch(origin + url);
        expect([url, res.status]).toStrictEqual([url, 404]);
        expect(await res.json()).toStrictEqual(NOT_FOUND);
      }
      const page = await fetch(`${origin}/simulator`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('relay-shell');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      repo.remove();
    }
  }, T);
});

describe('what still answers', () => {
  it('/api/health answers 200 { ok: true }', async () => {
    const one = await boot();
    const health = await call(one, 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.type).toContain('application/json');
    expect(JSON.parse(health.text)).toStrictEqual({ ok: true });
  }, T);

  it('the /api/v2 reads answer as before: the NYC businesses of the fixture file and the run at its start', async () => {
    const one = await boot();
    expect(one.lines[0]).toBe('Relay MVP II API ready at /api/v2 (NYC travel cache loaded)');

    const inFile = JSON.parse(fs.readFileSync(path.join(one.repo.fixturesDir, 'businesses.json'), 'utf8')) as
      { businesses: { id: string; name: string }[] };
    const businesses = await call(one, 'GET', '/api/v2/businesses');
    expect(businesses.status).toBe(200);
    const listed = (JSON.parse(businesses.text) as BusinessesResponse).businesses;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.map((b) => [b.id, b.name])).toStrictEqual(inFile.businesses.map((b) => [b.id, b.name]));

    const simulator = await call(one, 'GET', '/api/v2/simulator');
    expect(simulator.status).toBe(200);
    const sim = JSON.parse(simulator.text) as SimulatorResponse;
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false });
    expect(sim.shipments.length).toBeGreaterThan(0);

    for (const url of ['/api/v2/employees', '/api/v2/map', `/api/v2/businesses/${listed[0].id}/dashboard`]) {
      expect([url, (await call(one, 'GET', url)).status]).toStrictEqual([url, 200]);
    }
    const unknown = await call(one, 'GET', '/api/v2/no-such-route');
    expect([unknown.status, JSON.parse(unknown.text)]).toStrictEqual([404, NOT_FOUND]);
    expect(one.network).toStrictEqual([]);
  }, T);
});

describe('no MVP 1 run', () => {
  it('the server writes no state.json: after requests and a stop the data folder holds the v2 files only', async () => {
    const one = await boot();
    for (const [method, url, body] of MVP1_ROUTES.slice(0, 6)) await call(one, method, url, body);
    expect(dataFiles(one.repo)).not.toContain('state.json');
    await one.server.stop();
    expect(dataFiles(one.repo)).toStrictEqual(['state-v2.json', 'state-v2.source.json']);
    expect(fs.existsSync(one.repo.mvp1StatePath)).toBe(false);
  }, T);

  it('server/index.ts loads nothing of server/api/ outside v2/, and the MVP 1 route files it registered are gone', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'server/index.ts'), 'utf8');
    const imported = [...source.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]).sort();
    // './ai/env' (#785): the Gemini key and model names for POST /api/v2/parse-request, read like './geo/env'.
    expect(imported).toStrictEqual(['./ai/env', './api/v2/bootRun', './api/v2/bootstrap', './api/v2/router', './geo/env', './geo/googleClient']);
    expect(source).not.toMatch(/createStore|startClockTicker|createInitialRun/);

    for (const gone of ['businesses', 'commute', 'employees', 'map', 'planning', 'portals', 'scenario', 'shipments', 'simulator', 'ticker']) {
      expect([gone, fs.existsSync(path.join(repoRoot, 'server/api', `${gone}.ts`))]).toStrictEqual([gone, false]);
    }
  });
});
