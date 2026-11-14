// FakeProvider: TEST-ONLY travel data. App code (server/api, server/domain, server/index.ts) must never
// import this file: the app never invents travel times (SPEC "MVP II" rule 2). tests/geo/providers.test.ts checks it.
// Both builders fill the normal cache format and wrap it in the CachedProvider, so tests exercise the same
// lookup, rounding and "missing pair" behaviour as production.
import polyline from '@mapbox/polyline';
import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import { emptyTravelFiles } from './cache';
import type { TravelFiles } from './cache';
import { createCachedProvider } from './providers';
import type { CachedProvider } from './providers';

export interface FakePair {
  from: string;
  to: string;
  /** Whole minutes, as the matcher sees them. Stored as `durationMin * 60` seconds. */
  durationMin: number;
  distanceM: number;
}

export interface FakePolyline {
  from: string;
  to: string;
  /** Google encoded polyline, precision 5. */
  encoded: string;
}

export interface FakeProviderOptions {
  /** The explicit travel table. A pair that is not listed throws TravelDataMissingError, as in production. */
  pairs: FakePair[];
  polylines?: FakePolyline[];
  /**
   * When true, every listed A->B also answers for B->A (same numbers, polyline reversed),
   * unless B->A is listed itself. Default false: A->B and B->A are separate pairs.
   */
  symmetric?: boolean;
}

/** A CachedProvider plus the cache files behind it, so a test can add or remove pairs later. */
export type FakeProvider = CachedProvider & { files: TravelFiles };

export function createFakeProvider(options: FakeProviderOptions): FakeProvider {
  const files = emptyTravelFiles();
  const pairs = files.matrix.pairs;
  const lines = files.polylines.polylines;

  for (const pair of options.pairs) {
    const key = pairKey(pair.from, pair.to);
    if (pair.from === pair.to) throw new Error(`Fake travel table: ${key} is the same place twice (that is always 0)`);
    if (Object.hasOwn(pairs, key)) throw new Error(`Fake travel table: ${key} is listed twice`);
    if (!Number.isInteger(pair.durationMin) || pair.durationMin < 0) {
      throw new Error(`Fake travel table: ${key} needs durationMin as a whole number >= 0, got ${String(pair.durationMin)}`);
    }
    if (typeof pair.distanceM !== 'number' || !Number.isFinite(pair.distanceM) || pair.distanceM < 0) {
      throw new Error(`Fake travel table: ${key} needs distanceM >= 0, got ${String(pair.distanceM)}`);
    }
    pairs[key] = { durationS: pair.durationMin * 60, distanceM: pair.distanceM };
  }
  for (const line of options.polylines ?? []) {
    const key = pairKey(line.from, line.to);
    if (Object.hasOwn(lines, key)) throw new Error(`Fake travel table: polyline ${key} is listed twice`);
    lines[key] = line.encoded;
  }

  if (options.symmetric) {
    for (const pair of options.pairs) {
      const back = pairKey(pair.to, pair.from);
      if (!Object.hasOwn(pairs, back)) pairs[back] = { ...pairs[pairKey(pair.from, pair.to)] };
    }
    for (const line of options.polylines ?? []) {
      const back = pairKey(line.to, line.from);
      if (!Object.hasOwn(lines, back)) lines[back] = polyline.encode(polyline.decode(line.encoded).reverse());
    }
  }

  return { ...createCachedProvider(files), files };
}

export type FakePlaces = Record<string, LatLng> | ReadonlyArray<{ id: string } & LatLng>;

export interface FakeCoordsOptions {
  /** Straight-line driving speed. Default 30 km/h. */
  speedKmh?: number;
  /** Also give every pair a two-point straight polyline. Default false (`polyline` returns null). */
  polylines?: boolean;
}

export const FAKE_DEFAULT_SPEED_KMH = 30;
const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters. */
export function straightLineM(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A fake provider that knows every ordered pair of `places` (a `{ id: { lat, lng } }` record, or a list of
 * things with `id`, `lat`, `lng` such as businesses and homes). Deterministic: distance = straight-line meters,
 * rounded; seconds = distance / speed, rounded; minutes are then rounded up like real data.
 */
export function fakeProviderFromCoords(places: FakePlaces, options: FakeCoordsOptions = {}): FakeProvider {
  const speedKmh = options.speedKmh ?? FAKE_DEFAULT_SPEED_KMH;
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) throw new Error(`Fake travel: speedKmh must be > 0, got ${String(speedKmh)}`);
  const metersPerSecond = speedKmh / 3.6;

  const list: Array<{ id: string } & LatLng> = Array.isArray(places)
    ? places.map((place) => ({ id: place.id, lat: place.lat, lng: place.lng }))
    : Object.entries(places as Record<string, LatLng>).map(([id, point]) => ({ id, lat: point.lat, lng: point.lng }));

  const files = emptyTravelFiles();
  for (const place of list) {
    if (Object.hasOwn(files.matrix.places, place.id)) throw new Error(`Fake travel: place ${place.id} is listed twice`);
    files.matrix.places[place.id] = { lat: place.lat, lng: place.lng };
  }
  for (const from of list) {
    for (const to of list) {
      if (from.id === to.id) continue;
      const distanceM = Math.round(straightLineM(from, to));
      const key = pairKey(from.id, to.id);
      files.matrix.pairs[key] = { durationS: Math.round(distanceM / metersPerSecond), distanceM };
      if (options.polylines) {
        files.polylines.polylines[key] = polyline.encode([
          [from.lat, from.lng],
          [to.lat, to.lng],
        ]);
      }
    }
  }
  return { ...createCachedProvider(files), files };
}
