// The runtime travel service: the one object the running server uses for travel data.
// - At start it loads the committed NYC cache (`matrix.json`, `polylines.json`) from `dir`.
// - `provider` answers the synchronous lookups (shared/v2 TravelProvider) over those files in memory.
// - A live action fetches only what it needs from Google: a new home's travel pairs on a commute save
//   (`addPlaces` + `ensurePairs`), the route lines of a newly matched delivery (`ensureLegPolylines`).
//   Every answer is written back to the cache files (SPEC "MVP II" rule 3).
// Rules:
// - nothing is ever estimated; a missing key is GoogleKeyMissingError before any request (rule 2);
// - the key is an argument (the caller reads the environment) and lives only inside the bound Google
//   client, whose errors are redacted in googleClient.ts. This file logs nothing;
// - errors built here hold place IDs and fixed text only, never a latitude or a longitude.
import { pairKey } from '../../shared/v2/types';
import type { LatLng, Leg } from '../../shared/v2/types';
import { emptyTravelFiles, readTravelFiles, writeTravelFiles } from './cache';
import type { TravelFiles } from './cache';
import { GoogleKeyMissingError } from './googleClient';
import type { FetchLike } from './googleClient';
import { bindGoogleClient, createGoogleTravel } from './googleProvider';
import type { PlacePair } from './googleProvider';
import type { CachedProvider } from './providers';

export interface TravelServiceOptions {
  /** The cache directory, e.g. `fixtures/nyc`. */
  dir: string;
  /** The Google server key. Empty or undefined: the service answers from the cache only. */
  key: string | undefined;
  /** Defaults to the global `fetch`. Tests pass a fake. */
  fetch?: FetchLike;
  /** Called after a call that added data. Defaults to `writeTravelFiles(dir, files)`. */
  persist?: (files: TravelFiles) => void | Promise<void>;
  /** Backoff sleep between Google retries. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TravelService {
  /** False when `dir` has no cache, or a cache with no pairs. The API layer answers 503 `travel_data_missing` then. */
  readonly ready: boolean;
  /** Synchronous lookups over `files`; pairs and lines fetched later are visible at once. Null when not ready. */
  readonly provider: CachedProvider | null;
  /** The cache in memory (empty when `dir` has none). Fetched data is added to this object. */
  readonly files: TravelFiles;
  /**
   * Registers coordinates in `matrix.places` (a new `home-c-…` home) so its pairs can be fetched.
   * A place that is already there with the same coordinates is left alone. Throws TravelPlaceError, and adds
   * nothing, when a place already has other coordinates or a coordinate is not a real latitude / longitude.
   * The places reach the disk with the next fetch.
   */
  addPlaces(places: Record<string, LatLng>): void;
  /**
   * Makes sure every pair has a travel time and distance. All cached: resolves with no key and no request.
   * Something missing and no key: rejects with GoogleKeyMissingError before any request. Otherwise the missing
   * pairs are fetched and the cache files are written. Google's errors pass through unchanged, and pairs that
   * did get an answer stay cached (in memory and on disk).
   */
  ensurePairs(pairs: readonly PlacePair[]): Promise<{ fetched: number }>;
  /** The same for encoded route lines. */
  ensurePolylines(pairs: readonly PlacePair[]): Promise<{ fetched: number }>;
  /**
   * Route lines for the neighbouring pairs of each leg's `placeIds`. Best effort, for the map only: it never
   * rejects. `fetched` and `failed` count the distinct pairs that had no line when it was called: the ones
   * that have a line now, and the ones that still have none (those legs stay on the straight-line fallback).
   */
  ensureLegPolylines(legs: readonly Pick<Leg, 'placeIds'>[]): Promise<{ fetched: number; failed: number }>;
}

/** A place could not be registered: it already has other coordinates, or its ID or coordinates are not usable. */
export class TravelPlaceError extends Error {
  readonly placeIds: string[];
  constructor(problem: 'conflict' | 'invalid', placeIds: string[]) {
    super(
      problem === 'conflict'
        ? `Place(s) already in the travel cache with other coordinates: ${placeIds.join(', ')}. A place never moves; a new point needs a new place ID.`
        : `Place(s) without a usable ID, latitude or longitude: ${placeIds.map((id) => JSON.stringify(id)).join(', ')}.`,
    );
    this.name = 'TravelPlaceError';
    this.placeIds = placeIds;
  }
}

/**
 * A fetch was asked of a service that is not ready. The cache is built by `npm run fetch:routes`, never by a
 * live action, so a service without one calls nothing and writes nothing.
 */
