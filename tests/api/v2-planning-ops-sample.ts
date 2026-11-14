// Inputs and shared checks for the v2 planningOps tests.
//   - `generateInputs`: the real fixtures/nyc files with a test `places` table (matrix.json is not committed yet).
//   - `planningRun` / `lockedRun`: the small hand-built city of v2-sample.ts (2 plans, 3 jobs, 7 notifications, 6 events).
//   - `travelWithout`: a travel-cache stand-in that only answers `has`.
// Everything exported here is deep-frozen, so a function that writes to its input throws.
import { expect, vi } from 'vitest';
import businessesJson from '../../fixtures/nyc/businesses.json';
import demoStoryJson from '../../fixtures/nyc/demoStory.json';
import neighborhoodsJson from '../../fixtures/nyc/neighborhoods.json';
import type { GenerateInputs, TravelPairs } from '../../server/api/v2/planningOps';
import {
  pairKey, tripId,
  type NycBusinessesFile, type NycDemoStoryFile, type NycNeighborhoodsFile, type Run, type Scenario, type TravelMatrixFile,
} from '../../shared/v2/types';
import { deepFreeze, sampleRun } from './v2-sample';

export const businessesFile = businessesJson as NycBusinessesFile;
export const neighborhoodsFile = neighborhoodsJson as NycNeighborhoodsFile;
export const storyFile = demoStoryJson as NycDemoStoryFile;

/** Placeholder points, one per business, only so the generator has coordinates. Not real geocodes. */
export function testPlaces(file: NycBusinessesFile = businessesFile): TravelMatrixFile['places'] {
  return Object.fromEntries(
    file.businesses.map((business, index) => [business.id, { lat: 40.7 + index * 0.005, lng: -74 + index * 0.004 }]),
  );
}

export const generateInputs: GenerateInputs = deepFreeze({
  businessesFile, neighborhoodsFile, storyFile, places: testPlaces(),
});

/** The same inputs with other `places`. */
export const inputsWithPlaces = (places: TravelMatrixFile['places']): GenerateInputs =>
  deepFreeze({ businessesFile, neighborhoodsFile, storyFile, places: structuredClone(places) });

/** The small city after Play: `run-3`, version 12, clock locked at 1110. */
export const lockedRun: Run = sampleRun;

/** The small city while it can still be changed. */
export const planningRun: Run = deepFreeze({
  ...structuredClone(sampleRun),
  clock: { phase: 'planning', playing: false, timeMin: 930, speed: 120 },
});

/** A frozen copy of `base` after `edit` changed it. */
export function runWith(edit: (run: Run) => void, base: Run = sampleRun): Run {
  const copy = structuredClone(base);
  edit(copy);
  return deepFreeze(copy);
}

/**
 * A run around a generated scenario, as the route would store it before any matching: two trips per
 * employee with made-up baselines (these tests never read a travel time) and nothing matched.
 */
export function unmatchedRunOf(scenario: Scenario): Run {
  const { employees, settings } = structuredClone(scenario);
  return deepFreeze({
    runId: 'run-1', version: 0, scenario: structuredClone(scenario),
    trips: employees.flatMap((e) => [
      {
        id: tripId(e.id, 'eve'), employeeId: e.id, direction: 'evening' as const,
        originPlaceId: e.businessId, destinationPlaceId: e.homeId, departureMin: e.eveningDepartureMin,
        baselineDurationMin: 30, baselineDistanceM: 9000,
      },
      {
        id: tripId(e.id, 'morn'), employeeId: e.id, direction: 'morning' as const,
        originPlaceId: e.homeId, destinationPlaceId: e.businessId, departureMin: e.morningDepartureMin,
        baselineDurationMin: 32, baselineDistanceM: 9100,
      },
    ]),
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [], notifications: [], events: [],
    clock: { phase: 'planning', playing: false, timeMin: settings.simStartMin, speed: 120 },
  });
}

/**
 * A travel cache that knows every pair except the ones touching `missingPlaceIds` and the exact ordered
 * pairs in `missingPairs` (`pairKey(from, to)`). `calls` records what was asked.
 */
export function travelWithout(missingPlaceIds: string[] = [], missingPairs: string[] = []) {
  const places = new Set(missingPlaceIds);
  const pairs = new Set(missingPairs);
  const calls: string[] = [];
  const travel: TravelPairs = {
    has(from, to) {
      calls.push(pairKey(from, to));
      return from === to || !(places.has(from) || places.has(to) || pairs.has(pairKey(from, to)));
    },
  };
  return { travel, calls };
}

/** Every object and array inside a value. */
function objectsIn(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value);
    for (const child of Object.values(value)) objectsIn(child, into);
  }
  return into;
}

/** True when `a` and `b` hold the same object or array somewhere, so writing to one would change the other. */
export function sharesObjects(a: unknown, b: unknown): boolean {
  const mine = objectsIn(a);
  return [...objectsIn(b)].some((object) => mine.has(object));
}

/**
 * Runs `step` twice with the wall clock and `Math.random` made to throw, and checks that both results are equal:
 * the step may only use its arguments (and the generator's seeded PRNG).
 */
export function expectDeterministic<T>(step: () => T): T {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random was called'); });
  const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now was called'); });
  const perf = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('performance.now was called'); });
  try {
    const first = step();
    expect(step()).toStrictEqual(first);
    return first;
  } finally {
    random.mockRestore();
    now.mockRestore();
    perf.mockRestore();
  }
}
