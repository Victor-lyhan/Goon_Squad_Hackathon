// Shared by tests/domain/matching-v2-nyc-{real,random}.test.ts: the v2 matcher on the committed NYC cache.
// The fixtures are read once per test file (vitest gives each file its own module graph), the scenario is built
// with buildNycScenario, travel comes from createCachedProvider over the committed matrix.json and polylines.json,
// and trips from buildTrips. Nothing here names a story package, employee or relay business: #492 retunes the
// story, so every check below is a rule that holds for any story (issue #493).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type {
  AssignmentResult, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario, Trip,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import { checkPlans, type PlanIssue } from '../../server/domain/v2/planCheck';
import { buildTrips } from '../../server/domain/v2/trips';
import { readTravelFiles, type TravelFiles } from '../../server/geo/cache';
import { createCachedProvider, type CachedProvider } from '../../server/geo/providers';

/** SPEC "Matching": the matcher must stay under 2 s on the default workload using the cache. A SPEC limit keeps
 * its number (DECISIONS pass 52); it is not scaled to the local measurement. */
export const SPEC_MATCH_LIMIT_MS = 2_000;
/** Explicit per-test timeout: a build, a warm-up, a timed run and a check per scenario. */
export const NYC_TEST_TIMEOUT_MS = 20_000;

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;
}

type NycFiles = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  travelFiles: TravelFiles;
  travel: CachedProvider;
};

let loaded: NycFiles | undefined;

/** The committed fixtures/nyc files, read on first use and kept for the rest of this test file. */
export function nycFiles(): NycFiles {
  if (loaded) return loaded;
  const travelFiles = readTravelFiles(fixturesDir);
  if (!travelFiles) throw new Error(`No committed travel cache in ${fixturesDir}`);
  loaded = {
    businessesFile: readFixture<NycBusinessesFile>('businesses.json'),
    neighborhoodsFile: readFixture<NycNeighborhoodsFile>('neighborhoods.json'),
    storyFile: readFixture<NycDemoStoryFile>('demoStory.json'),
    travelFiles,
    travel: createCachedProvider(travelFiles),
  };
  return loaded;
}

export type NycCity = { scenario: Scenario; trips: Trip[]; ctx: MatchContext };

/** A scenario from the given request (parsed, so every omitted value is the schema default) on the cache. */
export function buildCity(request: unknown): NycCity {
  const files = nycFiles();
  const scenario = buildNycScenario({
    businessesFile: files.businessesFile,
    neighborhoodsFile: files.neighborhoodsFile,
    storyFile: files.storyFile,
    places: files.travelFiles.matrix.places,
    request: GenerateScenarioRequest.parse(request),
  });
  const trips = scenario.employees.flatMap(employee => buildTrips(employee, files.travel));
  const ctx: MatchContext = {
    travel: files.travel, trips, employees: scenario.employees, businesses: scenario.businesses,
    settings: scenario.settings,
  };
  return { scenario, trips, ctx };
}

/** One warm-up run, then one timed run of `assignShipments`. Returns the timed result and its wall-clock ms. */
export function timedMatch(city: NycCity): { result: AssignmentResult; ms: number } {
  assignShipments(city.scenario.shipments, city.ctx);
  const start = performance.now();
  const result = assignShipments(city.scenario.shipments, city.ctx);
  return { result, ms: performance.now() - start };
}

/** The independent plan check (planCheck.ts does not import the matcher, DECISIONS pass 46). */
export function planIssues(city: NycCity, result: AssignmentResult): PlanIssue[] {
  return checkPlans({
    plans: result.plans, shipments: city.scenario.shipments, employees: city.scenario.employees, trips: city.trips,
    businesses: city.scenario.businesses, settings: city.scenario.settings, travel: city.ctx.travel,
  });
}

/**
 * The matcher rules of SPEC "Matching", checked directly on the plans (a second opinion next to checkPlans).
 * Returns one readable line per broken rule; an empty list means every rule holds.
 */
export function ruleViolations(city: NycCity, result: AssignmentResult): string[] {
  const { scenario, trips } = city;
  const homeIds = new Set(scenario.homes.map(home => home.id));
  for (const employee of scenario.employees) homeIds.add(employee.homeId);
  const businessIds = new Set(scenario.businesses.map(business => business.id));
  const shipments = new Map(scenario.shipments.map(shipment => [shipment.id, shipment]));
  const employees = new Map(scenario.employees.map(employee => [employee.id, employee]));
  const tripIds = new Set(trips.map(trip => trip.id));
  const usedTrips = new Map<string, string>();
  const problems: string[] = [];

  for (const plan of result.plans) {
    const where = `${plan.id} (${plan.kind})`;
    const shipment = shipments.get(plan.shipmentId);
    if (!shipment) { problems.push(`${where}: unknown shipment ${plan.shipmentId}`); continue; }

    for (const leg of plan.legs) {
      for (const stop of leg.stops) {
        if (homeIds.has(stop.placeId)) problems.push(`${where}: stop at home ${stop.placeId}`);
        if (!businessIds.has(stop.placeId)) problems.push(`${where}: stop ${stop.placeId} is not a network business`);
      }
      if (!tripIds.has(leg.tripId)) problems.push(`${where}: unknown trip ${leg.tripId}`);
      const other = usedTrips.get(leg.tripId);
      if (other) problems.push(`${where}: trip ${leg.tripId} also carries ${other}`);
      usedTrips.set(leg.tripId, plan.id);
      const carrier = employees.get(leg.employeeId);
      if (!carrier) problems.push(`${where}: unknown employee ${leg.employeeId}`);
      else if (leg.extraMin > carrier.maxExtraMin) {
        problems.push(`${where}: leg on ${leg.tripId} adds ${leg.extraMin} min, limit ${carrier.maxExtraMin}`);
      }
    }

    if (plan.kind === 'relay') {
      const relay = plan.relayBusinessId;
      if (!relay) problems.push(`${where}: no relay business`);
      else {
        if (relay === shipment.originBusinessId) problems.push(`${where}: relay ${relay} is the sender`);
        if (relay === shipment.destinationBusinessId) problems.push(`${where}: relay ${relay} is the recipient`);
        if (!businessIds.has(relay)) problems.push(`${where}: relay ${relay} is not a network business`);
      }
      if (plan.legs.length !== 2) problems.push(`${where}: ${plan.legs.length} legs`);
      else if (plan.legs[0]!.employeeId === plan.legs[1]!.employeeId) {
        problems.push(`${where}: both legs carried by ${plan.legs[0]!.employeeId}`);
      }
    }
  }
  return problems;
}
