// Helper for the broken-request sweep of /api/v2 (tests/api/v2-sweep-*.test.ts, #521).
// - Starts the real v2 server on the sample cache with no key (`startBootstrapApi`), in a temp folder.
// - Lists the routes from the router itself (`routesOfRouter`), so a route added later is swept too.
// - `refused` sends one request and checks the whole rule: a JSON 4xx in the v2 error shape, no HTML, no
//   stack trace, no file path, and the run untouched (the same version, an identical GET /scenario/export,
//   a byte-identical state file or still none).
// Nothing here touches fixtures/nyc/, data/ or .env, and nothing leaves localhost.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { createV2Router, type V2Deps } from '../../server/api/v2/router';
import { ApiError } from '../../shared/v2/schemas';
import type { Employee, NetworkBusiness, NycDemoStoryFile, Run as RunV2 } from '../../shared/v2/types';
import { startBootstrapApi, tempRepo, type BootstrapApi, type TempRepo } from './v2-bootstrap-helper';

/**
 * Timeout of every test and hook in the sweep files (DECISIONS pass 19): each talks to a real HTTP server.
 * The slowest single test takes about 1 s locally.
 */
export const T = 30_000;

// ---------- the routes, read from the router ----------

export type SweptRoute = {
  /** Upper case: `POST`. */
  method: string;
  /** Relative to /api/v2, as registered: `/shipments/:id/match`. */
  path: string;
  /** `POST /shipments/:id/match`. */
  key: string;
  /** The names of the `:params` in the path. */
  params: string[];
};

const PARAM = /:([A-Za-z0-9_]+)/g;
const EVERY_METHOD = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type Layer = { route?: { path: unknown; methods: Record<string, boolean> } };

/**
 * Every route `createV2Router` registers for these deps, in registration order. It builds a second router
 * from the same deps and reads its layers; no request goes through that router.
 */
export function routesOfRouter(deps: V2Deps): SweptRoute[] {
  const { stack } = createV2Router(deps) as unknown as { stack: Layer[] };
  const routes: SweptRoute[] = [];
  for (const { route } of stack) {
    if (!route) continue; // a `router.use` layer: the body guard, the 404, the error handler
    const { path } = route;
    if (typeof path !== 'string') {
      throw new Error('v2-sweep-helper: a v2 route has a path that is not a string. Teach routesOfRouter to build its URL.');
    }
    const methods = route.methods._all
      ? EVERY_METHOD
      : Object.keys(route.methods).filter((m) => route.methods[m]).map((m) => m.toUpperCase());
    for (const method of methods) {
      routes.push({ method, path, key: `${method} ${path}`, params: [...path.matchAll(PARAM)].map((m) => m[1]) });
    }
  }
  return routes;
}

/** Everything that is not a plain read. POST /matches/compare is in here too: it is a POST with a body. */
export const isWrite = (route: SweptRoute) => !['GET', 'HEAD', 'OPTIONS'].includes(route.method);

/** The route's URL (relative to /api/v2) with every `:param` replaced by `value`. */
export const urlOf = (route: Pick<SweptRoute, 'path'>, value: string) => route.path.replace(PARAM, () => value);

// ---------- what the sweep knows about each write route ----------

/** IDs and values of the run as it is now. Read again before every use: a test may have changed the run. */
export type SweepContext = {
  run: RunV2;
  businesses: NetworkBusiness[];
  employee: Employee;
  /** A delivery request for PATCH and retry: an unmatched one when the run has one, else a matched one. */
  shipmentId: string;
  /** True when `shipmentId` is unmatched, so an edit reaches the body checks (a matched one is a 409 first). */
  editable: boolean;
  jobId: string;
};

export type WriteSpec = {
  /** The ID for the route's `:id` (ignored by a route without one). */
  id: (ctx: SweepContext) => string;
  /** A body the route accepts as it is, or null for a route that takes no options. */
  valid: ((ctx: SweepContext) => Record<string, unknown>) | null;
  /** What a request without any body gets: a 400, or the action runs (that is its valid form). */
  withoutBody: 'refused' | 'runs';
  /**
   * What `{}` gets (also an empty body sent as JSON, which the parser reads as `{}`): a 400 on a route with
   * a required field; on the others it is a valid request (an edit without fields changes nothing).
   */
  emptyObject: 'refused' | 'runs';
  /** False for POST /matches/compare, which never changes the run. */
  changesRun: boolean;
};

