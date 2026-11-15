// The broken-request sweep of /api/v2, part 2: IDs (#521).
// Every route that takes an ID in its path, read routes included, gets an unknown, an empty and a
// 300-character ID, IDs that look like object keys or paths, and real IDs of the wrong kind. The answer
// is a JSON 404 in the v2 error shape (a JSON 400 for a path that cannot be decoded), never a 500 and
// never HTML, and the run is untouched. The routes are read from the router, so one added later is swept too;
// a write route gets a body it would accept, so the ID is the only thing wrong with the request.
// (An unknown ID inside a body, such as the sender of a delivery, is a 400 with a field error:
// v2-sweep-bodies.test.ts.)
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  NO_BODY, T, isWrite, json, startSweepApi, urlOf, type Sent, type SweepApi, type SweptRoute,
} from './v2-sweep-helper';

let sweep: SweepApi;
let idRoutes: SweptRoute[];

beforeAll(async () => {
  sweep = await startSweepApi();
  idRoutes = sweep.routes.filter((route) => route.params.length > 0);
}, T);
afterEach(async () => {
  await sweep.confirmExport();
}, T);
afterAll(async () => {
  await sweep?.close();
}, T);

/** A body the route would accept, so only the ID is wrong. A read, a retry or a route without a spec gets none. */
function bodyFor(route: SweptRoute): Sent {
  const valid = isWrite(route) ? sweep.specOf(route)?.valid : null;
  return valid ? json(valid(sweep.ctx())) : NO_BODY;
}

/** Sends `id` (already URL-encoded) to every route with an ID and expects a JSON answer with `statuses`. */
async function sweepId(id: string, statuses: number[], label: string) {
  expect(idRoutes.length).toBeGreaterThan(0);
  for (const route of idRoutes) {
    await sweep.refused(route.method, urlOf(route, id), bodyFor(route), statuses, label);
  }
}

/** Which kind of ID a route takes, from the first part of its path: `/shipments/:id/match` -> shipments. */
const kindOf = (route: SweptRoute) => route.path.split('/')[1];

