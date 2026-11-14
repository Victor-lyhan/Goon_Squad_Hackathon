// Low-level Google HTTP client for the geo layer: Geocoding API + Routes API (route matrix, route polyline).
// The travel providers and scripts/fetch-routes.ts build on this. Rules it enforces (SPEC "MVP II" rules 1-4):
// - only the Geocoding and Routes APIs, always DRIVE + TRAFFIC_UNAWARE;
// - `fetch` is injected, so tests never touch the network or a key;
// - the key never appears in an error message, a log line or a thrown object (this file logs nothing);
// - a pair Google gave no route for is reported in `failures`, never as a made-up number.

export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
export const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
export const ROUTE_MATRIX_FIELD_MASK = 'originIndex,destinationIndex,duration,distanceMeters,status,condition';
export const ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';
/** Routes API limit: origins x destinations per computeRouteMatrix request. */
export const MAX_MATRIX_ELEMENTS = 625;
/** Retries after the first attempt, for 429, 5xx and network failures. The default: the fetch command's bulk limit. */
export const MAX_RETRIES = 3;
export const BACKOFF_BASE_MS = 500;
/** Per-attempt timeout. The default: the fetch command's bulk limit. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** `googleStatus` of the error for a request that was not sent because its call's deadline had passed (`msLeft`). Local, with status 0. */
export const CALL_DEADLINE_STATUS = 'CALL_DEADLINE';

const TRAVEL_MODE = 'DRIVE';
const ROUTING_PREFERENCE = 'TRAFFIC_UNAWARE';
const REDACTED = '[redacted]';

export interface LatLng {
  lat: number;
  lng: number;
}

/** The small part of `fetch` this client uses, so a test fake is a few lines. The global `fetch` fits it. */
export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export interface GoogleClientOptions {
  /** Server key (GOOGLE_MAPS_SERVER_KEY). The caller reads the environment; this file never does. */
  apiKey: string;
  /** Defaults to the global `fetch` (Node 22). */
  fetchImpl?: FetchLike;
  /** Backoff sleep between retries. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Per-attempt timeout. A timeout counts as a network failure and is retried. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Retries after the first attempt. Defaults to MAX_RETRIES. */
  maxRetries?: number;
  /**
   * The deadline of the whole call these requests belong to (a live action that must answer in time): the
   * milliseconds left of it, asked before every attempt and every backoff. With it,
   * - an attempt's timeout is cut to what is left;
   * - a backoff that would not end before the deadline is not slept: the request fails at once with the
   *   error of its last attempt;
   * - a request with nothing left is not sent: GoogleApiError with status 0 and CALL_DEADLINE_STATUS.
   * A deadline is always a failure, never a guessed answer. Not set: no deadline (the fetch command).
   */
  msLeft?: () => number;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  neighborhood: string | null;
  /**
   * Name of the `sublocality_level_1` address component, else of the first `sublocality` one, else null.
   * In New York City this is the borough ("Brooklyn"). Always set by `geocodeAddress`.
   */
  sublocality?: string | null;
  /** Name of the `administrative_area_level_2` address component (in the United States: the county), else null. Always set by `geocodeAddress`. */
  county?: string | null;
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  durationS: number;
  distanceM: number;
}

export interface RouteMatrixFailure {
  originIndex: number;
  destinationIndex: number;
  /** Google's `condition` (e.g. ROUTE_NOT_FOUND), or null when it sent none. */
  condition: string | null;
  message: string;
}

export interface RouteMatrixResult {
  /** Pairs with a real route, sorted by originIndex then destinationIndex. */
  elements: RouteMatrixElement[];
  /** Pairs without a usable answer, same order. Callers must not turn these into numbers. */
  failures: RouteMatrixFailure[];
}

export interface RoutePolyline {
  encoded: string;
  durationS: number;
  distanceM: number;
}

export class GoogleKeyMissingError extends Error {
  constructor() {
    super('Google API key is missing. Set GOOGLE_MAPS_SERVER_KEY in .env.');
    this.name = 'GoogleKeyMissingError';
  }
}

