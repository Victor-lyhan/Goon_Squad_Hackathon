// What the server writes when a request fails (#600, the last error handler of server/index.ts):
// every 500 leaves exactly one console.error line with the method, the path without its query string, the
// error's class name and its stack frames, and never the error's message, because a message can hold an
// entered home's coordinates (DECISIONS pass 56). The JSON answer stays `{ error: 'Internal server error' }`,
// and a 4xx or a 503 logs nothing. Made-up routes on a fake v2 store, plus one real route of the real
// runtime on a temp folder. No network, no key.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';
import { createApp, errorLogLine } from '../../server/index';
import type { Store } from '../../server/store';
import type { RunV2 } from '../../server/api/v2/router';
import { TravelDataMissingError, type TravelProvider } from '../../shared/v2/types';
import { startBootstrapApi, T, type BootstrapApi } from './v2-bootstrap-helper';

// TEST DATA ONLY. An entered home's ID holds its coordinates; none of this may reach a log line.
const HOME_ID = 'home-c-40.76420_-73.92350';
const SECRET = `No travel time for ${HOME_ID} at 40.7642, -73.9235 (30-01 Example St)`;
const QUERY = '?q=30-01%20Example%20St&lat=40.7642';
const NEVER_LOGGED = [SECRET, HOME_ID, '40.7642', '73.9235', '40.76420', 'Example', 'No travel time', '?', 'lat='];

class PlanBroken extends Error {}

const fakeTravel: TravelProvider = { durationMin: () => 12, distanceM: () => 3400, polyline: () => null };
const v2Run = { runId: 'run-v2-1', version: 0, clock: { phase: 'planning', playing: false, timeMin: 930, speed: 30 } } as unknown as RunV2;
const fakeStore: Store<RunV2> = { get: () => v2Run, mutate: async () => v2Run, flush: async () => {} };

const testRoutes = (router: express.Router) => {
  router.get('/test/throw', () => {
    throw new PlanBroken(SECRET);
  });
  router.post('/test/reject', async () => {
    await Promise.resolve();
    throw new TypeError(SECRET);
  });
  // A message of several lines, two of which look exactly like stack frames.
  router.get('/test/frame-like', () => {
    throw new PlanBroken(`${SECRET}\n    at ${HOME_ID} (/tmp/40.7642/-73.9235.ts:40:73)\n    at /tmp/Example-St.ts:1:2`);
  });
  // The message and the name were changed after the error was made: the stack still starts with the old ones.
  router.get('/test/changed-later', () => {
    const err = new Error(SECRET);
    err.name = `Renamed ${HOME_ID}`;
    err.message = 'another text with 40.7642';
    throw err;
  });
  router.get('/test/string', () => {
    throw SECRET; // eslint-disable-line no-throw-literal
  });
  router.get('/test/object', () => {
    throw { message: SECRET, lat: 40.7642, constructor: { name: SECRET } }; // eslint-disable-line no-throw-literal
  });
  router.get('/test/status-502', () => {
    throw Object.assign(new Error(SECRET), { status: 502 });
  });
  router.get('/test/own-500', (_req, res) => {
    res.status(500).json({ error: 'The route answered this itself.' });
  });
  router.get('/test/started', (_req, res) => {
    res.status(200).write('the first part');
    throw new PlanBroken(SECRET);
  });
  router.get('/test/status-418', () => {
    throw Object.assign(new Error(SECRET), { status: 418 });
  });
  router.get('/test/travel', () => {
    throw new TravelDataMissingError('biz-a', HOME_ID);
  });
  router.post('/test/echo', (req, res) => {
    res.json({ got: req.body });
  });
};

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-error-log-'));
  const app = createApp({ clientDist: path.join(dir, 'no-dist'), v2: { travel: fakeTravel, store: fakeStore, extraRoutes: testRoutes } });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, T);
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every console call of the test, by method. */
let printed: { method: string; args: unknown[] }[];
beforeEach(() => {
  printed = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void printed.push({ method, args }));
  }
});
afterEach(() => {
  vi.restoreAllMocks();
});

const call = async (method: string, url: string, body?: string) => {
  const res = await fetch(base + url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body });
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
};

/** The request answered the unchanged 500 body. */
async function expect500(method: string, url: string): Promise<void> {
  const res = await call(method, url);
  expect([url, res.status]).toStrictEqual([url, 500]);
  expect(res.type).toMatch(/json/);
  expect(JSON.parse(res.text)).toStrictEqual({ error: 'Internal server error' });
}

