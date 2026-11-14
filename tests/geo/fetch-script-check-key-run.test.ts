// runFetchScript without a flag (server/geo/fetchScript.ts), when Google refuses the first request the run makes to
// an API (not enabled, key restricted, billing off, key not valid): the run stops there, prints the row
// `--check-key` would print for that call and points at `--check-key`. Any other failure keeps the run's own rules.
// Temp folders with copies of the three real fixtures/nyc files and a fake Google client. No network, no real key, no .env.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { dropPlaces } from '../../server/geo/cacheEdit';
import { CHECK_KEY_LINE, RESUME_LINE, RESUME_WITHOUT_REFETCH_LINE } from '../../server/geo/fetchScript';
import { FetchStopError, runGeocodes, runMatrix, runPolylines } from '../../server/geo/fetchRunner';
import { failedRow, formatKeyCheck } from '../../server/geo/keyCheck';
import { BUSINESS_IDS, KEY, KEY_ENCODED, businessesFile, totalCalls } from './fetch-routes-helpers';
import {
  CITY_POINTS,
  cityClient,
  fixturesOnly,
  leakedLines,
  printedLineCount,
  removeTempDirs,
  script,
  snapshot,
  tempDirWithCacheOf,
  tempFixturesDir,
} from './fetch-script-helpers';
import { googleError } from './key-check-helpers';
import type { Api } from './key-check-helpers';

// A whole run with the fake client (matcher and both reports included) takes about 20 ms locally; a run that is
// refused takes less (DECISIONS pass 51 and 52: explicit limits, at least 10x).
vi.setConfig({ testTimeout: 10_000, hookTimeout: 30_000 });

// Google's documented wording for each cause (the same texts as tests/geo/key-check-classify.test.ts).
const GEOCODING_NOT_ENABLED = 'This API project is not authorized to use this API.';
const ROUTES_NOT_ENABLED =
  'Routes API has not been used in project 123456789012 before or it is disabled. Enable it by visiting ' +
  'https://console.developers.google.com/apis/api/routes.googleapis.com/overview?project=123456789012 then retry.';
const ROUTES_BILLING = 'This API method requires billing to be enabled. Please enable billing on project #123456789012 then retry.';
const REFERRER_BLOCKED = 'API keys with referer restrictions cannot be used with this API.';
const IP_BLOCKED = 'This IP, site or mobile application is not authorized to use this API key. Request received from IP address 203.0.113.7, with empty referer';
const KEY_NOT_VALID = 'API key not valid. Please pass a valid API key.';

const STOPPED = 'Stopped: Google refused the request below, the first one this run made to that API. No request was made after it.';

/** The run geocodes the businesses in ID order, so this is the one its first request is about. */
const FIRST_GEOCODED = [...businessesFile.businesses].sort((a, b) => (a.id < b.id ? -1 : 1))[0];

const cacheOf = (dir: string): TravelFiles => {
  const files = readTravelFiles(dir);
  if (files === null) throw new Error('no matrix.json');
  return files;
};
const thrower = (err: unknown) => (): never => {
  throw err;
};
/** The one line `--check-key` prints for this call when it fails this way. */
const rowLine = (api: Api, err: unknown) => formatKeyCheck([failedRow(api, err)])[0];

/** A folder a complete run was made on. Never changed after `beforeAll`; a test works on a copy. */
let seed: string;
let complete: TravelFiles;

beforeAll(async () => {
  seed = tempFixturesDir();
  const first = await script({ dir: seed });
  expect(first.code).toBe(0);
  expect(first.lines).not.toContain(CHECK_KEY_LINE);
  complete = cacheOf(seed);
});

afterAll(() => {
  expect(printedLineCount()).toBeGreaterThan(100);
  expect(leakedLines()).toEqual([]);
  removeTempDirs();
});

