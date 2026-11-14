// A small, complete travel cache for the cache-edit tests: 3 businesses, 3 homes, 4 employees. The numbers are made
// up for the tests; nothing here is Google data and nothing here is imported by app code.
import { pairKey } from '../../shared/v2/types';
import type { TravelFiles } from '../../server/geo/cache';
import { commutePairs } from '../../server/geo/fetchPlan';
import type { PlacePair } from '../../server/geo/fetchPlan';

export const BUSINESSES = [
  { id: 'biz-a', address: '1 Alpha Ave, New York, NY' },
  { id: 'biz-b', address: '2 Bravo St, Brooklyn, NY' },
  { id: 'biz-c', address: '3 Charlie Rd, Long Island City, NY' },
];
export const BUSINESS_IDS = BUSINESSES.map((business) => business.id);

/** `home-1` is a prefix of `home-10` on purpose. */
export const HOMES = [
  { id: 'home-1', lat: 40.765, lng: -73.919 },
  { id: 'home-10', lat: 40.67, lng: -73.98 },
  { id: 'home-story-harlem-2', lat: 40.813, lng: -73.9433 },
];
export const HOME_IDS = HOMES.map((home) => home.id);

export const EMPLOYEES = [
  { businessId: 'biz-a', homeId: 'home-1' },
  { businessId: 'biz-b', homeId: 'home-10' },
  { businessId: 'biz-c', homeId: 'home-story-harlem-2' },
  { businessId: 'biz-a', homeId: 'home-story-harlem-2' },
];

/** The route lines the fetch asks for: both directions of every commute, plus one stretch of a matched plan. */
export const WANTED_LINES: PlacePair[] = [...commutePairs(EMPLOYEES), { from: 'biz-a', to: 'biz-b' }];

/** Every pair the app needs (business ↔ business, home ↔ business; no home ↔ home): 6 + 18 = 24. */
export function neededPairKeys(): string[] {
  const keys: string[] = [];
  for (const a of BUSINESS_IDS) for (const b of BUSINESS_IDS) if (a !== b) keys.push(pairKey(a, b));
  for (const home of HOME_IDS) for (const business of BUSINESS_IDS) keys.push(pairKey(home, business), pairKey(business, home));
  return keys;
}

/** A cache with nothing missing: 6 places, 24 pairs, 9 route lines. Fresh objects on every call. */
export function completeFiles(): TravelFiles {
  const files: TravelFiles = {
    matrix: {
      schemaVersion: 1,
      places: {
        'biz-a': { lat: 40.7616, lng: -73.9817, formattedAddress: '1 Alpha Ave, New York, NY 10019, USA' },
        'biz-b': { lat: 40.7033, lng: -73.9881, formattedAddress: '2 Bravo St, Brooklyn, NY 11201, USA' },
        'biz-c': { lat: 40.7505, lng: -73.937, formattedAddress: '3 Charlie Rd, Long Island City, NY 11101, USA' },
      },
      pairs: {},
    },
    polylines: { schemaVersion: 1, polylines: {} },
  };
  for (const home of HOMES) files.matrix.places[home.id] = { lat: home.lat, lng: home.lng };
  neededPairKeys().forEach((key, i) => {
    files.matrix.pairs[key] = { durationS: 600 + 7 * i, distanceM: 4000 + 13 * i }; // a different value per pair
  });
  for (const { from, to } of WANTED_LINES) files.polylines.polylines[pairKey(from, to)] = `line:${from}>${to}`;
  return files;
}

/** The slow, obvious way to say what a drop must leave behind: split every key and compare whole IDs. */
export function withoutPlaces(files: TravelFiles, ids: readonly string[]): TravelFiles {
  const out = structuredClone(files);
  const gone = (key: string) => key.split('|').some((id) => ids.includes(id));
  for (const id of ids) delete out.matrix.places[id];
  for (const key of Object.keys(out.matrix.pairs)) if (gone(key)) delete out.matrix.pairs[key];
  for (const key of Object.keys(out.polylines.polylines)) if (gone(key)) delete out.polylines.polylines[key];
  return out;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ---------- homes entered in the commute editor ----------

/**
 * Two homes as the commute editor names them: `home-c-<lat>_<lng>`, 5 decimals (shared/v2/types.ts).
 * Made-up points on round numbers; neither is anybody's address.
 */
export const ENTERED_HOMES = [
  { id: 'home-c-40.70000_-73.90000', lat: 40.7, lng: -73.9 },
  { id: 'home-c-40.80000_-73.95000', lat: 40.8, lng: -73.95 },
];
export const ENTERED_HOME_IDS = ENTERED_HOMES.map((home) => home.id);

/** Anything that looks like the coordinates inside an entered-home ID, or the ID itself. A printed line must not match. */
export const ENTERED_ID_PATTERN = /home-c-\d|\d{2}\.\d{5}/;

/**
 * A copy of `files` after a live commute save for each home (server/api/v2 `commuteRoutes.ts`): the place, its
 * pairs with every business in both directions, and the two route lines of its commute to `employerId`.
 * Per home that is 1 place, `2 x businessIds.length` pairs and 2 route lines.
 */
export function withEnteredHomes(
  files: TravelFiles,
  businessIds: readonly string[],
  employerId: string = businessIds[0],
  homes: readonly { id: string; lat: number; lng: number }[] = ENTERED_HOMES,
): TravelFiles {
  const out = structuredClone(files);
  homes.forEach((home, h) => {
    out.matrix.places[home.id] = { lat: home.lat, lng: home.lng };
    businessIds.forEach((business, b) => {
      out.matrix.pairs[pairKey(home.id, business)] = { durationS: 900 + 60 * h + b, distanceM: 7000 + 100 * h + b };
      out.matrix.pairs[pairKey(business, home.id)] = { durationS: 960 + 60 * h + b, distanceM: 7100 + 100 * h + b };
    });
    out.polylines.polylines[pairKey(home.id, employerId)] = `line:entered-${h}>work`;
    out.polylines.polylines[pairKey(employerId, home.id)] = `line:work>entered-${h}`;
  });
  return out;
}
