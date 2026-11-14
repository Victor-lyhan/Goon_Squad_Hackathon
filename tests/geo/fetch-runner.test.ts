// Fetch runner (server/geo/fetchRunner.ts) against a fake client, or the real client over a fake fetch.
// No network, no real key, no .env, no files.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import type { PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import { batchPairs, planGeocodes, planMatrixPairs, planPolylines } from '../../server/geo/fetchPlan';
import {
  MAX_FAILED_REQUESTS_IN_A_ROW,
  bindGoogleClient,
  emptySummary,
  formatSummary,
  mergeSummaries,
  runGeocodes,
  runMatrix,
  runPolylines,
  scrubKeys,
} from '../../server/geo/fetchRunner';
import type { FetchClient, FetchSummary } from '../../server/geo/fetchRunner';
import { GoogleApiError, MAX_MATRIX_ELEMENTS } from '../../server/geo/googleClient';
import type { FetchLike, GeocodeResult, LatLng, RouteMatrixResult, RoutePolyline } from '../../server/geo/googleClient';

// Not a real key. It has characters that change when URL-encoded, so both forms are checked for leaks.
const KEY = 'FAKE_key-123+/=';
const KEY_ENCODED = 'FAKE_key-123%2B%2F%3D';

const BUSINESS_POINTS: Record<string, LatLng> = {
  'biz-a': { lat: 40.7536, lng: -73.9832 },
  'biz-b': { lat: 40.7033, lng: -73.9881 },
  'biz-c': { lat: 40.7447, lng: -73.9485 },
};
const HOMES = [
  { id: 'home-001', neighborhood: 'Astoria', lat: 40.7644, lng: -73.9235 },
  { id: 'home-002', neighborhood: 'Park Slope', lat: 40.671, lng: -73.9814 },
];
const BUSINESS_IDS = Object.keys(BUSINESS_POINTS);
const HOME_IDS = HOMES.map((home) => home.id);
const ALL_POINTS: Record<string, LatLng> = { ...BUSINESS_POINTS, ...Object.fromEntries(HOMES.map((home) => [home.id, { lat: home.lat, lng: home.lng }])) };

/** What the fake Google answers for a pair. Different in each direction, and never a whole number of minutes. */
function travel(origin: LatLng, destination: LatLng) {
  const span = Math.abs(origin.lat - destination.lat) + Math.abs(origin.lng - destination.lng);
  const durationS = 61 + Math.round(span * 20_000) * 60 + (origin.lat > destination.lat ? 13 : 0);
  return { durationS, distanceM: durationS * 9 + 5 };
}

