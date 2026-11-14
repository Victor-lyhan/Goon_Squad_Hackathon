// Helper for the whole-day simulation tests on the COMMITTED NYC travel cache (#516).
// - `loadNyc()` reads fixtures/nyc/ once per test file (module state lives per file in vitest): the three
//   story files and the travel cache (matrix.json + polylines.json). No key, no network, nothing is written.
// - `buildNycDay()` builds the default run the way the server boots it: `buildNycScenario` with
//   `GenerateScenarioRequest.parse({ preset: 'demo' })`, travel and route lines from `createCachedProvider`,
//   then `createInitialRun` (buildTrips + assignShipments + jobs) with the real `buildTimeline`.
//   Same wiring as sim-v2-day-helper.ts, with the cached provider in place of the straight-line one.
// - `deriveLegs()` re-derives every leg's clock from the provider alone (departure + Google minutes per pair
//   + handling + waiting). The tests compare the plan, the timeline and every snapshot against it.
// - The geometry at the bottom is the tests' own (it does not import server/domain/v2/polyline.ts), so a
//   mistake in the simulator's decoding or interpolation cannot hide behind the same code.
// Story IDs, names and counts are never pinned here (DECISIONS pass 54): everything is read from the run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mapboxPolyline from '@mapbox/polyline';
import { buildNycScenario } from '../../server/domain/v2/generator.js';
import { buildTimeline } from '../../server/domain/v2/timeline.js';
import { createInitialRun } from '../../server/api/v2/initialRun.js';
import { readTravelFiles, type TravelFiles } from '../../server/geo/cache.js';
import { createCachedProvider, type CachedProvider } from '../../server/geo/providers.js';
import { GenerateScenarioRequest } from '../../shared/v2/schemas.js';
import type {
  DeliveryPlan, LatLng, Leg, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile,
  Run, Shipment, StopKind, TravelProvider, Trip,
} from '../../shared/v2/types.js';

/** The simulated day of SPEC M3: Day 1 15:30 to Day 2 12:00, every whole minute. */
export const DAY_START_MIN = 930;
export const DAY_END_MIN = 2160;

const NYC_DIR = fileURLToPath(new URL('../../fixtures/nyc/', import.meta.url));