describe('every /api/v2 route that takes an ID', () => {
  it('covers the business, employee, shipment and job routes, reads and writes', () => {
    expect(idRoutes.map((route) => route.key)).toEqual(expect.arrayContaining([
      'GET /businesses/:id/dashboard',
      'GET /employees/:id/dashboard',
      'PUT /employees/:id/commute',
      'GET /shipments/:id',
      'PATCH /shipments/:id',
      'POST /shipments/:id/match',
      'GET /jobs/:id',
    ]));
    // The sweep fills one `:param` per route. A route with two needs its own cases here.
    expect(idRoutes.filter((route) => route.params.length !== 1).map((route) => route.key)).toStrictEqual([]);
  }, T);

  it.each([
    ['an unknown ID', 'sweep-unknown-id'],
    ['a 300-character ID', 'a'.repeat(300)],
    ['a shipment ID that was never given out', 'shp-999999'],
    ['an employee ID that was never given out', 'emp-999999'],
    ['a business ID that was never given out', 'biz-not-a-business'],
    ['a job ID that was never given out', 'plan-shp-999999-L0'],
    ['the ID __proto__', '__proto__'],
    ['the ID constructor', 'constructor'],
    ['the ID toString', 'toString'],
    ['the ID hasOwnProperty', 'hasOwnProperty'],
    ['the ID undefined', 'undefined'],
    ['the ID null', 'null'],
    ['a number as the ID', '0'],
    ['a path as the ID', '..%2F..%2Fetc%2Fpasswd'],
    ['an ID with a null byte', 'shp-1%00'],
    ['a blank ID', '%20'],
    ['an ID that is not ASCII', encodeURIComponent('包裹-✓-🚚')],
    ['HTML as the ID', encodeURIComponent('<script>alert(1)</script>')],
  ])('%s is a JSON 404', async (label, id) => {
    await sweepId(id, [404], label);
  }, T);

  it('an empty ID is a JSON 404', async () => {
    // `/shipments//match`, `/employees//commute`, `/shipments/`: no route matches, so the router's own 404 answers.
    await sweepId('', [404], 'an empty ID');
  }, T);

  it('an ID that cannot be decoded is a JSON 400', async () => {
    await sweepId('%E0%A4%A', [400], 'a broken percent-encoding');
    await sweepId('%', [400], 'a lone percent sign');
  }, T);

  it('a real ID of another kind is a JSON 404', async () => {
    const ctx = sweep.ctx();
    const real: Record<string, string> = {
      businesses: ctx.businesses[0].id,
      employees: ctx.employee.id,
      shipments: ctx.shipmentId,
      jobs: ctx.jobId,
    };
    const others: [string, string][] = [
      ['a home ID', ctx.employee.homeId],
      ['a plan ID', ctx.run.assignments.plans[0].id],
      ['a run ID', ctx.run.runId],
    ];
    let sent = 0;
    for (const route of idRoutes) {
      const wrongKind = Object.entries(real)
        .filter(([kind]) => kind !== kindOf(route))
        .map(([kind, id]): [string, string] => [`a real ${kind} ID`, id]);
      for (const [label, id] of [...wrongKind, ...others]) {
        if (id === real[kindOf(route)]) continue; // the same text is also a real ID of this route's kind
        await sweep.refused(route.method, urlOf(route, encodeURIComponent(id)), bodyFor(route), [404], label);
        sent += 1;
      }
    }
    expect(sent).toBeGreaterThan(idRoutes.length);
  }, T);

  it('a real ID with something added, or in another case, is a JSON 404', async () => {
    const ctx = sweep.ctx();
    const real: Record<string, string> = {
      businesses: ctx.businesses[0].id,
      employees: ctx.employee.id,
      shipments: ctx.shipmentId,
      jobs: ctx.jobId,
    };
    for (const route of idRoutes) {
      const id = real[kindOf(route)];
      if (!id) continue; // a kind this sweep has no real ID for
      for (const [label, changed] of [
        ['a real ID in upper case', id.toUpperCase()],
        ['a real ID with a space after it', `${id}%20`],
        ['a real ID with a space before it', `%20${id}`],
        ['a real ID with a null byte after it', `${id}%00`],
        ['a real ID twice', `${id}${id}`],
      ]) {
        await sweep.refused(route.method, urlOf(route, changed), bodyFor(route), [404], label);
      }
    }
  }, T);

  it('the 404 names what was not found and never repeats the ID', async () => {
    const id = `sweep-secret-${'z'.repeat(40)}`;
    for (const route of idRoutes) {
      const error = await sweep.refused(route.method, urlOf(route, id), bodyFor(route), [404], 'an unknown ID');
      // The read routes say "not found"; the write routes say it in a sentence (#888).
      expect(error.error).toMatch(/not found|no longer/i);
      expect(JSON.stringify(error)).not.toContain('sweep-secret');
    }
  }, T);
});

describe('after the ID sweep', () => {
  it('the real IDs still answer', async () => {
    const ctx = sweep.ctx();
    for (const url of [
      `/businesses/${ctx.businesses[0].id}/dashboard`, `/employees/${ctx.employee.id}/dashboard`,
      `/shipments/${ctx.shipmentId}`, `/jobs/${ctx.jobId}`,
    ]) {
      const reply = await sweep.send('GET', url);
      expect(reply.status, `GET ${url}`).toBe(200);
      expect(reply.contentType).toMatch(/^application\/json\b/);
    }
  }, T);

  it('there is still no state file and nothing reached Object.prototype', () => {
    expect(sweep.stateFileExists()).toBe(false);
    sweep.expectNoPollution();
  }, T);

  it('one valid delivery request still answers 201 and the version goes up by exactly one', async () => {
    await sweep.expectStillWorks();
  }, T);
});
