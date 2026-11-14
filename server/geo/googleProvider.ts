// GoogleProvider: the live travel source. It fills the travel cache from Google in an async step
// (`ensurePairs`, `ensurePolylines`); the synchronous lookups then go through the CachedProvider over the
// same files (DECISIONS pass 44). Rules:
// - only pairs missing from the cache are requested, and exactly those (no extra matrix elements);
// - raw Google seconds and meters are stored; nothing is ever estimated;
// - this file never sees the key: `client` is already bound to its options, and the errors of
//   googleClient.ts are redacted there. Errors built here hold only place IDs and those redacted messages.
import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import type { TravelFiles } from './cache';
import { GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL, computeRouteMatrix, computeRoutePolyline } from './googleClient';
import type { GoogleClientOptions, RouteMatrixResult, RoutePolyline } from './googleClient';
import { createCachedProvider } from './providers';
import type { CachedProvider } from './providers';

/** `computeRouteMatrix` and `computeRoutePolyline` of googleClient.ts, already bound to their options. */
export interface GoogleTravelClient {
  computeRouteMatrix(origins: LatLng[], destinations: LatLng[]): Promise<RouteMatrixResult>;
  computeRoutePolyline(origin: LatLng, destination: LatLng): Promise<RoutePolyline>;
}

/** Binds the two Routes calls of googleClient.ts to one set of options (key, fetch, sleep, timeout, retries, deadline). */
export function bindGoogleClient(options: GoogleClientOptions): GoogleTravelClient {
  return {
    computeRouteMatrix: (origins, destinations) => computeRouteMatrix(origins, destinations, options),
    computeRoutePolyline: (origin, destination) => computeRoutePolyline(origin, destination, options),
  };
}

export interface PlacePair {
  from: string;
  to: string;
}

export interface TravelRouteFailure extends PlacePair {
  what: 'matrix' | 'polyline';
  /** Why there is no data, e.g. "no route between these points". Never holds a key. */
  reason: string;
}

/**
 * Google answered, but gave no usable route for some pairs. Those pairs are NOT in the cache.
 * It is a GoogleApiError (`googleStatus: 'NO_ROUTE'`), so code that already handles Google failures handles it too.
 */
export class TravelRouteError extends GoogleApiError {
  readonly failures: TravelRouteFailure[];
  constructor(what: 'matrix' | 'polyline', failures: TravelRouteFailure[], requested: number) {
    const shown = failures.slice(0, 5).map((f) => `${pairKey(f.from, f.to)} (${f.reason})`);
    const more = failures.length > shown.length ? `; and ${failures.length - shown.length} more` : '';
    super({
      status: 200,
      googleStatus: 'NO_ROUTE',
      endpoint: what === 'matrix' ? ROUTE_MATRIX_URL : ROUTES_URL,
      message: `no ${what === 'matrix' ? 'travel time' : 'route line'} for ${failures.length} of ${requested} requested pair(s): ${shown.join('; ')}${more}`,
    });
    this.name = 'TravelRouteError';
    this.failures = failures;
  }
}

/** A pair names a place that has no coordinates in `files.matrix.places`. Nothing was requested from Google. */
export class TravelPlaceMissingError extends Error {
  readonly placeIds: string[];
  constructor(placeIds: string[]) {
    super(
      `No coordinates in the travel cache for place(s): ${placeIds.join(', ')}. ` +
        'Add them to matrix.json `places` (geocode the business, or store the home point) before fetching travel data.',
    );
    this.name = 'TravelPlaceMissingError';
    this.placeIds = placeIds;
  }
}

export interface GoogleTravelOptions {
  /** The cache in memory. Fetched data is written into this object. */
  files: TravelFiles;
  client: GoogleTravelClient;
  /** Called once after a call that added data, e.g. `(files) => writeTravelFiles(dir, files)`. */
  persist?: (files: TravelFiles) => void | Promise<void>;
}

export interface GoogleTravel {
  /** Synchronous lookups over the same `files`; sees fetched pairs at once. */
  provider: CachedProvider;
  /**
   * Makes sure every pair has a duration and distance in `files.matrix.pairs`, fetching only the missing ones.
   * Rejects with TravelPlaceMissingError (before any request) when a place has no coordinates, with
   * TravelRouteError when Google has no route for a pair, or with the client's own error. Pairs that did get
   * an answer are kept and persisted even when the call rejects; a failed pair is never written.
   * `via` replaces the client for this one call: the travel service passes one bound to the call's deadline.
   */
  ensurePairs(pairs: PlacePair[], via?: GoogleTravelClient): Promise<{ fetched: number }>;
  /** The same for encoded route lines in `files.polylines.polylines` (one Google request per missing pair). */
  ensurePolylines(pairs: PlacePair[], via?: GoogleTravelClient): Promise<{ fetched: number }>;
}

