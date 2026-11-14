// Google access check: three calls (one geocode, one 1x1 route matrix, one route line) that say, per API, whether
// the server key works and which Google Cloud setting to change when it does not. The first real Google call is the
// human's paid fetch; this costs three billable calls instead of a failed 4,986-pair run.
// Rules it keeps (SPEC "MVP II" rule 2, DECISIONS pass 51):
// - exactly three client calls, in that order, whatever fails; no retry beyond the client's own;
// - a cause is named only when Google's answer decides it; otherwise the row says `unknown` with Google's status;
// - it only reports: no cache, no file system, no environment, no terminal output; no string it returns holds a key.

import { scrubKeys } from './fetchRunner';
import type { FetchClient } from './fetchRunner';
import { GoogleApiError, GoogleKeyMissingError } from './googleClient';
import type { LatLng } from './googleClient';

export type KeyCheckApi = 'geocoding' | 'route_matrix' | 'routes';

export type KeyCheckProblem =
  | 'none'
  /** Google does not accept the key (wrong, deleted, expired or not set). */
  | 'key_invalid'
  /** The API is not enabled for the key's project. */
  | 'api_not_enabled'
  /** The project has no active billing. */
  | 'billing_off'
  /** A restriction on the key (HTTP referrer, IP address, app, or the list of allowed APIs) refuses this server call. */
  | 'key_restricted'
  | 'quota'
  /** The call worked but returned nothing usable (no geocoding result, no route). The key is fine. */
  | 'no_result'
  /** No HTTP response at all. */
  | 'network'
  /** Google's answer does not decide the cause. `detail` holds Google's own status and message. */
  | 'unknown';

export interface KeyCheckRow {
  api: KeyCheckApi;
  ok: boolean;
  problem: KeyCheckProblem;
  /** What came back: the result of a working call, or Google's status and message for a failed one. Never a key. */
  detail: string;
  /** One sentence: what the human has to change. Empty when `ok`. */
  remedy: string;
}

const MAX_DETAIL_LENGTH = 300;

/** The Google Cloud API behind each row: both Routes calls are the one "Routes API" in the console. */
const API_NAME: Record<KeyCheckApi, string> = {
  geocoding: 'Geocoding API',
  route_matrix: 'Routes API',
  routes: 'Routes API',
};

const CALL_NAME: Record<KeyCheckApi, string> = {
  geocoding: 'geocode',
  route_matrix: 'route matrix',
  routes: 'route line',
};

/** Which restriction on the key refused the call. Each one is a different setting on the key's page. */
type Restriction = 'referrer' | 'ip' | 'app' | 'api';

interface Verdict {
  problem: Exclude<KeyCheckProblem, 'none'>;
  restriction?: Restriction;
}

// Google's own wording, by cause. Routes errors are `{ error: { status, message } }` with an HTTP 4xx; Geocoding
// errors are HTTP 200 with `status: REQUEST_DENIED` and an `error_message`. The status alone (PERMISSION_DENIED,
// REQUEST_DENIED) is shared by all of these causes, so only the message decides between them.
const KEY_INVALID = [
  /API key not valid/i, // Routes, HTTP 400 INVALID_ARGUMENT
  /API key (?:is )?(?:invalid|expired)/i, // Geocoding "The provided API key is invalid." / "... is expired."; Routes "API key expired."
  /must use an API key to authenticate/i, // Geocoding, no key reached Google
  /\bAPI_KEY_INVALID\b/,
];
const BILLING_OFF = [
  /requires billing to be enabled/i, // Routes
  /must enable billing/i, // Geocoding
  /billing (?:account )?(?:is|has been|was) (?:disabled|closed|not enabled)/i,
  /\bBILLING_DISABLED\b/,
];
const RESTRICTIONS: [Restriction, RegExp[]][] = [
  ['referrer', [/requests from referer .* are blocked/i, /referr?er restrictions? cannot be used/i, /\bAPI_KEY_HTTP_REFERRER_BLOCKED\b/]],
  ['ip', [/IP address restriction/i, /\bAPI_KEY_IP_ADDRESS_BLOCKED\b/]],
  [
    'app',
    [
      /requests from this (?:android|ios) client application .* are blocked/i,
      /\bAPI_KEY_(?:ANDROID|IOS)_APP_BLOCKED\b/,
      /this IP, site or mobile application is not authorized to use this API key/i, // Geocoding: some application restriction
    ],
  ],
  ['api', [/requests to this API .* are blocked/i, /API key is not authorized to use this service or API/i, /\bAPI_KEY_SERVICE_BLOCKED\b/]],
];
const API_NOT_ENABLED = [
  /has not been used in project .* before or it is disabled/i, // Routes
  /API project is not authorized to use this API/i, // Geocoding
  /is not (?:activated|enabled) (?:on|for|in) your (?:API )?project/i,
  /\bSERVICE_DISABLED\b/,
];
/** Statuses that mean "too many requests" on their own. OVER_DAILY_LIMIT is not here: Google uses it for four causes. */
const QUOTA_STATUS = new Set(['RESOURCE_EXHAUSTED', 'OVER_QUERY_LIMIT']);