describe('a run on an empty cache whose first geocode is refused', () => {
  const refused = googleError('geocoding', 200, 'REQUEST_DENIED', GEOCODING_NOT_ENABLED);
  let dir: string;
  let run: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempFixturesDir();
    run = await script({ dir, google: cityClient({ geocode: thrower(refused) }) });
  });

  it('exits 1 after one request: no second geocode, no matrix request, no route line', () => {
    expect(run.code).toBe(1);
    expect(run.calls.geocode).toEqual([FIRST_GEOCODED.address]);
    expect(run.calls.matrix).toEqual([]);
    expect(run.calls.polyline).toEqual([]);
    expect(run.keys).toEqual([KEY]);
  });

  it('stops before the matrix step: no step line after the first, no summary and no report', () => {
    expect(run.lines.filter((line) => line.startsWith('Step '))).toEqual(['Step 1/4 geocode: 18 of 18 businesses have no coordinates yet']);
    for (const start of ['Fetch summary', 'Skipped steps', 'Plan check', 'Travel cache report', 'NOT complete', 'Done:']) {
      expect(run.lines.some((line) => line.startsWith(start))).toBe(false);
    }
    expect(run.lines).not.toContain(RESUME_LINE);
  });

  it('prints the row --check-key prints for that call, then the line that points at --check-key', () => {
    const row = rowLine('geocoding', refused);
    expect(row).toMatch(/^Geocoding API \(geocode\): api_not_enabled\. Enable the Geocoding API for this project in the Google Cloud console\. Detail: HTTP 200 REQUEST_DENIED: /);
    expect(run.lines.slice(-5, -2)).toEqual(['', STOPPED, row]);
    expect(run.lines.at(-2)).toMatch(/^Every step that finished before this is saved in .+\.$/);
    expect(run.lines.at(-2)).toContain(path.basename(dir));
    expect(run.lines.at(-1)).toBe(CHECK_KEY_LINE);
    expect(CHECK_KEY_LINE).toBe('Run `npm run fetch:routes -- --check-key` to see which setting is wrong.');
  });

  it('writes nothing: there was nothing fetched to save', () => {
    expect(snapshot(dir)).toEqual(fixturesOnly());
  });

  it('once the setting is fixed, a plain run on the same folder completes', async () => {
    const again = await script({ dir });
    expect(again.code).toBe(0);
    expect(again.calls.geocode).toHaveLength(18);
    expect(cacheOf(dir)).toEqual(complete);
  });
});

describe('a run whose geocodes work and whose first matrix request is refused', () => {
  const refused = googleError('route_matrix', 403, 'PERMISSION_DENIED', ROUTES_NOT_ENABLED);
  let dir: string;
  let run: Awaited<ReturnType<typeof script>>;

  beforeAll(async () => {
    dir = tempFixturesDir();
    run = await script({ dir, google: cityClient({ matrix: thrower(refused) }) });
  });

  it('exits 1 after one matrix request, not after three failed ones in a row', () => {
    expect(run.code).toBe(1);
    expect(run.calls.geocode).toHaveLength(18);
    expect(run.calls.matrix).toHaveLength(1);
    expect(run.calls.polyline).toEqual([]);
    expect(run.lines.some((line) => line.includes('stopped after 3 failed requests in a row'))).toBe(false);
  });

  it('has saved what was fetched before: all 18 geocoded businesses, and no pair', () => {
    const { matrix } = cacheOf(dir);
    expect(Object.keys(matrix.places).sort()).toEqual([...BUSINESS_IDS].sort());
    for (const id of BUSINESS_IDS) expect(matrix.places[id]).toMatchObject(CITY_POINTS[id]);
    expect(matrix.pairs).toEqual({});
  });

  it('prints the Routes API row and ends with the --check-key line', () => {
    const row = rowLine('route_matrix', refused);
    expect(row).toMatch(/^Routes API \(route matrix\): api_not_enabled\. Enable the Routes API for this project in the Google Cloud console\. Detail: HTTP 403 PERMISSION_DENIED: /);
    expect(run.lines.slice(-5, -2)).toEqual(['', STOPPED, row]);
    expect(run.lines.at(-2)).toMatch(/^Every step that finished before this is saved in .+\.$/);
    expect(run.lines.at(-1)).toBe(CHECK_KEY_LINE);
    expect(run.lines.some((line) => line.startsWith('Fetch summary'))).toBe(false);
  });

  it('the next run, with the API enabled, geocodes nothing again and completes', async () => {
    const again = await script({ dir });
    expect(again.code).toBe(0);
    expect(again.calls.geocode).toEqual([]);
    expect(cacheOf(dir)).toEqual(complete);
  });
});

describe('a run that only lacks route lines and whose first route line is refused', () => {
  it('exits 1 after one request, leaves matrix.json as it was and writes no polylines.json', async () => {
    const dir = tempDirWithCacheOf(seed);
    fs.rmSync(path.join(dir, POLYLINES_FILE));
    const before = snapshot(dir);
    const refused = googleError('routes', 403, 'PERMISSION_DENIED', ROUTES_BILLING);

    const run = await script({ dir, google: cityClient({ polyline: thrower(refused) }) });

    expect(run.code).toBe(1);
    expect(run.calls.geocode).toEqual([]);
    expect(run.calls.matrix).toEqual([]);
    expect(run.calls.polyline).toHaveLength(1);
    const row = rowLine('routes', refused);
    expect(row).toMatch(/^Routes API \(route line\): billing_off\. Turn on billing/);
    expect(run.lines.slice(-5, -2)).toEqual(['', STOPPED, row]);
    expect(run.lines.at(-1)).toBe(CHECK_KEY_LINE);
    expect(snapshot(dir)).toEqual(before);
    expect(snapshot(dir)[MATRIX_FILE]).toBe(snapshot(seed)[MATRIX_FILE]);
  });
});

