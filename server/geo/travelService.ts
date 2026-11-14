// The runtime travel service: the one object the running server uses for travel data.
// - At start it loads the committed NYC cache (`matrix.json`, `polylines.json`) from `dir`.
// - `provider` answers the synchronous lookups (shared/v2 TravelProvider) over those files in memory.
// - A live action fetches only what it needs from Google: a new home's travel pairs on a commute save
//   (`addPlaces` + `ensurePairs`), the route lines of a newly matched delivery (`ensureLegPolylines`).
//   Every answer is written back to the cache files (SPEC "MVP II" rule 3).
// - A refused pair fetch leaves nothing behind: a place registered here that has no travel pair is taken out
//   again, and is never written to the cache files while it has none (SPEC rule 6, DECISIONS pass 56).
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
   * A new place reaches the disk with the first cache write after it got a travel pair, never before. Until
   * then a rejected `ensurePairs` removes it again (see there), so call `ensurePairs` right after this.
   */
  addPlaces(places: Record<string, LatLng>): void;
  /**
   * Makes sure every pair has a travel time and distance. All cached: resolves with no key and no request.
   * Something missing and no key: rejects with GoogleKeyMissingError before any request. Otherwise the missing
   * pairs are fetched and the cache files are written. Google's errors pass through unchanged, and pairs that
   * did get an answer stay cached (in memory and on disk).
   * When it rejects, every place that `addPlaces` registered in this process, that is not on disk yet and that
   * has no pair at all is removed from `files.matrix.places` (with any route line of it) before the caller sees
   * the rejection, so the same point can be registered and fetched again. A place that got some of its pairs
   * stays: a retry fills the rest. A place that another `ensurePairs` call still in progress asks for stays
   * too; that call decides. Places from the cache files are never removed.
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

  // Places that `addPlaces` registered in this process and that no cache write has put on disk yet.
  // Only these can be rolled back; a place that was in the cache at start is never in this set.
  const unsaved = new Set<string>();
  // How many `ensurePairs` calls in progress name each place. A place another call still waits for is not rolled back.
  const claims = new Map<string, number>();

  /** The places of `ids` that have at least one travel pair, in either direction. */
  const withPair = (ids: ReadonlySet<string>): Set<string> => {
    const found = new Set<string>();
    if (ids.size === 0) return found;
    for (const key of Object.keys(files.matrix.pairs)) {
      const cut = key.indexOf('|'); // a place ID never holds '|' (see addPlaces)
      const from = key.slice(0, cut);
      const to = key.slice(cut + 1);
      if (ids.has(from)) found.add(from);
      if (ids.has(to)) found.add(to);
    }
    return found;
  };

  /**
   * Writes the cache without the unsaved places that have no pair yet (their fetch may still be refused), so
   * a typed address without travel data never reaches matrix.json, whichever call writes first.
   */
  const write = options.persist ?? ((current: TravelFiles) => writeTravelFiles(dir, current));
  const persist = async (current: TravelFiles): Promise<void> => {
    const written = withPair(unsaved);
    const held = [...unsaved].filter((id) => !written.has(id));
    if (held.length === 0) {
      await write(current);
    } else {
      const places = { ...current.matrix.places };
      for (const id of held) delete places[id];
      await write({ ...current, matrix: { ...current.matrix, places } });
    }
    for (const id of written) unsaved.delete(id); // on disk now: they stay for good
  };

  /** After a rejected pair fetch: takes out every unsaved place that has no pair and that no other call waits for. */
  const rollBack = (): void => {
    const open = new Set([...unsaved].filter((id) => !claims.has(id)));
    const paired = withPair(open);
    const removed = new Set([...open].filter((id) => !paired.has(id)));
    if (removed.size === 0) return;
    for (const id of removed) {
      delete files.matrix.places[id];
      unsaved.delete(id);
    }
    // A route line of a removed place (only there if its own write failed) would still describe the point.
    const lines = files.polylines.polylines;
    for (const key of Object.keys(lines)) {
      const cut = key.indexOf('|');
      if (removed.has(key.slice(0, cut)) || removed.has(key.slice(cut + 1))) delete lines[key];
    }
  };

  // One GoogleTravel for everything, so there is one queue: one Google fetch at a time across all methods.
  // With an empty key the client is never called: `ensure` rejects first.
  const google = createGoogleTravel({
    files,
    client: bindGoogleClient({ apiKey, fetchImpl: options.fetch, sleep: options.sleep }),
    persist,
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
      for (const [id, point] of fresh) {
        files.matrix.places[id] = point;
        unsaved.add(id);
      }
    },

    async ensurePairs(pairs) {
      // Claimed before the first await, so a call that fails while this one waits in the queue leaves its places alone.
      const named = new Set(pairs.flatMap(({ from, to }) => [from, to]));
      for (const id of named) claims.set(id, (claims.get(id) ?? 0) + 1);
      const release = () => {
        for (const id of named) {
          const left = (claims.get(id) ?? 1) - 1;
          if (left > 0) claims.set(id, left);
          else claims.delete(id);
        }
      };
      try {
        const result = await ensure(pairs, files.matrix.pairs, google.ensurePairs);
        release();
        return result;
      } catch (err) {
        release();
        rollBack();
        throw err;
      }
    },
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