export class GoogleApiError extends Error {
  /** HTTP status. 0 means no HTTP response at all (network failure or timeout). */
  readonly status: number;
  /** Google's status string (PERMISSION_DENIED, REQUEST_DENIED, ...) or a local one (NETWORK_ERROR, INVALID_RESPONSE, NO_ROUTE, CALL_DEADLINE). */
  readonly googleStatus: string | null;
  /** The endpoint called, without its query string, so it can never hold the key. */
  readonly endpoint: string;

  constructor(args: { status: number; googleStatus: string | null; endpoint: string; message: string }) {
    const label = args.status === 0 ? 'no response' : `HTTP ${args.status}`;
    super(`Google API error (${label}${args.googleStatus ? ` ${args.googleStatus}` : ''}) from ${args.endpoint}: ${args.message}`);
    this.name = 'GoogleApiError';
    this.status = args.status;
    this.googleStatus = args.googleStatus;
    this.endpoint = args.endpoint;
  }
}

interface Ctx {
  apiKey: string;
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  maxRetries: number;
  msLeft: () => number;
}

function context(opts: GoogleClientOptions): Ctx {
  const apiKey = typeof opts?.apiKey === 'string' ? opts.apiKey.trim() : '';
  if (apiKey === '') throw new GoogleKeyMissingError();
  return {
    apiKey,
    fetchImpl: opts.fetchImpl ?? fetch,
    sleep: opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? MAX_RETRIES,
    msLeft: opts.msLeft ?? (() => Infinity),
  };
}

