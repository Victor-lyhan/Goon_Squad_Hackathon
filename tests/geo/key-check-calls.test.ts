// Google access check (server/geo/keyCheck.ts): the three calls, their order, and what each row says when a call
// works, returns nothing usable or fails. No network, no real key, no .env.
import { describe, expect, it } from 'vitest';
import { checkGoogleAccess, keyCheckPassed } from '../../server/geo/keyCheck';
import { ADDRESS, APIS, FROM, TO, failing, fakeClient, googleError } from './key-check-helpers';

const check = (client: ReturnType<typeof fakeClient>['client']) => checkGoogleAccess({ client, address: ADDRESS, from: FROM, to: TO });

describe('key check: calls', () => {
  it('makes exactly three calls in order (geocode, 1x1 matrix, route line) and reports three ok rows', async () => {
    const { client, calls } = fakeClient();
    const rows = await check(client);

    expect(calls).toEqual([
      { fn: 'geocodeAddress', address: ADDRESS },
      { fn: 'computeRouteMatrix', origins: [FROM], destinations: [TO] },
      { fn: 'computeRoutePolyline', origin: FROM, destination: TO },
    ]);
    expect(rows).toEqual([
      { api: 'geocoding', ok: true, problem: 'none', detail: 'found 40.7484, -73.9857', remedy: '' },
      { api: 'route_matrix', ok: true, problem: 'none', detail: '734 s, 6120 m', remedy: '' },
      { api: 'routes', ok: true, problem: 'none', detail: 'route line of 27 characters, 734 s, 6120 m', remedy: '' },
    ]);
    expect(keyCheckPassed(rows)).toBe(true);
  });

  it.each(APIS)('still makes the other two calls when %s fails, and leaves their rows ok', async (api) => {
    const { client, calls } = failing(api, googleError(api, 403, 'PERMISSION_DENIED', 'The caller does not have permission'));
    const rows = await check(client);

    expect(calls.map((call) => call.fn)).toEqual(['geocodeAddress', 'computeRouteMatrix', 'computeRoutePolyline']);
    expect(rows.map((row) => row.api)).toEqual(APIS);
    for (const row of rows) {
      expect(row.ok).toBe(row.api !== api);
      expect(row.problem === 'none').toBe(row.api !== api);
      expect(row.remedy === '').toBe(row.api !== api);
    }
    expect(keyCheckPassed(rows)).toBe(false);
  });

  it('makes three calls and no more when every call fails (no retry of its own)', async () => {
    const calls: string[] = [];
    const down = (name: string) => async () => {
      calls.push(name);
      throw googleError('routes', 0, 'NETWORK_ERROR', 'TypeError: fetch failed');
    };
    const rows = await checkGoogleAccess({
      client: { geocodeAddress: down('geocode'), computeRouteMatrix: down('matrix'), computeRoutePolyline: down('route') },
      address: ADDRESS,
      from: FROM,
      to: TO,
    });

    expect(calls).toEqual(['geocode', 'matrix', 'route']);
    expect(rows.map((row) => row.problem)).toEqual(['network', 'network', 'network']);
  });

  it('survives a client method that throws before returning a promise', async () => {
    const { client } = fakeClient();
    client.computeRouteMatrix = () => {
      throw new Error('boom');
    };
    const rows = await check(client);

    expect(rows.map((row) => row.problem)).toEqual(['none', 'unknown', 'none']);
    expect(rows[1].detail).toBe('boom');
  });

  it('does not change the points it was given', async () => {
    const from = Object.freeze({ ...FROM });
    const to = Object.freeze({ ...TO });
    const { client } = fakeClient();
    const rows = await checkGoogleAccess({ client, address: ADDRESS, from, to });

    expect(keyCheckPassed(rows)).toBe(true);
    expect(from).toEqual(FROM);
    expect(to).toEqual(TO);
  });
});

describe('key check: a call that worked but returned nothing usable', () => {
  it('geocode with no result is no_result on the geocoding row, and names the Geocoding API', async () => {
    const { client, calls } = fakeClient({ geocoding: [] });
    const rows = await check(client);

    expect(calls).toHaveLength(3);
    expect(rows[0]).toEqual({
      api: 'geocoding',
      ok: false,
      problem: 'no_result',
      detail: 'no geocoding result for the check address (ZERO_RESULTS)',
      remedy: 'The Geocoding API answered, so the key works, but it found nothing for the check address; run the check with a real street address.',
    });
    expect(rows.slice(1).every((row) => row.ok)).toBe(true);
    expect(keyCheckPassed(rows)).toBe(false);
  });

  it('a geocode result without numbers is no_result, never an ok row', async () => {
    const { client } = fakeClient({ geocoding: [{ lat: Number.NaN, lng: -73.9, formattedAddress: '', neighborhood: null }] });
    expect((await check(client))[0].problem).toBe('no_result');
  });

  it('a matrix pair Google could not route is no_result with its condition in the detail', async () => {
    const { client } = fakeClient({
      route_matrix: { elements: [], failures: [{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND', message: 'no route between these points' }] },
    });
    const rows = await check(client);

    expect(rows[1]).toEqual({
      api: 'route_matrix',
      ok: false,
      problem: 'no_result',
      detail: 'no route for the check pair (ROUTE_NOT_FOUND: no route between these points)',
      remedy: 'The Routes API answered, so the key works, but it found no driving route between the two check points; run the check with two points on roads.',
    });
    expect([rows[0].ok, rows[2].ok]).toEqual([true, true]);
  });

  it('an empty matrix answer, or an element with unusable numbers, is no_result', async () => {
    const empty = fakeClient({ route_matrix: { elements: [], failures: [] } });
    expect((await check(empty.client))[1]).toMatchObject({ problem: 'no_result', detail: 'no route for the check pair (no element with a duration and a distance)' });

    const unreadable = fakeClient({ route_matrix: { elements: [{ originIndex: 0, destinationIndex: 0, durationS: Number.NaN, distanceM: 10 }], failures: [] } });
    expect((await check(unreadable.client))[1].problem).toBe('no_result');
  });

  it('NO_ROUTE from the route call is no_result on the routes row', async () => {
    const { client } = failing('routes', googleError('routes', 200, 'NO_ROUTE', 'no route between these points'));
    const rows = await check(client);

    expect(rows[2]).toMatchObject({ api: 'routes', ok: false, problem: 'no_result', detail: 'HTTP 200 NO_ROUTE: no route between these points' });
    expect(rows[2].remedy).toContain('Routes API');
    expect([rows[0].ok, rows[1].ok]).toEqual([true, true]);
  });

  it('a route without a line is no_result', async () => {
    const { client } = fakeClient({ routes: { encoded: '', durationS: 10, distanceM: 10 } });
    expect((await check(client))[2]).toMatchObject({ problem: 'no_result', detail: 'the route had no line' });
  });
});

describe('key check: module rules', () => {
  it('imports no file system, reads no environment and writes to no terminal', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../../server/geo/keyCheck.ts'), 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    expect([...new Set(imports)].sort()).toEqual(['./fetchRunner', './googleClient']);
    expect(source).not.toMatch(/\bfs\b|node:/);
    expect(source).not.toMatch(/process\.env|\bprocess\b/);
    // "Google Cloud console." is in the remedies, so only a use of the object counts: console.log(, console['log'].
    expect(source).not.toMatch(/\bconsole\s*(?:\.\s*\w+\s*\(|\[)/);
    expect(source).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
