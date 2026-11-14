// Google HTTP client (server/geo/googleClient.ts) against a fake fetch only: no network, no real key, no .env.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import {
  BACKOFF_BASE_MS,
  CALL_DEADLINE_STATUS,
  DEFAULT_TIMEOUT_MS,
  GEOCODE_URL,
  GoogleApiError,
  GoogleKeyMissingError,
  MAX_MATRIX_ELEMENTS,
  MAX_RETRIES,
  ROUTES_URL,
  ROUTE_MATRIX_URL,
  computeRouteMatrix,
  computeRoutePolyline,
  geocodeAddress,
  parseDurationSeconds,
  planMatrixBatches,
} from '../../server/geo/googleClient';
import type { FetchInitLike, FetchLike, LatLng } from '../../server/geo/googleClient';

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
const KEY = 'FAKE_key-123+/=';
const KEY_ENCODED = 'FAKE_key-123%2B%2F%3D';

interface Call {
  url: string;
  init?: FetchInitLike;
}
type Reply = { status: number; body: unknown } | Error;

/** A fetch that records every call and answers from `reply`. A string body is sent as is, anything else as JSON. */
function fakeFetch(reply: (call: Call, index: number) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const answer = reply(call, calls.length - 1);
    if (answer instanceof Error) throw answer;
    return { status: answer.status, text: async () => (typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)) };
  };
  return { calls, fetchImpl };
}

function sleepSpy() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const noSleep = async () => {};

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}

/** Fails if the key shows up anywhere a caller could print or serialize the error. */
function expectNoKey(err: unknown) {
  expect(err).toBeInstanceOf(Error);
  const error = err as Error;
  const views = [error.message, JSON.stringify(error), String(error), error.stack ?? '', inspect(error, { depth: 10, showHidden: true })];
  for (const view of views) {
    expect(view).not.toContain(KEY);
    expect(view).not.toContain(KEY_ENCODED);
    expect(view).not.toContain(encodeURIComponent(KEY));
  }
}

const EMPIRE = { lat: 40.7484405, lng: -73.9856644 };
const DUMBO = { lat: 40.7033, lng: -73.9881 };
const ASTORIA = { lat: 40.7644, lng: -73.9235 };

const wp = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

describe('geocodeAddress', () => {
  const okBody = {
    status: 'OK',
    results: [
      {
        formatted_address: '85 Broadway, Brooklyn, NY 11249, USA',
        geometry: { location: { lat: 40.7106, lng: -73.9665 } },
        address_components: [
          { long_name: '85', short_name: '85', types: ['street_number'] },
          { long_name: 'Brooklyn', short_name: 'Brooklyn', types: ['political', 'sublocality', 'sublocality_level_1'] },
          { long_name: 'Williamsburg', short_name: 'Williamsburg', types: ['neighborhood', 'political'] },
        ],
      },
      {
        formatted_address: '85 Broadway, Queens, NY 11101, USA',
        geometry: { location: { lat: 40.75, lng: -73.94 } },
        address_components: [{ long_name: 'Queens', short_name: 'Queens', types: ['political', 'sublocality', 'sublocality_level_1'] }],
      },
      {
        formatted_address: '85 Broadway, New York, NY 10006, USA',
        geometry: { location: { lat: 40.7081, lng: -74.0121 } },
        address_components: [{ long_name: 'New York', short_name: 'NY', types: ['administrative_area_level_1', 'political'] }],
      },
    ],
  };

  it('calls the Geocoding URL with the encoded address and key, and no key header', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: okBody }));
    await geocodeAddress('350 5th Ave, New York, NY', { apiKey: KEY, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://maps.googleapis.com/maps/api/geocode/json?address=350+5th+Ave%2C+New+York%2C+NY&key=${KEY_ENCODED}`);
    expect(calls[0].init?.method).toBe('GET');
    expect(calls[0].init?.headers).toBeUndefined();
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('reads location, formatted address and neighborhood (else sublocality, else null)', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: okBody }));
    expect(await geocodeAddress('85 Broadway', { apiKey: KEY, fetchImpl })).toEqual([
      { lat: 40.7106, lng: -73.9665, formattedAddress: '85 Broadway, Brooklyn, NY 11249, USA', neighborhood: 'Williamsburg' },
      { lat: 40.75, lng: -73.94, formattedAddress: '85 Broadway, Queens, NY 11101, USA', neighborhood: 'Queens' },
      { lat: 40.7081, lng: -74.0121, formattedAddress: '85 Broadway, New York, NY 10006, USA', neighborhood: null },
    ]);
  });

  it('returns [] for ZERO_RESULTS', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { status: 'ZERO_RESULTS', results: [] } }));
    expect(await geocodeAddress('nowhere at all', { apiKey: KEY, fetchImpl })).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('returns [] for a blank address without calling Google', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: okBody }));
    expect(await geocodeAddress('   ', { apiKey: KEY, fetchImpl })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws GoogleApiError for any other status, without retrying', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: { status: 'REQUEST_DENIED', error_message: 'This API is not enabled.', results: [] } }));
    const { waits, sleep } = sleepSpy();
    const err = await thrownBy(() => geocodeAddress('350 5th Ave', { apiKey: KEY, fetchImpl, sleep }));
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 200, googleStatus: 'REQUEST_DENIED', endpoint: 'https://maps.googleapis.com/maps/api/geocode/json' });
    expect((err as Error).message).toContain('This API is not enabled.');
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('retries OVER_QUERY_LIMIT, which Geocoding sends with HTTP 200', async () => {
    const { calls, fetchImpl } = fakeFetch((_call, i) => ({ status: 200, body: i === 0 ? { status: 'OVER_QUERY_LIMIT' } : okBody }));
    const { waits, sleep } = sleepSpy();
    expect(await geocodeAddress('85 Broadway', { apiKey: KEY, fetchImpl, sleep })).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([BACKOFF_BASE_MS]);
  });
});