/** Removes the key (raw and URL-encoded) and any `key=` query value from text that goes into an error. */
function redact(text: string, apiKey: string): string {
  let out = text;
  const forms = new Set([apiKey, encodeURIComponent(apiKey), new URLSearchParams({ k: apiKey }).toString().slice(2)]);
  for (const form of forms) if (form) out = out.split(form).join(REDACTED);
  return out.replace(/([?&]key=)[^&\s"'<>]*/g, `$1${REDACTED}`);
}

/** The only place a GoogleApiError is built: every string in it is redacted first. */
function fail(ctx: Ctx, endpoint: string, status: number, googleStatus: string | null, message: string): GoogleApiError {
  return new GoogleApiError({
    status,
    googleStatus: googleStatus === null ? null : redact(googleStatus, ctx.apiKey),
    endpoint: redact(endpoint.split('?')[0], ctx.apiKey),
    message: redact(message, ctx.apiKey).slice(0, 500),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Reads Google's error out of a body: `{ error: { message, status } }` (Routes), the same wrapped in an array, or `{ status, error_message }` (Geocoding). */
function googleError(json: unknown): { googleStatus: string | null; message: string | null } {
  const body = Array.isArray(json) ? json.find((item) => isRecord(item) && isRecord(item.error)) : json;
  if (!isRecord(body)) return { googleStatus: null, message: null };
  if (isRecord(body.error)) return { googleStatus: str(body.error.status), message: str(body.error.message) };
  return { googleStatus: str(body.status), message: str(body.error_message) };
}

function describeThrown(err: unknown): string {
  if (!(err instanceof Error)) return 'request failed';
  const cause = err.cause instanceof Error ? `: ${err.cause.message}` : '';
  return `${err.name}: ${err.message}${cause}`;
}

/** One HTTP attempt. Returns the parsed JSON of a 2xx response, or throws a GoogleApiError. */
async function sendJson(ctx: Ctx, endpoint: string, url: string, init: FetchInitLike): Promise<unknown> {
  let status: number;
  let text: string;
  try {
    // Whole milliseconds, at least 1: `withRetry` sends nothing when less than that is left of the deadline.
    const timeoutMs = Math.max(1, Math.min(ctx.timeoutMs, Math.floor(ctx.msLeft())));
    const res = await ctx.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    status = res.status;
    text = await res.text();
  } catch (err) {
    // The original error is not attached as `cause`: it may hold the request URL, and so the key.
    throw fail(ctx, endpoint, 0, 'NETWORK_ERROR', describeThrown(err));
  }
  let json: unknown;
  let parsed = true;
  try {
    json = JSON.parse(text);
  } catch {
    parsed = false;
  }
  if (status < 200 || status >= 300) {
    const { googleStatus, message } = googleError(json);
    throw fail(ctx, endpoint, status, googleStatus, message ?? (text.trim().slice(0, 200) || 'no error message'));
  }
  if (!parsed) throw fail(ctx, endpoint, status, 'INVALID_RESPONSE', 'the response was not JSON');
  return json;
}

/** Statuses the Geocoding API sends with HTTP 200 that mean "try again". */
const RETRIABLE_BODY_STATUS = new Set(['OVER_QUERY_LIMIT', 'UNKNOWN_ERROR']);

function isRetriable(err: unknown): boolean {
  if (!(err instanceof GoogleApiError)) return false;
  if (err.status === 0 || err.status === 429 || err.status >= 500) return true;
  return err.googleStatus !== null && RETRIABLE_BODY_STATUS.has(err.googleStatus);
}

/**
 * Runs one request up to 1 + `maxRetries` times, sleeping 0.5 s, 1 s, 2 s between attempts, and never past the
 * call's deadline (`msLeft`): see GoogleClientOptions.
 */
async function withRetry<T>(ctx: Ctx, endpoint: string, attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let retry = 0; ; retry++) {
    if (ctx.msLeft() < 1) {
      // After a backoff that ran late: the error of the attempt before it. Else this request was never sent.
      if (retry > 0) throw last;
      throw fail(ctx, endpoint, 0, CALL_DEADLINE_STATUS, 'the time limit of this call ran out before the request was sent');
    }
    try {
      return await attempt();
    } catch (err) {
      if (retry >= ctx.maxRetries || !isRetriable(err)) throw err;
      const backoffMs = BACKOFF_BASE_MS * 2 ** retry;
      if (ctx.msLeft() <= backoffMs) throw err; // no retry could start before the deadline
      last = err;
      await ctx.sleep(backoffMs);
    }
  }
}

/** `"734s"` -> 734. Anything else -> null (never a guessed number). */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** A missing `distanceMeters` means 0 (JSON drops default values). A present but unusable one -> null. */
function parseDistanceMeters(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function waypoint(point: LatLng) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

function routesHeaders(ctx: Ctx, fieldMask: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': ctx.apiKey, 'X-Goog-FieldMask': fieldMask };
}

/**
 * Geocoding API: address -> candidate points. `ZERO_RESULTS` (or a blank address) gives `[]`.
 * `neighborhood` is the `neighborhood` address component, else the `sublocality` one, else null.
 * `sublocality` and `county` say where Google places the point: see GeocodeResult.
 *
 * The component type names are Google's ("Address types and address component types"):
 * https://developers.google.com/maps/documentation/geocoding/requests-geocoding
 * That page also says a component can be missing or change type, so every part may be null.
 */
export async function geocodeAddress(address: string, opts: GoogleClientOptions): Promise<GeocodeResult[]> {
  const ctx = context(opts);
  if (address.trim() === '') return [];
  const url = `${GEOCODE_URL}?${new URLSearchParams({ address, key: ctx.apiKey }).toString()}`;
  return withRetry(ctx, GEOCODE_URL, async () => {
    const json = await sendJson(ctx, GEOCODE_URL, url, { method: 'GET' });
    const status = isRecord(json) ? str(json.status) : null;
    if (status === 'ZERO_RESULTS') return [];
    if (!isRecord(json) || status !== 'OK') {
      const message = isRecord(json) ? str(json.error_message) : null;
      throw fail(ctx, GEOCODE_URL, 200, status ?? 'INVALID_RESPONSE', message ?? 'geocoding did not return OK');
    }
    const results: GeocodeResult[] = [];
    for (const item of Array.isArray(json.results) ? json.results : []) {
      if (!isRecord(item) || !isRecord(item.geometry) || !isRecord(item.geometry.location)) continue;
      const { lat, lng } = item.geometry.location;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      const named = componentNamed(item.address_components);
      results.push({
        lat,
        lng,
        formattedAddress: str(item.formatted_address) ?? '',
        neighborhood: named((type) => type === 'neighborhood') ?? named((type) => type === 'sublocality' || type.startsWith('sublocality_level_')),
        sublocality: named((type) => type === 'sublocality_level_1') ?? named((type) => type === 'sublocality'),
        county: named((type) => type === 'administrative_area_level_2'),
      });
    }
    return results;
  });
}

/** `(wanted) => name` of the first address component with a wanted type (its long name, else its short one), or null. */
function componentNamed(components: unknown): (wanted: (type: string) => boolean) => string | null {
  return (wanted) => {
    for (const component of Array.isArray(components) ? components : []) {
      if (!isRecord(component) || !Array.isArray(component.types)) continue;
      if (component.types.some((type) => typeof type === 'string' && wanted(type))) {
        const name = str(component.long_name) ?? str(component.short_name);
        if (name) return name;
      }
    }
    return null;
  };
}

export interface MatrixBatch {
  originStart: number;
  originEnd: number; // exclusive
  destinationStart: number;
  destinationEnd: number; // exclusive
}

/**
 * Splits an origins x destinations matrix into requests of at most `maxElements` elements.
 * The shorter side is kept whole (when it fits) and the longer side is cut, which needs the fewest requests:
 * 30 x 30 becomes 30 x 20 + 30 x 10.
 */
export function planMatrixBatches(originCount: number, destinationCount: number, maxElements = MAX_MATRIX_ELEMENTS): MatrixBatch[] {
  if (originCount <= 0 || destinationCount <= 0) return [];
  let originChunk: number;
  let destinationChunk: number;
  if (originCount <= destinationCount) {
    originChunk = Math.min(originCount, maxElements);
    destinationChunk = Math.min(destinationCount, Math.max(1, Math.floor(maxElements / originChunk)));
  } else {
    destinationChunk = Math.min(destinationCount, maxElements);
    originChunk = Math.min(originCount, Math.max(1, Math.floor(maxElements / destinationChunk)));
  }
  const batches: MatrixBatch[] = [];
  for (let o = 0; o < originCount; o += originChunk) {
    for (let d = 0; d < destinationCount; d += destinationChunk) {
      batches.push({
        originStart: o,
        originEnd: Math.min(originCount, o + originChunk),
        destinationStart: d,
        destinationEnd: Math.min(destinationCount, d + destinationChunk),
      });
    }
  }
  return batches;
}

/**
 * Routes API computeRouteMatrix: driving duration and distance for every origin x destination pair.
 * Requests are sent one after another, each with at most 625 elements. Indices in the result refer to the
 * `origins` / `destinations` arrays passed in. Every pair ends up in exactly one of `elements` or `failures`.
 */
export async function computeRouteMatrix(origins: LatLng[], destinations: LatLng[], opts: GoogleClientOptions): Promise<RouteMatrixResult> {
  const ctx = context(opts);
  const elements: RouteMatrixElement[] = [];
  const failures: RouteMatrixFailure[] = [];

  for (const batch of planMatrixBatches(origins.length, destinations.length)) {
    const batchOrigins = origins.slice(batch.originStart, batch.originEnd);
    const batchDestinations = destinations.slice(batch.destinationStart, batch.destinationEnd);
    const body = JSON.stringify({
      origins: batchOrigins.map((point) => ({ waypoint: waypoint(point) })),
      destinations: batchDestinations.map((point) => ({ waypoint: waypoint(point) })),
      travelMode: TRAVEL_MODE,
      routingPreference: ROUTING_PREFERENCE,
    });

    const part = await withRetry(ctx, ROUTE_MATRIX_URL, async () => {
      const json = await sendJson(ctx, ROUTE_MATRIX_URL, ROUTE_MATRIX_URL, {
        method: 'POST',
        headers: routesHeaders(ctx, ROUTE_MATRIX_FIELD_MASK),
        body,
      });
      if (!Array.isArray(json)) throw fail(ctx, ROUTE_MATRIX_URL, 200, 'INVALID_RESPONSE', 'expected a JSON array of matrix elements');
      const ok: RouteMatrixElement[] = [];
      const bad: RouteMatrixFailure[] = [];
      const seen = new Set<number>();
      for (const item of json) {
        if (isRecord(item) && isRecord(item.error)) {
          // An error sent inside the element stream of a 2xx response.
          const code = typeof item.error.code === 'number' ? item.error.code : 200;
          throw fail(ctx, ROUTE_MATRIX_URL, code, str(item.error.status), str(item.error.message) ?? 'error in the matrix response');
        }
        if (!isRecord(item)) throw fail(ctx, ROUTE_MATRIX_URL, 200, 'INVALID_RESPONSE', 'a matrix element was not an object');
        // JSON drops default values, so a missing index is 0.
        const o = item.originIndex ?? 0;
        const d = item.destinationIndex ?? 0;
        const inRange = (index: unknown, size: number): index is number =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < size;
        if (!inRange(o, batchOrigins.length) || !inRange(d, batchDestinations.length)) {
          throw fail(ctx, ROUTE_MATRIX_URL, 200, 'INVALID_RESPONSE', 'a matrix element had an index outside the request');
        }
        const slot = o * batchDestinations.length + d;
        if (seen.has(slot)) throw fail(ctx, ROUTE_MATRIX_URL, 200, 'INVALID_RESPONSE', 'the same matrix element was returned twice');
        seen.add(slot);

        const originIndex = batch.originStart + o;
        const destinationIndex = batch.destinationStart + d;
        const condition = str(item.condition);
        const status = isRecord(item.status) ? item.status : {};
        const statusOk = status.code === undefined || status.code === 0;
        const durationS = parseDurationSeconds(item.duration);
        const distanceM = parseDistanceMeters(item.distanceMeters);
        if (condition === 'ROUTE_EXISTS' && statusOk && durationS !== null && distanceM !== null) {
          ok.push({ originIndex, destinationIndex, durationS, distanceM });
        } else {
          const message =
            str(status.message) ??
            (condition !== 'ROUTE_EXISTS' ? 'no route between these points' : !statusOk ? 'element status was not OK' : 'duration or distance missing or unreadable');
          bad.push({ originIndex, destinationIndex, condition, message: redact(message, ctx.apiKey) });
        }
      }
      // A pair Google did not answer is a failure too, not a silent gap.
      for (let o = 0; o < batchOrigins.length; o++) {
        for (let d = 0; d < batchDestinations.length; d++) {
          if (seen.has(o * batchDestinations.length + d)) continue;
          bad.push({
            originIndex: batch.originStart + o,
            destinationIndex: batch.destinationStart + d,
            condition: null,
            message: 'Google returned no element for this pair',
          });
        }
      }
      return { ok, bad };
    });
    elements.push(...part.ok);
    failures.push(...part.bad);
  }

  const byIndex = (a: { originIndex: number; destinationIndex: number }, b: { originIndex: number; destinationIndex: number }) =>
    a.originIndex - b.originIndex || a.destinationIndex - b.destinationIndex;
  return { elements: elements.sort(byIndex), failures: failures.sort(byIndex) };
}

/**
 * Routes API computeRoutes: the driving route between two points as an encoded polyline.
 * Throws GoogleApiError with `googleStatus: 'NO_ROUTE'` when Google finds no route.
 */
export async function computeRoutePolyline(origin: LatLng, destination: LatLng, opts: GoogleClientOptions): Promise<RoutePolyline> {
  const ctx = context(opts);
  const body = JSON.stringify({
    origin: waypoint(origin),
    destination: waypoint(destination),
    travelMode: TRAVEL_MODE,
    routingPreference: ROUTING_PREFERENCE,
  });
  return withRetry(ctx, ROUTES_URL, async () => {
    const json = await sendJson(ctx, ROUTES_URL, ROUTES_URL, { method: 'POST', headers: routesHeaders(ctx, ROUTES_FIELD_MASK), body });
    if (!isRecord(json)) throw fail(ctx, ROUTES_URL, 200, 'INVALID_RESPONSE', 'expected a JSON object');
    const route = Array.isArray(json.routes) ? json.routes[0] : undefined;
    if (!isRecord(route)) throw fail(ctx, ROUTES_URL, 200, 'NO_ROUTE', 'no route between these points');
    const encoded = isRecord(route.polyline) ? str(route.polyline.encodedPolyline) : null;
    const durationS = parseDurationSeconds(route.duration);
    const distanceM = parseDistanceMeters(route.distanceMeters);
    if (encoded === null || durationS === null || distanceM === null) {
      throw fail(ctx, ROUTES_URL, 200, 'INVALID_RESPONSE', 'the route had no polyline, duration or readable distance');
    }
    return { encoded, durationS, distanceM };
  });
}
