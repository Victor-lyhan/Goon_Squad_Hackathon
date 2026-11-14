// Carries out the plans from server/geo/fetchPlan.ts through an injected Google client and returns the updated
// cache objects with a summary. The logic behind `npm run fetch:routes`; the script only reads and writes files.
// No fs, no environment, no console: progress goes to the `log(line)` callback.
// Rules it keeps (SPEC "MVP II" rules 2-4 and "Fetch script"):
// - a number is written only when Google returned it; anything else becomes an entry in `summary.failures`;
// - the input file object is never mutated, and results fetched before a failure are kept;
// - no log line, failure reason or summary line holds a key.

import { pairKey } from '../../shared/v2/types';
import type { PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import type { GeocodeTarget, MatrixPlan, PlacePair } from './fetchPlan';
import { GoogleApiError, computeRouteMatrix, computeRoutePolyline, geocodeAddress } from './googleClient';
import type { GeocodeResult, GoogleClientOptions, LatLng, RouteMatrixResult, RoutePolyline } from './googleClient';

/** The functions exported by googleClient.ts, already bound to their options. A test fake is three small functions. */
export interface FetchClient {
  geocodeAddress(address: string): Promise<GeocodeResult[]>;
  computeRouteMatrix(origins: LatLng[], destinations: LatLng[]): Promise<RouteMatrixResult>;
  computeRoutePolyline(origin: LatLng, destination: LatLng): Promise<RoutePolyline>;
}

/** The real client. The caller reads the key from the environment; this file never does. */
export function bindGoogleClient(opts: GoogleClientOptions): FetchClient {
  return {
    geocodeAddress: (address) => geocodeAddress(address, opts),
    computeRouteMatrix: (origins, destinations) => computeRouteMatrix(origins, destinations, opts),
    computeRoutePolyline: (origin, destination) => computeRoutePolyline(origin, destination, opts),
  };
}

export type FetchStep = 'geocode' | 'matrix' | 'polyline';

export type FetchFailure =
  /** A business address with no geocoding result, or a geocoding request that failed. */
  | { kind: 'geocode'; placeId: string; reason: string }
  /** A place a step could not use (no coordinates, or it moved since it was cached). Its pairs were not requested. */
  | { kind: 'place'; step: FetchStep; placeId: string; reason: string }
  /** A pair Google could not route. */
  | { kind: 'matrix-pair'; from: string; to: string; reason: string }
  /** A whole matrix request that failed: none of its pairs were written. */
  | { kind: 'matrix-batch'; originIds: string[]; destinationIds: string[]; reason: string }
  /** A polyline Google could not give, or whose request failed. */
  | { kind: 'polyline'; from: string; to: string; reason: string };

export interface FetchSummary {
  geocoded: number;
  pairsFetched: number;
  pairsAlreadyCached: number;
  polylinesFetched: number;
  /** Calls made to the client, failed ones included. */
  requests: number;
  failures: FetchFailure[];
  /** One line per step that gave up early (see MAX_FAILED_REQUESTS_IN_A_ROW). Empty on a normal run. */
  stopped: string[];
}

export type Log = (line: string) => void;

/**
 * A step stops after this many failed requests in a row (each one already retried by the client): a wrong key,
 * a used-up quota or a dead network fails every request the same way. What was fetched so far is kept;
 * running again resumes from there.
 */
export const MAX_FAILED_REQUESTS_IN_A_ROW = 3;

const REDACTED = '[redacted]';
const MAX_REASON_LENGTH = 300;

/**
 * Removes anything that looks like a Google key from text that is logged or reported. googleClient.ts already
 * redacts its own errors with the real key; this is a second net for errors from any other client.
 */
export function scrubKeys(text: string): string {
  return text
    .replace(/([?&]key=)[^&\s"'<>]*/gi, `$1${REDACTED}`)
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${REDACTED}`)
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, REDACTED);
}

function reasonOf(err: unknown): string {
  // Only an Error's message is used: any other thrown value could hold a request, and so a key.
  const text = err instanceof Error && err.message !== '' ? err.message : 'request failed';
  return scrubKeys(text).slice(0, MAX_REASON_LENGTH);
}

/** "No route" is Google's answer for one pair, not a sign that requests are failing. */
function isNoRoute(err: unknown): boolean {
  return err instanceof GoogleApiError && err.googleStatus === 'NO_ROUTE';
}

function isPoint(value: unknown): value is LatLng {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);
}

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const has = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

export function emptySummary(): FetchSummary {
  return { geocoded: 0, pairsFetched: 0, pairsAlreadyCached: 0, polylinesFetched: 0, requests: 0, failures: [], stopped: [] };
}

/** Adds up the summaries of the steps of one run, in the order given. */
export function mergeSummaries(...parts: FetchSummary[]): FetchSummary {
  const total = emptySummary();
  for (const part of parts) {
    total.geocoded += part.geocoded;
    total.pairsFetched += part.pairsFetched;
    total.pairsAlreadyCached += part.pairsAlreadyCached;
    total.polylinesFetched += part.polylinesFetched;
    total.requests += part.requests;
    total.failures.push(...part.failures);
    total.stopped.push(...part.stopped);
  }
  return total;
}

function stopLine(step: FetchStep, done: number, total: number): string {
  return `${step}: stopped after ${MAX_FAILED_REQUESTS_IN_A_ROW} failed requests in a row; ${total - done} of ${total} requests not attempted. Run again to resume.`;
}

/**
 * Geocodes each planned business and stores the first result in `matrix.places`.
 * An address with no result is a failure and gets no coordinates.
 */
export async function runGeocodes(args: {
  plan: readonly GeocodeTarget[];
  matrix: TravelMatrixFile;
  client: Pick<FetchClient, 'geocodeAddress'>;
  log: Log;
}): Promise<{ file: TravelMatrixFile; summary: FetchSummary }> {
  const { plan, matrix, client } = args;
  const log: Log = (line) => args.log(scrubKeys(line));
  const places = { ...matrix.places };
  const summary = emptySummary();
  let failedInARow = 0;

  for (let i = 0; i < plan.length; i++) {
    const { id, address } = plan[i];
    const label = `geocode ${i + 1}/${plan.length} ${id}`;
    summary.requests++;
    let results: GeocodeResult[];
    try {
      results = await client.geocodeAddress(address);
    } catch (err) {
      const reason = reasonOf(err);
      summary.failures.push({ kind: 'geocode', placeId: id, reason });
      log(`${label}: FAILED: ${reason}`);
      if (++failedInARow >= MAX_FAILED_REQUESTS_IN_A_ROW && i + 1 < plan.length) {
        summary.stopped.push(stopLine('geocode', i + 1, plan.length));
        log(summary.stopped[summary.stopped.length - 1]);
        break;
      }
      continue;
    }
    failedInARow = 0;
    const first = Array.isArray(results) ? results[0] : undefined;
    if (!isPoint(first)) {
      const reason = 'no geocoding result for this address (ZERO_RESULTS)';
      summary.failures.push({ kind: 'geocode', placeId: id, reason });
      log(`${label}: FAILED: ${reason}`);
      continue;
    }
    const formattedAddress = typeof first.formattedAddress === 'string' ? first.formattedAddress : '';
    places[id] = formattedAddress === '' ? { lat: first.lat, lng: first.lng } : { lat: first.lat, lng: first.lng, formattedAddress };
    summary.geocoded++;
    const others = results.length > 1 ? ` (first of ${results.length} candidates)` : '';
    log(`${label}: ${first.lat}, ${first.lng} ${formattedAddress}${others}`.trimEnd());
  }

  return { file: { schemaVersion: 1, places, pairs: matrix.pairs }, summary };
}

/**
 * Fetches the planned matrix batches, one request each, and stores raw seconds and meters under `pairKey(from, to)`.
 * Business coordinates come from `matrix.places` (run the geocodes first); homes are passed with theirs and are
 * added to `places`. A home whose coordinates differ from the cached ones is reported and left alone: its cached
 * pairs belong to the old point, so mixing in new ones would be wrong.
 */
export async function runMatrix(args: {
  plan: MatrixPlan;
  matrix: TravelMatrixFile;
  homes: readonly ({ id: string } & LatLng)[];
  client: Pick<FetchClient, 'computeRouteMatrix'>;
  log: Log;
}): Promise<{ file: TravelMatrixFile; summary: FetchSummary }> {
  const { plan, matrix, homes, client } = args;
  const log: Log = (line) => args.log(scrubKeys(line));
  const places = { ...matrix.places };
  const pairs = { ...matrix.pairs };
  const summary = emptySummary();
  summary.pairsAlreadyCached = plan.cachedPairs;

  // Places whose pairs are not requested, with the reason. Each is reported once.
  const unusable = new Map<string, string>();
  const reported = new Set<string>();
  for (const home of homes) {
    // The type says a home has coordinates; a hand-edited or half-generated list may not.
    const hasPoint = Number.isFinite(home.lat) && Number.isFinite(home.lng);
    if (!hasPoint) {
      unusable.set(home.id, 'the home has no usable coordinates');
    } else if (!has(places, home.id)) {
      places[home.id] = { lat: home.lat, lng: home.lng };
    } else if (places[home.id].lat !== home.lat || places[home.id].lng !== home.lng) {
      unusable.set(
        home.id,
        `the home moved since it was cached (cached ${places[home.id].lat}, ${places[home.id].lng}; now ${home.lat}, ${home.lng}). ` +
          'Remove its entries from the cache and run again.',
      );
    }
  }
  const usable = (id: string): boolean => {
    if (!unusable.has(id) && !isPoint(places[id])) unusable.set(id, 'no coordinates for this place (geocode it, or pass the home)');
    const reason = unusable.get(id);
    if (reason === undefined) return true;
    if (!reported.has(id)) {
      reported.add(id);
      summary.failures.push({ kind: 'place', step: 'matrix', placeId: id, reason });
      log(`matrix: skipping pairs of ${id}: ${reason}`);
    }
    return false;
  };

  let failedInARow = 0;
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i];
    const originIds = batch.originIds.filter(usable);
    const destinationIds = batch.destinationIds.filter(usable);
    if (originIds.length === 0 || destinationIds.length === 0) continue;
    const label = `matrix ${i + 1}/${plan.batches.length} ${batch.block} (${originIds.length} x ${destinationIds.length})`;

    summary.requests++;
    let result: RouteMatrixResult;
    try {
      result = await client.computeRouteMatrix(
        originIds.map((id) => ({ lat: places[id].lat, lng: places[id].lng })),
        destinationIds.map((id) => ({ lat: places[id].lat, lng: places[id].lng })),
      );
    } catch (err) {
      const reason = reasonOf(err);
      summary.failures.push({ kind: 'matrix-batch', originIds, destinationIds, reason });
      log(`${label}: FAILED: ${reason}`);
      if (++failedInARow >= MAX_FAILED_REQUESTS_IN_A_ROW && i + 1 < plan.batches.length) {
        summary.stopped.push(stopLine('matrix', i + 1, plan.batches.length));
        log(summary.stopped[summary.stopped.length - 1]);
        break;
      }
      continue;
    }
    failedInARow = 0;

    // Every pair of the request ends up written or in `failures`, whatever the client returned.
    const answered = new Set<string>();
    const pairAt = (originIndex: number, destinationIndex: number): PlacePair | null => {
      const from = originIds[originIndex];
      const to = destinationIds[destinationIndex];
      if (from === undefined || to === undefined || answered.has(pairKey(from, to))) return null;
      answered.add(pairKey(from, to));
      return { from, to };
    };
    let fetched = 0;
    let failed = 0;
    for (const element of result.elements ?? []) {
      const pair = pairAt(element.originIndex, element.destinationIndex);
      if (!pair) continue;
      if (isAmount(element.durationS) && isAmount(element.distanceM)) {
        pairs[pairKey(pair.from, pair.to)] = { durationS: element.durationS, distanceM: element.distanceM };
        fetched++;
      } else {
        summary.failures.push({ kind: 'matrix-pair', ...pair, reason: 'duration or distance missing or unreadable' });
        failed++;
      }
    }
    for (const failure of result.failures ?? []) {
      const pair = pairAt(failure.originIndex, failure.destinationIndex);
      if (!pair) continue;
      const reason = scrubKeys(failure.condition ? `${failure.condition}: ${failure.message}` : failure.message).slice(0, MAX_REASON_LENGTH);
      summary.failures.push({ kind: 'matrix-pair', ...pair, reason });
      failed++;
    }
    for (const from of originIds) {
      for (const to of destinationIds) {
        if (answered.has(pairKey(from, to))) continue;
        summary.failures.push({ kind: 'matrix-pair', from, to, reason: 'no answer for this pair' });
        failed++;
      }
    }
    summary.pairsFetched += fetched;
    log(`${label}: ${fetched} pairs fetched${failed > 0 ? `, ${failed} FAILED` : ''}`);
  }

  return { file: { schemaVersion: 1, places, pairs }, summary };
}

/**
 * Fetches the planned polylines, one request each, and stores the encoded string under `pairKey(from, to)`.
 * `places` gives the coordinates: pass the `places` of the matrix file after `runMatrix`.
 * The duration and distance that come with a route are not stored; the matrix is the only source of numbers.
 */
export async function runPolylines(args: {
  plan: readonly PlacePair[];
  polylines: PolylinesFile;
  places: Readonly<Record<string, LatLng>>;
  client: Pick<FetchClient, 'computeRoutePolyline'>;
  log: Log;
}): Promise<{ file: PolylinesFile; summary: FetchSummary }> {
  const { plan, places, client } = args;
  const log: Log = (line) => args.log(scrubKeys(line));
  const polylines = { ...args.polylines.polylines };
  const summary = emptySummary();
  let failedInARow = 0;

  for (let i = 0; i < plan.length; i++) {
    const { from, to } = plan[i];
    const label = `polyline ${i + 1}/${plan.length} ${from} -> ${to}`;
    const fail = (reason: string) => {
      summary.failures.push({ kind: 'polyline', from, to, reason });
      log(`${label}: FAILED: ${reason}`);
    };
    const origin = has(places, from) ? places[from] : undefined;
    const destination = has(places, to) ? places[to] : undefined;
    if (!isPoint(origin) || !isPoint(destination)) {
      fail(`no coordinates for ${!isPoint(origin) ? from : to}`);
      continue;
    }

    summary.requests++;
    let route: RoutePolyline;
    try {
      route = await client.computeRoutePolyline({ lat: origin.lat, lng: origin.lng }, { lat: destination.lat, lng: destination.lng });
    } catch (err) {
      fail(reasonOf(err));
      if (isNoRoute(err)) {
        failedInARow = 0;
      } else if (++failedInARow >= MAX_FAILED_REQUESTS_IN_A_ROW && i + 1 < plan.length) {
        summary.stopped.push(stopLine('polyline', i + 1, plan.length));
        log(summary.stopped[summary.stopped.length - 1]);
        break;
      }
      continue;
    }
    failedInARow = 0;
    if (typeof route?.encoded !== 'string' || route.encoded === '') {
      fail('the route had no polyline');
      continue;
    }
    polylines[pairKey(from, to)] = route.encoded;
    summary.polylinesFetched++;
    // One line per polyline would be a few hundred lines; failures are always logged.
    if ((i + 1) % 25 === 0 || i + 1 === plan.length) log(`polyline ${i + 1}/${plan.length}: ${summary.polylinesFetched} fetched so far`);
  }

  return { file: { schemaVersion: 1, polylines }, summary };
}

function idRange(ids: readonly string[]): string {
  return ids.length <= 2 ? ids.join(', ') : `${ids[0]} … ${ids[ids.length - 1]}`;
}

function failureLine(failure: FetchFailure): string {
  switch (failure.kind) {
    case 'geocode':
      return `geocode ${failure.placeId}: ${failure.reason}`;
    case 'place':
      return `${failure.step} ${failure.placeId}: ${failure.reason}`;
    case 'matrix-pair':
      return `matrix ${failure.from} -> ${failure.to}: ${failure.reason}`;
    case 'matrix-batch': {
      const count = failure.originIds.length * failure.destinationIds.length;
      return `matrix request, ${count} pairs not fetched (${idRange(failure.originIds)} -> ${idRange(failure.destinationIds)}): ${failure.reason}`;
    }
    case 'polyline':
      return `polyline ${failure.from} -> ${failure.to}: ${failure.reason}`;
  }
}

/** The lines the script prints at the end. Every failure is listed; no line ever holds a key. */
export function formatSummary(summary: FetchSummary): string[] {
  const lines = [
    'Fetch summary',
    `  businesses geocoded: ${summary.geocoded}`,
    `  matrix pairs fetched: ${summary.pairsFetched}`,
    `  matrix pairs already cached: ${summary.pairsAlreadyCached}`,
    `  polylines fetched: ${summary.polylinesFetched}`,
    `  Google requests: ${summary.requests}`,
    summary.failures.length === 0 ? '  failures: none' : `  failures: ${summary.failures.length}`,
    ...summary.failures.map((failure) => `    - ${failureLine(failure)}`),
    ...summary.stopped.map((line) => `  stopped early: ${line}`),
  ];
  return lines.map(scrubKeys);
}
