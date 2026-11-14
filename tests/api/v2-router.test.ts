import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';
import { createApp } from '../../server/index';
import type { Store } from '../../server/store';
import { createV2Router, type RunV2, type V2Deps } from '../../server/api/v2/router';
import { sendTravelError, travelErrorBody, travelUnavailable } from '../../server/api/v2/errors';
import { GoogleApiError, GoogleKeyMissingError } from '../../server/geo/googleClient';
import { TravelDataMissingError, type TravelProvider } from '../../shared/v2/types';
import type { TravelUnavailable } from '../../shared/v2/api';

const NOT_LOADED: TravelUnavailable = {
  error: 'NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.',
  code: 'travel_data_missing',
};
// Looks like a Google key. It must never reach a response body.
const FAKE_KEY = 'AIzaSyFAKE-KEY-0123456789abcdefghijklmn';

const fakeTravel: TravelProvider = {
  durationMin: (a, b) => (a === b ? 0 : 12),
  distanceM: (a, b) => (a === b ? 0 : 3400),
  polyline: () => null,
};
// Only what these routes read; the real v2 run arrives with a later issue.
const v2Run = { runId: 'run-v2-1', version: 0, clock: { phase: 'planning', playing: false, timeMin: 930, speed: 30 } } as unknown as RunV2;
const fakeStore: Store<RunV2> = {
  get: () => v2Run,
  mutate: async () => v2Run,
  flush: async () => {},
};

const testRoutes = (router: express.Router) => {
  router.get('/test/ok', (_req, res) => {
    res.json({ runId: fakeStore.get().runId, minutes: fakeTravel.durationMin('biz-a', 'biz-b') });
  });
  router.get('/test/data-missing', () => {
    throw new TravelDataMissingError('biz-a', 'home-001');
  });
  router.get('/test/polyline-missing', () => {
    throw new TravelDataMissingError('biz-a', 'biz-b', 'polyline');
  });
  router.put('/test/key-missing', () => {
    throw new GoogleKeyMissingError();
  });
  // async handler: a rejected promise must reach the same error handler
  router.post('/test/google-down', async () => {
    await Promise.resolve();
    throw new GoogleApiError({
      status: 403, googleStatus: 'PERMISSION_DENIED',
      endpoint: 'https://routes.googleapis.com/directions/v2:computeRoutes',
      message: `API key ${FAKE_KEY} is not authorized`,
    });
  });
  router.get('/test/google-network', () => {
    throw new GoogleApiError({ status: 0, googleStatus: 'NETWORK_ERROR', endpoint: 'https://maps.googleapis.com/maps/api/geocode/json', message: 'timeout' });
  });
  router.get('/test/plain-error', () => {
    throw new Error(`boom with ${FAKE_KEY}`);
  });
};

let dir: string;
let dist: string;
const servers: Server[] = [];

