// Edits to the travel cache for a place that moved after the paid route fetch. The cache is keyed by place ID, so a
// moved home (or a business whose address was corrected) would keep the old point's travel times: a stale time is
// an invented time (SPEC "MVP II" rule 2). A moved place is never patched: it is dropped with every pair and route
// line that touches it, and the next `npm run fetch:routes` refills only that place (re-running skips cached pairs).
// Pure: plain cache objects in, new plain objects and text lines out. No fs, no environment, no network, no logging.

import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import type { TravelFiles } from './cache';
import { straightLineM } from './cacheReport';

export interface CacheEditResult {
  /** The cache without the dropped places. Always new objects; the input is never changed. */
  files: TravelFiles;
  /** The requested IDs that were in the cache and are now gone, de-duplicated and sorted. */
  dropped: string[];
  /** How many entries were removed. A pair between two dropped places counts once. */
  removed: { places: number; pairs: number; polylines: number };
  /** The requested IDs the cache holds nothing for, de-duplicated and sorted. Nothing was changed for them. */
  unknown: string[];
}

const has = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/** De-duplicated, in code-unit order (the same on every machine). */
const sortedUnique = (ids: readonly string[]) => [...new Set(ids)].sort();

/**
 * True when `key` is a pair key with `id` as its origin or its destination. Built from the one `pairKey` format,
 * separator included, so `home-1` matches `home-1|biz-a` and `biz-a|home-1` but never `home-10|biz-a`.
 */
function touches(key: string, id: string): boolean {
  return key.startsWith(pairKey(id, '')) || key.endsWith(pairKey('', id));
}

/**
 * Drops each place in `placeIds` from the cache: its entry in `matrix.places`, every pair with it as origin or
 * destination, and every route line the same way. An ID the cache holds nothing for goes to `unknown`.
 * A place whose `places` entry is already gone but that still has pairs or route lines counts as in the cache,
 * so its leftovers are removed too (they would be stale all the same).
 */
export function dropPlaces(files: TravelFiles, placeIds: readonly string[]): CacheEditResult {
  const { matrix, polylines } = files;
  const requested = sortedUnique(placeIds);
  const pairKeys = Object.keys(matrix.pairs);
  const polylineKeys = Object.keys(polylines.polylines);
  const inCache = (id: string) =>
    id !== '' && (has(matrix.places, id) || pairKeys.some((key) => touches(key, id)) || polylineKeys.some((key) => touches(key, id)));

  const dropped = requested.filter(inCache);
  const unknown = requested.filter((id) => !inCache(id));
  const goes = new Set(dropped);
  const touched = (key: string) => dropped.some((id) => touches(key, id));

  const places = Object.entries(matrix.places).filter(([id]) => !goes.has(id));
  const pairs = Object.entries(matrix.pairs).filter(([key]) => !touched(key));
  const lines = Object.entries(polylines.polylines).filter(([key]) => !touched(key));

  return {
    files: {
      matrix: {
        ...matrix,
        places: Object.fromEntries(places.map(([id, place]) => [id, { ...place }])),
        pairs: Object.fromEntries(pairs.map(([key, pair]) => [key, { ...pair }])),
      },
      polylines: { ...polylines, polylines: Object.fromEntries(lines) },
    },
    dropped,
    removed: {
      places: Object.keys(matrix.places).length - places.length,
      pairs: pairKeys.length - pairs.length,
      polylines: polylineKeys.length - lines.length,
    },
    unknown,
  };
}

export interface MovedHome {
  id: string;
  /** The point the cached travel times were fetched for. */
  cached: LatLng;
  /** The home's point now (fixtures or generator). */
  current: LatLng;
  /** Straight-line distance between the two, in meters. */
  movedM: number;
}

export interface MovedHomesInput {
  files: Pick<TravelFiles, 'matrix'>;
  /** The current homes: the story homes and the pool. If an ID is listed twice, the first one counts. */
  homes: readonly ({ id: string } & LatLng)[];
  /** A home counts as moved when it is MORE than this many meters from its cached point. Default 1. */
  toleranceM?: number;
}

/** The types say every point has numbers; a hand-edited file or a half-generated list may not. */
const isPoint = (value: { lat?: unknown; lng?: unknown } | undefined): boolean =>
  value !== undefined && value !== null && Number.isFinite(value.lat) && Number.isFinite(value.lng);

/**
 * The homes whose cached point is no longer where the home is, sorted by ID. Their cached travel times belong to
 * the old point, so they should go through `dropPlaces` and be fetched again.
 * A home that is not in the cache is not listed: nothing is stale for it, and the fetch plan already has it as missing.
 */
export function movedHomes({ files, homes, toleranceM = 1 }: MovedHomesInput): MovedHome[] {
  if (!Number.isFinite(toleranceM) || toleranceM < 0) {
    throw new RangeError(`toleranceM must be a non-negative number of meters, got ${String(toleranceM)}`);
  }
  const places = files.matrix.places;
  const seen = new Set<string>();
  const moved: MovedHome[] = [];
  for (const home of homes) {
    if (seen.has(home.id)) continue;
    seen.add(home.id);
    if (!has(places, home.id)) continue;
    const cached = places[home.id];
    // A point that is not a number can't be compared, and "not moved" would be a guess. The message has no coordinates.
    if (!isPoint(home)) throw new RangeError(`Home ${home.id} has no usable coordinates`);
    if (!isPoint(cached)) throw new RangeError(`The cached place ${home.id} has no usable coordinates`);
    const movedM = straightLineM(cached, home);
    if (movedM > toleranceM) {
      moved.push({ id: home.id, cached: { lat: cached.lat, lng: cached.lng }, current: { lat: home.lat, lng: home.lng }, movedM });
    }
  }
  return moved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The lines the fetch script prints after a drop: one line for what was dropped, then one per unknown ID.
 * Only place IDs and counts: no coordinates and no addresses.
 */
export function formatCacheEdit(result: Pick<CacheEditResult, 'dropped' | 'removed' | 'unknown'>): string[] {
  const { dropped, removed, unknown } = result;
  const lines: string[] = [];
  if (dropped.length > 0) {
    lines.push(
      `Dropped ${dropped.join(', ')}: ${plural(removed.places, 'place')}, ${plural(removed.pairs, 'pair')}, ` +
        `${plural(removed.polylines, 'route line')}. Run fetch:routes to refill.`,
    );
  }
  for (const id of unknown) lines.push(`Not in the travel cache: ${id}. Nothing was dropped for it.`);
  if (lines.length === 0) lines.push('Nothing to drop: no place ID was given.');
  return lines;
}