/** Exactly one console call was made, to console.error, with one string of one line. Returns it. */
function theOneLine(): string {
  expect(printed.map((p) => p.method)).toStrictEqual(['error']);
  expect(printed[0].args).toHaveLength(1);
  const line = printed[0].args[0];
  expect(typeof line).toBe('string');
  expect(line as string).not.toMatch(/[\r\n]/);
  for (const secret of NEVER_LOGGED) expect(line as string).not.toContain(secret);
  return line as string;
}

/** The frames of a line: every part after the first, each one "at ... :line:column" or a native frame. */
function framesOf(line: string): string[] {
  const frames = line.split(' | ').slice(1);
  for (const frame of frames) expect(frame).toMatch(/^at .*(:\d+:\d+\)?|\(<anonymous>\)|\(native\)|\(index \d+\)|<anonymous>)$/);
  return frames;
}

describe('a 500 writes one console.error line', () => {
  it('a route that throws: method, path without the query string, class name and stack frames', async () => {
    await expect500('GET', `/api/v2/test/throw${QUERY}`);
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('500 GET /api/v2/test/throw PlanBroken');
    const frames = framesOf(line);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toMatch(/v2-error-log\.test\.ts:\d+:\d+\)?$/); // where it was thrown
  }, T);

  it('an async route that rejects', async () => {
    await expect500('POST', `/api/v2/test/reject${QUERY}`);
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('500 POST /api/v2/test/reject TypeError');
    expect(framesOf(line)[0]).toMatch(/v2-error-log\.test\.ts:\d+:\d+\)?$/);
  }, T);

  it('a message of several lines that look like stack frames is left out whole', async () => {
    await expect500('GET', '/api/v2/test/frame-like');
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('500 GET /api/v2/test/frame-like PlanBroken');
    const frames = framesOf(line);
    expect(frames[0]).toMatch(/v2-error-log\.test\.ts:\d+:\d+\)?$/);
    expect(frames.join('\n')).not.toMatch(/\/tmp\//);
  }, T);

  it('a message and a name that were changed after the error was made: neither the old nor the new text', async () => {
    await expect500('GET', '/api/v2/test/changed-later');
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('500 GET /api/v2/test/changed-later Error');
    expect(line).not.toContain('Renamed');
    expect(line).not.toContain('another text');
    expect(framesOf(line).length).toBeGreaterThan(0);
  }, T);

  it('a thrown string or plain object: the kind of value only', async () => {
    await expect500('GET', '/api/v2/test/string');
    expect(theOneLine()).toBe('500 GET /api/v2/test/string non-error (string)');
    printed = [];
    await expect500('GET', '/api/v2/test/object');
    expect(theOneLine()).toBe('500 GET /api/v2/test/object Error');
  }, T);

  it('an error with a 5xx status of its own is answered and logged as the 500 it becomes', async () => {
    await expect500('GET', '/api/v2/test/status-502');
    expect(theOneLine().split(' | ')[0]).toBe('500 GET /api/v2/test/status-502 Error');
  }, T);

  it('a route that answers 500 itself keeps its body and still leaves one line', async () => {
    const res = await call('GET', `/api/v2/test/own-500${QUERY}`);
    expect(res.status).toBe(500);
    expect(JSON.parse(res.text)).toStrictEqual({ error: 'The route answered this itself.' });
    expect(theOneLine()).toBe('500 GET /api/v2/test/own-500 (answered by the route, which passed on no error)');
  }, T);

  it('five failing requests write five lines, one each', async () => {
    for (let i = 0; i < 5; i += 1) await expect500('GET', `/api/v2/test/throw?n=${i}`);
    expect(printed.map((p) => p.method)).toStrictEqual(['error', 'error', 'error', 'error', 'error']);
    expect(new Set(printed.map((p) => String(p.args[0]).split(' | ')[0]))).toStrictEqual(new Set(['500 GET /api/v2/test/throw PlanBroken']));
  }, T);
});

describe('an error after the answer started', () => {
  it('ends the connection and writes one line without the message', async () => {
    const outcome = await fetch(`${base}/api/v2/test/started${QUERY}`).then((res) => res.text()).then(
      (text) => ({ text }),
      () => ({ text: null }),
    );
    expect(outcome.text === null || !outcome.text.includes('Example')).toBe(true); // cut off; never the message
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('Failed after the answer started: GET /api/v2/test/started PlanBroken');
    expect(framesOf(line).length).toBeGreaterThan(0);
    expect((await call('GET', '/api/health')).status).toBe(200); // the server is still up
  }, T);
});