describe('computeRouteMatrix', () => {
  it('sends the exact URL, headers and body', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: [] }));
    await computeRouteMatrix([EMPIRE, DUMBO], [ASTORIA], { apiKey: KEY, fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
    });
    expect(JSON.parse(calls[0].init?.body ?? '')).toEqual({
      origins: [wp(EMPIRE), wp(DUMBO)],
      destinations: [wp(ASTORIA)],
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });
  });

  it('parses "734s" as 734 and treats a missing index or distance as 0', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: [
        { originIndex: 1, destinationIndex: 1, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 5210, duration: '734s' },
        // JSON drops default values: no originIndex, no destinationIndex and no distanceMeters here.
        { status: {}, condition: 'ROUTE_EXISTS', duration: '0s' },
        { originIndex: 1, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 900, duration: '120s' },
        { destinationIndex: 1, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 4100, duration: '601s' },
      ],
    }));
    const result = await computeRouteMatrix([EMPIRE, DUMBO], [EMPIRE, ASTORIA], { apiKey: KEY, fetchImpl });
    expect(result.failures).toEqual([]);
    expect(result.elements).toEqual([
      { originIndex: 0, destinationIndex: 0, durationS: 0, distanceM: 0 },
      { originIndex: 0, destinationIndex: 1, durationS: 601, distanceM: 4100 },
      { originIndex: 1, destinationIndex: 0, durationS: 120, distanceM: 900 },
      { originIndex: 1, destinationIndex: 1, durationS: 734, distanceM: 5210 },
    ]);
  });

  it('puts an element without ROUTE_EXISTS in failures, never in elements', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      body: [
        { originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 5210, duration: '734s' },
        { originIndex: 0, destinationIndex: 1, status: {}, condition: 'ROUTE_NOT_FOUND' },
        // Has numbers, but no condition: still not a route.
        { originIndex: 1, destinationIndex: 0, status: {}, distanceMeters: 100, duration: '10s' },
        { originIndex: 1, destinationIndex: 1, status: { code: 3, message: 'Invalid waypoint.' }, condition: 'ROUTE_EXISTS', duration: '10s' },
        // ROUTE_EXISTS without a duration: no number is invented.
        { originIndex: 2, destinationIndex: 0, status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 100 },
        // (2, 1) is not returned at all.
      ],
    }));
    const result = await computeRouteMatrix([EMPIRE, DUMBO, ASTORIA], [EMPIRE, ASTORIA], { apiKey: KEY, fetchImpl });
    expect(result.elements).toEqual([{ originIndex: 0, destinationIndex: 0, durationS: 734, distanceM: 5210 }]);
    expect(result.failures).toEqual([
      { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND', message: 'no route between these points' },
      { originIndex: 1, destinationIndex: 0, condition: null, message: 'no route between these points' },
      { originIndex: 1, destinationIndex: 1, condition: 'ROUTE_EXISTS', message: 'Invalid waypoint.' },
      { originIndex: 2, destinationIndex: 0, condition: 'ROUTE_EXISTS', message: 'duration or distance missing or unreadable' },
      { originIndex: 2, destinationIndex: 1, condition: null, message: 'Google returned no element for this pair' },
    ]);
  });

  it('splits a 30 x 30 matrix into requests of at most 625 elements and maps the indices back', async () => {
    // Point i has latitude i (origins) or longitude j (destinations), so the fake can tell which global pair it is
    // answering and encode it in the duration: (i, j) -> i * 1000 + j seconds, i * 100000 + j meters.
    const origins = Array.from({ length: 30 }, (_, i) => ({ lat: i, lng: -1 }));
    const destinations = Array.from({ length: 30 }, (_, j) => ({ lat: -1, lng: j }));
    const sizes: number[] = [];
    const { calls, fetchImpl } = fakeFetch((call) => {
      const body = JSON.parse(call.init?.body ?? '') as { origins: ReturnType<typeof wp>[]; destinations: ReturnType<typeof wp>[] };
      sizes.push(body.origins.length * body.destinations.length);
      const elements: Record<string, unknown>[] = [];
      body.origins.forEach((origin, o) => {
        body.destinations.forEach((destination, d) => {
          const i = origin.waypoint.location.latLng.latitude;
          const j = destination.waypoint.location.latLng.longitude;
          const element: Record<string, unknown> = { status: {}, condition: 'ROUTE_EXISTS', duration: `${i * 1000 + j}s` };
          if (o !== 0) element.originIndex = o; // like Google, drop zero values
          if (d !== 0) element.destinationIndex = d;
          if (i + j !== 0) element.distanceMeters = i * 100000 + j;
          elements.push(element);
        });
      });
      return { status: 200, body: elements.reverse() }; // Google does not promise an order
    });

    const result = await computeRouteMatrix(origins, destinations, { apiKey: KEY, fetchImpl });

    expect(calls.length).toBeGreaterThan(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(900);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(625);
    expect(result.failures).toEqual([]);
    expect(result.elements).toHaveLength(900);
    const expected = [];
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) expected.push({ originIndex: i, destinationIndex: j, durationS: i * 1000 + j, distanceM: i * 100000 + j });
    expect(result.elements).toEqual(expected);
  });

  it('makes no request for an empty side', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: [] }));
    expect(await computeRouteMatrix([], [ASTORIA], { apiKey: KEY, fetchImpl })).toEqual({ elements: [], failures: [] });
    expect(await computeRouteMatrix([EMPIRE], [], { apiKey: KEY, fetchImpl })).toEqual({ elements: [], failures: [] });
    expect(calls).toHaveLength(0);
  });

  it('rejects a response that is not an element array or has an index outside the request', async () => {
    const notArray = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await thrownBy(() => computeRouteMatrix([EMPIRE], [ASTORIA], { apiKey: KEY, fetchImpl: notArray.fetchImpl }))).toMatchObject({
      name: 'GoogleApiError',
      googleStatus: 'INVALID_RESPONSE',
    });
    const outside = fakeFetch(() => ({ status: 200, body: [{ originIndex: 5, condition: 'ROUTE_EXISTS', duration: '1s' }] }));
    expect(await thrownBy(() => computeRouteMatrix([EMPIRE], [ASTORIA], { apiKey: KEY, fetchImpl: outside.fetchImpl }))).toMatchObject({
      name: 'GoogleApiError',
      googleStatus: 'INVALID_RESPONSE',
    });
  });
});

