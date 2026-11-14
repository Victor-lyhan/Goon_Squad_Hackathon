// A complete travel cache for the boot tests, built in memory. TEST DATA ONLY: the business coordinates
// below are made up (rough points on a 0.01-degree grid, not geocoded addresses) and every time and
// distance comes from a straight line at a fixed speed. The app never does this (SPEC "MVP II" rule 2);
// it is the same approach as tests/domain/matching-v2-workload.ts.
// Like the real cache it has every ordered business/business and home/business pair and no home/home pair.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairKey, type Home, type LatLng, type Run as RunV2, type TravelProvider } from '../../shared/v2/types';
import { emptyTravelFiles, type TravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import { straightLineM } from '../../server/geo/fakeProvider';
import { generateHomePool } from '../../server/domain/v2/generator';
import { readNycFixtures, type NycFixtures, type Places } from '../../server/api/v2/bootRun';

export const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');

// Made-up points, one per business in fixtures/nyc/businesses.json.
const MADE_UP_BUSINESS_POINTS: Record<string, LatLng> = {
  'biz-penguin-random-house': { lat: 40.77, lng: -73.98 },
  'biz-mcgraw-hill': { lat: 40.76, lng: -73.98 },
  'biz-bh-photo': { lat: 40.75, lng: -74.0 },
  'biz-starbucks-reserve': { lat: 40.74, lng: -74.0 },
  'biz-century-21': { lat: 40.71, lng: -74.01 },
  'biz-blue-bottle-wall': { lat: 40.71, lng: -74.0 },
  'biz-zabars': { lat: 40.79, lng: -73.98 },
  'biz-levain-uws': { lat: 40.78, lng: -73.98 },
  'biz-etsy': { lat: 40.7, lng: -73.99 },
  'biz-powerhouse-arena': { lat: 40.7, lng: -73.98 },
  'biz-brooklyn-roasting': { lat: 40.7, lng: -73.97 },
  'biz-mast-brothers': { lat: 40.72, lng: -73.96 },
  'biz-community-bookstore': { lat: 40.67, lng: -73.98 },
  'biz-wework-montague': { lat: 40.69, lng: -73.99 },
  'biz-jetblue': { lat: 40.75, lng: -73.94 },
  'biz-sweetleaf': { lat: 40.74, lng: -73.95 },
  'biz-titan-foods': { lat: 40.77, lng: -73.92 },
  'biz-kinship-coffee': { lat: 40.76, lng: -73.92 },
};

const SPEED_KMH = 30;

export type BootSample = {
  fixtures: NycFixtures;
  files: TravelFiles;
  /** `files.matrix.places`: the 18 businesses and every home the generator can use. */
  places: Places;
  /** The cached provider over `files`. */
  travel: TravelProvider;
  /** The 10 story homes and the 120 pool homes. */
  homes: Home[];
};

/** A fresh sample on every call, so a test may remove a pair or a place without affecting another test. */
export function bootSample(): BootSample {
  const fixtures = readNycFixtures(FIXTURES_DIR);
  const homes = [
    ...fixtures.storyFile.featuredEmployees.map((employee) => employee.home),
    ...generateHomePool(fixtures.neighborhoodsFile.neighborhoods),
  ];
  const files = emptyTravelFiles();
  const { places, pairs } = files.matrix;
  for (const business of fixtures.businessesFile.businesses) {
    const point = MADE_UP_BUSINESS_POINTS[business.id];
    if (!point) throw new Error(`v2-boot-sample: add a made-up point for ${business.id}`);
    places[business.id] = { ...point };
  }
  const businessIds = Object.keys(places);
  for (const home of homes) places[home.id] = { lat: home.lat, lng: home.lng };

  const add = (from: string, to: string) => {
    const distanceM = Math.round(straightLineM(places[from], places[to]));
    pairs[pairKey(from, to)] = { durationS: Math.round(distanceM / (SPEED_KMH / 3.6)), distanceM };
  };
  for (const a of businessIds) {
    for (const b of businessIds) if (a !== b) add(a, b);
    for (const home of homes) {
      add(a, home.id);
      add(home.id, a);
    }
  }
  return { fixtures, files, places, travel: createCachedProvider(files), homes };
}

/** The run as JSON with the one measured field zeroed (`computeMs` is wall-clock time, like in the MVP 1 tests). */
export function runJson(run: RunV2): string {
  return JSON.stringify({ ...run, assignments: { ...run.assignments, computeMs: 0 } });
}