async function start(v2?: V2Deps): Promise<string> {
  const server = createApp(v2 ? { clientDist: dist, v2 } : { clientDist: dist }).listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const call = async (base: string, method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  expect(res.headers.get('content-type')).toMatch(/json/);
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
};

let unloaded: string; // createApp with default options
let loaded: string;   // fake travel + fake store + test routes

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-router-'));
  dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html>SPA</html>');
  unloaded = await start();
  loaded = await start({ travel: fakeTravel, store: fakeStore, extraRoutes: testRoutes });
});
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('/api/v2 before the NYC travel data is loaded (createApp defaults)', () => {
  it.each([
    ['GET', '/api/v2/businesses'],
    ['POST', '/api/v2/shipments'],
    ['GET', '/api/v2/anything'],
    ['GET', '/api/v2'],
    ['GET', '/api/v2/'],
    ['GET', '/api/v2/simulator?x=1'],
    ['GET', '/api/v2/geocode?q=astoria'],
    ['PUT', '/api/v2/employees/emp-1/commute'],
    ['PATCH', '/api/v2/shipments/shp-1'],
    ['DELETE', '/api/v2/deep/er/path'],
  ])('%s %s -> 503 travel_data_missing', async (method, url) => {
    const withBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    const { status, body } = await call(unloaded, method, url, withBody ? { any: 'thing' } : undefined);
    expect(status).toBe(503);
    expect(body).toEqual(NOT_LOADED);
  });

  it('HEAD also answers 503', async () => {
    const res = await fetch(`${unloaded}/api/v2/businesses`, { method: 'HEAD' });
    expect(res.status).toBe(503);
  });

  it('outside /api/v2: /api/health is 200, the deleted MVP 1 /api/businesses and /api/unknown are the JSON 404, the SPA still loads', async () => {
    const gone = await call(unloaded, 'GET', '/api/businesses'); // an MVP 1 route until #628
    expect(gone.status).toBe(404);
    expect(gone.body).toEqual({ error: 'Not found' });
    expect((await call(unloaded, 'GET', '/api/health')).body).toEqual({ ok: true });

    const missing = await call(unloaded, 'GET', '/api/unknown');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not found' });
    // a path that only looks like the v2 prefix is not the v2 router
    expect((await call(unloaded, 'GET', '/api/v2x')).status).toBe(404);
    expect((await call(unloaded, 'GET', '/api/v22/businesses')).status).toBe(404);

    const spa = await fetch(`${unloaded}/simulator`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('SPA');
  });

  it('503 when only one of travel and store is there, even for a registered route', async () => {
    for (const deps of [
      { travel: null, store: fakeStore, extraRoutes: testRoutes },
      { travel: fakeTravel, store: null, extraRoutes: testRoutes },
    ] satisfies V2Deps[]) {
      const base = await start(deps);
      for (const url of ['/api/v2/test/ok', '/api/v2/businesses']) {
        const { status, body } = await call(base, 'GET', url);
        expect(status).toBe(503);
        expect(body).toEqual(NOT_LOADED);
      }
      expect((await call(base, 'GET', '/api/health')).status).toBe(200);
      expect((await call(base, 'GET', '/api/businesses')).status).toBe(404); // an MVP 1 route until #628
    }
  });
});

describe('/api/v2 with travel data and a v2 store', () => {
  it('routes registered through extraRoutes are served', async () => {
    const { status, body } = await call(loaded, 'GET', '/api/v2/test/ok');
    expect(status).toBe(200);
    expect(body).toEqual({ runId: 'run-v2-1', minutes: 12 });
  });

  it.each([
    ['GET', '/api/v2/businesses'],
    ['POST', '/api/v2/shipments'],
    ['GET', '/api/v2/anything'],
    ['GET', '/api/v2'],
    ['POST', '/api/v2/test/ok'], // right path, wrong method
    ['DELETE', '/api/v2/test/data-missing'],
  ])('unknown %s %s -> JSON 404, never the SPA', async (method, url) => {
    const { status, body } = await call(loaded, method, url, method === 'POST' ? {} : undefined);
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });

  it.each([
    ['GET', '/api/v2/test/data-missing', 'travel_data_missing'],
    ['GET', '/api/v2/test/polyline-missing', 'travel_data_missing'],
    ['PUT', '/api/v2/test/key-missing', 'google_key_missing'],
    ['POST', '/api/v2/test/google-down', 'google_unavailable'],
    ['GET', '/api/v2/test/google-network', 'google_unavailable'],
  ])('%s %s -> 503 %s', async (method, url, code) => {
    const { status, body, text } = await call(loaded, method, url, method === 'GET' ? undefined : {});
    expect(status).toBe(503);
    expect(Object.keys(body).sort()).toEqual(['code', 'error']);
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(10);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('AIza');
  });

  it('a missing pair names the two places, so a human knows what to fetch', async () => {
    const { body } = await call(loaded, 'GET', '/api/v2/test/data-missing');
    expect(body.error).toContain('biz-a');
    expect(body.error).toContain('home-001');
    expect(body.error).toContain('npm run fetch:routes');
  });

  it('a plain Error falls through to the app handler: 500 JSON with no detail', async () => {
    const { status, body, text } = await call(loaded, 'GET', '/api/v2/test/plain-error');
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Internal server error' });
    expect(text).not.toContain(FAKE_KEY);
  });

  it('a malformed JSON body is the app-level 400, as on MVP 1 routes', async () => {
    const { status, body } = await call(loaded, 'POST', '/api/v2/test/google-down', '{not json');
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Request body is not valid JSON' });
  });

  it('the deleted MVP 1 routes are the JSON 404 next to a loaded v2 router, and /api/health answers (#628)', async () => {
    expect((await call(loaded, 'GET', '/api/businesses')).status).toBe(404);
    expect((await call(loaded, 'GET', '/api/simulator')).status).toBe(404);
    expect((await call(loaded, 'GET', '/api/health')).body).toEqual({ ok: true });
    const missing = await call(loaded, 'GET', '/api/unknown');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not found' });
  });

  it('the server keeps answering after errors', async () => {
    await call(loaded, 'GET', '/api/v2/test/plain-error');
    await call(loaded, 'GET', '/api/v2/test/data-missing');
    expect((await call(loaded, 'GET', '/api/v2/test/ok')).status).toBe(200);
  });
});

describe('v2 error helpers', () => {
  const fakeRes = () => {
    const sent: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) { sent.status = code; return res; },
      json(body: unknown) { sent.body = body; return res; },
    };
    return { res: res as unknown as express.Response, sent };
  };

  it('travelUnavailable builds the contract body', () => {
    const body: TravelUnavailable = travelUnavailable('google_key_missing', 'No key');
    expect(body).toEqual({ error: 'No key', code: 'google_key_missing' });
  });

  it('sendTravelError sends 503 and returns true for the three travel errors', () => {
    const cases: [unknown, TravelUnavailable['code']][] = [
      [new TravelDataMissingError('a', 'b'), 'travel_data_missing'],
      [new GoogleKeyMissingError(), 'google_key_missing'],
      [new GoogleApiError({ status: 500, googleStatus: null, endpoint: 'https://x', message: `key=${FAKE_KEY}` }), 'google_unavailable'],
    ];
    for (const [err, code] of cases) {
      const { res, sent } = fakeRes();
      expect(sendTravelError(res, err)).toBe(true);
      expect(sent.status).toBe(503);
      expect((sent.body as TravelUnavailable).code).toBe(code);
      expect(JSON.stringify(sent.body)).not.toContain(FAKE_KEY);
    }
  });

  it('sendTravelError returns false and sends nothing for anything else', () => {
    const lookalike = Object.assign(new Error('x'), { name: 'TravelDataMissingError', status: 503 });
    for (const err of [new Error('boom'), new TypeError('x'), lookalike, 'a string', null, undefined, { code: 'travel_data_missing' }]) {
      const { res, sent } = fakeRes();
      expect(sendTravelError(res, err)).toBe(false);
      expect(sent).toEqual({});
      expect(travelErrorBody(err)).toBeNull();
    }
  });

  it('createV2Router returns a router for both states without touching the deps', () => {
    expect(typeof createV2Router({ travel: null, store: null })).toBe('function');
    expect(typeof createV2Router({ travel: fakeTravel, store: fakeStore })).toBe('function');
  });
});