describe('planMatrixBatches', () => {
  const cover = (o: number, d: number, max?: number) => {
    const seen = new Set<string>();
    for (const b of planMatrixBatches(o, d, max)) {
      expect((b.originEnd - b.originStart) * (b.destinationEnd - b.destinationStart)).toBeLessThanOrEqual(max ?? MAX_MATRIX_ELEMENTS);
      for (let i = b.originStart; i < b.originEnd; i++) {
        for (let j = b.destinationStart; j < b.destinationEnd; j++) {
          expect(seen.has(`${i}:${j}`)).toBe(false);
          seen.add(`${i}:${j}`);
        }
      }
    }
    return seen.size;
  };

  it('keeps a matrix of 625 elements or fewer in one request', () => {
    expect(planMatrixBatches(25, 25)).toEqual([{ originStart: 0, originEnd: 25, destinationStart: 0, destinationEnd: 25 }]);
    expect(planMatrixBatches(1, 625)).toHaveLength(1);
    expect(planMatrixBatches(0, 10)).toEqual([]);
  });

  it('splits 30 x 30 into two requests', () => {
    expect(planMatrixBatches(30, 30)).toEqual([
      { originStart: 0, originEnd: 30, destinationStart: 0, destinationEnd: 20 },
      { originStart: 0, originEnd: 30, destinationStart: 20, destinationEnd: 30 },
    ]);
  });

  it('covers every pair exactly once for uneven and very long sides', () => {
    expect(cover(60, 18)).toBe(60 * 18);
    expect(cover(18, 60)).toBe(18 * 60);
    expect(cover(1, 1300)).toBe(1300);
    expect(cover(700, 3)).toBe(2100);
    expect(cover(7, 5, 4)).toBe(35);
    expect(planMatrixBatches(60, 18)).toHaveLength(2); // 34 origins x 18 = 612, then 26 x 18
  });
});

