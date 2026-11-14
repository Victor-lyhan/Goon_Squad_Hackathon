// runFetchRoutes (server/geo/fetchRoutes.ts) on the real fixtures/nyc/*.json with a fake Google client.
// No network, no real key, no .env, no files written.
import { describe, expect, it } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { emptyTravelFiles } from '../../server/geo/cache';
import { commutePairs, planLegPairs } from '../../server/geo/fetchPlan';
import { runFetchRoutes } from '../../server/geo/fetchRoutes';
import { MAX_FAILED_REQUESTS_IN_A_ROW } from '../../server/geo/fetchRunner';
import { createCachedProvider } from '../../server/geo/providers';
import {
  BUSINESS_IDS,
  BUSINESS_POINTS,
  HOMES,
  HOME_IDS,
  KEY,
  KEY_ENCODED,
  businessesFile,
  fakeClient,
  firstRun,
  input,
  leakedLines,
  loggedLineCount,
  matrixPairsRequested,
  neededPairs,
  run,
  totalCalls,
  travel,
} from './fetch-routes-helpers';

const sorted = (values: readonly string[]) => [...values].sort();
const businessPlaces = (places: Record<string, unknown>) => Object.keys(places).filter((id) => id.startsWith('biz-'));

describe('runFetchRoutes: a first run on empty files', () => {
  it('geocodes the 18 businesses, each once', async () => {
    const { result, calls } = await firstRun();
    expect(sorted(calls.geocode)).toEqual(sorted(businessesFile.businesses.map((business) => business.address)));
    expect(calls.geocode).toHaveLength(18);
    for (const business of businessesFile.businesses) {
      expect(result.files.matrix.places[business.id]).toEqual({ ...BUSINESS_POINTS[business.id], formattedAddress: `${business.name}, New York, NY` });
    }
  });

  it('requests every needed matrix pair exactly once: the 120-home pool and the story homes against all businesses', async () => {
    const { result, calls } = await firstRun();
    const requested = matrixPairsRequested(calls);
    expect(HOMES).toHaveLength(120 + 10);
    expect(requested).toHaveLength(18 * 17 + 2 * 130 * 18);
    expect(new Set(requested).size).toBe(requested.length);
    expect(sorted(requested)).toEqual(sorted(neededPairs()));
    expect(sorted(Object.keys(result.files.matrix.pairs))).toEqual(sorted(neededPairs()));

    // The numbers are the client's, raw, under the right key.
    const places = result.files.matrix.places;
    for (const [from, to] of [['biz-etsy', 'home-001'], ['home-001', 'biz-etsy'], [BUSINESS_IDS[0], BUSINESS_IDS[17]], ['home-story-astoria-1', BUSINESS_IDS[3]]]) {
      expect(result.files.matrix.pairs[pairKey(from, to)]).toEqual(travel(places[from], places[to]));
    }
    for (const home of HOMES) expect(places[home.id]).toEqual({ lat: home.lat, lng: home.lng });
  });

  it('ends with the default scenario matched on the fetched matrix', async () => {
    const { result } = await firstRun();
    const { scenario, assignments, trips } = result;
    expect(result.skipped).toEqual([]);
    expect(scenario?.preset).toBe('demo');
    expect(scenario?.employees).toHaveLength(60);
    expect(scenario?.shipments).toHaveLength(24);
    expect(scenario?.businesses).toHaveLength(18);
    expect(scenario?.businesses.map((business) => ({ lat: business.lat, lng: business.lng }))).toEqual(BUSINESS_IDS.map((id) => BUSINESS_POINTS[id]));

    expect(trips).toHaveLength(120);
    const travelNow = createCachedProvider(result.files);
    for (const trip of trips) expect(trip.baselineDurationMin).toBe(travelNow.durationMin(trip.originPlaceId, trip.destinationPlaceId));

    expect(assignments!.plans.length + assignments!.unmatched.length).toBe(24);
    expect(assignments!.plans.length).toBeGreaterThan(0); // otherwise the route-line checks below would check nothing
    expect(assignments!.computeMs).toBeGreaterThan(0);
  });

  it('fetches a route line for both baseline commutes of every employee and for every leg pair of the matched plans, each once', async () => {
    const { result, calls } = await firstRun();
    const commutes = commutePairs(result.scenario!.employees).map(({ from, to }) => pairKey(from, to));
    const legs = planLegPairs(result.assignments!.plans).map(({ from, to }) => pairKey(from, to));
    expect(commutes).toHaveLength(120);
    expect(legs.length).toBeGreaterThan(0);

    for (const key of [...commutes, ...legs]) expect(result.files.polylines.polylines[key]).toBe(`line(${key.replace('|', '>')})`);
    expect(new Set(calls.polyline).size).toBe(calls.polyline.length);
    expect(sorted(calls.polyline)).toEqual(sorted([...new Set([...commutes, ...legs])]));
    expect(sorted(Object.keys(result.files.polylines.polylines))).toEqual(sorted(calls.polyline));
  });

  it('reports summary counts equal to the calls the client received', async () => {
    const { result, calls } = await firstRun();
    expect(result.summary).toEqual({
      geocoded: calls.geocode.length,
      pairsFetched: matrixPairsRequested(calls).length,
      pairsAlreadyCached: 0,
      polylinesFetched: calls.polyline.length,
      requests: totalCalls(calls),
      failures: [],
      stopped: [],
    });
  });

  it('saves after each step, so each paid step is on disk before the next one starts', async () => {
    const { result, saves, lines } = await firstRun();
    expect(saves).toHaveLength(3);
    const [afterGeocode, afterMatrix, afterLines] = saves;

    expect(businessPlaces(afterGeocode.matrix.places)).toHaveLength(18);
    expect(afterGeocode.matrix.pairs).toEqual({});
    expect(afterGeocode.polylines.polylines).toEqual({});

    expect(afterMatrix.matrix).toEqual(result.files.matrix);
    expect(afterMatrix.polylines.polylines).toEqual({});

    expect(afterLines).toEqual(result.files);

    // The log names the four steps in order.
    const steps = lines.filter((line) => line.startsWith('Step '));
    expect(steps.map((line) => line.slice(0, 8))).toEqual(['Step 1/4', 'Step 2/4', 'Step 3/4', 'Step 4/4']);
  });
});