export type NycFiles = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  travelFiles: TravelFiles;
};

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${NYC_DIR}${name}.json`, 'utf8')) as T;
}

let loaded: NycFiles | null = null;

/** The committed fixtures/nyc files, read once per test file. */
export function loadNyc(): NycFiles {
  if (loaded) return loaded;
  const travelFiles = readTravelFiles(NYC_DIR);
  if (!travelFiles) throw new Error('fixtures/nyc has no travel cache (matrix.json)');
  loaded = {
    businessesFile: fixture<NycBusinessesFile>('businesses'),
    neighborhoodsFile: fixture<NycNeighborhoodsFile>('neighborhoods'),
    storyFile: fixture<NycDemoStoryFile>('demoStory'),
    travelFiles,
  };
  return loaded;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export type NycDay = {
  files: NycFiles;
  travel: CachedProvider;
  run: Run;
  /** Coordinates of every business and home of the scenario, by place ID. */
  places: Record<string, LatLng>;
  businessIds: Set<string>;
  homeIds: Set<string>;
};

/**
 * One build of the default NYC run from the loaded files. Each call builds a new scenario and a new run
 * (the determinism test calls it twice); the files are shared and never changed.
 */
export function buildNycDay(): NycDay {
  const files = loadNyc();
  const travel = createCachedProvider(files.travelFiles);
  const scenario = buildNycScenario({
    businessesFile: files.businessesFile,
    neighborhoodsFile: files.neighborhoodsFile,
    storyFile: files.storyFile,
    places: files.travelFiles.matrix.places,
    request: GenerateScenarioRequest.parse({ preset: 'demo' }),
  });
  const built = createInitialRun(scenario, { travel, buildEvents: buildTimeline });
  // `computeMs` is a wall-clock measurement the API layer adds; the domain's own value is 0 (DECISIONS pass 4).
  const run: Run = { ...built, assignments: { ...built.assignments, computeMs: 0 } };
  const places = Object.fromEntries(
    [...scenario.businesses, ...scenario.homes].map(({ id, lat, lng }) => [id, { lat, lng }]),
  );
  return {
    files, travel, run, places,
    businessIds: new Set(scenario.businesses.map(business => business.id)),
    homeIds: new Set(scenario.homes.map(home => home.id)),
  };
}

// ---------- every leg's clock, re-derived from the provider ----------

export type DerivedStop = {
  placeId: string; kind: StopKind;
  arrivalMin: number; serviceStartMin: number; serviceEndMin: number;
};

/** One drive between two neighbouring places of a leg. The vehicle is on the road in [departMin, arriveMin). */
export type DrivenPair = {
  planId: string; shipmentId: string; legIndex: number; employeeId: string;
  from: string; to: string; departMin: number; arriveMin: number;
  /** Google's raw seconds for the pair, straight from matrix.json. */
  seconds: number;
};

export type DerivedLeg = {
  plan: DeliveryPlan; shipment: Shipment; leg: Leg; legIndex: number; trip: Trip;
  stops: DerivedStop[]; pairs: DrivenPair[]; finishMin: number; distanceM: number;
};

/**
 * Walks every planned leg from its trip's departure with the provider's minutes, 2 minutes of handling per
 * stop and waiting at the pickup (for the package to be ready; for a relay's second leg, for the first leg's
 * drop to be finished). Only the route (place order, stop places and kinds) is read from the plan; no stored
 * time is.
 */
export function deriveLegs(day: Pick<NycDay, 'run' | 'travel' | 'files'>): DerivedLeg[] {
  const { run, travel } = day;
  const rawPairs = day.files.travelFiles.matrix.pairs;
  const trips = new Map(run.trips.map(trip => [trip.id, trip]));
  const shipments = new Map(run.scenario.shipments.map(shipment => [shipment.id, shipment]));
  const handlingMin = run.scenario.settings.handlingMin;
  const derived: DerivedLeg[] = [];
  for (const plan of run.assignments.plans) {
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) throw new Error(`${plan.id} has no shipment`);
    let readyMin = shipment.readyMin;
    plan.legs.forEach((leg, legIndex) => {
      const trip = trips.get(leg.tripId);
      if (!trip) throw new Error(`${plan.id} leg ${legIndex} has no trip`);
      let time = trip.departureMin;
      let distanceM = 0;
      let stopIndex = 0;
      const stops: DerivedStop[] = [];
      const pairs: DrivenPair[] = [];
      leg.placeIds.forEach((placeId, index) => {
        if (index > 0) {
          const from = leg.placeIds[index - 1]!;
          const arriveMin = time + travel.durationMin(from, placeId);
          pairs.push({
            planId: plan.id, shipmentId: plan.shipmentId, legIndex, employeeId: leg.employeeId,
            from, to: placeId, departMin: time, arriveMin,
            seconds: rawPairs[`${from}|${placeId}`]?.durationS ?? Number.NaN,
          });
          distanceM += travel.distanceM(from, placeId);
          time = arriveMin;
        }
        while (leg.stops[stopIndex]?.placeId === placeId) {
          const arrivalMin = time;
          const serviceStartMin = stopIndex === 0 ? Math.max(arrivalMin, readyMin) : arrivalMin;
          time = serviceStartMin + handlingMin;
          stops.push({ placeId, kind: leg.stops[stopIndex]!.kind, arrivalMin, serviceStartMin, serviceEndMin: time });
          stopIndex += 1;
        }
      });
      if (stopIndex !== leg.stops.length) throw new Error(`${plan.id} leg ${legIndex} has a stop off its route`);
      derived.push({ plan, shipment, leg, legIndex, trip, stops, pairs, finishMin: time, distanceM });
      // The next leg of a relay cannot collect before this leg's drop is finished.
      readyMin = Math.max(readyMin, stops.at(-1)?.serviceEndMin ?? readyMin);
    });
  }
  return derived;
}

// ---------- geometry (the tests' own) ----------

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

/** Great-circle distance in meters. */
export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A Google encoded route line (precision 5) as points, decoded with @mapbox/polyline. */
export function decodeLine(encoded: string): LatLng[] {
  return mapboxPolyline.decode(encoded, 5).map(([lat, lng]) => ({ lat, lng }));
}

export type Path = { points: LatLng[]; cumulativeM: number[]; lengthM: number };

export function pathOf(points: LatLng[]): Path {
  const cumulativeM = [0];
  for (let i = 1; i < points.length; i++) cumulativeM.push(cumulativeM[i - 1]! + metersBetween(points[i - 1]!, points[i]!));
  return { points, cumulativeM, lengthM: cumulativeM.at(-1) ?? 0 };
}

/**
 * Where `point` is relative to a path: `offM` is the distance to the nearest point of the path, `alongM` the
 * distance travelled along the path up to that nearest point. A route line can pass the same spot twice
 * (a ramp that loops under itself), so of the spots that are as near as the nearest (within half a meter),
 * the one whose `alongM` is closest to `expectedAlongM` is reported.
 */
export function locateOnPath(path: Path, point: LatLng, expectedAlongM: number): { offM: number; alongM: number } {
  // A flat map around the point: x east, y north, in meters. Exact enough over one city.
  const scaleX = Math.cos(point.lat * RAD) * RAD * EARTH_RADIUS_M;
  const scaleY = RAD * EARTH_RADIUS_M;
  const flat = (p: LatLng) => ({ x: (p.lng - point.lng) * scaleX, y: (p.lat - point.lat) * scaleY });
  const candidates: { offM: number; alongM: number }[] = [];
  for (let i = 1; i < path.points.length; i++) {
    const a = flat(path.points[i - 1]!);
    const b = flat(path.points[i]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSq));
    candidates.push({
      offM: Math.hypot(a.x + dx * t, a.y + dy * t),
      alongM: path.cumulativeM[i - 1]! + (path.cumulativeM[i]! - path.cumulativeM[i - 1]!) * t,
    });
  }
  if (candidates.length === 0) throw new Error('A path needs at least 2 points');
  const nearest = Math.min(...candidates.map(candidate => candidate.offM));
  return candidates
    .filter(candidate => candidate.offM <= nearest + 0.5)
    .reduce((best, candidate) =>
      Math.abs(candidate.alongM - expectedAlongM) < Math.abs(best.alongM - expectedAlongM) ? candidate : best);
}

/** A provider that answers like `travel` but has no route line for the pairs `withhold` names. */
export function withoutLines(travel: TravelProvider, withhold: (from: string, to: string) => boolean): TravelProvider {
  return {
    durationMin: (from, to) => travel.durationMin(from, to),
    distanceM: (from, to) => travel.distanceM(from, to),
    polyline: (from, to) => (withhold(from, to) ? null : travel.polyline(from, to)),
  };
}