describe('computeRoutePolyline', () => {
  const okBody = { routes: [{ distanceMeters: 8123, duration: '1105s', polyline: { encodedPolyline: 'ipkcFfichVnP@j@BLoFVwM{E?' } }] };

  it('sends the exact URL, headers and body, and reads the first route', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: okBody }));
    const route = await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl });
    expect(route).toEqual({ encoded: 'ipkcFfichVnP@j@BLoFVwM{E?', durationS: 1105, distanceM: 8123 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    });
    expect(JSON.parse(calls[0].init?.body ?? '')).toEqual({
      origin: { location: { latLng: { latitude: EMPIRE.lat, longitude: EMPIRE.lng } } },
      destination: { location: { latLng: { latitude: DUMBO.lat, longitude: DUMBO.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });
  });

  it('throws instead of inventing a route when Google returns none or an incomplete one', async () => {
    const none = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await thrownBy(() => computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl: none.fetchImpl }))).toMatchObject({
      name: 'GoogleApiError',
      googleStatus: 'NO_ROUTE',
    });
    const noDuration = fakeFetch(() => ({ status: 200, body: { routes: [{ distanceMeters: 5, polyline: { encodedPolyline: 'abc' } }] } }));
    expect(await thrownBy(() => computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl: noDuration.fetchImpl }))).toMatchObject({
      name: 'GoogleApiError',
      googleStatus: 'INVALID_RESPONSE',
    });
    expect(none.calls).toHaveLength(1);
  });
});

describe('parseDurationSeconds', () => {
  it('reads Google duration strings only', () => {
    expect(parseDurationSeconds('734s')).toBe(734);
    expect(parseDurationSeconds('0s')).toBe(0);
    expect(parseDurationSeconds('12.5s')).toBe(12.5);
    for (const bad of ['734', 's', '', '-5s', '1e3s', 734, null, undefined]) expect(parseDurationSeconds(bad)).toBeNull();
  });
});