describe('what logs nothing', () => {
  it('a 200, 400s, 404s, an error with a 4xx status and a 503 travel error', async () => {
    const answers: [string, string, number, string?][] = [
      ['GET', '/api/health', 200],
      ['POST', '/api/v2/test/echo', 200, '{"a":1}'],
      ['POST', '/api/v2/test/echo', 400, '{"a":'], // malformed JSON
      ['POST', '/api/v2/test/echo', 400, '{"__proto__":{"a":1}}'], // refused by the body guard
      ['GET', `/api/v2/no-such-route${QUERY}`, 404],
      ['GET', '/api/no-such-route', 404],
      ['GET', '/no-such-page', 404],
      ['GET', `/api/v2/test/status-418${QUERY}`, 418],
      ['GET', `/api/v2/test/travel${QUERY}`, 503],
    ];
    for (const [method, url, status, body] of answers) {
      const res = await call(method, url, body);
      expect([method, url, res.status]).toStrictEqual([method, url, status]);
    }
    expect(printed).toStrictEqual([]);
  }, T);
});

describe('a real route of the real runtime', () => {
  let api: BootstrapApi | null = null;
  afterEach(async () => {
    await api?.close();
    api = null;
  });

  it('GET /api/v2/simulator with a store that fails: the 500 body, one line, no message', async () => {
    api = await startBootstrapApi({ cache: 'sample' });
    expect(api.runtime.status).toBe('ready');
    expect((await api.v2.get('/simulator')).status).toBe(200);
    expect(printed).toStrictEqual([]);

    const store = api.store!;
    const realGet = store.get;
    store.get = () => {
      throw new RangeError(SECRET);
    };
    try {
      const res = await api.v2.get(`/simulator${QUERY}`);
      expect(res.status).toBe(500);
      expect(res.body).toStrictEqual({ error: 'Internal server error' });
    } finally {
      store.get = realGet;
    }
    const line = theOneLine();
    expect(line.split(' | ')[0]).toBe('500 GET /api/v2/simulator RangeError');
    expect(framesOf(line).some((frame) => frame.includes('readRoutes'))).toBe(true); // the route that called the store
    expect((await api.v2.get('/simulator')).status).toBe(200);
  }, T);
});

describe('errorLogLine', () => {
  const req = { method: 'PUT', originalUrl: `/api/v2/employees/emp-1/commute${QUERY}` };

  it('is one line: what, method, path, class, then the frames', () => {
    const line = errorLogLine('500', req, new PlanBroken(SECRET));
    expect(line).not.toMatch(/[\r\n]/);
    expect(line.split(' | ')[0]).toBe('500 PUT /api/v2/employees/emp-1/commute PlanBroken');
    expect(framesOf(line).length).toBeGreaterThan(0);
    for (const secret of NEVER_LOGGED) expect(line).not.toContain(secret);
  });

  it('an error without a stack, an empty message, and values that are no errors', () => {
    const bare = new PlanBroken(SECRET);
    bare.stack = undefined;
    expect(errorLogLine('500', req, bare)).toBe('500 PUT /api/v2/employees/emp-1/commute PlanBroken');
    expect(framesOf(errorLogLine('500', req, new Error(''))).length).toBeGreaterThan(0);
    expect(errorLogLine('500', req, undefined)).toBe('500 PUT /api/v2/employees/emp-1/commute non-error (undefined)');
    expect(errorLogLine('500', req, null)).toBe('500 PUT /api/v2/employees/emp-1/commute non-error (null)');
    expect(errorLogLine('500', req, 40.7642)).toBe('500 PUT /api/v2/employees/emp-1/commute non-error (number)');
    expect(errorLogLine('500', req, Object.create(null))).toBe('500 PUT /api/v2/employees/emp-1/commute Error');
  });

  it('an error whose fields cannot be read still gives one line', () => {
    const hostile = new Proxy({}, {
      get: () => {
        throw new Error(SECRET);
      },
    });
    expect(errorLogLine('500', req, hostile)).toBe('500 PUT /api/v2/employees/emp-1/commute (the error could not be read)');
  });

  it('a stack that is only a message keeps nothing of it', () => {
    const err = new PlanBroken('short');
    err.stack = `PlanBroken: ${SECRET}\nmore of it at 40.7642`;
    expect(errorLogLine('500', req, err)).toBe('500 PUT /api/v2/employees/emp-1/commute PlanBroken');
  });
});