describe('every access error stops the run at the first request, with its own row', () => {
  const causes: [string, Api, number, string | null, string, RegExp][] = [
    ['key not valid (Routes)', 'route_matrix', 400, 'INVALID_ARGUMENT', KEY_NOT_VALID, /: key_invalid\. Set GOOGLE_MAPS_SERVER_KEY in \.env to a valid server key/],
    ['key not valid (Geocoding)', 'geocoding', 200, 'REQUEST_DENIED', 'The provided API key is invalid.', /: key_invalid\. /],
    ['API not enabled', 'geocoding', 200, 'REQUEST_DENIED', GEOCODING_NOT_ENABLED, /: api_not_enabled\. Enable the Geocoding API/],
    ['billing off', 'route_matrix', 403, 'PERMISSION_DENIED', ROUTES_BILLING, /: billing_off\. Turn on billing/],
    ['referrer restriction', 'geocoding', 200, 'REQUEST_DENIED', REFERRER_BLOCKED, /: key_restricted\. The server key must not have an HTTP referrer restriction/],
    ['application restriction', 'geocoding', 200, 'REQUEST_DENIED', IP_BLOCKED, /: key_restricted\. /],
    ['API restriction', 'route_matrix', 403, 'PERMISSION_DENIED', 'Requests to this API routes.googleapis.com method google.maps.routing.v2.Routes.ComputeRouteMatrix are blocked.', /: key_restricted\. Add the Routes API to the API restrictions of the server key/],
    // Refused, with wording that names no cause: still a refusal, and the row says `unknown` with Google's status.
    ['refused without a known cause (Routes)', 'route_matrix', 403, 'PERMISSION_DENIED', 'Something Google has never said before.', /: unknown\. .* Detail: HTTP 403 PERMISSION_DENIED: Something Google has never said before\./],
    ['refused without a known cause (Geocoding)', 'geocoding', 200, 'REQUEST_DENIED', 'Something Google has never said before.', /: unknown\. .* Detail: HTTP 200 REQUEST_DENIED: Something Google has never said before\./],
  ];

  it.each(causes)('%s', async (_name, api, status, googleStatus, message, says) => {
    const dir = tempFixturesDir();
    const refused = googleError(api, status, googleStatus, message);
    const google = cityClient(api === 'geocoding' ? { geocode: thrower(refused) } : { matrix: thrower(refused) });

    const run = await script({ dir, google });

    expect(run.code).toBe(1);
    expect(api === 'geocoding' ? run.calls.geocode : run.calls.matrix).toHaveLength(1);
    expect(totalCalls(run.calls)).toBe(api === 'geocoding' ? 1 : 19);
    expect(run.lines.at(-3)).toBe(rowLine(api, refused));
    expect(run.lines.at(-3)).toMatch(says);
    expect(run.lines.at(-1)).toBe(CHECK_KEY_LINE);
  });
});

describe('a failure that is not an access error keeps the rules the run already had', () => {
  const others: [string, unknown][] = [
    ['a server error', googleError('geocoding', 503, 'UNAVAILABLE', 'backend unavailable')],
    ['a used-up quota', googleError('geocoding', 200, 'OVER_QUERY_LIMIT', 'You have exceeded your rate-limit for this API.')],
    ['no answer at all', googleError('geocoding', 0, 'NETWORK_ERROR', 'fetch failed')],
    ['an error that is not from Google', new Error('socket hang up')],
  ];

  it.each(others)('%s on every geocode: three failed requests, the summary, the resume line, and no --check-key line', async (_name, err) => {
    const dir = tempFixturesDir();

    const run = await script({ dir, google: cityClient({ geocode: thrower(err) }) });

    expect(run.code).toBe(1);
    expect(run.calls.geocode).toHaveLength(3);
    expect(run.lines.some((line) => line.startsWith('Fetch summary'))).toBe(true);
    expect(run.lines.at(-1)).toBe(RESUME_LINE);
    expect(run.lines).not.toContain(CHECK_KEY_LINE);
    expect(run.lines).not.toContain(STOPPED);
  });

  it('an access error that is not the first request to that API does not stop the run: the API worked before', async () => {
    const dir = tempFixturesDir();
    const first = FIRST_GEOCODED.id;
    const refused = googleError('geocoding', 200, 'REQUEST_DENIED', GEOCODING_NOT_ENABLED);

    const run = await script({ dir, google: cityClient({ geocode: (id) => (id === first ? undefined : thrower(refused)()) }) });

    expect(run.code).toBe(1);
    // The first worked, the next three failed in a row, and the step gave up as it always did.
    expect(run.calls.geocode).toHaveLength(4);
    expect(Object.keys(cacheOf(dir).matrix.places)).toContain(first);
    expect(run.lines.some((line) => line.startsWith('Fetch summary'))).toBe(true);
    expect(run.lines.at(-1)).toBe(RESUME_LINE);
    expect(run.lines).not.toContain(CHECK_KEY_LINE);
  });

  it('one pair without a route on the first route line is not a refusal', async () => {
    const dir = tempDirWithCacheOf(seed);
    fs.rmSync(path.join(dir, POLYLINES_FILE));
    let asked = 0;
    const noRoute = googleError('routes', 200, 'NO_ROUTE', 'no route between these points');

    const run = await script({ dir, google: cityClient({ polyline: () => (asked++ === 0 ? thrower(noRoute)() : undefined) }) });

    expect(run.calls.polyline.length).toBeGreaterThan(100);
    expect(run.lines).not.toContain(CHECK_KEY_LINE);
    expect(run.lines.at(-1)).toBe(RESUME_LINE);
  });
});

