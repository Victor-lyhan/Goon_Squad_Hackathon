// The broken-request sweep of /api/v2, part 3: routes, methods, paths and the transport (#521).
// - The write routes are the ones the router itself lists; each must be known to the sweep.
// - An unknown path, a wrong method, a broken URL, a body over the size limit, an unknown charset or
//   encoding and a body that is not JSON all get a JSON 4xx in the v2 error shape, never a 500 and never
//   Express's HTML page, and the run is untouched (`refused` in v2-sweep-helper.ts checks every request).
// - What is not a refusal is pinned too: the routes that take no options run on a request without a body,
//   a locked run answers 409 (DECISIONS pass 6), and a server without travel data answers its 503.
// Sample cache, no key, no network; nothing is timed.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { startBootstrapApi } from './v2-bootstrap-helper';
import {
  BROKEN_BODIES, NO_BODY, T, UNKNOWN_ID, WRITE_SPECS, json, leakIn, originOf, rawJson, sender, startSweepApi, urlOf,
  validCommute, validDelivery, type Sent, type SweepApi, type SweptRoute,
} from './v2-sweep-helper';

let sweep: SweepApi;

beforeAll(async () => {
  sweep = await startSweepApi();
}, T);
afterEach(async () => {
  await sweep.confirmExport();
}, T);
afterAll(async () => {
  await sweep?.close();
}, T);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
/** GET cannot carry a body in `fetch`; every other method gets an empty JSON object. */
const bodyOf = (method: string): Sent => (method === 'GET' ? NO_BODY : json({}));

describe('the write routes of /api/v2, as the router lists them', () => {
  it('are the nine of the issue plus the read-only comparison and parse-request, and each has a sweep entry', () => {
    const listed = sweep.writeRoutes.map((route) => route.key);
    expect(listed).toEqual(expect.arrayContaining([
      'POST /shipments', 'PATCH /shipments/:id', 'POST /shipments/:id/match',   // create, edit, retry
      'PUT /employees/:id/commute',                                              // the commute save
      'POST /simulator/control',                                                 // the simulator control
      'POST /planning/reset', 'POST /matches/recompute',                         // new planning cycle, recompute
      'POST /scenario/generate', 'POST /scenario/import',                        // generate, import
      'POST /matches/compare', 'POST /parse-request',                            // the two that only read
    ]));
    // A route added to the router fails here until it has an entry (and so its own broken-field cases).
    expect([...listed].sort(), 'keep WRITE_SPECS in tests/api/v2-sweep-helper.ts in step with the router')
      .toStrictEqual(Object.keys(WRITE_SPECS).sort());
    expect(new Set(listed).size).toBe(listed.length);
  }, T);

  it('the read routes are listed too, and none of them is a write', () => {
    const reads = sweep.routes.filter((route) => route.method === 'GET').map((route) => route.key);
    expect(reads).toEqual(expect.arrayContaining([
      'GET /businesses', 'GET /employees', 'GET /map', 'GET /simulator', 'GET /scenario/export',
      'GET /businesses/:id/dashboard', 'GET /employees/:id/dashboard', 'GET /shipments/:id', 'GET /jobs/:id',
    ]));
    expect(sweep.routes.length).toBe(reads.length + sweep.writeRoutes.length);
  }, T);
});

describe('unknown paths and wrong methods', () => {
  it.each([
    ['an unknown path', '/nope'],
    ['the root of /api/v2', ''],
    ['the root with a slash', '/'],
    ['a path one level too deep', '/simulator/control/extra'],
    ['a path under a real ID', `/shipments/${UNKNOWN_ID}/match/again`],
    ['half of a real path', '/scenario'],
    ['the prefix twice', '/v2/simulator'],
    ['a real path with an extension', '/simulator.json'],
    ['an MVP 1 path that MVP II does not have', '/health'],
    ['a path that climbs out', '/..%2F..%2Fapi%2Fhealth'],
    ['a 300-character path', `/${'p'.repeat(300)}`],
    ['a path with a blank', '/%20'],
    ['a path that is not ASCII', `/${encodeURIComponent('模拟器')}`],
  ])('%s is a JSON 404 for every method', async (label, path) => {
    for (const method of METHODS) {
      await sweep.refused(method, path, bodyOf(method), [404], label);
    }
  }, T);

  it('a path that cannot be decoded is a JSON 400 for every method', async () => {
    for (const method of METHODS) {
      await sweep.refused(method, '/shipments/%E0%A4%A/match', bodyOf(method), [400], 'a broken percent-encoding');
    }
  }, T);

  it('every route answers a method it does not have with a JSON 404 or 405', async () => {
    const methodsOf = new Map<string, Set<string>>();
    for (const route of sweep.routes) {
      methodsOf.set(route.path, (methodsOf.get(route.path) ?? new Set()).add(route.method));
    }
    const ctx = sweep.ctx();
    const idFor = (path: string) => {
      const kind = path.split('/')[1];
      const real: Record<string, string> = {
        businesses: ctx.businesses[0].id, employees: ctx.employee.id, shipments: ctx.shipmentId, jobs: ctx.jobId,
      };
      return real[kind] ?? UNKNOWN_ID;
    };
    let sent = 0;
    for (const [path, registered] of methodsOf) {
      for (const method of METHODS) {
        if (registered.has(method)) continue;
        await sweep.refused(method, urlOf({ path }, idFor(path)), bodyOf(method), [404, 405], 'a method the route does not have');
        sent += 1;
      }
    }
    expect(sent).toBeGreaterThanOrEqual(methodsOf.size * 3);
  }, T);

  it('a wrong method or an unknown path with a broken body is still a JSON 4xx', async () => {
    for (const [name, sent] of BROKEN_BODIES) {
      await sweep.refused('DELETE', '/shipments', sent, [400, 404, 405], name);
      await sweep.refused('PUT', '/simulator/control', sent, [400, 404, 405], name);
      await sweep.refused('POST', '/nope', sent, [400, 404, 405], name);
    }
  }, T);
});