export class TravelNotLoadedError extends Error {
  constructor() {
    super('NYC travel data is not loaded. Run npm run fetch:routes and commit fixtures/nyc/.');
    this.name = 'TravelNotLoadedError';
  }
}

/** Reads the cache in `dir` and builds the service. Throws TravelCacheError when the cache is corrupt (it is never replaced). */
export function createTravelService(options: TravelServiceOptions): TravelService {
  const { dir } = options;
  const apiKey = typeof options.key === 'string' ? options.key.trim() : '';
  const files = readTravelFiles(dir) ?? emptyTravelFiles();
  const ready = Object.keys(files.matrix.pairs).length > 0;

  // One GoogleTravel for everything, so there is one queue: one Google fetch at a time across all methods.
  // With an empty key the client is never called: `ensure` rejects first.
  const google = createGoogleTravel({
    files,
    client: bindGoogleClient({ apiKey, fetchImpl: options.fetch, sleep: options.sleep }),
    persist: options.persist ?? ((current) => writeTravelFiles(dir, current)),
  });

  /** The distinct pairs of different places that `cached` does not hold. */
  const missingFrom = (pairs: readonly PlacePair[], cached: Record<string, unknown>): PlacePair[] => {
    const missing = new Map<string, PlacePair>();
    for (const { from, to } of pairs) {
      const key = pairKey(from, to);
      if (from !== to && !Object.hasOwn(cached, key)) missing.set(key, { from, to });
    }
    return [...missing.values()];
  };

  const ensure = async (
    pairs: readonly PlacePair[],
    cached: Record<string, unknown>,
    fetchMissing: (pairs: PlacePair[]) => Promise<{ fetched: number }>,
  ): Promise<{ fetched: number }> => {
    if (!ready) throw new TravelNotLoadedError();
    if (apiKey === '' && missingFrom(pairs, cached).length > 0) throw new GoogleKeyMissingError();
    // Checks the cache again in its turn in the queue, so an overlapping call never buys the same pair twice.
    return fetchMissing([...pairs]);
  };

  const hasPlace = (placeId: string) => Object.hasOwn(files.matrix.places, placeId);

  return {
    ready,
    provider: ready ? google.provider : null,
    files,

    addPlaces(places) {
      if (!ready) throw new TravelNotLoadedError();
      const invalid: string[] = [];
      const conflicts: string[] = [];
      const fresh: [string, LatLng][] = [];
      for (const [id, point] of Object.entries(places)) {
        if (id === '' || id.includes('|') || !isCoordinate(point?.lat, 90) || !isCoordinate(point?.lng, 180)) {
          invalid.push(id);
        } else if (!hasPlace(id)) {
          fresh.push([id, { lat: point.lat, lng: point.lng }]);
        } else if (files.matrix.places[id].lat !== point.lat || files.matrix.places[id].lng !== point.lng) {
          conflicts.push(id);
        }
      }
      if (invalid.length > 0) throw new TravelPlaceError('invalid', invalid.sort());
      if (conflicts.length > 0) throw new TravelPlaceError('conflict', conflicts.sort());
      for (const [id, point] of fresh) files.matrix.places[id] = point;
    },

    ensurePairs: (pairs) => ensure(pairs, files.matrix.pairs, google.ensurePairs),
    ensurePolylines: (pairs) => ensure(pairs, files.polylines.polylines, google.ensurePolylines),

    async ensureLegPolylines(legs) {
      let wanted: PlacePair[] = [];
      try {
        const lines = files.polylines.polylines;
        wanted = missingFrom(legPairs(legs), lines);
        // A pair with an unknown place cannot be fetched; it must not stop the other legs' lines.
        const fetchable = wanted.filter(({ from, to }) => hasPlace(from) && hasPlace(to));
        if (ready && apiKey !== '' && fetchable.length > 0) {
          // Lines fetched before a failure are already in `files` (and on disk); the count below sees them.
          await google.ensurePolylines(fetchable).catch(() => undefined);
        }
        const fetched = wanted.filter(({ from, to }) => Object.hasOwn(lines, pairKey(from, to))).length;
        return { fetched, failed: wanted.length - fetched };
      } catch {
        return { fetched: 0, failed: wanted.length };
      }
    },
  };
}

/** The neighbouring pairs of each leg's `placeIds`, in travel order. */
function legPairs(legs: readonly Pick<Leg, 'placeIds'>[]): PlacePair[] {
  const pairs: PlacePair[] = [];
  for (const leg of legs) {
    for (let i = 0; i + 1 < leg.placeIds.length; i++) pairs.push({ from: leg.placeIds[i], to: leg.placeIds[i + 1] });
  }
  return pairs;
}

function isCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}
