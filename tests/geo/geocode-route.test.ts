// GET /api/v2/geocode handler (server/api/geo.ts) on a small Express app with a fake Google fetch:
// no network beyond localhost, no real key, no .env.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GEOCODE_DEADLINE_MS,
  GEOCODE_MAX_RETRIES,
  GEOCODE_TIMEOUT_MS,
  GOOGLE_UNAVAILABLE_MESSAGE,
  KEY_MISSING_MESSAGE,
  MAX_GEOCODE_RESULTS,
  NYC_BOUNDS,
  boroughOf,
  getGeocode,
  insideNyc,
  nycNeighborhoodLookup,
  withNycHint,
  type GeocodeDeps,
} from '../../server/api/geo';
import { BACKOFF_BASE_MS, GEOCODE_URL, type FetchLike } from '../../server/geo/googleClient';
import type { GeocodeResponse, TravelUnavailable } from '../../shared/v2/api';
import { ApiError } from '../../shared/v2/schemas';
import type { NycNeighborhoodsFile } from '../../shared/v2/types';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
const KEY = 'FAKE_key-123+/=';
const KEY_ENCODED = encodeURIComponent(KEY);
// Not a real person's address: a made-up house number on a real avenue.
const QUERY = '99999 Thirtieth Avenue Astoria';

// The parts of a Geocoding result, under the type names of Google's documentation
// (https://developers.google.com/maps/documentation/geocoding/requests-geocoding).
interface GoogleItem {
  label: string;
  lat: number;
  lng: number;
  /** `neighborhood` */
  neighborhood?: string;
  /** `sublocality_level_1`: in New York City, the borough. */
  borough?: string;
  /** `locality`: the city or town. */
  locality?: string;
  /** `administrative_area_level_2`: the county. */
  county?: string;
  /** `administrative_area_level_1` short name. Defaults to NY. */
  state?: string;
}

function googleOk(items: GoogleItem[]) {
  const part = (name: string | undefined, types: string[]) => (name ? [{ long_name: name, short_name: name, types }] : []);
  return {
    status: 'OK',
    results: items.map((item) => ({
      formatted_address: item.label,
      geometry: { location: { lat: item.lat, lng: item.lng } },
      address_components: [
        ...part(item.neighborhood, ['neighborhood', 'political']),
        ...part(item.borough, ['political', 'sublocality', 'sublocality_level_1']),
        ...part(item.locality, ['locality', 'political']),
        ...part(item.county, ['administrative_area_level_2', 'political']),
        { long_name: item.state === 'NJ' ? 'New Jersey' : 'New York', short_name: item.state ?? 'NY', types: ['administrative_area_level_1', 'political'] },
        { long_name: 'United States', short_name: 'US', types: ['country', 'political'] },
      ],
    })),
  };
}

const ASTORIA: GoogleItem = {
  label: '99999 30th Ave, Astoria, NY 11102, USA', lat: 40.7661234567, lng: -73.9212345678, neighborhood: 'Astoria', borough: 'Queens', county: 'Queens County',
};

type Reply = { status: number; body: unknown } | Error;

function fakeGoogle(reply: (url: string, index: number) => Reply) {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    const answer = reply(url, urls.length - 1);
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
  return { urls, fetchImpl };
}

let server: Server | undefined;