function geocodedMatrix(): TravelMatrixFile {
  const places: TravelMatrixFile['places'] = {};
  for (const [id, point] of Object.entries(BUSINESS_POINTS)) places[id] = { ...point, formattedAddress: `${id} address, New York, NY` };
  return { schemaVersion: 1, places, pairs: {} };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

interface MatrixCall {
  origins: LatLng[];
  destinations: LatLng[];
}

/** A client that answers every pair from `travel`, unless a test overrides a call. Records what it was asked. */
function fakeClient(
  overrides: {
    geocode?: (address: string, index: number) => GeocodeResult[];
    matrix?: (call: MatrixCall, index: number) => RouteMatrixResult | undefined;
    polyline?: (origin: LatLng, destination: LatLng, index: number) => RoutePolyline | undefined;
  } = {},
) {
  const calls = { geocode: [] as string[], matrix: [] as MatrixCall[], polyline: [] as { origin: LatLng; destination: LatLng }[] };
  const client: FetchClient = {
    async geocodeAddress(address) {
      calls.geocode.push(address);
      return overrides.geocode ? overrides.geocode(address, calls.geocode.length - 1) : [];
    },
    async computeRouteMatrix(origins, destinations) {
      const call = { origins, destinations };
      calls.matrix.push(call);
      const override = overrides.matrix?.(call, calls.matrix.length - 1);
      if (override) return override;
      const elements = origins.flatMap((origin, originIndex) =>
        destinations.map((destination, destinationIndex) => ({ originIndex, destinationIndex, ...travel(origin, destination) })),
      );
      return { elements, failures: [] };
    },
    async computeRoutePolyline(origin, destination) {
      calls.polyline.push({ origin, destination });
      const override = overrides.polyline?.(origin, destination, calls.polyline.length - 1);
      return override ?? { encoded: `poly(${origin.lat},${origin.lng}>${destination.lat},${destination.lng})`, ...travel(origin, destination) };
    },
  };
  return { calls, client };
}

function collectLog() {
  const lines: string[] = [];
  return { lines, log: (line: string) => void lines.push(line) };
}

const serverError = () => new GoogleApiError({ status: 503, googleStatus: 'UNAVAILABLE', endpoint: 'https://routes.googleapis.com/x', message: 'backend unavailable' });

describe('runGeocodes', () => {
  const businesses = [
    { id: 'biz-a', address: '1 A St, New York, NY' },
    { id: 'biz-b', address: 'nowhere at all' },
    { id: 'biz-c', address: '3 C St, Queens, NY' },
  ];
  const result = (id: string, extra = 0): GeocodeResult => ({
    lat: BUSINESS_POINTS[id].lat + extra,
    lng: BUSINESS_POINTS[id].lng,
    formattedAddress: `${id} formatted`,
    neighborhood: null,
  });

  it('stores the first result in matrix.places and reports an address with no result', async () => {
    const matrix = deepFreeze<TravelMatrixFile>({ schemaVersion: 1, places: {}, pairs: { 'x|y': { durationS: 100, distanceM: 900 } } });
    const before = structuredClone(matrix);
    const { calls, client } = fakeClient({
      geocode: (address) => (address.startsWith('1 A') ? [result('biz-a'), result('biz-a', 1)] : address.startsWith('3 C') ? [{ ...result('biz-c'), formattedAddress: '' }] : []),
    });
    const { lines, log } = collectLog();

    const { file, summary } = await runGeocodes({ plan: planGeocodes(businesses, matrix), matrix, client, log });

    expect(calls.geocode).toEqual(businesses.map((business) => business.address));
    expect(file.places).toEqual({
      'biz-a': { ...BUSINESS_POINTS['biz-a'], formattedAddress: 'biz-a formatted' },
      'biz-c': { ...BUSINESS_POINTS['biz-c'] },
    });
    expect(file.pairs).toEqual(before.pairs);
    expect(summary.geocoded).toBe(2);
    expect(summary.requests).toBe(3);
    expect(summary.failures).toEqual([{ kind: 'geocode', placeId: 'biz-b', reason: expect.stringContaining('ZERO_RESULTS') }]);
    expect(matrix).toEqual(before); // the input is untouched
    expect(file).not.toBe(matrix);
    expect(lines.some((line) => line.includes('biz-a') && line.includes('first of 2 candidates'))).toBe(true);
    expect(lines.some((line) => line.includes('biz-b') && line.includes('FAILED'))).toBe(true);

    // Resuming: only the business that failed is asked again.
    expect(planGeocodes(businesses, file)).toEqual([{ id: 'biz-b', address: 'nowhere at all' }]);
  });

  it('reports a request that throws and carries on with the next business', async () => {
    const { client } = fakeClient({
      geocode: (address) => {
        if (address.startsWith('1 A')) throw serverError();
        return address.startsWith('3 C') ? [result('biz-c')] : [result('biz-b')];
      },
    });
    const { file, summary } = await runGeocodes({ plan: businesses, matrix: geocodedMatrixWithout(), client, log: () => {} });

    expect(Object.keys(file.places).sort()).toEqual(['biz-b', 'biz-c']);
    expect(summary.failures).toEqual([{ kind: 'geocode', placeId: 'biz-a', reason: expect.stringContaining('HTTP 503') }]);
    expect(summary.stopped).toEqual([]);
  });

  function geocodedMatrixWithout(): TravelMatrixFile {
    return { schemaVersion: 1, places: {}, pairs: {} };
  }
});

describe('runMatrix', () => {
  it('stores raw seconds and meters under pairKey(from, to) and adds the homes to places', async () => {
    const matrix = geocodedMatrix();
    const plan = planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix);
    const { calls, client } = fakeClient();
    const { lines, log } = collectLog();

    const { file, summary } = await runMatrix({ plan, matrix, homes: HOMES, client, log });

    expect(Object.keys(file.pairs)).toHaveLength(18);
    for (const from of Object.keys(ALL_POINTS)) {
      for (const to of Object.keys(ALL_POINTS)) {
        const needed = from !== to && !(from.startsWith('home-') && to.startsWith('home-'));
        expect(file.pairs[pairKey(from, to)]).toEqual(needed ? travel(ALL_POINTS[from], ALL_POINTS[to]) : undefined);
      }
    }
    // Raw seconds: not rounded to minutes, and each direction has its own number.
    expect(file.pairs['biz-a|biz-b'].durationS % 60).not.toBe(0);
    expect(file.pairs['biz-a|biz-b']).not.toEqual(file.pairs['biz-b|biz-a']);

    expect(file.places['home-001']).toEqual({ lat: 40.7644, lng: -73.9235 }); // no neighborhood or other fields
    expect(file.places['home-002']).toEqual({ lat: 40.671, lng: -73.9814 });
    expect(file.places['biz-a']).toEqual(matrix.places['biz-a']);
    expect(file.schemaVersion).toBe(1);

    expect(summary).toEqual({ ...emptySummary(), pairsFetched: 18, requests: plan.batches.length });
    expect(calls.matrix).toHaveLength(plan.batches.length);
    expect(lines).toHaveLength(plan.batches.length);
    expect(lines[0]).toContain(`matrix 1/${plan.batches.length} business-business`);
  });

  it('makes zero requests when run again on its own result', async () => {
    const first = fakeClient();
    const matrix = geocodedMatrix();
    const ids = { businessIds: BUSINESS_IDS, homeIds: HOME_IDS };
    const run1 = await runMatrix({ plan: planMatrixPairs(ids, matrix), matrix, homes: HOMES, client: first.client, log: () => {} });

    const second = fakeClient();
    const plan2 = planMatrixPairs(ids, run1.file);
    const run2 = await runMatrix({ plan: plan2, matrix: run1.file, homes: HOMES, client: second.client, log: () => {} });

    expect(plan2.batches).toEqual([]);
    expect(second.calls.matrix).toHaveLength(0);
    expect(run2.file).toEqual(run1.file);
    expect(run2.summary).toEqual({ ...emptySummary(), pairsAlreadyCached: 18 });
  });

  it('reports a pair Google cannot route and writes no number for it', async () => {
    const blockedFrom = ALL_POINTS['home-001'];
    const blockedTo = ALL_POINTS['biz-b'];
    const { client } = fakeClient({
      matrix: ({ origins, destinations }) => {
        const result: RouteMatrixResult = { elements: [], failures: [] };
        origins.forEach((origin, originIndex) =>
          destinations.forEach((destination, destinationIndex) => {
            if (origin.lat === blockedFrom.lat && destination.lat === blockedTo.lat) {
              result.failures.push({ originIndex, destinationIndex, condition: 'ROUTE_NOT_FOUND', message: 'no route between these points' });
            } else {
              result.elements.push({ originIndex, destinationIndex, ...travel(origin, destination) });
            }
          }),
        );
        return result;
      },
    });
    const matrix = geocodedMatrix();
    const ids = { businessIds: BUSINESS_IDS, homeIds: HOME_IDS };

    const { file, summary } = await runMatrix({ plan: planMatrixPairs(ids, matrix), matrix, homes: HOMES, client, log: () => {} });

    expect(file.pairs).not.toHaveProperty('home-001|biz-b');
    expect(Object.keys(file.pairs)).toHaveLength(17);
    expect(file.pairs['biz-b|home-001']).toEqual(travel(blockedTo, blockedFrom)); // the other direction is fine
    expect(summary.pairsFetched).toBe(17);
    expect(summary.failures).toEqual([
      { kind: 'matrix-pair', from: 'home-001', to: 'biz-b', reason: 'ROUTE_NOT_FOUND: no route between these points' },
    ]);
    expect(formatSummary(summary).join('\n')).toContain('matrix home-001 -> biz-b: ROUTE_NOT_FOUND');

    // Running again asks for that one pair only.
    const again = planMatrixPairs(ids, file);
    expect(again.batches.flatMap(batchPairs)).toEqual([{ from: 'home-001', to: 'biz-b' }]);
  });

  it('writes nothing for an element without readable numbers, or for a pair the client did not answer', async () => {
    const { client } = fakeClient({
      matrix: ({ origins, destinations }, index) =>
        index === 0
          ? {
              elements: [
                { originIndex: 0, destinationIndex: 0, durationS: Number.NaN, distanceM: 1200 },
                { originIndex: 7, destinationIndex: 0, ...travel(origins[0], destinations[0]) }, // an index outside the request
              ],
              failures: [],
            }
          : undefined,
    });
    const matrix = geocodedMatrix();
    const { file, summary } = await runMatrix({ plan: planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: [] }, matrix), matrix, homes: [], client, log: () => {} });

    // Request 1 is biz-a -> biz-b, biz-c.
    expect(Object.keys(file.pairs).sort()).toEqual(['biz-b|biz-a', 'biz-b|biz-c', 'biz-c|biz-a', 'biz-c|biz-b']);
    expect(summary.failures).toEqual([
      { kind: 'matrix-pair', from: 'biz-a', to: 'biz-b', reason: 'duration or distance missing or unreadable' },
      { kind: 'matrix-pair', from: 'biz-a', to: 'biz-c', reason: 'no answer for this pair' },
    ]);
  });

  it('keeps the results of batch 1 when batch 2 throws, reports the error and carries on', async () => {
    const businessIds = Array.from({ length: 18 }, (_, i) => `biz-${String(i + 1).padStart(2, '0')}`);
    const homes = Array.from({ length: 129 }, (_, i) => ({ id: `home-${String(i + 1).padStart(3, '0')}`, lat: 40.6 + i * 0.001, lng: -73.9 - i * 0.0007 }));
    const matrix: TravelMatrixFile = { schemaVersion: 1, places: {}, pairs: {} };
    businessIds.forEach((id, i) => (matrix.places[id] = { lat: 40.7 + i * 0.003, lng: -74 + i * 0.002 }));
    const ids = { businessIds, homeIds: homes.map((home) => home.id) };
    const plan = planMatrixPairs(ids, matrix);
    const { calls, client } = fakeClient({
      matrix: (_call, index) => {
        if (index === 1) throw serverError();
        return undefined;
      },
    });
    const { lines, log } = collectLog();

    const { file, summary } = await runMatrix({ plan, matrix, homes, client, log });

    const batch1 = batchPairs(plan.batches[0]);
    const batch2 = batchPairs(plan.batches[1]);
    for (const pair of batch1) expect(file.pairs).toHaveProperty([pairKey(pair.from, pair.to)]);
    for (const pair of batch2) expect(file.pairs).not.toHaveProperty([pairKey(pair.from, pair.to)]);
    expect(Object.keys(file.pairs)).toHaveLength(4950 - batch2.length);
    expect(summary.pairsFetched).toBe(4950 - batch2.length);
    expect(summary.requests).toBe(plan.batches.length);
    expect(summary.failures).toEqual([
      { kind: 'matrix-batch', originIds: plan.batches[1].originIds, destinationIds: plan.batches[1].destinationIds, reason: expect.stringContaining('HTTP 503 UNAVAILABLE') },
    ]);
    expect(summary.stopped).toEqual([]);
    expect(lines.some((line) => line.startsWith(`matrix 2/${plan.batches.length}`) && line.includes('FAILED'))).toBe(true);
    for (const call of calls.matrix) expect(call.origins.length * call.destinations.length).toBeLessThanOrEqual(MAX_MATRIX_ELEMENTS);

    // Resuming asks only for what batch 2 lost.
    const again = planMatrixPairs(ids, file);
    expect(again.missingPairs).toBe(batch2.length);
    expect(again.cachedPairs).toBe(4950 - batch2.length);
  });

  it('stops after three failed requests in a row and keeps what it had', async () => {
    const matrix = geocodedMatrix();
    const plan = planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix); // 5 requests
    const { calls, client } = fakeClient({
      matrix: (_call, index) => {
        if (index >= 1) throw new Error('quota used up');
        return undefined;
      },
    });

    const { file, summary } = await runMatrix({ plan, matrix, homes: HOMES, client, log: () => {} });

    expect(plan.batches).toHaveLength(5);
    expect(calls.matrix).toHaveLength(1 + MAX_FAILED_REQUESTS_IN_A_ROW);
    expect(Object.keys(file.pairs).sort()).toEqual(['biz-a|biz-b', 'biz-a|biz-c']);
    expect(summary.failures).toHaveLength(MAX_FAILED_REQUESTS_IN_A_ROW);
    expect(summary.stopped).toEqual([expect.stringContaining('1 of 5 requests not attempted')]);
    expect(formatSummary(summary).join('\n')).toContain('stopped early: matrix:');
  });

  it('does not change the matrix it is given', async () => {
    const matrix = deepFreeze(geocodedMatrix());
    const before = structuredClone(matrix);
    const { client } = fakeClient();

    const { file } = await runMatrix({ plan: planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix), matrix, homes: deepFreeze(structuredClone(HOMES)), client, log: () => {} });

    expect(matrix).toEqual(before);
    expect(file).not.toBe(matrix);
    expect(file.places).not.toBe(matrix.places);
    expect(file.pairs).not.toBe(matrix.pairs);
  });

  it('skips the pairs of a place without coordinates and says so once', async () => {
    const matrix = geocodedMatrix();
    delete matrix.places['biz-c']; // its geocode failed
    const plan = planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix);
    const { calls, client } = fakeClient();

    const { file, summary } = await runMatrix({ plan, matrix, homes: HOMES, client, log: () => {} });

    expect(Object.keys(file.pairs).some((key) => key.includes('biz-c'))).toBe(false);
    expect(Object.keys(file.pairs)).toHaveLength(2 + 8); // a <-> b, and both homes with a and b
    expect(file.places).not.toHaveProperty('biz-c');
    expect(summary.failures).toEqual([{ kind: 'place', step: 'matrix', placeId: 'biz-c', reason: expect.stringContaining('no coordinates') }]);
    for (const call of calls.matrix) {
      for (const point of [...call.origins, ...call.destinations]) expect(point).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    }
  });

  it('refuses to mix new pairs into a home that moved since it was cached', async () => {
    const matrix = geocodedMatrix();
    matrix.places['home-001'] = { lat: 40.9, lng: -73.8 }; // cached at another point
    matrix.pairs['home-001|biz-a'] = { durationS: 999, distanceM: 9999 };
    const plan = planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix);

    const { file, summary } = await runMatrix({ plan, matrix, homes: HOMES, client: fakeClient().client, log: () => {} });

    expect(file.places['home-001']).toEqual({ lat: 40.9, lng: -73.8 });
    expect(Object.keys(file.pairs).filter((key) => key.includes('home-001'))).toEqual(['home-001|biz-a']);
    expect(file.pairs['home-001|biz-a']).toEqual({ durationS: 999, distanceM: 9999 });
    expect(Object.keys(file.pairs).filter((key) => key.includes('home-002'))).toHaveLength(6);
    expect(summary.failures).toEqual([{ kind: 'place', step: 'matrix', placeId: 'home-001', reason: expect.stringContaining('moved since it was cached') }]);
  });
});