let requestCount = 0;

/** A delivery request the default run accepts. Every call has a new `clientRequestId`. */
export function validDelivery(ctx: SweepContext): Record<string, unknown> {
  const { simStartMin, simEndMin } = ctx.run.scenario.settings;
  return {
    clientRequestId: `sweep-${process.pid}-${++requestCount}`,
    originBusinessId: ctx.businesses[0].id,
    destinationBusinessId: ctx.businesses[1].id,
    label: 'Sweep documents',
    category: 'envelope',
    description: 'Signed papers',
    weightKg: 0.5,
    readyMin: simStartMin + 30,
    deadlineMin: simEndMin,
    pickupInstructions: '',
    dropoffInstructions: '',
  };
}

/** The employee's commute exactly as it is stored. */
export function validCommute({ employee }: SweepContext): Record<string, unknown> {
  return {
    businessId: employee.businessId,
    home: { homeId: employee.homeId },
    eveningDepartureMin: employee.eveningDepartureMin,
    morningDepartureMin: employee.morningDepartureMin,
    availableEvening: employee.availableEvening,
    availableMorning: employee.availableMorning,
    maxExtraMin: employee.maxExtraMin,
  };
}

export const validGenerate = (): Record<string, unknown> =>
  ({ preset: 'random', seed: 7, employees: 20, packages: 10, maxExtraMin: 8 });

/** The run itself: what GET /scenario/export answers. */
export const validImport = (ctx: SweepContext): Record<string, unknown> => JSON.parse(JSON.stringify(ctx.run));

const none = () => '';

/**
 * One entry per write route of /api/v2. The sweep fails when the router has a write route that is not
 * listed here, so a new route gets its own entry (the bodies every route must refuse are sent to it anyway).
 */
export const WRITE_SPECS: Record<string, WriteSpec> = {
  'POST /shipments':
    { id: none, valid: validDelivery, withoutBody: 'refused', emptyObject: 'refused', changesRun: true },
  'PATCH /shipments/:id':
    { id: (c) => c.shipmentId, valid: () => ({ label: 'Sweep edit' }), withoutBody: 'refused', emptyObject: 'runs', changesRun: true },
  'POST /shipments/:id/match':
    { id: (c) => c.shipmentId, valid: null, withoutBody: 'runs', emptyObject: 'runs', changesRun: true },
  'PUT /employees/:id/commute':
    { id: (c) => c.employee.id, valid: validCommute, withoutBody: 'refused', emptyObject: 'refused', changesRun: true },
  'POST /simulator/control':
    { id: none, valid: () => ({ action: 'pause' }), withoutBody: 'refused', emptyObject: 'refused', changesRun: true },
  'POST /planning/reset':
    { id: none, valid: null, withoutBody: 'runs', emptyObject: 'runs', changesRun: true },
  'POST /matches/recompute':
    { id: none, valid: null, withoutBody: 'runs', emptyObject: 'runs', changesRun: true },
  'POST /scenario/generate':
    { id: none, valid: validGenerate, withoutBody: 'refused', emptyObject: 'refused', changesRun: true },
  'POST /scenario/import':
    { id: none, valid: validImport, withoutBody: 'refused', emptyObject: 'refused', changesRun: true },
  'POST /matches/compare':
    { id: none, valid: () => ({}), withoutBody: 'runs', emptyObject: 'runs', changesRun: false },
};

/** The ID a route added after this sweep gets in its URL. */
export const UNKNOWN_ID = 'sweep-unknown-id';

// ---------- requests ----------

/** What goes over the wire: the exact body text and the headers. `{}` is a request with no body at all. */
export type Sent = { body?: string; headers?: Record<string, string> };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const NO_BODY: Sent = {};
/** A JSON body from a value. */
export const json = (value: unknown): Sent => ({ body: JSON.stringify(value), headers: JSON_HEADERS });
/** A body sent as JSON exactly as written, valid or not. */
export const rawJson = (text: string): Sent => ({ body: text, headers: JSON_HEADERS });

