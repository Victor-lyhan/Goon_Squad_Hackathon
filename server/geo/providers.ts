// CachedProvider: the synchronous TravelProvider (shared/v2/types.ts) over the travel cache files.
// The matcher, the simulation and the API read travel times through this. It never estimates:
// a pair that is not in the cache throws TravelDataMissingError.
import { TravelDataMissingError, pairKey } from '../../shared/v2/types';
import type { LatLng, TravelProvider } from '../../shared/v2/types';
import { minutesFromSeconds } from './cache';
import type { TravelFiles } from './cache';

export type CachedProvider = TravelProvider & {
  /** True when `durationMin` and `distanceM` will answer for this ordered pair (always true for the same place). */
  has(fromPlaceId: string, toPlaceId: string): boolean;
  /** The cached coordinates of a place, or null when the cache does not know it. */
  place(placeId: string): LatLng | null;
};

/**
 * A provider over `files`. It keeps the object it was given and looks things up on every call,
 * so pairs, polylines and places added to `files` later are visible without building a new provider.
 */
export function createCachedProvider(files: TravelFiles): CachedProvider {
  const pairOf = (from: string, to: string) => {
    const pairs = files.matrix.pairs;
    const key = pairKey(from, to);
    if (!Object.hasOwn(pairs, key)) throw new TravelDataMissingError(from, to, 'matrix');
    return pairs[key];
  };

  return {
    durationMin(from, to) {
      if (from === to) return 0;
      return minutesFromSeconds(pairOf(from, to).durationS);
    },
    distanceM(from, to) {
      if (from === to) return 0;
      return pairOf(from, to).distanceM;
    },
    polyline(from, to) {
      const polylines = files.polylines.polylines;
      const key = pairKey(from, to);
      return Object.hasOwn(polylines, key) ? polylines[key] : null;
    },
    has(from, to) {
      return from === to || Object.hasOwn(files.matrix.pairs, pairKey(from, to));
    },
    place(placeId) {
      const places = files.matrix.places;
      if (!Object.hasOwn(places, placeId)) return null;
      return { lat: places[placeId].lat, lng: places[placeId].lng };
    },
  };
}