describe('runFetchRoutes: resuming', () => {
  it('makes zero client calls on its own output and returns deep-equal files', async () => {
    const { result: firstResult } = await firstRun();
    const again = await run(firstResult.files);

    expect(totalCalls(again.calls)).toBe(0);
    expect(again.result.files).toEqual(firstResult.files);
    expect(again.result.files).not.toBe(firstResult.files);
    expect(again.saves).toEqual([]); // nothing changed, nothing to write
    expect(again.result.skipped).toEqual([]);
    expect(again.result.summary).toEqual({
      geocoded: 0,
      pairsFetched: 0,
      pairsAlreadyCached: neededPairs().length,
      polylinesFetched: 0,
      requests: 0,
      failures: [],
      stopped: [],
    });
    // The matcher still ran, on the cache alone, with the same result.
    expect(again.result.scenario).toEqual(firstResult.scenario);
    expect(again.result.trips).toEqual(firstResult.trips);
    expect(again.result.assignments!.plans).toEqual(firstResult.assignments!.plans);
    expect(again.result.assignments!.unmatched).toEqual(firstResult.assignments!.unmatched);
  });

  it('carries on from what was saved before a crash: after the matrix step, only the route lines are fetched', async () => {
    const { result: firstResult, calls: firstCalls, saves } = await firstRun();
    const resumed = await run(saves[1]);

    expect(resumed.calls.geocode).toEqual([]);
    expect(resumed.calls.matrix).toEqual([]);
    expect(sorted(resumed.calls.polyline)).toEqual(sorted(firstCalls.polyline));
    expect(resumed.result.files).toEqual(firstResult.files);
    expect(resumed.saves).toHaveLength(1);
  });

  it('never mutates the input files, and does not hand them back', async () => {
    const files = emptyTravelFiles();
    files.matrix.places['biz-etsy'] = { ...BUSINESS_POINTS['biz-etsy'], formattedAddress: 'cached earlier' };
    const before = structuredClone(files);
    const { result, calls } = await run(files); // `run` freezes a copy; this checks the plain object as well

    expect(files).toEqual(before);
    expect(calls.geocode).toHaveLength(17); // the cached business is not geocoded again
    expect(result.files.matrix.places['biz-etsy'].formattedAddress).toBe('cached earlier');
    expect(result.files.matrix).not.toBe(files.matrix);
  });

  it('lets an error from save escape: carrying on would pay for results that cannot be kept', async () => {
    const { client, calls } = fakeClient();
    await expect(
      runFetchRoutes({
        ...input(),
        client,
        log: () => {},
        save: () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect(calls.geocode).toHaveLength(18);
    expect(calls.matrix).toEqual([]);
  });
});

describe('runFetchRoutes: a business that cannot be geocoded', () => {
  const lost = 'biz-sweetleaf';
  const others = BUSINESS_IDS.filter((id) => id !== lost);
  const noResultFor = () => fakeClient({ geocode: (id) => (id === lost ? [] : undefined) });

  it('skips steps 3 and 4 with a reason, keeps the 17 geocodes and requests no pair of that business', async () => {
    expect(BUSINESS_IDS).toContain(lost);
    const { result, calls, saves, lines } = await run(emptyTravelFiles(), noResultFor());

    expect(result.scenario).toBeNull();
    expect(result.assignments).toBeNull();
    expect(result.trips).toEqual([]);
    expect(result.skipped.map((entry) => entry.step)).toEqual(['match', 'polylines']);
    expect(result.skipped[0].reason).toContain(lost);
    for (const { reason } of result.skipped) {
      expect(reason.endsWith('Run again to resume.')).toBe(true);
      expect(reason).not.toContain('\n');
    }
    expect(lines.filter((line) => line.includes('SKIPPED'))).toHaveLength(2);

    // save was called with the 17 geocodes before anything else was fetched.
    expect(sorted(businessPlaces(saves[0].matrix.places))).toEqual(sorted(others));
    expect(saves[0].matrix.pairs).toEqual({});

    // The other 17 businesses get their matrix; nothing is requested for the lost one.
    const requested = matrixPairsRequested(calls);
    expect(requested.some((key) => key.split('|').includes(lost))).toBe(false);
    expect(sorted(requested)).toEqual(sorted(neededPairs(others)));
    expect(calls.polyline).toEqual([]);
    expect(result.files.polylines.polylines).toEqual({});
    expect(saves[saves.length - 1]).toEqual(result.files);

    expect(result.summary.geocoded).toBe(17);
    expect(result.summary.requests).toBe(totalCalls(calls));
    expect(result.summary.failures).toEqual([{ kind: 'geocode', placeId: lost, reason: expect.stringContaining('ZERO_RESULTS') }]);
  });

  it('finishes on the next run once the business geocodes, fetching only what that business adds', async () => {
    const { result: partial } = await run(emptyTravelFiles(), noResultFor());
    const { result, calls } = await run(partial.files);
    const { result: firstResult } = await firstRun();

    expect(calls.geocode).toEqual([businessesFile.businesses.find((business) => business.id === lost)!.address]);
    const requested = matrixPairsRequested(calls);
    expect(requested).toHaveLength(2 * 17 + 2 * HOME_IDS.length);
    expect(requested.every((key) => key.split('|').includes(lost))).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.files).toEqual(firstResult.files);
  });
});

describe('runFetchRoutes: matrix requests that fail', () => {
  it('stops when every matrix request fails, keeps the geocodes and reports it without leaking the key', async () => {
    const failing = fakeClient({
      matrix: () => {
        throw new Error(`POST https://routes.googleapis.com/x?key=${KEY_ENCODED} failed with header X-Goog-Api-Key: ${KEY}`);
      },
    });
    const { result, calls, saves, lines } = await run(emptyTravelFiles(), failing);

    expect(calls.matrix).toHaveLength(MAX_FAILED_REQUESTS_IN_A_ROW); // gave up, did not hammer all requests
    expect(calls.polyline).toEqual([]);
    expect(result.summary.stopped).toHaveLength(1);
    expect(result.summary.stopped[0]).toContain('matrix: stopped after');
    expect(result.summary.failures).toHaveLength(MAX_FAILED_REQUESTS_IN_A_ROW);
    expect(result.summary.failures.every((failure) => failure.kind === 'matrix-batch')).toBe(true);
    expect(result.summary.pairsFetched).toBe(0);
    expect(result.summary.geocoded).toBe(18);

    // The geocodes were saved and are in the result; no pair was invented.
    expect(businessPlaces(saves[0].matrix.places)).toHaveLength(18);
    expect(businessPlaces(result.files.matrix.places)).toHaveLength(18);
    expect(result.files.matrix.pairs).toEqual({});

    expect(result.scenario).toBeNull();
    expect(result.skipped.map((entry) => entry.step)).toEqual(['match', 'polylines']);
    expect(result.skipped[0].reason).toContain('matrix lacks');
    for (const { reason } of result.skipped) expect(reason.endsWith('Run again to resume.')).toBe(true);

    const everything = JSON.stringify(result) + lines.join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(KEY_ENCODED);
    expect(lines.some((line) => line.includes('[redacted]'))).toBe(true);
  });

  it('skips the matcher when Google could not route one pair the default scenario needs, and estimates nothing', async () => {
    const from = 'biz-etsy';
    const to = 'biz-sweetleaf';
    const oneGap = fakeClient({
      matrix: (call) => {
        const originIndex = call.originIds.indexOf(from);
        const destinationIndex = call.destinationIds.indexOf(to);
        if (originIndex < 0 || destinationIndex < 0) return undefined;
        const elements = call.originIds.flatMap((origin, o) =>
          call.destinationIds.flatMap((destination, d) =>
            o === originIndex && d === destinationIndex ? [] : [{ originIndex: o, destinationIndex: d, ...travel(BUSINESS_POINTS[origin], BUSINESS_POINTS[destination]) }],
          ),
        );
        return { elements, failures: [{ originIndex, destinationIndex, condition: 'ROUTE_NOT_FOUND', message: 'no route' }] };
      },
    });
    const { result, calls } = await run(emptyTravelFiles(), oneGap);

    expect(result.files.matrix.pairs[pairKey(from, to)]).toBeUndefined();
    expect(Object.keys(result.files.matrix.pairs)).toHaveLength(neededPairs().length - 1);
    expect(result.summary.failures).toEqual([{ kind: 'matrix-pair', from, to, reason: expect.stringContaining('ROUTE_NOT_FOUND') }]);
    expect(result.skipped.map((entry) => entry.step)).toEqual(['match', 'polylines']);
    expect(result.skipped[0].reason).toContain('lacks 1 of');
    expect(result.scenario).toBeNull();
    expect(calls.polyline).toEqual([]);
  });
});

describe('the log of every run in this file', () => {
  it('never holds the fake key, raw or URL-encoded', () => {
    expect(loggedLineCount()).toBeGreaterThan(0);
    expect(leakedLines()).toEqual([]);
  });
});