describe('runPolylines', () => {
  const places = ALL_POINTS;
  const wanted = [
    { from: 'biz-a', to: 'home-001' },
    { from: 'home-001', to: 'biz-a' },
    { from: 'biz-a', to: 'biz-b' },
    { from: 'biz-b', to: 'home-002' },
  ];

  it('stores the encoded polyline under pairKey(from, to) and makes zero requests the second time', async () => {
    const polylines = deepFreeze<PolylinesFile>({ schemaVersion: 1, polylines: { 'biz-c|biz-a': 'cached' } });
    const before = structuredClone(polylines);
    const first = fakeClient();
    const { lines, log } = collectLog();

    const run1 = await runPolylines({ plan: planPolylines(wanted, polylines), polylines, places, client: first.client, log });

    expect(first.calls.polyline).toHaveLength(4);
    expect(run1.file).toEqual({
      schemaVersion: 1,
      polylines: {
        'biz-c|biz-a': 'cached',
        'biz-a|biz-b': 'poly(40.7536,-73.9832>40.7033,-73.9881)',
        'biz-a|home-001': 'poly(40.7536,-73.9832>40.7644,-73.9235)',
        'biz-b|home-002': 'poly(40.7033,-73.9881>40.671,-73.9814)',
        'home-001|biz-a': 'poly(40.7644,-73.9235>40.7536,-73.9832)',
      },
    });
    expect(run1.summary).toEqual({ ...emptySummary(), polylinesFetched: 4, requests: 4 });
    expect(polylines).toEqual(before);
    expect(lines).toEqual(['polyline 4/4: 4 fetched so far']);

    const second = fakeClient();
    const run2 = await runPolylines({ plan: planPolylines(wanted, run1.file), polylines: run1.file, places, client: second.client, log });
    expect(second.calls.polyline).toHaveLength(0);
    expect(run2.file).toEqual(run1.file);
    expect(run2.summary).toEqual(emptySummary());
  });

  it('reports a pair with no route, a failed request and a place without coordinates; none is written', async () => {
    const noRoute = new GoogleApiError({ status: 200, googleStatus: 'NO_ROUTE', endpoint: 'https://routes.googleapis.com/x', message: 'no route between these points' });
    const { calls, client } = fakeClient({
      polyline: (origin, destination) => {
        if (origin.lat === ALL_POINTS['biz-a'].lat && destination.lat === ALL_POINTS['biz-b'].lat) throw noRoute;
        if (origin.lat === ALL_POINTS['biz-b'].lat) throw serverError();
        if (origin.lat === ALL_POINTS['home-001'].lat) return { encoded: '', durationS: 1, distanceM: 1 };
        return undefined;
      },
    });
    const plan = planPolylines([...wanted, { from: 'biz-a', to: 'home-404' }], { schemaVersion: 1, polylines: {} });

    const { file, summary } = await runPolylines({ plan, polylines: { schemaVersion: 1, polylines: {} }, places, client, log: () => {} });

    expect(Object.keys(file.polylines)).toEqual(['biz-a|home-001']);
    expect(summary.polylinesFetched).toBe(1);
    expect(calls.polyline).toHaveLength(4); // the pair without coordinates is never sent
    expect(summary.failures).toEqual([
      { kind: 'polyline', from: 'biz-a', to: 'biz-b', reason: expect.stringContaining('NO_ROUTE') },
      { kind: 'polyline', from: 'biz-a', to: 'home-404', reason: 'no coordinates for home-404' },
      { kind: 'polyline', from: 'biz-b', to: 'home-002', reason: expect.stringContaining('HTTP 503') },
      { kind: 'polyline', from: 'home-001', to: 'biz-a', reason: 'the route had no polyline' },
    ]);
  });

  it('does not stop for pairs without a route, but stops after three failed requests in a row', async () => {
    const noRoute = () => new GoogleApiError({ status: 200, googleStatus: 'NO_ROUTE', endpoint: 'https://routes.googleapis.com/x', message: 'no route' });
    const plan = Array.from({ length: 6 }, (_, i) => ({ from: 'biz-a', to: `home-${i}` }));
    const manyPlaces: Record<string, LatLng> = { 'biz-a': ALL_POINTS['biz-a'] };
    plan.forEach((pair, i) => (manyPlaces[pair.to] = { lat: 40.6 + i * 0.01, lng: -73.9 }));
    const empty: PolylinesFile = { schemaVersion: 1, polylines: {} };

    const unroutable = fakeClient({
      polyline: () => {
        throw noRoute();
      },
    });
    const run1 = await runPolylines({ plan, polylines: empty, places: manyPlaces, client: unroutable.client, log: () => {} });
    expect(unroutable.calls.polyline).toHaveLength(6);
    expect(run1.summary.stopped).toEqual([]);

    const broken = fakeClient({
      polyline: (_o, _d, index) => {
        if (index >= 1) throw new Error('network down');
        return undefined;
      },
    });
    const run2 = await runPolylines({ plan, polylines: empty, places: manyPlaces, client: broken.client, log: () => {} });
    expect(broken.calls.polyline).toHaveLength(4);
    expect(Object.keys(run2.file.polylines)).toEqual(['biz-a|home-0']);
    expect(run2.summary.stopped).toEqual([expect.stringContaining('2 of 6 requests not attempted')]);
  });
});