export function createGoogleTravel({ files, client, persist }: GoogleTravelOptions): GoogleTravel {
  // One fetch at a time: a second call waits, then finds the first call's pairs in the cache instead of buying them again.
  // The queue belongs to this object. Two GoogleTravel objects over the same `files` do not wait for each other.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Distinct pairs of different places that `cached` does not hold yet, sorted, after checking their coordinates. */
  const missingPairs = (pairs: PlacePair[], cached: Record<string, unknown>): PlacePair[] => {
    const missing = new Map<string, PlacePair>();
    for (const { from, to } of pairs) {
      const key = pairKey(from, to);
      if (from !== to && !Object.hasOwn(cached, key)) missing.set(key, { from, to });
    }
    const unknown = new Set<string>();
    for (const { from, to } of missing.values()) {
      for (const id of [from, to]) if (!Object.hasOwn(files.matrix.places, id)) unknown.add(id);
    }
    if (unknown.size > 0) throw new TravelPlaceMissingError([...unknown].sort());
    return [...missing.keys()].sort().map((key) => missing.get(key)!);
  };

  const pointOf = (placeId: string): LatLng => {
    const place = files.matrix.places[placeId];
    return { lat: place.lat, lng: place.lng };
  };

  /** Runs `fetchAll`, persists once if it added anything (even when it then fails), and reports route failures. */
  const run = async (
    what: 'matrix' | 'polyline',
    requested: number,
    fetchAll: (state: { fetched: number; failures: TravelRouteFailure[] }) => Promise<void>,
  ): Promise<{ fetched: number }> => {
    const state = { fetched: 0, failures: [] as TravelRouteFailure[] };
    try {
      await fetchAll(state);
    } finally {
      if (state.fetched > 0 && persist) await persist(files);
    }
    if (state.failures.length > 0) throw new TravelRouteError(what, state.failures, requested);
    return { fetched: state.fetched };
  };

  const ensurePairs = (pairs: PlacePair[], via: GoogleTravelClient = client) =>
    inTurn(async () => {
      const missing = missingPairs(pairs, files.matrix.pairs);
      if (missing.length === 0) return { fetched: 0 };
      return run('matrix', missing.length, async (state) => {
        for (const { origins, destinations } of matrixRequests(missing)) {
          const result = await via.computeRouteMatrix(origins.map(pointOf), destinations.map(pointOf));
          const open = new Set<string>();
          for (const from of origins) for (const to of destinations) open.add(pairKey(from, to));
          const take = (originIndex: number, destinationIndex: number): PlacePair | null => {
            const from = origins[originIndex];
            const to = destinations[destinationIndex];
            if (from === undefined || to === undefined || !open.delete(pairKey(from, to))) return null;
            return { from, to };
          };

          for (const element of result.elements) {
            const pair = take(element.originIndex, element.destinationIndex);
            if (!pair) continue;
            if (isAmount(element.durationS) && isAmount(element.distanceM)) {
              files.matrix.pairs[pairKey(pair.from, pair.to)] = { durationS: element.durationS, distanceM: element.distanceM };
              state.fetched += 1;
            } else {
              state.failures.push({ ...pair, what: 'matrix', reason: 'Google sent an unreadable duration or distance' });
            }
          }
          for (const failure of result.failures) {
            const pair = take(failure.originIndex, failure.destinationIndex);
            if (pair) state.failures.push({ ...pair, what: 'matrix', reason: failure.message });
          }
          // A pair with no answer at all is a failure too, never a silent gap.
          for (const from of origins) {
            for (const to of destinations) {
              if (open.has(pairKey(from, to))) state.failures.push({ from, to, what: 'matrix', reason: 'Google returned no answer for this pair' });
            }
          }
        }
      });
    });

  const ensurePolylines = (pairs: PlacePair[], via: GoogleTravelClient = client) =>
    inTurn(async () => {
      const missing = missingPairs(pairs, files.polylines.polylines);
      if (missing.length === 0) return { fetched: 0 };
      return run('polyline', missing.length, async (state) => {
        for (const { from, to } of missing) {
          // Another queue over the same `files` may have fetched this line since this call's turn began (the
          // travel service has one queue per kind of call). Then it is not bought again.
          if (Object.hasOwn(files.polylines.polylines, pairKey(from, to))) continue;
          try {
            const route = await via.computeRoutePolyline(pointOf(from), pointOf(to));
            if (typeof route.encoded !== 'string' || route.encoded === '') {
              state.failures.push({ from, to, what: 'polyline', reason: 'Google sent an empty route line' });
              continue;
            }
            files.polylines.polylines[pairKey(from, to)] = route.encoded;
            state.fetched += 1;
          } catch (err) {
            // "No route for this pair" is about the pair: note it and go on. Anything else (key, quota, network) stops the run.
            if (!(err instanceof GoogleApiError) || err.googleStatus !== 'NO_ROUTE') throw err;
            state.failures.push({ from, to, what: 'polyline', reason: 'no route between these points' });
          }
        }
      });
    });

  return { provider: createCachedProvider(files), ensurePairs, ensurePolylines };
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Turns a list of pairs into origins x destinations requests that cover exactly those pairs:
 * origins that need the same set of destinations share one request. Order is deterministic.
 */
export function matrixRequests(pairs: PlacePair[]): { origins: string[]; destinations: string[] }[] {
  const byOrigin = new Map<string, Set<string>>();
  for (const { from, to } of pairs) {
    if (!byOrigin.has(from)) byOrigin.set(from, new Set());
    byOrigin.get(from)!.add(to);
  }
  const requests = new Map<string, { origins: string[]; destinations: string[] }>();
  for (const origin of [...byOrigin.keys()].sort()) {
    const destinations = [...byOrigin.get(origin)!].sort();
    const signature = JSON.stringify(destinations);
    const request = requests.get(signature);
    if (request) request.origins.push(origin);
    else requests.set(signature, { origins: [origin], destinations });
  }
  return [...requests.values()];
}
