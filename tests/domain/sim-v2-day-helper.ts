import { readFileSync } from 'node:fs';
import { buildNycScenario } from '../../server/domain/v2/generator.js';
import { createInitialRun } from '../../server/api/v2/initialRun.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import { encodePolyline } from '../../server/domain/v2/polyline.js';
import { straightLineM } from '../../server/geo/fakeProvider.js';
import {
  pairKey, TravelDataMissingError, type LatLng, type TravelProvider,
  type NycBusinessesFile, type NycNeighborhoodsFile, type NycDemoStoryFile,
} from '../../shared/v2/types.js';

// TEST DATA ONLY, on the same coarse grid as the API boot tests. These are not
// geocodes, and the derived travel table must never be imported by app code.
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

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../fixtures/nyc/${name}.json`, import.meta.url), 'utf8'));
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Detour limit of the background commuters in this sweep. It is not the NYC default: on the made-up straight-line
 * table almost every story package finds a direct carrier at 8 or more, and the sweep needs relays too. With the
 * story retuned for real travel times (#492) the limits 4 to 7 give at least 2 relay plans; 5 gives the most.
 */
const DAY_MAX_EXTRA_MIN = 5;

/** Build once per file (twice only for the independent-build determinism check). */
export function buildDay() {
  const scenario = buildNycScenario({
    businessesFile: fixture<NycBusinessesFile>('businesses'),
    neighborhoodsFile: fixture<NycNeighborhoodsFile>('neighborhoods'),
    storyFile: fixture<NycDemoStoryFile>('demoStory'),
    places: MADE_UP_BUSINESS_POINTS,
    request: { preset: 'demo', seed: 42, employees: 60, packages: 24, maxExtraMin: DAY_MAX_EXTRA_MIN },
  });
  const places = Object.fromEntries([...scenario.businesses, ...scenario.homes].map(
    ({ id, lat, lng }) => [id, { lat, lng }],
  ));
  const pairs: Record<string, { minutes: number; meters: number; line: string | null }> = {};
  let pairIndex = 0;
  for (const [from, a] of Object.entries(places)) {
    for (const [to, b] of Object.entries(places)) {
      if (from.startsWith('home-') && to.startsWith('home-')) continue;
      const meters = Math.round(straightLineM(a, b));
      const count = 100 + pairIndex % 201;
      // A slight curve makes route interpolation distinguishable from fallback.
      const line = pairIndex++ % 13 === 0 ? null : encodePolyline(Array.from({ length: count }, (_, i) => {
        const fraction = i / (count - 1);
        return {
          lat: a.lat + (b.lat - a.lat) * fraction + Math.sin(Math.PI * fraction) * 0.001,
          lng: a.lng + (b.lng - a.lng) * fraction,
        };
      }));
      pairs[pairKey(from, to)] = { meters, minutes: Math.ceil(meters / 500), line };
    }
  }
  const travel = {
    pairs,
    durationMin(from: string, to: string) {
      if (from === to) return 0;
      const pair = this.pairs[pairKey(from, to)];
      if (!pair) throw new TravelDataMissingError(from, to);
      return pair.minutes;
    },
    distanceM(from: string, to: string) {
      if (from === to) return 0;
      const pair = this.pairs[pairKey(from, to)];
      if (!pair) throw new TravelDataMissingError(from, to);
      return pair.meters;
    },
    polyline(from: string, to: string) { return this.pairs[pairKey(from, to)]?.line ?? null; },
  } satisfies TravelProvider & { pairs: typeof pairs };
  const run = createInitialRun(scenario, { travel, buildEvents: buildTimeline });
  const direct = run.assignments.plans.filter(plan => plan.kind === 'direct').length;
  const relay = run.assignments.plans.filter(plan => plan.kind === 'relay').length;
  if (direct < 2 || relay < 2) {
    throw new Error(`Day sweep requires at least 2 direct and 2 relay plans; got ${direct} direct, ${relay} relay. `
      + 'After a story change, pick another DAY_MAX_EXTRA_MIN.');
  }
  return { run, travel, places };
}
