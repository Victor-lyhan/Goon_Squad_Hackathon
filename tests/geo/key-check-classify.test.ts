// Google access check (server/geo/keyCheck.ts): each failure Google can answer with becomes the setting to change.
// The messages are Google's documented wording for each cause. No network, no real key, no .env.
import { describe, expect, it } from 'vitest';
import { bindGoogleClient } from '../../server/geo/fetchRunner';
import { GEOCODE_URL, GoogleKeyMissingError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { FetchLike } from '../../server/geo/googleClient';
import { checkGoogleAccess } from '../../server/geo/keyCheck';
import type { KeyCheckProblem, KeyCheckRow } from '../../server/geo/keyCheck';
import { ADDRESS, APIS, FROM, TO, failing, googleError } from './key-check-helpers';
import type { Api } from './key-check-helpers';

async function rowFor(api: Api, err: unknown): Promise<KeyCheckRow> {
  const { client, calls } = failing(api, err);
  const rows = await checkGoogleAccess({ client, address: ADDRESS, from: FROM, to: TO });
  expect(calls).toHaveLength(3);
  // One failing API leaves the other two rows ok.
  expect(rows.filter((row) => row.ok).map((row) => row.api)).toEqual(APIS.filter((other) => other !== api));
  const row = rows[APIS.indexOf(api)];
  expect(row.api).toBe(api);
  expect(row.ok).toBe(false);
  return row;
}

const ROUTES_NOT_ENABLED =
  'Routes API has not been used in project 123456789012 before or it is disabled. Enable it by visiting ' +
  'https://console.developers.google.com/apis/api/routes.googleapis.com/overview?project=123456789012 then retry. ' +
  'If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.';
const ROUTES_BILLING =
  'This API method requires billing to be enabled. Please enable billing on project #123456789012 by visiting ' +
  'https://console.developers.google.com/billing/enable?project=123456789012 then retry.';
const ROUTES_QUOTA =
  "Quota exceeded for quota metric 'ComputeRouteMatrix elements' and limit 'ComputeRouteMatrix elements per minute' " +
  "of service 'routes.googleapis.com' for consumer 'project_number:123456789012'.";

const REFERRER_REMEDY = 'The server key must not have an HTTP referrer restriction; use an IP restriction or none.';
const KEY_REMEDY = 'Set GOOGLE_MAPS_SERVER_KEY in .env to a valid server key from the Credentials page of the Google Cloud console.';

interface Case {
  name: string;
  api: Api;
  status: number;
  googleStatus: string | null;
  message: string;
  problem: KeyCheckProblem;
  remedy: string;
}

const CASES: Case[] = [
  // --- Routes API: HTTP 403 PERMISSION_DENIED covers four different causes; only the message tells them apart.
  {
    name: 'matrix: 403 PERMISSION_DENIED, Routes API not enabled',
    api: 'route_matrix',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: ROUTES_NOT_ENABLED,
    problem: 'api_not_enabled',
    remedy: 'Enable the Routes API for this project in the Google Cloud console.',
  },
  {
    name: 'route: 403 PERMISSION_DENIED, Routes API not enabled',
    api: 'routes',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: ROUTES_NOT_ENABLED,
    problem: 'api_not_enabled',
    remedy: 'Enable the Routes API for this project in the Google Cloud console.',
  },
  {
    name: 'matrix: 403 PERMISSION_DENIED, billing off',
    api: 'route_matrix',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: ROUTES_BILLING,
    problem: 'billing_off',
    remedy: 'Turn on billing for the Google Cloud project that owns the server key; the Routes API refuses calls without it.',
  },
  {
    name: 'route: 403 PERMISSION_DENIED, HTTP referrer restriction',
    api: 'routes',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: 'Requests from referer <empty> are blocked.',
    problem: 'key_restricted',
    remedy: REFERRER_REMEDY,
  },
  {
    name: 'matrix: 403 PERMISSION_DENIED, IP restriction',
    api: 'route_matrix',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: 'The provided API key has an IP address restriction. The originating IP address of the call (203.0.113.7) violates this restriction.',
    problem: 'key_restricted',
    remedy:
      "The IP restriction on the server key does not include this machine; add this machine's public IP address to the key in the Google Cloud console, or remove the restriction.",
  },
  {
    name: 'route: 403 PERMISSION_DENIED, Android app restriction',
    api: 'routes',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: 'Requests from this Android client application <empty> are blocked.',
    problem: 'key_restricted',
    remedy: 'The server key has an application restriction that refuses server calls; use an IP restriction that includes this machine, or none.',
  },
  {
    name: 'route: 403 PERMISSION_DENIED, key not allowed to call the Routes API',
    api: 'routes',
    status: 403,
    googleStatus: 'PERMISSION_DENIED',
    message: 'Requests to this API routes.googleapis.com method google.maps.routing.v2.Routes.ComputeRoutes are blocked.',
    problem: 'key_restricted',
    remedy: 'Add the Routes API to the API restrictions of the server key in the Google Cloud console, or remove the API restriction.',
  },
  {
    name: 'matrix: 400 INVALID_ARGUMENT, key not valid',
    api: 'route_matrix',
    status: 400,
    googleStatus: 'INVALID_ARGUMENT',
    message: 'API key not valid. Please pass a valid API key.',
    problem: 'key_invalid',
    remedy: KEY_REMEDY,
  },
  {
    name: 'route: 400 INVALID_ARGUMENT, key expired',
    api: 'routes',
    status: 400,
    googleStatus: 'INVALID_ARGUMENT',
    message: 'API key expired. Please renew the API key.',
    problem: 'key_invalid',
    remedy: KEY_REMEDY,
  },
  {
    name: 'matrix: HTTP 429 RESOURCE_EXHAUSTED',
    api: 'route_matrix',
    status: 429,
    googleStatus: 'RESOURCE_EXHAUSTED',
    message: ROUTES_QUOTA,
    problem: 'quota',
    remedy: 'The Routes API quota for this project is used up or set too low; wait, or raise it on the Quotas page of the Google Cloud console.',
  },
  {
    name: 'route: HTTP 429 with no Google status',
    api: 'routes',
    status: 429,
    googleStatus: null,
    message: 'Too Many Requests',
    problem: 'quota',
    remedy: 'The Routes API quota for this project is used up or set too low; wait, or raise it on the Quotas page of the Google Cloud console.',
  },
  {
    name: 'matrix: status 0 (no HTTP response)',
    api: 'route_matrix',
    status: 0,
    googleStatus: 'NETWORK_ERROR',
    message: 'TypeError: fetch failed: getaddrinfo ENOTFOUND routes.googleapis.com',
    problem: 'network',
    remedy: "No answer came back from the Routes API; check this machine's internet connection and run the check again.",
  },

  // --- Geocoding API: HTTP 200 with status REQUEST_DENIED for every key or project problem.
  {
    name: 'geocode: REQUEST_DENIED, key invalid',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'The provided API key is invalid.',
    problem: 'key_invalid',
    remedy: KEY_REMEDY,
  },
  {
    name: 'geocode: REQUEST_DENIED, Geocoding API not enabled',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'This API project is not authorized to use this API.',
    problem: 'api_not_enabled',
    remedy: 'Enable the Geocoding API for this project in the Google Cloud console.',
  },
  {
    name: 'geocode: REQUEST_DENIED, API not activated',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'This API is not activated on your API project. You may need to enable this API in the Google Cloud Console: https://console.cloud.google.com/apis/library?filter=category:maps',
    problem: 'api_not_enabled',
    remedy: 'Enable the Geocoding API for this project in the Google Cloud console.',
  },
  {
    name: 'geocode: REQUEST_DENIED, billing off',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'You must enable Billing on the Google Cloud Project at https://console.cloud.google.com/project/_/billing/enable Learn more at https://developers.google.com/maps/gmp-get-started',
    problem: 'billing_off',
    remedy: 'Turn on billing for the Google Cloud project that owns the server key; the Geocoding API refuses calls without it.',
  },
  {
    name: 'geocode: REQUEST_DENIED, HTTP referrer restriction',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'API keys with referer restrictions cannot be used with this API.',
    problem: 'key_restricted',
    remedy: REFERRER_REMEDY,
  },
  {
    name: 'geocode: REQUEST_DENIED, this IP is not allowed by the key',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'This IP, site or mobile application is not authorized to use this API key. Request received from IP address 203.0.113.7, with empty referer',
    problem: 'key_restricted',
    remedy: 'The server key has an application restriction that refuses server calls; use an IP restriction that includes this machine, or none.',
  },
  {
    name: 'geocode: REQUEST_DENIED, key not allowed to call the Geocoding API',
    api: 'geocoding',
    status: 200,
    googleStatus: 'REQUEST_DENIED',
    message: 'This API key is not authorized to use this service or API.',
    problem: 'key_restricted',
    remedy: 'Add the Geocoding API to the API restrictions of the server key in the Google Cloud console, or remove the API restriction.',
  },
  {
    name: 'geocode: OVER_QUERY_LIMIT',
    api: 'geocoding',
    status: 200,
    googleStatus: 'OVER_QUERY_LIMIT',
    message: 'You have exceeded your daily request quota for this API. If you did not set a custom daily request quota, verify your project has an active billing account: http://g.co/dev/maps-no-account',
    problem: 'quota',
    remedy: 'The Geocoding API quota for this project is used up or set too low; wait, or raise it on the Quotas page of the Google Cloud console.',
  },
  {
    name: 'geocode: status 0 (timeout)',
    api: 'geocoding',
    status: 0,
    googleStatus: 'NETWORK_ERROR',
    message: 'TimeoutError: The operation was aborted due to timeout',
    problem: 'network',
    remedy: "No answer came back from the Geocoding API; check this machine's internet connection and run the check again.",
  },
];

describe('key check: each problem from a realistic Google error', () => {
  it.each(CASES)('$name -> $problem', async ({ api, status, googleStatus, message, problem, remedy }) => {
    const row = await rowFor(api, googleError(api, status, googleStatus, message));

    expect(row.problem).toBe(problem);
    expect(row.remedy).toBe(remedy);
    // The detail starts with what Google said: HTTP status, Google's status, then its message.
    const label = status === 0 ? 'no response' : `HTTP ${status}`;
    expect(row.detail.startsWith(`${label}${googleStatus ? ` ${googleStatus}` : ''}: ${message.slice(0, 40)}`)).toBe(true);
    expect(row.detail.length).toBeLessThanOrEqual(300);
  });

  it('covers every problem a failed call can have', () => {
    const produced = new Set(CASES.map((item) => item.problem));
    // no_result and unknown are in their own tests (key-check-calls and below).
    expect([...produced].sort()).toEqual(['api_not_enabled', 'billing_off', 'key_invalid', 'key_restricted', 'network', 'quota']);
  });

  it('a missing key (GoogleKeyMissingError from the client) is key_invalid on every row', async () => {
    for (const api of APIS) {
      const row = await rowFor(api, new GoogleKeyMissingError());
      expect(row.problem).toBe('key_invalid');
      expect(row.remedy).toBe(KEY_REMEDY);
    }
  });

  it('the two Routes rows name the Routes API and the geocode row names the Geocoding API', async () => {
    const message = 'has not been used in project 1 before or it is disabled';
    const remedies = await Promise.all(APIS.map(async (api) => (await rowFor(api, googleError(api, 403, 'PERMISSION_DENIED', message))).remedy));

    expect(remedies[0]).toContain('Geocoding API');
    expect(remedies[0]).not.toContain('Routes API');
    for (const remedy of remedies.slice(1)) {
      expect(remedy).toContain('Routes API');
      expect(remedy).not.toContain('Geocoding API');
    }
  });
});

describe('key check: when the signals do not decide, the row says unknown with Google\'s status', () => {
  const UNDECIDED: { name: string; api: Api; status: number; googleStatus: string | null; message: string; detail: string }[] = [
    {
      name: '403 PERMISSION_DENIED with a message that names no cause',
      api: 'route_matrix',
      status: 403,
      googleStatus: 'PERMISSION_DENIED',
      message: 'The caller does not have permission',
      detail: 'HTTP 403 PERMISSION_DENIED: The caller does not have permission',
    },
    {
      name: 'REQUEST_DENIED with no error_message',
      api: 'geocoding',
      status: 200,
      googleStatus: 'REQUEST_DENIED',
      message: 'geocoding did not return OK',
      detail: 'HTTP 200 REQUEST_DENIED: geocoding did not return OK',
    },
    {
      // Google documents four causes for this status (bad key, no billing, a usage cap, a failed payment).
      name: 'OVER_DAILY_LIMIT with no error_message',
      api: 'geocoding',
      status: 200,
      googleStatus: 'OVER_DAILY_LIMIT',
      message: 'geocoding did not return OK',
      detail: 'HTTP 200 OVER_DAILY_LIMIT: geocoding did not return OK',
    },
    {
      name: '400 INVALID_ARGUMENT about the request, not the key',
      api: 'routes',
      status: 400,
      googleStatus: 'INVALID_ARGUMENT',
      message: 'Invalid value at \'routing_preference\' (type.googleapis.com/google.maps.routing.v2.RoutingPreference), "TRAFFIC_UNAWARE_X"',
      detail: 'HTTP 400 INVALID_ARGUMENT: Invalid value at \'routing_preference\' (type.googleapis.com/google.maps.routing.v2.RoutingPreference), "TRAFFIC_UNAWARE_X"',
    },
    {
      name: '503 UNAVAILABLE',
      api: 'route_matrix',
      status: 503,
      googleStatus: 'UNAVAILABLE',
      message: 'The service is currently unavailable.',
      detail: 'HTTP 503 UNAVAILABLE: The service is currently unavailable.',
    },
    {
      name: 'a 200 the client could not read',
      api: 'route_matrix',
      status: 200,
      googleStatus: 'INVALID_RESPONSE',
      message: 'expected a JSON array of matrix elements',
      detail: 'HTTP 200 INVALID_RESPONSE: expected a JSON array of matrix elements',
    },
    {
      name: '401 with no Google status',
      api: 'routes',
      status: 401,
      googleStatus: null,
      message: 'no error message',
      detail: 'HTTP 401: no error message',
    },
  ];

  it.each(UNDECIDED)('$name', async ({ api, status, googleStatus, message, detail }) => {
    const row = await rowFor(api, googleError(api, status, googleStatus, message));

    expect(row.problem).toBe('unknown');
    expect(row.detail).toBe(detail);
    const name = api === 'geocoding' ? 'Geocoding API' : 'Routes API';
    expect(row.remedy).toBe(`The answer from the ${name} does not point to one setting; read the detail before running the full fetch.`);
  });

  it('an error that is not a GoogleApiError is unknown with its message, and a thrown non-Error shows nothing of itself', async () => {
    expect(await rowFor('geocoding', new TypeError('fetch failed'))).toMatchObject({ problem: 'unknown', detail: 'fetch failed' });
    expect(await rowFor('routes', { url: 'https://example.test/?key=secret', message: 'API key not valid' })).toMatchObject({ problem: 'unknown', detail: 'request failed' });
  });

  it('keeps a long or multi-line Google message to one bounded line', async () => {
    const row = await rowFor('route_matrix', googleError('route_matrix', 500, 'INTERNAL', `line one\n  line two\t${'x'.repeat(600)}`));

    expect(row.detail.startsWith('HTTP 500 INTERNAL: line one line two x')).toBe(true);
    expect(row.detail).not.toMatch(/[\n\t]/);
    expect(row.detail).toHaveLength(300);
  });
});

describe('key check: through the real client over a fake fetch', () => {
  // Not a real key. It has characters that change when URL-encoded.
  const KEY = 'FAKE_key-123+/=';
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });

  it('a key with only the Geocoding API enabled: geocode ok, both Routes rows api_not_enabled, three requests', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url.split('?')[0]);
      if (url.startsWith(GEOCODE_URL)) {
        return json(200, { status: 'OK', results: [{ formatted_address: '350 5th Ave', geometry: { location: { lat: 40.7484, lng: -73.9857 } } }] });
      }
      return json(403, { error: { code: 403, message: ROUTES_NOT_ENABLED, status: 'PERMISSION_DENIED' } });
    };
    const rows = await checkGoogleAccess({ client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} }), address: ADDRESS, from: FROM, to: TO });

    expect(urls).toEqual([GEOCODE_URL, ROUTE_MATRIX_URL, ROUTES_URL]); // a 403 is not retried by the client
    expect(rows.map((row) => row.problem)).toEqual(['none', 'api_not_enabled', 'api_not_enabled']);
    expect(rows[1].remedy).toBe('Enable the Routes API for this project in the Google Cloud console.');
    expect(rows[1].detail.startsWith('HTTP 403 PERMISSION_DENIED: Routes API has not been used in project')).toBe(true);
  });

  it('a browser key (referrer restriction): all three rows key_restricted with the referrer remedy', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.startsWith(GEOCODE_URL)
        ? json(200, { status: 'REQUEST_DENIED', error_message: 'API keys with referer restrictions cannot be used with this API.', results: [] })
        : json(403, { error: { code: 403, message: 'Requests from referer <empty> are blocked.', status: 'PERMISSION_DENIED' } });
    const rows = await checkGoogleAccess({ client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} }), address: ADDRESS, from: FROM, to: TO });

    expect(rows.map((row) => row.problem)).toEqual(['key_restricted', 'key_restricted', 'key_restricted']);
    expect(rows.map((row) => row.remedy)).toEqual([REFERRER_REMEDY, REFERRER_REMEDY, REFERRER_REMEDY]);
  });

  it('a wrong key: all three rows key_invalid, and the key Google echoed back is in no row', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.startsWith(GEOCODE_URL)
        ? json(200, { status: 'REQUEST_DENIED', error_message: `The provided API key is invalid. (${url})` })
        : json(400, { error: { code: 400, message: `API key not valid. Please pass a valid API key. [${KEY}]`, status: 'INVALID_ARGUMENT' } });
    const rows = await checkGoogleAccess({ client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} }), address: ADDRESS, from: FROM, to: TO });

    expect(rows.map((row) => row.problem)).toEqual(['key_invalid', 'key_invalid', 'key_invalid']);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(encodeURIComponent(KEY));
    expect(text).toContain('[redacted]');
  });

  it('ZERO_RESULTS, a pair with no route and an empty routes list are no_result, not a key problem', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith(GEOCODE_URL)) return json(200, { status: 'ZERO_RESULTS', results: [] });
      if (url === ROUTE_MATRIX_URL) return json(200, [{ originIndex: 0, destinationIndex: 0, status: {}, condition: 'ROUTE_NOT_FOUND' }]);
      return json(200, {});
    };
    const rows = await checkGoogleAccess({ client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} }), address: ADDRESS, from: FROM, to: TO });

    expect(rows.map((row) => row.problem)).toEqual(['no_result', 'no_result', 'no_result']);
    expect(rows.every((row) => !row.ok)).toBe(true);
  });

  it('HTTP 429 after the client\'s own retries is quota; the check adds no retry of its own', async () => {
    let matrixRequests = 0;
    const fetchImpl: FetchLike = async (url) => {
      if (url.startsWith(GEOCODE_URL)) return json(200, { status: 'OK', results: [{ geometry: { location: { lat: 40.7, lng: -73.9 } } }] });
      if (url === ROUTE_MATRIX_URL) {
        matrixRequests++;
        return json(429, { error: { code: 429, message: ROUTES_QUOTA, status: 'RESOURCE_EXHAUSTED' } });
      }
      return json(200, { routes: [{ duration: '734s', distanceMeters: 6120, polyline: { encodedPolyline: 'abc' } }] });
    };
    const rows = await checkGoogleAccess({ client: bindGoogleClient({ apiKey: KEY, fetchImpl, sleep: async () => {} }), address: ADDRESS, from: FROM, to: TO });

    expect(matrixRequests).toBe(4); // 1 + MAX_RETRIES inside the client's single computeRouteMatrix call
    expect(rows.map((row) => row.problem)).toEqual(['none', 'quota', 'none']);
  });
});