const matches = (patterns: RegExp[], text: string) => patterns.some((pattern) => pattern.test(text));

/** Google's own message: the part of a GoogleApiError message after its "... from <endpoint>: " prefix. */
function googleMessage(err: GoogleApiError): string {
  const marker = ` from ${err.endpoint}: `;
  const at = err.message.indexOf(marker);
  return at === -1 ? err.message : err.message.slice(at + marker.length);
}

function classify(err: unknown): Verdict {
  if (err instanceof GoogleKeyMissingError) return { problem: 'key_invalid' };
  if (!(err instanceof GoogleApiError)) return { problem: 'unknown' };
  if (err.status === 0) return { problem: 'network' };
  if (err.googleStatus === 'NO_ROUTE') return { problem: 'no_result' };

  const text = googleMessage(err);
  if (matches(KEY_INVALID, text)) return { problem: 'key_invalid' };
  if (matches(BILLING_OFF, text)) return { problem: 'billing_off' };
  for (const [restriction, patterns] of RESTRICTIONS) {
    if (matches(patterns, text)) return { problem: 'key_restricted', restriction };
  }
  if (matches(API_NOT_ENABLED, text)) return { problem: 'api_not_enabled' };
  if (err.status === 429 || (err.googleStatus !== null && QUOTA_STATUS.has(err.googleStatus))) return { problem: 'quota' };
  return { problem: 'unknown' };
}

function remedyFor(api: KeyCheckApi, verdict: Verdict): string {
  const name = API_NAME[api];
  switch (verdict.problem) {
    case 'key_invalid':
      return 'Set GOOGLE_MAPS_SERVER_KEY in .env to a valid server key from the Credentials page of the Google Cloud console.';
    case 'api_not_enabled':
      return `Enable the ${name} for this project in the Google Cloud console.`;
    case 'billing_off':
      return `Turn on billing for the Google Cloud project that owns the server key; the ${name} refuses calls without it.`;
    case 'key_restricted':
      switch (verdict.restriction) {
        case 'referrer':
          return 'The server key must not have an HTTP referrer restriction; use an IP restriction or none.';
        case 'ip':
          return "The IP restriction on the server key does not include this machine; add this machine's public IP address to the key in the Google Cloud console, or remove the restriction.";
        case 'api':
          return `Add the ${name} to the API restrictions of the server key in the Google Cloud console, or remove the API restriction.`;
        default:
          return 'The server key has an application restriction that refuses server calls; use an IP restriction that includes this machine, or none.';
      }
    case 'quota':
      return `The ${name} quota for this project is used up or set too low; wait, or raise it on the Quotas page of the Google Cloud console.`;
    case 'no_result':
      return api === 'geocoding'
        ? 'The Geocoding API answered, so the key works, but it found nothing for the check address; run the check with a real street address.'
        : 'The Routes API answered, so the key works, but it found no driving route between the two check points; run the check with two points on roads.';
    case 'network':
      return `No answer came back from the ${name}; check this machine's internet connection and run the check again.`;
    case 'unknown':
      return `The answer from the ${name} does not point to one setting; read the detail before running the full fetch.`;
  }
}

/** One line of text that is safe to print: no key, no line break, bounded length. */
function clean(text: string): string {
  return scrubKeys(text).replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL_LENGTH);
}

