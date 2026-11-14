// client/src/api/v2.ts against a fake fetch: every helper calls the method and path documented in the
// route list at the top of shared/v2/api.ts, and every documented route has a helper.
// (The /api/v2 server routes land later; nothing here needs a server, network or keys.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as v2 from '../../client/src/api/v2';
import * as v1 from '../../client/src/api';
import type { Run } from '../../shared/v2/types';

type Call = { path: string; init: RequestInit };
let calls: Call[] = [];

/** Fake fetch: records the call, answers 200 `{}`, and rejects like the real one when the signal aborts. */
const fakeFetch = (input: string, init: RequestInit = {}) => {
  calls.push({ path: input, init });
  if (init.signal?.aborted) return Promise.reject(new DOMException('This operation was aborted', 'AbortError'));
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
};
const stub = () => { calls = []; vi.stubGlobal('fetch', fakeFetch); };
afterEach(() => vi.unstubAllGlobals());

// ---------- The documented routes, parsed from the comment block above the imports ----------
const apiSource = fs.readFileSync(path.resolve(__dirname, '../../shared/v2/api.ts'), 'utf8');
const header = apiSource.slice(0, apiSource.indexOf('\nimport '));
const documentedRoutes = header.split('\n')
  .map((line) => /^\/\/\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/v2\S*)/.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => `${m[1]} ${m[2]}`);

// ---------- One case per helper ----------
const ID = 'id 1/é?&';                 // needs encoding in a path segment
const QUERY = '350 5th Ave & W 34th St, #2';
const opts = (signal?: AbortSignal): v2.RequestOptions => ({ signal });

const shipmentReq = {
  clientRequestId: 'r1', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', label: 'L',
  category: 'envelope' as const, description: 'd', weightKg: 0.5, readyMin: 960, deadlineMin: 1980,
};
const commuteBase = {
  businessId: 'biz-a', eveningDepartureMin: 1050, morningDepartureMin: 1920,
  availableEvening: true, availableMorning: true, maxExtraMin: 8,
};
const commuteReq = { ...commuteBase, home: { lat: 40.6722, lng: -73.9772, neighborhood: 'Park Slope' } };
const generateReq = { preset: 'random' as const, seed: 7, employees: 40 };
const run = { runId: 'run-1', version: 3 } as unknown as Run;

type Case = {
  /** `METHOD path` exactly as documented in shared/v2/api.ts. */
  route: string;
  call: (signal?: AbortSignal) => Promise<unknown>;
  /** Expected JSON body; undefined = the request must have no body. */
  body?: unknown;
};
const cases: Record<string, Case> = {
  getBusinesses: { route: 'GET /api/v2/businesses', call: (s) => v2.getBusinesses(opts(s)) },
  getBusinessDashboard: { route: 'GET /api/v2/businesses/:id/dashboard', call: (s) => v2.getBusinessDashboard(ID, opts(s)) },
  createShipment: { route: 'POST /api/v2/shipments', call: (s) => v2.createShipment(shipmentReq, opts(s)), body: shipmentReq },
  getShipment: { route: 'GET /api/v2/shipments/:id', call: (s) => v2.getShipment(ID, opts(s)) },
  patchShipment: { route: 'PATCH /api/v2/shipments/:id', call: (s) => v2.patchShipment(ID, { label: 'Renamed' }, opts(s)), body: { label: 'Renamed' } },
  matchShipment: { route: 'POST /api/v2/shipments/:id/match', call: (s) => v2.matchShipment(ID, opts(s)) },
  getEmployees: { route: 'GET /api/v2/employees', call: (s) => v2.getEmployees(opts(s)) },
  getEmployeeDashboard: { route: 'GET /api/v2/employees/:id/dashboard', call: (s) => v2.getEmployeeDashboard(ID, opts(s)) },
  putCommute: { route: 'PUT /api/v2/employees/:id/commute', call: (s) => v2.putCommute(ID, commuteReq, opts(s)), body: commuteReq },
  getJob: { route: 'GET /api/v2/jobs/:id', call: (s) => v2.getJob(ID, opts(s)) },
  getMap: { route: 'GET /api/v2/map', call: (s) => v2.getMap(opts(s)) },
  getSimulator: { route: 'GET /api/v2/simulator', call: (s) => v2.getSimulator(opts(s)) },
  simulatorControl: { route: 'POST /api/v2/simulator/control', call: (s) => v2.simulatorControl({ action: 'pause' }, opts(s)), body: { action: 'pause' } },
  compareMatches: { route: 'POST /api/v2/matches/compare', call: (s) => v2.compareMatches(opts(s)), body: {} },
  recomputeMatches: { route: 'POST /api/v2/matches/recompute', call: (s) => v2.recomputeMatches(opts(s)) },
  resetPlanning: { route: 'POST /api/v2/planning/reset', call: (s) => v2.resetPlanning(opts(s)) },
  generateScenario: { route: 'POST /api/v2/scenario/generate', call: (s) => v2.generateScenario(generateReq, opts(s)), body: generateReq },
  exportScenario: { route: 'GET /api/v2/scenario/export', call: (s) => v2.exportScenario(opts(s)) },
  importScenario: { route: 'POST /api/v2/scenario/import', call: (s) => v2.importScenario(run, opts(s)), body: run },
  geocode: { route: 'GET /api/v2/geocode?q=', call: (s) => v2.geocode(QUERY, opts(s)) },
};