describe('retries', () => {
  const routeBody = { routes: [{ distanceMeters: 10, duration: '5s', polyline: { encodedPolyline: 'abc' } }] };
  const quota = { error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } };

  it('429 then 200 succeeds after one retry', async () => {
    const { calls, fetchImpl } = fakeFetch((_call, i) => (i === 0 ? { status: 429, body: quota } : { status: 200, body: routeBody }));
    const { waits, sleep } = sleepSpy();
    expect(await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, sleep })).toEqual({ encoded: 'abc', durationS: 5, distanceM: 10 });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([BACKOFF_BASE_MS]);
    expect(calls[1].init?.body).toBe(calls[0].init?.body);
  });

  it('retries a failed matrix batch without repeating the batches that worked', async () => {
    const origins = Array.from({ length: 30 }, (_, i) => ({ lat: i, lng: 0 }));
    const { calls, fetchImpl } = fakeFetch((_call, i) => (i === 1 ? { status: 503, body: 'upstream unavailable' } : { status: 200, body: [] }));
    const result = await computeRouteMatrix(origins, origins, { apiKey: KEY, fetchImpl, sleep: noSleep });
    expect(calls).toHaveLength(3); // batch 1, batch 2 (503), batch 2 again
    expect(calls[2].init?.body).toBe(calls[1].init?.body);
    expect(result.elements).toEqual([]);
    expect(result.failures).toHaveLength(900);
  });

  it('gives up on 5xx after 3 retries, with a growing backoff', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 503, body: { error: { code: 503, message: 'Backend unavailable.', status: 'UNAVAILABLE' } } }));
    const { waits, sleep } = sleepSpy();
    const err = await thrownBy(() => computeRouteMatrix([EMPIRE], [DUMBO], { apiKey: KEY, fetchImpl, sleep }));
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 503, googleStatus: 'UNAVAILABLE' });
    expect((err as Error).message).toContain('Backend unavailable.');
    expect(calls).toHaveLength(1 + MAX_RETRIES);
    expect(waits).toEqual([500, 1000, 2000]);
  });

  it('403 throws GoogleApiError without retrying', async () => {
    const denied = { error: { code: 403, message: 'Routes API has not been used in this project.', status: 'PERMISSION_DENIED' } };
    for (const run of [
      (o: { apiKey: string; fetchImpl: FetchLike; sleep: (ms: number) => Promise<void> }) => computeRouteMatrix([EMPIRE], [DUMBO], o),
      (o: { apiKey: string; fetchImpl: FetchLike; sleep: (ms: number) => Promise<void> }) => computeRoutePolyline(EMPIRE, DUMBO, o),
      (o: { apiKey: string; fetchImpl: FetchLike; sleep: (ms: number) => Promise<void> }) => geocodeAddress('350 5th Ave', o),
    ]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status: 403, body: denied }));
      const { waits, sleep } = sleepSpy();
      const err = await thrownBy(() => run({ apiKey: KEY, fetchImpl, sleep }));
      expect(err).toBeInstanceOf(GoogleApiError);
      expect(err).toMatchObject({ status: 403, googleStatus: 'PERMISSION_DENIED' });
      expect((err as Error).message).toContain('Routes API has not been used in this project.');
      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
    }
  });

  it('retries a network failure and reports it as GoogleApiError with status 0', async () => {
    const { calls, fetchImpl } = fakeFetch(() => new TypeError('fetch failed'));
    const err = await thrownBy(() => computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, sleep: noSleep }));
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 0, googleStatus: 'NETWORK_ERROR' });
    expect(calls).toHaveLength(1 + MAX_RETRIES);
  });
});

