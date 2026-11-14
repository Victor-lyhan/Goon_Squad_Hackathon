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
  GEOCODE_MAX_RETRIES,
  GOOGLE_UNAVAILABLE_MESSAGE,
  KEY_MISSING_MESSAGE,
  MAX_GEOCODE_RESULTS,
  NYC_BOUNDS,
  getGeocode,
  insideNyc,
  nycNeighborhoodLookup,
  withNycHint,
  type GeocodeDeps,
} from '../../server/api/geo';
import { GEOCODE_URL, type FetchLike } from '../../server/geo/googleClient';
import type { GeocodeResponse, TravelUnavailable } from '../../shared/v2/api';
import { ApiError } from '../../shared/v2/schemas';
import type { NycNeighborhoodsFile } from '../../shared/v2/types';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
const KEY = 'FAKE_key-123+/=';
const KEY_ENCODED = encodeURIComponent(KEY);
// Not a real person's address: a made-up house number on a real avenue.
const QUERY = '99999 Thirtieth Avenue Astoria';

interface GoogleItem {
  label: string;
  lat: number;
  lng: number;
  neighborhood?: string;
  sublocality?: string;
}

function googleOk(items: GoogleItem[]) {
  return {
    status: 'OK',
    results: items.map((item) => ({
      formatted_address: item.label,
      geometry: { location: { lat: item.lat, lng: item.lng } },
      address_components: [
        ...(item.neighborhood ? [{ long_name: item.neighborhood, short_name: item.neighborhood, types: ['neighborhood', 'political'] }] : []),
        ...(item.sublocality ? [{ long_name: item.sublocality, short_name: item.sublocality, types: ['political', 'sublocality', 'sublocality_level_1'] }] : []),
        { long_name: 'New York', short_name: 'NY', types: ['administrative_area_level_1', 'political'] },
      ],
    })),
  };
}

const ASTORIA: GoogleItem = { label: '99999 30th Ave, Astoria, NY 11102, USA', lat: 40.7661234567, lng: -73.9212345678, neighborhood: 'Astoria' };

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
  server = app.listen(0);
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

  it('drops results outside the five boroughs', async () => {
    const google = fakeGoogle(() => ({
      status: 200,
      body: googleOk([
        { label: '99999 State St, Albany, NY 12207, USA', lat: 42.6526, lng: -73.7562, neighborhood: 'Center Square' },
        // Inside the bounding box, but across the Hudson in New Jersey.
        { label: '99999 Washington St, Hoboken, NJ 07030, USA', lat: 40.744, lng: -74.0324, neighborhood: 'Downtown Hoboken' },
        { label: '99999 Bay St, Staten Island, NY 10301, USA', lat: 40.6405, lng: -74.0759, neighborhood: 'St. George' },
        { label: '', lat: 40.75, lng: -73.99, neighborhood: 'Midtown' },
      ]),
    }));
    const base = await serve({ key: () => KEY, fetchImpl: google.fetchImpl });
    const body = (await (await search(base, 'ninety-nine state street')).json()) as GeocodeResponse;
    expect(body.results.map((r) => r.neighborhood)).toEqual(['St. George']);
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
      { label: '99999 31st St, Queens, NY 11102, USA', lat: 40.765, lng: -73.92 },
      { label: '99999 Broadway, New York, NY 10007, USA', lat: 40.7128, lng: -74.006 },
      { label: '99999 5th Ave, Brooklyn, NY 11215, USA', lat: 40.67, lng: -73.98, sublocality: 'Brooklyn' },
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
    expect(printed).toEqual(['[geocode] Google Geocoding failed: HTTP 200 REQUEST_DENIED', '[geocode] Google Geocoding failed after a retry']);
  });
});

describe('geocode helpers', () => {
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
