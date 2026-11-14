// Runs, request bodies and the shared checks for the v2 shipmentOps tests.
//
// Small city (from v2-sample.ts): Studio, Agency, Cafe.
//   shp-1 (req-1) relay-matched, shp-2 (req-2) direct-matched, shp-3 (req-3) unmatched.
// Planning window 930..2160.
import { expect } from 'vitest';
import businessesJson from '../../fixtures/nyc/businesses.json';
import demoStoryJson from '../../fixtures/nyc/demoStory.json';
import neighborhoodsJson from '../../fixtures/nyc/neighborhoods.json';
import { buildNycScenario } from '../../server/domain/v2/generator';
import type {
  NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Run, Shipment, TravelMatrixFile,
} from '../../shared/v2/types';
import { deepFreeze, sampleRun } from './v2-sample';

/** The small city while it can still be changed. Frozen: a function that writes to it throws. */
export const planningRun: Run = deepFreeze({
  ...structuredClone(sampleRun),
  clock: { phase: 'planning', playing: false, timeMin: 930, speed: 120 },
});

/** The same city after Play: `clock.phase === 'locked'`. */
export const lockedRun: Run = sampleRun;

/** A copy of the small city with other shipments; frozen like the rest. */
export function runWithShipments(shipments: Shipment[], base: Run = planningRun): Run {
  const copy = structuredClone(base);
  copy.scenario.shipments = structuredClone(shipments);
  return deepFreeze(copy);
}

/**
 * The curated NYC demo scenario from the real fixture files: 18 businesses and the story's 24 packages,
 * with IDs given in file order by the generator (shp-1 .. shp-24). Nothing is matched: these tests never match.
 */
export function demoRun(): Run {
  const businessesFile = businessesJson as NycBusinessesFile;
  // Placeholder points, only so the generator accepts the businesses (the real ones come from geocoding).
  // shipmentOps never reads a coordinate.
  const places: TravelMatrixFile['places'] = Object.fromEntries(
    businessesFile.businesses.map((b, i) => [b.id, { lat: 40.7 + i * 0.005, lng: -73.98 }]),
  );
  const scenario = buildNycScenario({
    businessesFile,
    neighborhoodsFile: neighborhoodsJson as NycNeighborhoodsFile,
    storyFile: demoStoryJson as NycDemoStoryFile,
    places,
    request: { preset: 'demo', seed: 42, employees: 60, packages: 24, maxExtraMin: 8 },
  });
  return deepFreeze({
    runId: 'run-1', version: 1, scenario, trips: [],
    assignments: { plans: [], unmatched: [], computeMs: 0 },
    jobs: [], notifications: [], events: [],
    clock: { phase: 'planning', playing: false, timeMin: scenario.settings.simStartMin, speed: 120 },
  });
}

/** A create body that is valid on the small city. */
export function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientRequestId: 'req-new',
    originBusinessId: 'biz-studio',
    destinationBusinessId: 'biz-agency',
    label: 'Gift box',
    category: 'small_box',
    description: 'Pastries for the team',
    weightKg: 1.2,
    readyMin: 1000,
    deadlineMin: 2000,
    pickupInstructions: 'Ask at the counter',
    dropoffInstructions: 'Leave at reception',
    ...overrides,
  };
}

/** `createBody()` without the named fields. */
export function createBodyWithout(fields: string[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = createBody(overrides);
  for (const field of fields) delete body[field];
  return body;
}

/** Every string inside a value: object keys are skipped, object values and array items are read. */
export function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(texts);
}

/** No message says "hub", prints a missing value, or shows a raw ID. */
export function expectCleanErrorText(error: unknown): void {
  const all = texts(error);
  expect(all.length).toBeGreaterThan(0);
  for (const message of all) {
    expect(message.trim()).not.toBe('');
    expect(message).not.toMatch(/hub|undefined|null|NaN|\[object|biz-|home-|shp-|emp-|req-/i);
    expect(message).not.toMatch(/Invalid input|expected|received|Too small|Too big/i); // Zod's default wording
  }
}

/**
 * Runs a shipmentOps function the way every test must: on a frozen run, twice.
 * Checks that the run is deep-equal before and after, that both calls give a deep-equal result,
 * and that a refusal's body is clean. Returns the first result.
 */
export function checked<T>(run: Run, call: (run: Run) => T): T {
  const frozen = deepFreeze(structuredClone(run));
  const before = structuredClone(frozen);
  const first = call(frozen);
  const second = call(frozen);
  expect(frozen).toEqual(before);
  expect(second).toEqual(first);
  expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)));
  if (first && typeof first === 'object' && 'error' in first) expectCleanErrorText(first.error);
  return first;
}