export type Reply = { status: number; contentType: string; text: string; headers: Headers };

/** The server's origin. The bootstrap helper does not expose it, so it is read from one of its own calls. */
export async function originOf(api: Pick<BootstrapApi, 'call'>): Promise<string> {
  const real = globalThis.fetch;
  let origin = '';
  globalThis.fetch = (async (input, init) => {
    origin = new URL(input instanceof Request ? input.url : String(input)).origin;
    return real(input, init);
  }) as typeof fetch;
  try {
    await api.call('GET', '/api/health');
  } finally {
    globalThis.fetch = real;
  }
  if (!origin) throw new Error('v2-sweep-helper: could not find the test server');
  return origin;
}

/** `send(method, url, sent)` for URLs relative to /api/v2 on `origin`. The answer is read as text, never parsed. */
export const sender = (origin: string) => async (method: string, url: string, sent: Sent = NO_BODY): Promise<Reply> => {
  const res = await fetch(`${origin}/api/v2${url}`, { method, headers: sent.headers, body: sent.body });
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text: await res.text(), headers: res.headers };
};

// ---------- broken bodies ----------

/** 200 kB of text. */
export const HUGE_TEXT = 'x'.repeat(200_000);

const DEEP = 10_000;

/**
 * Bodies no route may accept, whatever it does. Each is sent to every write route the router lists.
 * (A request with no body is not here: it is the valid form of the routes that take no options.)
 */
export const BROKEN_BODIES: [name: string, sent: Sent][] = [
  ['malformed JSON', rawJson('{"clientRequestId": "sweep",')],
  ['JSON cut off inside a text', rawJson('{"label": "Docu')],
  ['null', rawJson('null')],
  ['a string', rawJson('"hello"')],
  ['a number', rawJson('42')],
  ['an array', rawJson('[]')],
  ['an array of objects', rawJson('[{"action":"pause"},{}]')],
  ['only a __proto__ key', rawJson('{"__proto__":{"polluted":true}}')],
  ['a __proto__ key deep inside', rawJson('{"options":{"list":[{"__proto__":{"polluted":true}}]}}')],
  ['a 200 kB text', json({ note: HUGE_TEXT })],
  ['a 200 kB key', json({ [HUGE_TEXT]: 1 })],
  [`an object nested ${DEEP} levels deep`, rawJson(`${'{"a":'.repeat(DEEP)}1${'}'.repeat(DEEP)}`)],
  [`an array nested ${DEEP} levels deep`, rawJson(`${'['.repeat(DEEP)}${']'.repeat(DEEP)}`)],
];

/** A minute no form may send. `1e9` is far outside the two simulated days (0 to 2880). */
export const BAD_MINUTES: [name: string, minute: number][] = [
  ['negative', -5],
  ['fractional', 1000.5],
  ['far outside the two days', 1e9],
];

const REMOVE = Symbol('remove');
/** Pass as the value of `withField` to delete the field. */
export const MISSING: unknown = REMOVE;

const isIndex = (segment: string) => /^\d+$/.test(segment);

/** The value at a dotted path: `home.homeId`, `scenario.shipments.0.label`. */
export function fieldAt(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (value, segment) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[segment] : undefined),
    body,
  );
}

/** A deep copy of `body` with the field at the dotted `path` set to `value` (or deleted, for `MISSING`). */
export function withField<T>(body: T, path: string, value: unknown): T {
  const copy = structuredClone(body);
  const segments = path.split('.');
  const last = segments.pop() as string;
  const parent = segments.length === 0 ? copy : fieldAt(copy, segments.join('.'));
  if (typeof parent !== 'object' || parent === null) throw new Error(`v2-sweep-helper: nothing at ${path}`);
  if (value === REMOVE) {
    if (Array.isArray(parent) && isIndex(last)) parent.splice(Number(last), 1);
    else delete (parent as Record<string, unknown>)[last];
  } else {
    (parent as Record<string, unknown>)[last] = value;
  }
  return copy;
}