describe('broken URLs on the write routes', () => {
  const variants: [string, (url: string) => string][] = [
    ['a trailing slash', (url) => `${url}/`],
    ['upper case', (url) => url.toUpperCase()],
    ['a query that looks like object keys', (url) => `${url}?__proto__[polluted]=1&constructor[prototype][polluted]=1&a[]=1&a[]=2`],
    ['a 300-character query', (url) => `${url}?q=${'q'.repeat(300)}`],
    ['a doubled slash', (url) => `/${url}`],
  ];

  // Whether Express routes such a URL to the handler or not, a broken body must stay refused.
  it.each(variants)('%s does not get a broken body through', async (label, change) => {
    for (const route of sweep.writeRoutes) {
      for (const [name, sent] of BROKEN_BODIES.slice(0, 4)) {
        await sweep.refused(route.method, change(sweep.urlFor(route)), sent, [400, 404], `${label} and ${name}`);
      }
    }
  }, T);

  it('nothing reached Object.prototype', () => {
    sweep.expectNoPollution();
  }, T);
});

describe('the transport', () => {
  const OVER_LIMIT = JSON.stringify({ pad: 'x'.repeat(6 * 1024 * 1024) }); // the app reads at most 5 MB
  const jsonAs = (headers: Record<string, string>): Sent => ({ body: '{"action":"pause"}', headers });

  // These are refused before any route sees them, so every write route refuses them, also one that takes no options.
  it.each<[string, Sent, number[]]>([
    ['a body over the size limit', rawJson(OVER_LIMIT), [413]],
    ['JSON in an unknown charset', jsonAs({ 'Content-Type': 'application/json; charset=klingon' }), [415]],
    ['JSON in an unknown encoding', jsonAs({ 'Content-Type': 'application/json', 'Content-Encoding': 'squashed' }), [415]],
    ['JSON that says it is gzip and is not', jsonAs({ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }), [400]],
    ['a number that is not JSON (NaN)', rawJson('{"timeMin": NaN}'), [400]],
    ['a number that is not JSON (Infinity)', rawJson('{"timeMin": Infinity}'), [400]],
    ['single quotes', rawJson("{'action': 'pause'}"), [400]],
    ['a trailing comma', rawJson('{"action": "pause",}'), [400]],
    ['two JSON values', rawJson('{"action": "pause"}{"action": "play"}'), [400]],
  ])('every write route refuses %s', async (label, sent, statuses) => {
    for (const route of sweep.writeRoutes) {
      await sweep.refused(route.method, sweep.urlFor(route), sent, statuses, label);
    }
  }, T);

  // A body that is not JSON is not read at all, so it counts as no body.
  it.each<[string, Sent]>([
    ['plain text', { body: 'hello', headers: { 'Content-Type': 'text/plain' } }],
    ['valid JSON sent as plain text', { body: '{"action":"pause"}', headers: { 'Content-Type': 'text/plain' } }],
    ['a form post', { body: 'action=pause&label=Docs&weightKg=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }],
    ['a multipart form', {
      body: '--x\r\nContent-Disposition: form-data; name="action"\r\n\r\npause\r\n--x--\r\n',
      headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
    }],
    ['XML', { body: '<action>pause</action>', headers: { 'Content-Type': 'application/xml' } }],
    ['a body without a content type', { body: '{"action":"pause"}', headers: { 'Content-Type': '' } }],
  ])('every write route that needs a body refuses %s', async (label, sent) => {
    let checked = 0;
    for (const route of sweep.writeRoutes) {
      if (sweep.specOf(route)?.withoutBody === 'runs') continue;
      const editable = route.key !== 'PATCH /shipments/:id' || sweep.ctx().editable;
      await sweep.refused(route.method, sweep.urlFor(route), sent, editable ? [400] : [409], label);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  }, T);
});

// Everything above is refused. From here on requests change the run, so the order of the tests matters.
describe('what is not a refusal', () => {
  it('a route that takes no options runs on no body and on {}: 200, and the version goes up by exactly one', async () => {
    let checked = 0;
    for (const route of sweep.writeRoutes) {
      const spec = sweep.specOf(route);
      if (!spec || spec.emptyObject !== 'runs') continue;
      const forms: [string, Sent][] = [['{}', json({})], ['an empty JSON body', rawJson('')]];
      if (spec.withoutBody === 'runs') forms.push(['no body', NO_BODY]);
      for (const [label, sent] of forms) {
        const ctx = sweep.ctx();
        // A retry of a matched delivery and the comparison store nothing; an edit needs an unmatched delivery.
        const stores = spec.changesRun && (route.params.length === 0 || ctx.editable);
        if (route.key === 'PATCH /shipments/:id' && !ctx.editable) continue; // a 409: covered by the bodies sweep
        const before = sweep.store.get().version;
        const reply = await sweep.send(route.method, sweep.urlFor(route), sent);
        const what = `${route.key} with ${label} -> ${reply.status} ${reply.text.slice(0, 120)}`;
        expect(reply.status, what).toBe(200);
        expect(reply.contentType, what).toMatch(/^application\/json\b/);
        expect(sweep.store.get().version - before, what).toBe(stores ? 1 : 0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  }, T);

  it('after those requests the broken bodies are still refused on every write route', async () => {
    expect(sweep.stateFileExists()).toBe(true);
    for (const route of sweep.writeRoutes) {
      for (const [name, sent] of BROKEN_BODIES) {
        await sweep.refused(route.method, sweep.urlFor(route), sent, [400], name);
      }
    }
  }, T);

  it('a locked run answers every change with a JSON 409 and stays as it is (DECISIONS pass 6)', async () => {
    const played = await sweep.send('POST', '/simulator/control', json({ action: 'play' }));
    expect(played.status).toBe(200);
    expect(sweep.store.get().clock.phase).toBe('locked');

    const ctx = sweep.ctx();
    const locked: [string, string, Sent][] = [
      ['POST', '/shipments', json(validDelivery(ctx))],
      ['PATCH', `/shipments/${ctx.shipmentId}`, json({ label: 'Sweep edit' })],
      ['POST', `/shipments/${ctx.shipmentId}/match`, NO_BODY],
      ['PUT', `/employees/${ctx.employee.id}/commute`, json(validCommute(ctx))],
      ['POST', '/matches/recompute', NO_BODY],
    ];
    for (const [method, url, sent] of locked) {
      const error = await sweep.refused(method, url, sent, [409], 'a valid request while locked');
      // The sentence names the simulator's control that unlocks (#734), not one the app no longer has.
      expect(error.error).toMatch(/Press Back to start in the simulator/);
      expect(error.error).not.toMatch(/planning cycle/i);
    }
    // A broken request stays refused: 400 as before, or 409 where the route looks at the lock first.
    for (const route of sweep.writeRoutes) {
      for (const [name, sent] of BROKEN_BODIES) {
        await sweep.refused(route.method, sweep.urlFor(route), sent, [400, 409], `${name} while locked`);
      }
    }

    const reset = await sweep.send('POST', '/planning/reset');
    expect(reset.status).toBe(200);
    expect(sweep.store.get().clock.phase).toBe('planning');
  }, T);

  it('one valid delivery request still answers 201 and the version goes up by exactly one', async () => {
    await sweep.expectStillWorks();
    sweep.expectNoPollution();
  }, T);
});

describe('a server without travel data', () => {
  it('answers every write route with JSON, 400 for a body that cannot be read and 503 otherwise, and writes no file', async () => {
    const api = await startBootstrapApi({ cache: 'empty' });
    try {
      expect(api.runtime.status).toBe('not_loaded');
      const send = sender(await originOf(api));
      const bodies: [string, Sent, number][] = [
        ['no body', NO_BODY, 503],
        ['{}', json({}), 503],
        ['an array', rawJson('[]'), 503],
        ['malformed JSON', rawJson('{"a":'), 400],
        ['null', rawJson('null'), 400],
      ];
      for (const key of Object.keys(WRITE_SPECS)) {
        const [method, path] = key.split(' ');
        const route: Pick<SweptRoute, 'path'> = { path };
        for (const [label, sent, status] of bodies) {
          const reply = await send(method, urlOf(route, UNKNOWN_ID), sent);
          const what = `${key} with ${label} -> ${reply.status} ${reply.text.slice(0, 160)}`;
          expect(reply.status, what).toBe(status);
          expect(reply.contentType, what).toMatch(/^application\/json\b/);
          expect(leakIn(reply.text, [process.cwd(), os.tmpdir(), api.repo.root]), what).toBeNull();
          const body = JSON.parse(reply.text) as { error?: unknown; code?: unknown };
          expect(typeof body.error, what).toBe('string');
          if (status === 503) expect(body.code, what).toBe('travel_data_missing');
        }
      }
      expect(fs.existsSync(api.repo.statePath)).toBe(false);
    } finally {
      await api.close();
    }
  }, T);
});