/** The concrete URL a case must request: `:id` filled in encoded, and the encoded query after `?q=`. */
const expectedPath = (route: string) => {
  const p = route.split(' ')[1].replace(':id', encodeURIComponent(ID));
  return p.endsWith('?q=') ? p + encodeURIComponent(QUERY) : p;
};

describe('v2 client: route coverage', () => {
  it('the route list in shared/v2/api.ts is found', () => {
    expect(documentedRoutes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(documentedRoutes).size).toBe(documentedRoutes.length);
    expect(documentedRoutes).toContain('GET /api/v2/geocode?q=');
  });

  it('every documented route has exactly one helper, and no helper is undocumented', () => {
    expect(Object.values(cases).map((c) => c.route).sort()).toEqual([...documentedRoutes].sort());
  });

  it('there is a case for every exported helper (lowercase-named functions)', () => {
    const helpers = Object.entries(v2)
      .filter(([, v]) => typeof v === 'function' && !/^[A-Z]/.test(v.name || '')).map(([k]) => k);
    expect(Object.keys(cases).sort()).toEqual(helpers.sort());
  });

  it('the index has no route helper left: the MVP 1 ones are deleted (#628) and the v2 ones are only in v2.ts', () => {
    const names = (mod: Record<string, unknown>) => Object.entries(mod)
      .filter(([, v]) => typeof v === 'function' && !/^[A-Z]/.test((v as { name?: string }).name || '')).map(([k]) => k).sort();
    expect(names(v1)).toEqual([]);
    expect(names(v2)).toEqual(Object.keys(cases).sort());
  });
});

describe('v2 client: method, path and body per helper', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name} -> ${c.route}`, async () => {
      stub();
      expect(await c.call()).toEqual({});
      expect(calls).toHaveLength(1);
      const [{ path: called, init }] = calls;
      expect(`${init.method} ${called}`).toBe(`${c.route.split(' ')[0]} ${expectedPath(c.route)}`);
      expect(called.startsWith('/api/v2/')).toBe(true);
      if (c.body === undefined) {
        expect(init.body).toBeUndefined();
        expect(init.headers).toBeUndefined();
      } else {
        expect(JSON.parse(init.body as string)).toEqual(c.body);
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      }
    });

    it(`${name} is abortable through its options`, async () => {
      stub();
      const ctl = new AbortController();
      ctl.abort();
      const e = await c.call(ctl.signal).then(() => null, (x) => x);
      expect(e).toBeInstanceOf(v2.ApiRequestError);
      expect(v2.isAbortError(e)).toBe(true);
      expect(v2.isNetworkError(e)).toBe(false);
      expect(calls[0].init.signal?.aborted).toBe(true);
    });
  }

  it('options stay optional on every helper', async () => {
    stub();
    await v2.getSimulator();
    await v2.getJob('job-1');
    await v2.matchShipment('shp-1');
    await v2.geocode('Bedford Ave');
    expect(calls.map((c) => c.path)).toEqual([
      '/api/v2/simulator', '/api/v2/jobs/job-1', '/api/v2/shipments/shp-1/match', '/api/v2/geocode?q=Bedford%20Ave',
    ]);
  });
});

describe('v2 client: request types follow shared/v2/schemas', () => {
  it('putCommute takes an existing home or a new point, not the MVP 1 homeNodeId', async () => {
    stub();
    await v2.putCommute('emp-1', { ...commuteBase, home: { homeId: 'home-001' } });
    await v2.putCommute('emp-1', { ...commuteBase, home: { lat: 40.7, lng: -73.9, neighborhood: 'DUMBO' } });
    expect(calls.map((c) => JSON.parse(c.init.body as string).home)).toEqual([
      { homeId: 'home-001' }, { lat: 40.7, lng: -73.9, neighborhood: 'DUMBO' },
    ]);
    // @ts-expect-error MVP 1 body: `homeNodeId` instead of `home`
    void v2.putCommute('emp-1', { ...commuteBase, homeNodeId: 'n1' });
    // @ts-expect-error a new home needs lat, lng and neighborhood
    void v2.putCommute('emp-1', { ...commuteBase, home: { lat: 40.7, lng: -73.9 } });
  });

  it('generateScenario has no hubs and lets schema defaults be omitted', async () => {
    stub();
    await v2.generateScenario({ preset: 'demo' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ preset: 'demo' });
    // @ts-expect-error `hubs` is gone in MVP II
    void v2.generateScenario({ preset: 'random', hubs: 3 });
  });

  it('geocode sends the query URL-encoded in ?q=', async () => {
    stub();
    await v2.geocode(QUERY);
    expect(calls[0].path).toBe('/api/v2/geocode?q=350%205th%20Ave%20%26%20W%2034th%20St%2C%20%232');
    expect(new URL(calls[0].path, 'http://x').searchParams.get('q')).toBe(QUERY);
  });
});
