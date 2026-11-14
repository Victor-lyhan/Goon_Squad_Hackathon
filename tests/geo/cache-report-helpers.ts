// Hand-built travel caches for the cache-report tests. The numbers are made up for the tests (a road factor on the
// straight line at a fixed speed); nothing here is Google data and nothing here is imported by app code.
import { pairKey } from '../../shared/v2/types';
import type { Home, LatLng, PolylinesFile, TravelMatrixFile } from '../../shared/v2/types';
import { straightLineM } from '../../server/geo/cacheReport';
import type { BusinessLabel } from '../../server/geo/cacheReport';

export const BUSINESSES: BusinessLabel[] = [
  { id: 'biz-a', name: 'Alpha Press', neighborhood: 'Midtown' },
  { id: 'biz-b', name: 'Bravo Books', neighborhood: 'DUMBO' },
  { id: 'biz-c', name: 'Charlie Coffee', neighborhood: 'Long Island City' },
];
export const BUSINESS_IDS = BUSINESSES.map((business) => business.id);

export const HOMES: Home[] = [
  { id: 'home-001', neighborhood: 'Astoria', lat: 40.765, lng: -73.919 },
  { id: 'home-002', neighborhood: 'Park Slope', lat: 40.67, lng: -73.98 },
];

export type Places = TravelMatrixFile['places'];

export function cleanPlaces(): Places {
  return {
    'biz-a': { lat: 40.7616, lng: -73.9817, formattedAddress: '1 Alpha Ave, New York, NY 10019, USA' },
    'biz-b': { lat: 40.7033, lng: -73.9881, formattedAddress: '2 Bravo St, Brooklyn, NY 11201, USA' },
    'biz-c': { lat: 40.7505, lng: -73.937, formattedAddress: '3 Charlie Rd, Long Island City, NY 11101, USA' },
    'home-001': { lat: HOMES[0].lat, lng: HOMES[0].lng },
    'home-002': { lat: HOMES[1].lat, lng: HOMES[1].lng },
  };
}

export const ROAD_FACTOR = 1.4;
export const SPEED_KMH = 30;

/** A believable pair value for two points: `factor` times the straight line, driven at `speedKmh`. */
export function pairValue(a: LatLng, b: LatLng, factor = ROAD_FACTOR, speedKmh = SPEED_KMH) {
  const distanceM = Math.round(straightLineM(a, b) * factor);
  return { distanceM, durationS: Math.max(1, Math.round((distanceM / 1000 / speedKmh) * 3600)) };
}

/** Every pair the app needs (business ↔ business, home ↔ business; no home ↔ home), with believable values. */
export function fullMatrix(places: Places = cleanPlaces()): TravelMatrixFile {
  const pairs: TravelMatrixFile['pairs'] = {};
  const ids = Object.keys(places);
  for (const from of ids) {
    for (const to of ids) {
      if (from === to || (from.startsWith('home-') && to.startsWith('home-'))) continue;
      pairs[pairKey(from, to)] = pairValue(places[from], places[to]);
    }
  }
  return { schemaVersion: 1, places, pairs };
}

export const emptyMatrix = (): TravelMatrixFile => ({ schemaVersion: 1, places: {}, pairs: {} });
export const emptyPolylines = (): PolylinesFile => ({ schemaVersion: 1, polylines: {} });