describe('formatSummary', () => {
  it('prints the counts and lists every failure', () => {
    const summary: FetchSummary = {
      geocoded: 17,
      pairsFetched: 4338,
      pairsAlreadyCached: 612,
      polylinesFetched: 140,
      requests: 180,
      failures: [
        { kind: 'geocode', placeId: 'biz-x', reason: 'no geocoding result for this address (ZERO_RESULTS)' },
        { kind: 'matrix-pair', from: 'home-007', to: 'biz-a', reason: 'ROUTE_NOT_FOUND: no route between these points' },
        { kind: 'matrix-batch', originIds: ['home-001', 'home-002', 'home-003'], destinationIds: ['biz-a', 'biz-b'], reason: 'Google API error (HTTP 503 UNAVAILABLE)' },
        { kind: 'polyline', from: 'biz-a', to: 'home-007', reason: 'Google API error (HTTP 200 NO_ROUTE)' },
      ],
      stopped: [],
    };
    expect(formatSummary(summary)).toEqual([
      'Fetch summary',
      '  businesses geocoded: 17',
      '  matrix pairs fetched: 4338',
      '  matrix pairs already cached: 612',
      '  polylines fetched: 140',
      '  Google requests: 180',
      '  failures: 4',
      '    - geocode biz-x: no geocoding result for this address (ZERO_RESULTS)',
      '    - matrix home-007 -> biz-a: ROUTE_NOT_FOUND: no route between these points',
      '    - matrix request, 6 pairs not fetched (home-001 … home-003 -> biz-a, biz-b): Google API error (HTTP 503 UNAVAILABLE)',
      '    - polyline biz-a -> home-007: Google API error (HTTP 200 NO_ROUTE)',
    ]);
    expect(formatSummary(emptySummary())).toContain('  failures: none');
  });

  it('adds up the steps of a run', () => {
    const total = mergeSummaries(
      { ...emptySummary(), geocoded: 3, requests: 4, failures: [{ kind: 'geocode', placeId: 'biz-x', reason: 'r' }] },
      { ...emptySummary(), pairsFetched: 10, pairsAlreadyCached: 8, requests: 2, stopped: ['matrix: stopped'] },
      { ...emptySummary(), polylinesFetched: 5, requests: 5 },
    );
    expect(total).toEqual({
      geocoded: 3,
      pairsFetched: 10,
      pairsAlreadyCached: 8,
      polylinesFetched: 5,
      requests: 11,
      failures: [{ kind: 'geocode', placeId: 'biz-x', reason: 'r' }],
      stopped: ['matrix: stopped'],
    });
  });
});