describe('the key never leaks', () => {
  type Opts = { apiKey: string; fetchImpl: FetchLike; sleep: (ms: number) => Promise<void> };
  const calls: [string, (o: Opts) => Promise<unknown>][] = [
    ['geocodeAddress', (o) => geocodeAddress('350 5th Ave, New York', o)],
    ['computeRouteMatrix', (o) => computeRouteMatrix([EMPIRE], [DUMBO], o)],
    ['computeRoutePolyline', (o) => computeRoutePolyline(EMPIRE, DUMBO, o)],
  ];
  // Worst cases: Google (or a proxy, or fetch itself) echoes the key or the full request URL back.
  const echoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${KEY_ENCODED}`;
  const replies: [string, () => Reply][] = [
    ['403 whose message quotes the key', () => ({ status: 403, body: { error: { code: 403, message: `API key ${KEY} is not authorized (${echoUrl}).`, status: `DENIED_${KEY}` } } })],
    ['400 with the error wrapped in an array', () => ({ status: 400, body: [{ error: { code: 400, message: `Bad key ${KEY}`, status: 'INVALID_ARGUMENT' } }] })],
    ['500 with an HTML body quoting the URL', () => ({ status: 500, body: `<html>upstream error for ${echoUrl} and ${encodeURIComponent(KEY)}</html>` })],
    ['200 with REQUEST_DENIED quoting the key', () => ({ status: 200, body: { status: 'REQUEST_DENIED', error_message: `The provided API key ${KEY} is invalid.` } })],
    ['200 with a non-JSON body', () => ({ status: 200, body: `oops ${KEY}` })],
    ['200 with an error element quoting the key', () => ({ status: 200, body: [{ error: { code: 403, message: `key ${KEY} rejected`, status: 'PERMISSION_DENIED' } }] })],
    ['fetch throwing with the URL in its message and cause', () => new TypeError(`fetch failed for ${echoUrl}`, { cause: new Error(`connect ECONNREFUSED ${echoUrl} ${KEY}`) })],
  ];

  for (const [fnName, run] of calls) {
    for (const [replyName, reply] of replies) {
      it(`${fnName}: ${replyName}`, async () => {
        const { calls: sent, fetchImpl } = fakeFetch(reply);
        const err = await thrownBy(() => run({ apiKey: KEY, fetchImpl, sleep: noSleep }));
        expect(sent.length).toBeGreaterThan(0);
        expect(err).toBeInstanceOf(GoogleApiError);
        expectNoKey(err);
      });
    }
  }

  it('keeps a failed element message free of the key', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 200, body: [{ status: { code: 7, message: `key ${KEY} may not route here` }, condition: 'ROUTE_NOT_FOUND' }] }));
    const result = await computeRouteMatrix([EMPIRE], [DUMBO], { apiKey: KEY, fetchImpl });
    expect(result.failures).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('expectNoKey itself catches a leak', () => {
    expect(() => expectNoKey(new Error(`bad ${KEY}`))).toThrow();
    expect(() => expectNoKey(Object.assign(new Error('fine'), { url: `x?key=${KEY_ENCODED}` }))).toThrow();
  });
});

describe('missing key', () => {
  it('throws GoogleKeyMissingError before any request', async () => {
    for (const apiKey of ['', '   ', undefined as unknown as string]) {
      const { calls, fetchImpl } = fakeFetch(() => ({ status: 200, body: {} }));
      for (const run of [
        () => geocodeAddress('350 5th Ave', { apiKey, fetchImpl }),
        () => computeRouteMatrix([EMPIRE], [DUMBO], { apiKey, fetchImpl }),
        () => computeRoutePolyline(EMPIRE, DUMBO, { apiKey, fetchImpl }),
      ]) {
        const err = await thrownBy(run);
        expect(err).toBeInstanceOf(GoogleKeyMissingError);
        expect(err).not.toBeInstanceOf(GoogleApiError);
        expect((err as Error).message).toContain('GOOGLE_MAPS_SERVER_KEY');
      }
      expect(calls).toHaveLength(0);
    }
  });
});

// #555: what a live action sets (server/geo/travelService.ts). The fetch command sets none of these.
describe('the limits a caller can set: maxRetries and the deadline of its call (msLeft)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const unavailable = { status: 503, body: { error: { code: 503, message: `Backend unavailable for ${KEY}.`, status: 'UNAVAILABLE' } } };
  const route = { status: 200, body: { routes: [{ duration: '734s', distanceMeters: 6120, polyline: { encodedPolyline: 'abc' } }] } };
  /** Records the number each attempt gives `AbortSignal.timeout`. */
  const timeouts = () => {
    const asked: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms);
      return real(ms);
    });
    return asked;
  };

  it('maxRetries replaces the 3 retries: 1 means two attempts and one backoff, 0 means one attempt', async () => {
    for (const [maxRetries, waited] of [[1, [500]], [0, []]] as const) {
      const { calls, fetchImpl } = fakeFetch(() => unavailable);
      const { waits, sleep } = sleepSpy();
      const err = await thrownBy(() => computeRouteMatrix([EMPIRE], [DUMBO], { apiKey: KEY, fetchImpl, sleep, maxRetries }));
      expect(err).toMatchObject({ status: 503, googleStatus: 'UNAVAILABLE' });
      expect(calls).toHaveLength(1 + maxRetries);
      expect(waits).toEqual(waited);
    }
  });

  it('without msLeft an attempt gets timeoutMs (15 s by default); with it, the whole milliseconds that are left when that is less', async () => {
    const asked = timeouts();
    const { fetchImpl } = fakeFetch(() => route);
    await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl });
    await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, timeoutMs: 4000 });
    await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, timeoutMs: 4000, msLeft: () => 9000 });
    await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, timeoutMs: 4000, msLeft: () => 1500.7 });
    await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, msLeft: () => 1 });
    expect(asked).toEqual([DEFAULT_TIMEOUT_MS, 4000, 4000, 1500, 1]);
  });

  it('a backoff that would not end before the deadline is not slept: the request fails at once with its own error', async () => {
    for (const left of [BACKOFF_BASE_MS, BACKOFF_BASE_MS - 1, 1]) {
      const { calls, fetchImpl } = fakeFetch(() => unavailable);
      const { waits, sleep } = sleepSpy();
      const err = await thrownBy(() => computeRouteMatrix([EMPIRE], [DUMBO], { apiKey: KEY, fetchImpl, sleep, msLeft: () => left }));
      expect(err).toMatchObject({ status: 503, googleStatus: 'UNAVAILABLE' });
      expect(calls).toHaveLength(1);
      expect(waits).toEqual([]);
      expectNoKey(err);
    }
  });

  it('with more left than the backoff it retries as usual', async () => {
    const { calls, fetchImpl } = fakeFetch((_call, i) => (i === 0 ? unavailable : route));
    const { waits, sleep } = sleepSpy();
    const result = await computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, sleep, msLeft: () => BACKOFF_BASE_MS + 1 });
    expect(result).toEqual({ encoded: 'abc', durationS: 734, distanceM: 6120 });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([500]);
  });

  it('a backoff that ran late ends the request with the error of the attempt before it, and no attempt is sent after the deadline', async () => {
    let left = 5000;
    const { calls, fetchImpl } = fakeFetch(() => unavailable);
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      left = 0.4; // the sleep took far longer than asked
    };
    const err = await thrownBy(() => computeRoutePolyline(EMPIRE, DUMBO, { apiKey: KEY, fetchImpl, sleep, msLeft: () => left }));
    expect(err).toMatchObject({ status: 503, googleStatus: 'UNAVAILABLE' });
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([500]);
  });

  it('with nothing left no request is sent: GoogleApiError with status 0 and CALL_DEADLINE, for every call', async () => {
    const runs: [string, (o: { apiKey: string; fetchImpl: FetchLike; msLeft: () => number }) => Promise<unknown>][] = [
      [GEOCODE_URL, (o) => geocodeAddress('350 5th Ave, New York', o)],
      [ROUTE_MATRIX_URL, (o) => computeRouteMatrix([EMPIRE], [DUMBO], o)],
      [ROUTES_URL, (o) => computeRoutePolyline(EMPIRE, DUMBO, o)],
    ];
    for (const left of [0, 0.9, -250]) {
      for (const [endpoint, run] of runs) {
        const { calls, fetchImpl } = fakeFetch(() => route);
        const err = await thrownBy(() => run({ apiKey: KEY, fetchImpl, msLeft: () => left }));
        expect((err as Error).constructor).toBe(GoogleApiError);
        expect(err).toMatchObject({ name: 'GoogleApiError', status: 0, googleStatus: CALL_DEADLINE_STATUS, endpoint });
        expect((err as Error).message).toContain('the time limit of this call ran out before the request was sent');
        expect(calls).toHaveLength(0);
        expectNoKey(err);
      }
    }
  });

  it('a matrix of two requests whose deadline passes after the first one rejects: no partial result is returned', async () => {
    let left = 5000;
    const origins = Array.from({ length: 30 }, (_, i) => ({ lat: 40.7 + i * 0.001, lng: -73.98 })); // 30 x 30 = 2 requests
    const { calls, fetchImpl } = fakeFetch(() => {
      left = 0;
      return { status: 200, body: [] };
    });
    const err = await thrownBy(() => computeRouteMatrix(origins, origins, { apiKey: KEY, fetchImpl, msLeft: () => left }));
    expect(err).toMatchObject({ status: 0, googleStatus: CALL_DEADLINE_STATUS, endpoint: ROUTE_MATRIX_URL });
    expect(calls).toHaveLength(1);
  });
});