/** A value of another type than `value`, the way a form bug sends it: "990" for 990, 12345 for a text. */
export function wrongTypeOf(value: unknown): unknown {
  if (typeof value === 'string') return 12345;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return 'yes';
  if (Array.isArray(value)) return { 0: 'not a list' };
  return 'not an object';
}

/**
 * `body` as JSON text with a real `__proto__` key in the object at `path` ('' = the body itself).
 * Built as an own property, because `{ __proto__: x }` in source code would set the prototype instead.
 */
export function withProtoKey(body: Record<string, unknown>, path = ''): Sent {
  const copy = structuredClone(body);
  const target = path === '' ? copy : fieldAt(copy, path);
  if (typeof target !== 'object' || target === null) throw new Error(`v2-sweep-helper: nothing at ${path}`);
  Object.defineProperty(target, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true, writable: true });
  const text = JSON.stringify(copy);
  if (!text.includes('"__proto__"')) throw new Error('v2-sweep-helper: the __proto__ key did not reach the JSON text');
  return rawJson(text);
}

// ---------- the checks ----------

/** `ApiError` with nothing else in it: `{ error }` or `{ error, fieldErrors }`. */
const StrictApiError = ApiError.strict();

const ERROR_TEXT_LIMIT = 4096;

/** The reason `text` looks like it holds a stack trace or a file path of this machine, or null. */
export function leakIn(text: string, privatePaths: string[]): string | null {
  for (const dir of privatePaths) if (dir && text.includes(dir)) return `it holds the path ${dir}`;
  const patterns: [RegExp, string][] = [
    [/(^|\\n|\n)\s*at\s+\S/, 'a stack frame'],
    [/node_modules/, 'node_modules'],
    [/\.(ts|tsx|js|mjs|cjs):\d+/, 'a source file and line'],
    [/file:\/\//, 'a file URL'],
    [/(^|[\s"'(])\/(Users|home|root|tmp|var|private|opt|usr)\//, 'an absolute path'],
    [/[A-Za-z]:\\\\/, 'a Windows path'],
  ];
  for (const [pattern, what] of patterns) if (pattern.test(text)) return `it holds ${what}`;
  return null;
}

/**
 * The rule for the answer to a broken request: one of `statuses` (never a 5xx), JSON, the v2 error shape,
 * short, no HTML, no stack trace, no file path. Returns the parsed body.
 */
export function expectJsonError(reply: Reply, statuses: number[], what: string, privatePaths: string[] = []): ApiError {
  const shown = `${what} -> ${reply.status} ${reply.text.slice(0, 200)}`;
  expect(statuses, shown).toContain(reply.status);
  expect(reply.status, shown).toBeGreaterThanOrEqual(400);
  expect(reply.status, shown).toBeLessThan(500);
  expect(reply.contentType, shown).toMatch(/^application\/json\b/);
  expect(reply.text, shown).not.toMatch(/<\s*(!doctype|html|body|pre|head|title)\b/i);
  expect(reply.text.length, `${shown}: the error answer is ${reply.text.length} characters long`).toBeLessThanOrEqual(ERROR_TEXT_LIMIT);
  expect(leakIn(reply.text, [process.cwd(), os.tmpdir(), ...privatePaths]), shown).toBeNull();

  let body: unknown;
  try {
    body = JSON.parse(reply.text);
  } catch {
    throw new Error(`${shown}: the body is not JSON`);
  }
  const parsed = StrictApiError.safeParse(body);
  expect(parsed.success, `${shown}: not the v2 error shape { error, fieldErrors? }`).toBe(true);
  const error = parsed.data as ApiError;
  expect(error.error.trim(), shown).not.toBe('');
  return error;
}

/** What "the run is untouched" compares. */
export type RunState = {
  version: number;
  runId: string;
  /** The text of GET /api/v2/scenario/export (or the stored run as the same JSON text, see `refused`). */
  exported: string;
  /** The bytes of the v2 state file, or null while it was never written. */
  stateFile: Buffer | null;
};

export function expectSameState(after: RunState, before: RunState, what: string): void {
  expect(after.version, `${what}: the version changed`).toBe(before.version);
  expect(after.runId, `${what}: the runId changed`).toBe(before.runId);
  // Compared as booleans: a failure must not print two 100 kB texts.
  expect(after.exported === before.exported, `${what}: GET /scenario/export changed`).toBe(true);
  const sameFile = after.stateFile === null || before.stateFile === null
    ? after.stateFile === before.stateFile
    : after.stateFile.equals(before.stateFile);
  expect(sameFile, `${what}: the state file ${before.stateFile === null ? 'was created' : 'changed'}`).toBe(true);
}

// ---------- the server ----------

export type SweepApi = Awaited<ReturnType<typeof startSweepApi>>;

/**
 * The temp copy of fixtures/nyc on the sample cache, with the last story package made impossible to carry
 * (its deadline is one minute after it is ready). So the fresh run always has one unmatched delivery to
 * edit, whatever the real story matches on the made-up sample times: since the retune of #650 it matches
 * all 24 there. Only the copy is changed, before the server reads it, so no state file is written.
 */
function sweepRepo(): TempRepo {
  const repo = tempRepo('sample');
  const storyPath = path.join(repo.fixturesDir, 'demoStory.json');
  const story = JSON.parse(fs.readFileSync(storyPath, 'utf8')) as NycDemoStoryFile;
  const last = story.shipments.at(-1);
  if (!last) throw new Error('v2-sweep-helper: the story has no package');
  last.deadlineMin = last.readyMin + 1;
  fs.writeFileSync(storyPath, JSON.stringify(story));
  return repo;
}

/** The real v2 server on the sample cache with no key, with the sweep's requests and checks. */
export async function startSweepApi() {
  // No key, and the helper's default `fetch` throws: a broken request must never reach Google.
  const repo = sweepRepo();
  const api = await startBootstrapApi({ cache: 'sample', repo });
  const store = api.store;
  if (!store) throw new Error('v2-sweep-helper: /api/v2 did not load on the sample cache');
  const rawSend = sender(await originOf(api));
  const routes = routesOfRouter(api.runtime.deps);
  const privatePaths = [api.repo.root];

  // The state after the last refused request. Any other request clears it, so it is never stale.
  let known: RunState | null = null;
  // True while `known` was compared in memory only and GET /scenario/export still has to confirm it.
  let unconfirmed = false;

  const send = async (method: string, url: string, sent: Sent = NO_BODY): Promise<Reply> => {
    known = null;
    return rawSend(method, url, sent);
  };

  const stateFile = () => (fs.existsSync(api.repo.statePath) ? fs.readFileSync(api.repo.statePath) : null);

  /** The run's state with the export fetched over HTTP. */
  const state = async (): Promise<RunState> => {
    await store.flush();
    const exported = await rawSend('GET', '/scenario/export');
    expect(exported.status, 'GET /scenario/export').toBe(200);
    const run = store.get();
    // The export is the stored run as JSON, byte for byte. `stateInMemory` relies on that.
    expect(exported.text === JSON.stringify(run), 'GET /scenario/export is not the stored run as JSON').toBe(true);
    return { version: run.version, runId: run.runId, exported: exported.text, stateFile: stateFile() };
  };

  /** The same state without the HTTP call: the text GET /scenario/export would answer, built from the store. */
  const stateInMemory = async (): Promise<RunState> => {
    await store.flush();
    const run = store.get();
    return { version: run.version, runId: run.runId, exported: JSON.stringify(run), stateFile: stateFile() };
  };

  /**
   * GET /scenario/export still answers exactly what it answered before the refused requests since the
   * last call. Every sweep file calls this after each test.
   */
  const confirmExport = async (): Promise<void> => {
    if (!known || !unconfirmed) return;
    expectSameState(await state(), known, 'after the refused requests of this test');
    unconfirmed = false;
  };

  const ctx = (): SweepContext => {
    const run = store.get();
    const unmatched = run.assignments.unmatched[0]?.shipmentId;
    const shipmentId = unmatched ?? run.assignments.plans[0]?.shipmentId ?? run.scenario.shipments[0]?.id;
    const jobId = run.jobs[0]?.id;
    const employee = run.scenario.employees[0];
    if (!shipmentId || !jobId || !employee || run.scenario.businesses.length < 2) {
      throw new Error('v2-sweep-helper: the run has no delivery, job, employee or second business to aim at');
    }
    return { run, businesses: run.scenario.businesses, employee, shipmentId, editable: unmatched !== undefined, jobId };
  };

  /**
   * Sends one request that must be refused and checks the whole rule: the answer (`expectJsonError`)
   * and the untouched run (`expectSameState`). Returns the error body.
   * The state before the first refused request is read over HTTP. After each request the stored run is
   * turned into the same JSON text in memory and compared with it, together with the version and the
   * state file's bytes; `confirmExport` then fetches the real export once per test. That keeps a sweep
   * of a thousand requests fast without skipping a request.
   */
  const refused = async (method: string, url: string, sent: Sent, statuses: number[], label = ''): Promise<ApiError> => {
    const what = `${method} /api/v2${url.length > 80 ? `${url.slice(0, 80)}…` : url}${label ? ` with ${label}` : ''}`;
    const before = known ?? (await state());
    const reply = await rawSend(method, url, sent);
    known = null;
    const error = expectJsonError(reply, statuses, what, privatePaths);
    const after = await stateInMemory();
    expectSameState(after, before, what);
    known = after;
    unconfirmed = true;
    return error;
  };

  return {
    api,
    store,
    /** Every route of the router, reads included. */
    routes,
    /** The routes that are not plain reads. */
    writeRoutes: routes.filter(isWrite),
    /** The spec of a write route, or undefined for one added after this sweep. */
    specOf: (route: SweptRoute): WriteSpec | undefined => WRITE_SPECS[route.key],
    /** The route's URL with real IDs (a route without a spec gets `UNKNOWN_ID`). */
    urlFor: (route: SweptRoute): string => urlOf(route, WRITE_SPECS[route.key]?.id(ctx()) ?? UNKNOWN_ID),
    ctx,
    send,
    state,
    refused,
    confirmExport,
    stateFileExists: () => fs.existsSync(api.repo.statePath),

    /**
     * Stores a delivery nobody can carry (ready one minute before the end of the run), so the run has an
     * unmatched request to edit and the state file is written. Returns its ID.
     */
    seedUnmatchedDelivery: async (): Promise<string> => {
      const c = ctx();
      const { simEndMin } = c.run.scenario.settings;
      const reply = await send('POST', '/shipments', json({ ...validDelivery(c), readyMin: simEndMin - 1, deadlineMin: simEndMin }));
      expect(reply.status, reply.text.slice(0, 200)).toBe(201);
      const body = JSON.parse(reply.text) as { matched: boolean; shipment: { id: string } };
      expect(body.matched).toBe(false);
      return body.shipment.id;
    },

    /**
     * "After the whole sweep one valid delivery request still answers 200 or 201 and the version goes up
     * by exactly one": checked on the store, over HTTP and in the state file.
     */
    expectStillWorks: async (): Promise<void> => {
      const before = store.get().version;
      const reply = await send('POST', '/shipments', json(validDelivery(ctx())));
      expect([200, 201], reply.text.slice(0, 200)).toContain(reply.status);
      expect(reply.contentType).toMatch(/^application\/json\b/);
      const stored = JSON.parse(reply.text) as { shipment: { id: string } };
      expect(store.get().version).toBe(before + 1);

      const polled = await send('GET', '/simulator');
      expect(polled.status).toBe(200);
      const simulator = JSON.parse(polled.text) as { version: number; shipments: { id: string }[] };
      expect(simulator.version).toBe(before + 1);
      expect(simulator.shipments.map((s) => s.id)).toContain(stored.shipment.id);
      expect((await api.savedRun())?.version).toBe(before + 1);
    },

    /** No request may have put anything on `Object.prototype`. */
    expectNoPollution: (): void => {
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.keys(Object.prototype)).toStrictEqual([]);
    },

    close: async () => {
      await api.close();
      repo.remove(); // `startBootstrapApi` leaves a repo it was given
    },
  };
}