function detailOf(err: unknown): string {
  if (err instanceof GoogleApiError) {
    const label = err.status === 0 ? 'no response' : `HTTP ${err.status}`;
    return clean(`${label}${err.googleStatus ? ` ${err.googleStatus}` : ''}: ${googleMessage(err)}`);
  }
  // Only an Error's message is used: any other thrown value could hold a request, and so a key.
  return clean(err instanceof Error && err.message !== '' ? err.message : 'request failed');
}

function okRow(api: KeyCheckApi, detail: string): KeyCheckRow {
  return { api, ok: true, problem: 'none', detail: clean(detail), remedy: '' };
}

function problemRow(api: KeyCheckApi, verdict: Verdict, detail: string): KeyCheckRow {
  return { api, ok: false, problem: verdict.problem, detail: clean(detail), remedy: scrubKeys(remedyFor(api, verdict)) };
}

function failedRow(api: KeyCheckApi, err: unknown): KeyCheckRow {
  return problemRow(api, classify(err), detailOf(err));
}

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Checks the server key against the three Google calls the fetch makes. Always makes exactly three client calls
 * (geocode, 1x1 matrix, route line), in that order: a failed call does not stop the next one, because each API is
 * enabled and restricted on its own. Returns one row per call, in the same order. Never throws for a failed call.
 */
export async function checkGoogleAccess(args: { client: FetchClient; address: string; from: LatLng; to: LatLng }): Promise<KeyCheckRow[]> {
  const { client, address } = args;
  const from = { lat: args.from.lat, lng: args.from.lng };
  const to = { lat: args.to.lat, lng: args.to.lng };
  const rows: KeyCheckRow[] = [];

  try {
    const results = await client.geocodeAddress(address);
    const first = Array.isArray(results) ? results[0] : undefined;
    if (first && isCoordinate(first.lat) && isCoordinate(first.lng)) {
      rows.push(okRow('geocoding', `found ${first.lat}, ${first.lng}`));
    } else {
      rows.push(problemRow('geocoding', { problem: 'no_result' }, 'no geocoding result for the check address (ZERO_RESULTS)'));
    }
  } catch (err) {
    rows.push(failedRow('geocoding', err));
  }

  try {
    const result = await client.computeRouteMatrix([from], [to]);
    const element = (result?.elements ?? []).find((item) => item.originIndex === 0 && item.destinationIndex === 0);
    if (element && isAmount(element.durationS) && isAmount(element.distanceM)) {
      rows.push(okRow('route_matrix', `${element.durationS} s, ${element.distanceM} m`));
    } else {
      const failure = (result?.failures ?? [])[0];
      const said = failure ? (failure.condition ? `${failure.condition}: ${failure.message}` : failure.message) : 'no element with a duration and a distance';
      rows.push(problemRow('route_matrix', { problem: 'no_result' }, `no route for the check pair (${said})`));
    }
  } catch (err) {
    rows.push(failedRow('route_matrix', err));
  }

  try {
    const route = await client.computeRoutePolyline(from, to);
    if (typeof route?.encoded === 'string' && route.encoded !== '') {
      rows.push(okRow('routes', `route line of ${route.encoded.length} characters, ${route.durationS} s, ${route.distanceM} m`));
    } else {
      rows.push(problemRow('routes', { problem: 'no_result' }, 'the route had no line'));
    }
  } catch (err) {
    rows.push(failedRow('routes', err));
  }

  return rows;
}

/** True when every row is ok (and there is at least one). */
export function keyCheckPassed(rows: readonly KeyCheckRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.ok);
}

/** The lines the fetch command prints: one per API, then the verdict. No line ever holds a key. */
export function formatKeyCheck(rows: readonly KeyCheckRow[]): string[] {
  const lines = rows.map((row) => {
    const label = `${API_NAME[row.api]} (${CALL_NAME[row.api]})`;
    if (row.ok) return `${label}: ok${row.detail ? ` (${row.detail})` : ''}`;
    return `${label}: ${row.problem}. ${row.remedy}${row.detail ? ` Detail: ${row.detail}` : ''}`;
  });
  lines.push(keyCheckPassed(rows) ? 'All three Google APIs answered.' : 'Fix the rows above, then run the check again.');
  return lines.map((line) => scrubKeys(line).replace(/\s+/g, ' '));
}