describe('--refetch and a refused first request', () => {
  it('the drop is saved, and the last two lines say to leave --refetch out and to run --check-key', async () => {
    const dir = tempDirWithCacheOf(seed);
    const refused = googleError('geocoding', 200, 'REQUEST_DENIED', GEOCODING_NOT_ENABLED);

    const run = await script({ dir, argv: ['--refetch', 'biz-etsy'], google: cityClient({ geocode: thrower(refused) }) });

    expect(run.code).toBe(1);
    expect(totalCalls(run.calls)).toBe(1);
    expect(cacheOf(dir)).toEqual(dropPlaces(complete, ['biz-etsy']).files);
    expect(run.lines.slice(-2)).toEqual([RESUME_WITHOUT_REFETCH_LINE, CHECK_KEY_LINE]);
    expect(run.lines.at(-4)).toBe(rowLine('geocoding', refused));
  });
});

describe('the key is never printed by a refused run', () => {
  // What Google or a proxy could echo back: the key itself, its URL-encoded form, a request URL and a header.
  const echo = `(${KEY}, https://maps.example/geocode?address=x&key=${KEY_ENCODED}, X-Goog-Api-Key: ${KEY})`;

  it.each([
    ['in a message with a known cause', googleError('geocoding', 200, 'REQUEST_DENIED', `The provided API key is invalid. ${echo}`)],
    ['in a message without a known cause', googleError('geocoding', 403, 'PERMISSION_DENIED', `Denied ${echo}`)],
    ['in the status', googleError('geocoding', 403, KEY, `API key not valid. ${echo}`)],
  ])('%s: the run stops, and no line holds the key in either form', async (_name, refused) => {
    const run = await script({ dir: tempFixturesDir(), google: cityClient({ geocode: thrower(refused) }) });

    expect(run.code).toBe(1);
    expect(run.calls.geocode).toHaveLength(1);
    expect(run.lines.at(-1)).toBe(CHECK_KEY_LINE);
    expect(run.lines.at(-3)).toContain('[redacted]');
    const printed = run.lines.join('\n');
    expect(printed).not.toContain(KEY);
    expect(printed).not.toContain(KEY_ENCODED);
  });
});

describe('fetchRunner: a FetchStopError from the client ends the step at once', () => {
  const stop = new FetchStopError();
  const log = () => {};
  const places = { a: { lat: 40.7, lng: -74 }, b: { lat: 40.71, lng: -74.01 } };

  it('runGeocodes, runMatrix and runPolylines let it through and make no further request', async () => {
    let requests = 0;
    const stopping = async (): Promise<never> => {
      requests++;
      throw stop;
    };
    const matrix = { schemaVersion: 1 as const, places, pairs: {} };

    await expect(
      runGeocodes({ plan: [{ id: 'a', address: 'one' }, { id: 'b', address: 'two' }], matrix, client: { geocodeAddress: stopping }, log }),
    ).rejects.toBe(stop);
    expect(requests).toBe(1);

    const batch = (from: string, to: string) => ({ block: 'business-business', originIds: [from], destinationIds: [to] });
    const plan = { batches: [batch('a', 'b'), batch('b', 'a')], missingPairs: 2, cachedPairs: 0 } as unknown as Parameters<typeof runMatrix>[0]['plan'];
    await expect(runMatrix({ plan, matrix, homes: [], client: { computeRouteMatrix: stopping }, log })).rejects.toBe(stop);
    expect(requests).toBe(2);

    await expect(
      runPolylines({
        plan: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
        polylines: { schemaVersion: 1, polylines: {} },
        places,
        client: { computeRoutePolyline: stopping },
        log,
      }),
    ).rejects.toBe(stop);
    expect(requests).toBe(3);
  });
});