describe('keys never reach a log line, a failure or the summary', () => {
  function expectNoKey(text: string) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY_ENCODED);
    expect(text).not.toContain('FAKE_key');
  }

  it('with the real client built on a fake key and a fetch that leaks it in every way', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      urls.push(url);
      const sentKey = init?.headers?.['X-Goog-Api-Key'] ?? '';
      if (url.includes('geocode')) {
        if (url.includes('first')) throw new TypeError(`fetch failed for ${url}`);
        if (url.includes('second')) {
          return { status: 403, text: async () => JSON.stringify({ status: 'REQUEST_DENIED', error_message: `The provided API key ${KEY} is invalid (${url}).` }) };
        }
        return { status: 200, text: async () => JSON.stringify({ status: 'ZERO_RESULTS', results: [] }) };
      }
      if (url.includes('computeRouteMatrix')) {
        return { status: 403, text: async () => JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: `API key ${sentKey} not valid.` } }) };
      }
      throw new Error('connect ECONNRESET', { cause: new Error(`request with X-Goog-Api-Key: ${sentKey} failed`) });
    };
    const client = bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} });
    const { lines, log } = collectLog();

    const geocodes = await runGeocodes({
      plan: [
        { id: 'biz-a', address: 'first address' },
        { id: 'biz-b', address: 'second address' },
        { id: 'biz-c', address: 'third address' },
      ],
      matrix: { schemaVersion: 1, places: {}, pairs: {} },
      client,
      log,
    });
    const matrix = geocodedMatrix();
    const pairs = await runMatrix({ plan: planMatrixPairs({ businessIds: BUSINESS_IDS, homeIds: HOME_IDS }, matrix), matrix, homes: HOMES, client, log });
    const routes = await runPolylines({ plan: [{ from: 'biz-a', to: 'home-001' }], polylines: { schemaVersion: 1, polylines: {} }, places: ALL_POINTS, client, log });
    const summary = mergeSummaries(geocodes.summary, pairs.summary, routes.summary);

    // The fake fetch really did see the key, and every request failed.
    expect(urls.some((url) => url.includes(KEY_ENCODED))).toBe(true);
    expect(summary.geocoded + summary.pairsFetched + summary.polylinesFetched).toBe(0);
    expect(summary.failures.map((failure) => failure.kind)).toEqual(['geocode', 'geocode', 'geocode', 'matrix-batch', 'matrix-batch', 'matrix-batch', 'polyline']);
    expect(summary.stopped).toHaveLength(1);
    expect(summary.failures[1].reason).toContain('REQUEST_DENIED');
    expect(summary.failures[3].reason).toContain('PERMISSION_DENIED');

    expectNoKey(formatSummary(summary).join('\n'));
    expectNoKey(lines.join('\n'));
    expectNoKey(JSON.stringify(summary));
    expectNoKey(JSON.stringify([geocodes.file, pairs.file, routes.file]));
    for (const failure of summary.failures) expectNoKey(failure.reason);
  });

  it('with any other client whose errors carry a key', async () => {
    const leaked = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE12';
    const { client } = fakeClient({
      geocode: (_address, index) => {
        if (index === 0) throw new Error(`GET https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${KEY_ENCODED} failed`);
        if (index === 1) throw new Error(`bad key ${leaked}`);
        throw { url: `https://example.test/?key=${leaked}` }; // not an Error: never stringified
      },
    });
    const { lines, log } = collectLog();
    const { summary } = await runGeocodes({
      plan: [
        { id: 'biz-a', address: 'a' },
        { id: 'biz-b', address: 'b' },
        { id: 'biz-c', address: 'c' },
      ],
      matrix: { schemaVersion: 1, places: {}, pairs: {} },
      client,
      log,
    });

    const text = [...formatSummary(summary), ...lines, JSON.stringify(summary)].join('\n');
    expectNoKey(text);
    expect(text).not.toContain(leaked);
    expect(summary.failures.map((failure) => failure.reason)).toEqual([
      'GET https://maps.googleapis.com/maps/api/geocode/json?address=x&key=[redacted] failed',
      'bad key [redacted]',
      'request failed',
    ]);
  });

  it('scrubKeys leaves ordinary text alone', () => {
    expect(scrubKeys('matrix 2/26 home-business (34 x 18): 612 pairs fetched')).toBe('matrix 2/26 home-business (34 x 18): 612 pairs fetched');
    expect(scrubKeys('x-goog-api-key: abc123, next')).toBe('x-goog-api-key: [redacted], next');
  });
});