async function serve(deps: GeocodeDeps): Promise<string> {
  const app = express();
  app.get('/api/v2/geocode', getGeocode(deps));
  // 127.0.0.1 only (#821): on every address, another program on 127.0.0.1 with the same port number could answer.
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const search = (base: string, q: string) => fetch(`${base}/api/v2/geocode?q=${encodeURIComponent(q)}`);

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let printed: string[];

beforeEach(() => {
  printed = [];
  for (const name of CONSOLE_METHODS) {
    vi.spyOn(console, name).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((arg) => (arg instanceof Error ? `${arg.stack}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

function expectNoLeak(text: string, secrets: string[]) {
  for (const secret of [KEY, KEY_ENCODED, ...secrets]) expect(text).not.toContain(secret);
}

describe('GET /api/v2/geocode', () => {
  it('returns results in the contract shape, with the NYC hint added and coordinates rounded to 5 decimals', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([ASTORIA]) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });

    const res = await search(base, `  ${QUERY} `);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as GeocodeResponse;
    expect(body).toEqual({
      results: [{ label: '99999 30th Ave, Astoria, NY 11102, USA', neighborhood: 'Astoria', lat: 40.76612, lng: -73.92123 }],
    });

    expect(google.urls).toHaveLength(1);
    const sent = new URL(google.urls[0]);
    expect(sent.origin + sent.pathname).toBe(GEOCODE_URL);
    expect(sent.searchParams.get('address')).toBe(`${QUERY}, New York, NY`);
    expect(sent.searchParams.get('key')).toBe(KEY);
  });

  it('does not add the hint twice when the query already ends in New York', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([ASTORIA]) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    await search(base, '99999 30th Ave, Queens, NY 11102');
    expect(new URL(google.urls[0]).searchParams.get('address')).toBe('99999 30th Ave, Queens, NY 11102');
  });

  it('drops results outside New York City that name no borough', async () => {
    const google = fakeGoogle(() => ({
      status: 200,
      body: googleOk([
        { label: '99999 State St, Albany, NY 12207, USA', lat: 42.6526, lng: -73.7562, neighborhood: 'Center Square', locality: 'Albany', county: 'Albany County' },
        // Inside the bounding box, but across the Hudson in New Jersey.
        { label: '99999 Washington St, Hoboken, NJ 07030, USA', lat: 40.744, lng: -74.0324, neighborhood: 'Downtown Hoboken', locality: 'Hoboken', county: 'Hudson County', state: 'NJ' },
        { label: '99999 Bay St, Staten Island, NY 10301, USA', lat: 40.6405, lng: -74.0759, neighborhood: 'St. George', borough: 'Staten Island', county: 'Richmond County' },
      ]),
    }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, 'ninety-nine state street')).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.neighborhood)).toEqual(['St. George']);
  });

  // #602: these three are inside NYC_BOUNDS, in New York State and have a neighborhood. Only the borough rule drops them.
  const NEIGHBORS: GoogleItem[] = [
    { label: '99999 Gramatan Ave, Mount Vernon, NY 10550, USA', lat: 40.913, lng: -73.837, neighborhood: 'Fleetwood', locality: 'Mount Vernon', county: 'Westchester County' },
    { label: '99999 McLean Ave, Yonkers, NY 10705, USA', lat: 40.9052, lng: -73.8791, neighborhood: 'Lincoln Park', locality: 'Yonkers', county: 'Westchester County' },
    { label: '99999 Doughty Blvd, Inwood, NY 11096, USA', lat: 40.6216, lng: -73.7468, neighborhood: 'Inwood', locality: 'Inwood', county: 'Nassau County' },
  ];
  const FIVE_BOROUGHS: GoogleItem[] = [
    { label: '99999 Broadway, New York, NY 10027, USA', lat: 40.8116, lng: -73.9465, neighborhood: 'Harlem', borough: 'Manhattan', locality: 'New York', county: 'New York County' },
    { label: '99999 5th Ave, Brooklyn, NY 11215, USA', lat: 40.6712, lng: -73.9836, neighborhood: 'Park Slope', borough: 'Brooklyn', county: 'Kings County' },
    ASTORIA,
    { label: '99999 Grand Concourse, Bronx, NY 10451, USA', lat: 40.8264, lng: -73.9226, neighborhood: 'Concourse', borough: 'The Bronx', county: 'Bronx County' },
    { label: '99999 Bay St, Staten Island, NY 10301, USA', lat: 40.6405, lng: -74.0759, neighborhood: 'St. George', borough: 'Staten Island', county: 'Richmond County' },
  ];

  it('drops Mount Vernon, Yonkers and Inwood (Nassau): in the box, in New York State, with a neighborhood, but in no borough', async () => {
    for (const item of NEIGHBORS) {
      expect(insideNyc(item.lat, item.lng), item.label).toBe(true);
      expect(item.label).toMatch(/, NY \d{5}, USA$/);
      expect(item.neighborhood).toBeTruthy();
    }
    expect(NEIGHBORS[0]).toMatchObject({ lat: 40.913, lng: -73.837, neighborhood: 'Fleetwood' });

    const file = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc/neighborhoods.json'), 'utf8'),
    ) as NycNeighborhoodsFile;
    for (const neighborhoodFor of [undefined, nycNeighborhoodLookup(file.neighborhoods), () => 'Any name']) {
      // Each one alone, then all three around a Bronx address: only that one is offered.
      for (const items of [...NEIGHBORS.map((item) => [item]), [NEIGHBORS[0], FIVE_BOROUGHS[3], NEIGHBORS[1], NEIGHBORS[2]]]) {
        const google = fakeGoogle(() => ({ status: 200, body: googleOk(items) }));
        const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl, neighborhoodFor });
        const res = await search(base, QUERY);
        expect(res.status).toBe(200);
        const body = (await res.json()) as GeocodeResponse;
        expect(body.results.map((r) => r.label)).toEqual(items.length === 1 ? [] : [FIVE_BOROUGHS[3].label]);
        await new Promise((resolve) => server!.close(resolve));
        server = undefined;
      }
    }
  });

  it('keeps one address in each of the five boroughs, with label, neighborhood, lat and lng only', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk(FIVE_BOROUGHS) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, QUERY)).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.neighborhood)).toEqual(['Harlem', 'Park Slope', 'Astoria', 'Concourse', 'St. George']);
    expect(body.results.map((r) => r.label)).toEqual(FIVE_BOROUGHS.map((item) => item.label));
    for (const result of body.results) expect(Object.keys(result).sort()).toEqual(['label', 'lat', 'lng', 'neighborhood']);
    expect(JSON.stringify(body)).not.toMatch(/borough|county|sublocality|Kings|Richmond/i);
  });

  it('drops a result with no borough component, and reads the county when only the borough part is missing', async () => {
    const google = fakeGoogle(() => ({
      status: 200,
      body: googleOk([
        // Only the state and the country: inside the box, ", NY", a neighborhood, but no borough.
        { label: '99999 7th Ave, New York, NY 10001, USA', lat: 40.7484, lng: -73.9935, neighborhood: 'Chelsea' },
        // A city named like nothing in the list is not a borough.
        { label: '99999 8th Ave, New York, NY 10001, USA', lat: 40.7501, lng: -73.9952, neighborhood: 'Chelsea', locality: 'New York' },
        // Google warns that any one component can be missing: the county of a borough is enough.
        { label: '99999 Bedford Ave, Brooklyn, NY 11211, USA', lat: 40.7177, lng: -73.9575, neighborhood: 'Williamsburg', county: 'Kings County' },
        // A part of a name is not the name.
        { label: '99999 Hillside Ave, Queens Village, NY 11427, USA', lat: 40.7301, lng: -73.7462, neighborhood: 'Queens Village', borough: 'Queens Village' },
      ]),
    }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, QUERY)).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.neighborhood)).toEqual(['Williamsburg']);
  });

  it('the box, the state and the label stay as a second check on a result that names a borough', async () => {
    const google = fakeGoogle(() => ({
      status: 200,
      body: googleOk([
        { label: '99999 State St, Albany, NY 12207, USA', lat: 42.6526, lng: -73.7562, neighborhood: 'Center Square', borough: 'Manhattan', county: 'New York County' },
        { label: '99999 Washington St, Hoboken, NJ 07030, USA', lat: 40.744, lng: -74.0324, neighborhood: 'Downtown Hoboken', borough: 'Manhattan', state: 'NJ' },
        { label: '', lat: 40.75, lng: -73.99, neighborhood: 'Midtown', borough: 'Manhattan', county: 'New York County' },
        FIVE_BOROUGHS[1],
      ]),
    }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, QUERY)).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.neighborhood)).toEqual(['Park Slope']);
  });

  it(`returns at most ${MAX_GEOCODE_RESULTS} results, in Google's order, without duplicates`, async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...ASTORIA, label: `${90000 + i} 30th Ave, Astoria, NY 11102, USA`, lat: ASTORIA.lat + i * 0.0001 }));
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([many[0], many[0], ...many.slice(1)]) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, QUERY)).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.label)).toEqual(many.slice(0, MAX_GEOCODE_RESULTS).map((item) => item.label));
  });

  it('a result without a neighborhood is dropped, unless neighborhoodFor names one', async () => {
    const items: GoogleItem[] = [
      // The first two name their borough by its county only, so Google gives no neighborhood label at all.
      { label: '99999 31st St, Queens, NY 11102, USA', lat: 40.765, lng: -73.92, county: 'Queens County' },
      { label: '99999 Broadway, New York, NY 10007, USA', lat: 40.7128, lng: -74.006, county: 'New York County' },
      { label: '99999 5th Ave, Brooklyn, NY 11215, USA', lat: 40.67, lng: -73.98, borough: 'Brooklyn', county: 'Kings County' },
    ];
    const google = fakeGoogle(() => ({ status: 200, body: googleOk(items) }));

    const plain = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const without = (await (await search(plain, QUERY)).json()) as GeocodeResponse;
    // Only the one Google labels itself (the client falls back to the sublocality).
    expect(without.results.map((r) => r.neighborhood)).toEqual(['Brooklyn']);
    await new Promise((resolve) => server!.close(resolve));

    const file = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc/neighborhoods.json'), 'utf8'),
    ) as NycNeighborhoodsFile;
    const withLookup = await serve({ key: () => KEY, fetchImpl: google.fetchImpl, neighborhoodFor: nycNeighborhoodLookup(file.neighborhoods) });
    const withBoxes = (await (await search(withLookup, QUERY)).json()) as GeocodeResponse;
    // The first point is inside the Astoria box; the second is in no box, so it is still dropped.
    expect(withBoxes.results.map((r) => r.neighborhood)).toEqual(['Astoria', 'Brooklyn']);
  });

  it('answers 400 in the ApiError shape for a bad query, without calling Google', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([ASTORIA]) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });

    const short = await search(base, ' ab ');
    expect(short.status).toBe(400);
    const body = ApiError.parse(await short.json());
    expect(body.fieldErrors).toEqual({ q: 'Type at least 3 characters' });

    const missing = await fetch(`${base}/api/v2/geocode`);
    expect(missing.status).toBe(400);
    expect(ApiError.parse(await missing.json()).fieldErrors).toHaveProperty('q');

    const twice = await fetch(`${base}/api/v2/geocode?q=first+one&q=second+one`);
    expect(twice.status).toBe(400);

    const long = await search(base, 'x'.repeat(201));
    expect(long.status).toBe(400);
    expect(ApiError.parse(await long.json()).fieldErrors).toEqual({ q: 'Max 200 characters' });

    expect(google.urls).toHaveLength(0);
  });

  it('answers 400 before 503: a bad query is reported even without a key', async () => {
    const base = await serve({ key: () => null });
    expect((await search(base, 'ab')).status).toBe(400);
  });

  it('answers 503 google_key_missing without a key and sends nothing to Google', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([ASTORIA]) }));
    for (const key of [null, '', '   ']) {
      const base = await serve({ key: () => key, fetchImpl: google.fetchImpl });
      const res = await search(base, QUERY);
      expect(res.status).toBe(503);
      expect((await res.json()) as TravelUnavailable).toEqual({ error: KEY_MISSING_MESSAGE, code: 'google_key_missing' });
      await new Promise((resolve) => server!.close(resolve));
      server = undefined;
    }
    expect(KEY_MISSING_MESSAGE).toBe('Address search needs GOOGLE_MAPS_SERVER_KEY on the server.');
    expect(google.urls).toHaveLength(0);
  });

  it('reads the key on every request, so a key added later is picked up', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: googleOk([ASTORIA]) }));
    let key: string | null = null;
    const base = await serve({ key: () => key, fetchImpl: google.fetchImpl });
    expect((await search(base, QUERY)).status).toBe(503);
    key = KEY;
    expect((await search(base, QUERY)).status).toBe(200);
  });

  it('answers 503 google_unavailable when Google says REQUEST_DENIED, with no key or query in the body', async () => {
    const google = fakeGoogle((url) => ({
      status: 200,
      body: { status: 'REQUEST_DENIED', error_message: `The provided API key is invalid. ${url}`, results: [] },
    }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text) as TravelUnavailable).toEqual({ error: GOOGLE_UNAVAILABLE_MESSAGE, code: 'google_unavailable' });
    expectNoLeak(text, [QUERY, encodeURIComponent(QUERY), 'Thirtieth']);
    expect(google.urls).toHaveLength(1); // REQUEST_DENIED is not retried
  });

  it(`retries a Google 5xx ${GEOCODE_MAX_RETRIES} time, then answers 503 google_unavailable`, async () => {
    const google = fakeGoogle(() => ({ status: 500, body: { error: { status: 'INTERNAL', message: 'backend error' } } }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    expect(((await res.json()) as TravelUnavailable).code).toBe('google_unavailable');
    expect(google.urls).toHaveLength(1 + GEOCODE_MAX_RETRIES);
  });

  it('recovers when the retry succeeds', async () => {
    const google = fakeGoogle((_url, index) => (index === 0 ? new Error('socket hang up') : { status: 200, body: googleOk([ASTORIA]) }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const res = await search(base, QUERY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GeocodeResponse).results).toHaveLength(1);
  });

  it('answers 200 with no results for ZERO_RESULTS', async () => {
    const google = fakeGoogle(() => ({ status: 200, body: { status: 'ZERO_RESULTS', results: [] } }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const res = await search(base, QUERY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  it('an unexpected error gives a plain 500 that repeats nothing', async () => {
    const base = await serve({
      key: () => KEY,
      geocode: async (address, opts) => {
        throw new Error(`boom for ${address} with ${opts.apiKey}`);
      },
    });
    const res = await search(base, QUERY);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Address search failed.' });
    expectNoLeak(text + printed.join('\n'), [QUERY, 'Thirtieth']);
  });
});

// #602, DECISIONS pass 61: the page gives up at 8 s (client/src/api/http.ts), so the route answers within 7 s.
// Time is virtual: the route's clock and the client's backoff sleep are the test's, and an attempt that gets no
// answer is charged the number the client gave `AbortSignal.timeout` for it. Nothing here waits in real time.
describe('the deadline of the whole search', () => {
  /** What Google does with attempt `index`: answer `reply` after `afterMs`, or nothing at all (`reply` left out). */
  type Script = (index: number) => { afterMs: number; reply?: { status: number; body: unknown } };

  function virtualGoogle(script: Script, lateSleepMs = 0) {
    let nowMs = 0;
    const sleeps: number[] = [];
    const attempts: { startMs: number; timeoutMs: number }[] = [];
    const problems: string[] = [];
    // The stand-in signal never fires (no real timer); the fake fetch charges its number to the clock.
    const timeoutOf = new WeakMap<AbortSignal, number>();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const { signal } = new AbortController();
      timeoutOf.set(signal, ms);
      return signal;
    });
    const fetchImpl: FetchLike = async (_url, init) => {
      const timeoutMs = init?.signal ? timeoutOf.get(init.signal) : undefined;
      if (timeoutMs === undefined) {
        problems.push('a request had no signal from AbortSignal.timeout(ms)');
        throw new Error('no timeout signal');
      }
      const { afterMs, reply } = script(attempts.length);
      attempts.push({ startMs: nowMs, timeoutMs });
      if (reply === undefined || afterMs >= timeoutMs) {
        nowMs += timeoutMs;
        // What Node's fetch rejects with when its AbortSignal.timeout fires.
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      nowMs += afterMs;
      return { status: reply.status, text: async () => JSON.stringify(reply.body) };
    };
    const deps: Pick<GeocodeDeps, 'fetchImpl' | 'now' | 'sleep'> = {
      fetchImpl,
      now: () => nowMs,
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += ms + lateSleepMs;
      },
    };
    return { deps, sleeps, attempts, problems, now: () => nowMs };
  }

  const silent: Script = () => ({ afterMs: Infinity });
  const backendError = { status: 500, body: { error: { status: 'INTERNAL', message: 'backend error' } } };

  it('the numbers: 7 s for the search, under the page\'s 8 s; two attempts and the backoff fit inside it', () => {
    expect(GEOCODE_DEADLINE_MS).toBe(7_000);
    expect(GEOCODE_DEADLINE_MS).toBeLessThan(8_000);
    expect(GEOCODE_MAX_RETRIES).toBe(1);
    expect(2 * GEOCODE_TIMEOUT_MS + BACKOFF_BASE_MS).toBeLessThan(GEOCODE_DEADLINE_MS);
  });

  it('a Google that never answers: 503 google_unavailable before 7 s, after two attempts', async () => {
    const google = virtualGoogle(silent);
    const base = await serve({ key: () => KEY, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text) as TravelUnavailable).toEqual({ error: GOOGLE_UNAVAILABLE_MESSAGE, code: 'google_unavailable' });

    expect(google.problems).toEqual([]);
    expect(google.attempts).toEqual([
      { startMs: 0, timeoutMs: GEOCODE_TIMEOUT_MS },
      { startMs: GEOCODE_TIMEOUT_MS + BACKOFF_BASE_MS, timeoutMs: GEOCODE_TIMEOUT_MS },
    ]);
    expect(google.sleeps).toEqual([BACKOFF_BASE_MS]);
    expect(google.now()).toBe(6_500);
    expect(google.now()).toBeLessThan(GEOCODE_DEADLINE_MS);

    // One line for the operator, with no address and no key in it or in the answer.
    expect(printed).toEqual(['[geocode] Google Geocoding failed: no response NETWORK_ERROR']);
    expectNoLeak(text + printed.join('\n'), [QUERY, encodeURIComponent(QUERY), 'Thirtieth']);
  });

  it('a first attempt that fails fast: the retry runs inside the deadline and its answer is used', async () => {
    const google = virtualGoogle((index) => (index === 0 ? { afterMs: 120, reply: backendError } : { afterMs: 300, reply: { status: 200, body: googleOk([ASTORIA]) } }));
    const base = await serve({ key: () => KEY, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GeocodeResponse).results.map((r) => r.neighborhood)).toEqual(['Astoria']);

    expect(google.problems).toEqual([]);
    expect(google.attempts).toEqual([
      { startMs: 0, timeoutMs: GEOCODE_TIMEOUT_MS },
      { startMs: 120 + BACKOFF_BASE_MS, timeoutMs: GEOCODE_TIMEOUT_MS },
    ]);
    expect(google.now()).toBe(920);
    expect(printed).toEqual([]);
  });

  it('a first attempt that fails late and a silent retry: still 503 before 7 s', async () => {
    const google = virtualGoogle((index) => (index === 0 ? { afterMs: 2_900, reply: backendError } : { afterMs: Infinity }));
    const base = await serve({ key: () => KEY, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    expect(((await res.json()) as TravelUnavailable).code).toBe('google_unavailable');
    expect(google.attempts).toHaveLength(2);
    expect(google.now()).toBe(2_900 + BACKOFF_BASE_MS + GEOCODE_TIMEOUT_MS);
    expect(google.now()).toBeLessThan(GEOCODE_DEADLINE_MS);
  });

  it('the deadline is counted from the request: a retry that starts late gets only what is left of the 7 s', async () => {
    // The backoff ends 1.5 s late (a busy server), so the retry starts at 4.9 s with 2.1 s left, not 3 s.
    const google = virtualGoogle((index) => (index === 0 ? { afterMs: 2_900, reply: backendError } : { afterMs: Infinity }), 1_500);
    const base = await serve({ key: () => KEY, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    expect(((await res.json()) as TravelUnavailable).code).toBe('google_unavailable');
    expect(google.attempts).toEqual([
      { startMs: 0, timeoutMs: GEOCODE_TIMEOUT_MS },
      { startMs: 4_900, timeoutMs: 2_100 },
    ]);
    expect(google.now()).toBe(GEOCODE_DEADLINE_MS);
  });

  it('with nothing left after the backoff, no second request is sent', async () => {
    const google = virtualGoogle(() => ({ afterMs: 2_900, reply: backendError }), 4_000);
    const base = await serve({ key: () => KEY, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    expect(((await res.json()) as TravelUnavailable).code).toBe('google_unavailable');
    expect(google.attempts).toHaveLength(1);
    expect(printed).toEqual(['[geocode] Google Geocoding failed: HTTP 500 INTERNAL']);
  });

  it('a missing key is still 503 google_key_missing at once: no request, no wait', async () => {
    const google = virtualGoogle(silent);
    const base = await serve({ key: () => null, ...google.deps });
    const res = await search(base, QUERY);
    expect(res.status).toBe(503);
    expect((await res.json()) as TravelUnavailable).toEqual({ error: KEY_MISSING_MESSAGE, code: 'google_key_missing' });
    expect(google.attempts).toEqual([]);
    expect(google.sleeps).toEqual([]);
    expect(google.now()).toBe(0);
  });
});

describe('geocode logging (SPEC MVP II rules 2 and 6)', () => {
  it('prints no key, query or label for a successful, a denied, an unreachable and an invalid request', async () => {
    const replies: Reply[] = [
      { status: 200, body: googleOk([ASTORIA]) },
      { status: 200, body: { status: 'REQUEST_DENIED', error_message: `key ${KEY} is not allowed to geocode ${QUERY}` } },
      new Error(`fetch failed for ${GEOCODE_URL}?address=${encodeURIComponent(QUERY)}&key=${KEY_ENCODED}`),
      new Error(`fetch failed again for ${QUERY} ${KEY}`),
    ];
    const google = fakeGoogle((_url, index) => replies[index]);
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });

    const ok = await search(base, QUERY);
    expect(ok.status).toBe(200);
    const label = ((await ok.json()) as GeocodeResponse).results[0].label;
    expect(label).toBe(ASTORIA.label);
    expect((await search(base, QUERY)).status).toBe(503);
    expect((await search(base, QUERY)).status).toBe(503);
    expect((await search(base, 'ab')).status).toBe(400);
    expect(google.urls).toHaveLength(4);

    const all = printed.join('\n');
    expectNoLeak(all, [QUERY, encodeURIComponent(QUERY), 'Thirtieth', 'Astoria', label, '30th Ave', '11102']);
    // What it does print: one line per Google failure, with status words only.
    expect(printed).toEqual(['[geocode] Google Geocoding failed: HTTP 200 REQUEST_DENIED', '[geocode] Google Geocoding failed: no response NETWORK_ERROR']);
  });
});

describe('geocode helpers', () => {
  it('boroughOf reads the borough from the sublocality, else from the county, and matches whole names only', () => {
    const cases: [string | null | undefined, string | null | undefined, string | null][] = [
      ['Manhattan', 'New York County', 'Manhattan'],
      ['Brooklyn', 'Kings County', 'Brooklyn'],
      ['Queens', 'Queens County', 'Queens'],
      ['The Bronx', 'Bronx County', 'Bronx'],
      ['Bronx', null, 'Bronx'],
      ['Staten Island', 'Richmond County', 'Staten Island'],
      [' brooklyn ', undefined, 'Brooklyn'],
      [null, 'Kings County', 'Brooklyn'],
      [undefined, 'new york county', 'Manhattan'],
      ['Fleetwood', 'Richmond County', 'Staten Island'],
      [null, 'Westchester County', null],
      [null, 'Nassau County', null],
      [null, 'Hudson County', null],
      ['Queens Village', null, null],
      [null, 'Queens', null], // a county is named in full
      ['Kings County', null, null],
      ['constructor', 'toString', null],
      ['', '', null],
      [null, null, null],
      [undefined, undefined, null],
    ];
    for (const [sublocality, county, borough] of cases) {
      expect(boroughOf({ sublocality, county }), `${sublocality} / ${county}`).toBe(borough);
    }
  });

  it('withNycHint adds ", New York, NY" unless the query already ends in New York', () => {
    expect(withNycHint('30th Ave, Astoria')).toBe('30th Ave, Astoria, New York, NY');
    expect(withNycHint('Park Slope')).toBe('Park Slope, New York, NY');
    expect(withNycHint('7th Ave, Brooklyn,  ')).toBe('7th Ave, Brooklyn, New York, NY');
    // A street named after the city or a borough is not a city.
    expect(withNycHint('1600 New York Ave')).toBe('1600 New York Ave, New York, NY');
    expect(withNycHint('70-01 Queens Blvd')).toBe('70-01 Queens Blvd, New York, NY');
    expect(withNycHint('Germany')).toBe('Germany, New York, NY');

    for (const q of ['350 5th Ave, New York, NY 10118', '350 5th Ave NYC', '5th ave ny', 'New York', 'Astoria, Queens, NY, USA', 'Bedford Ave, Brooklyn, New York City']) {
      expect(withNycHint(q)).toBe(q);
    }
  });

  it('NYC_BOUNDS holds the five boroughs and not their neighbors', () => {
    expect(NYC_BOUNDS).toEqual({ south: 40.4774, west: -74.2591, north: 40.9176, east: -73.7002 });
    const inside: [string, number, number][] = [
      ['Midtown Manhattan', 40.7549, -73.984],
      ['Downtown Brooklyn', 40.6928, -73.9903],
      ['Astoria, Queens', 40.7644, -73.9235],
      ['Riverdale, the Bronx', 40.9006, -73.9067],
      ['Tottenville, Staten Island', 40.5083, -74.2355],
      ['Far Rockaway, Queens', 40.6054, -73.7551],
    ];
    for (const [name, lat, lng] of inside) expect(insideNyc(lat, lng), name).toBe(true);
    const outside: [string, number, number][] = [
      ['Morristown, NJ', 40.7968, -74.4815],
      ['White Plains, NY', 41.034, -73.7629],
      ['Hempstead, NY', 40.7062, -73.6187],
      ['Philadelphia, PA', 39.9526, -75.1652],
    ];
    for (const [name, lat, lng] of outside) expect(insideNyc(lat, lng), name).toBe(false);
  });

  it('nycNeighborhoodLookup returns the name of the first box that contains the point', () => {
    const lookup = nycNeighborhoodLookup([
      { id: 'nbh-a', name: 'First', borough: 'Queens', bbox: { south: 40.7, west: -74, north: 40.8, east: -73.9 } },
      { id: 'nbh-b', name: 'Second', borough: 'Queens', bbox: { south: 40.75, west: -74, north: 40.85, east: -73.9 } },
    ]);
    expect(lookup(40.76, -73.95)).toBe('First'); // in both: the first wins
    expect(lookup(40.82, -73.95)).toBe('Second');
    expect(lookup(40.7, -74)).toBe('First'); // edges count
    expect(lookup(40.6, -73.95)).toBeNull();
    expect(nycNeighborhoodLookup([])(40.76, -73.95)).toBeNull();
  });
});
