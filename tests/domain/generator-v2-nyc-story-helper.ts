// Shared by tests/domain/generator-v2-nyc-story.test.ts: the committed NYC fixtures (businesses, neighborhoods,
// the demo story and the Google travel matrix) read once, and the default run built from them the way the server
// boot and the fetch command build it. Travel comes only from the committed matrix.json; polylines.json is never
// read, so the test holds before a human fetches the new plans' route lines (DECISIONS pass 54).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssignmentResult, DeliveryPlan, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario, Shipment,
  TravelMatrixFile, Trip,
} from '../../shared/v2/types';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { buildNycScenario } from '../../server/domain/v2/generator';
import { assignShipments, type MatchContext } from '../../server/domain/v2/matching';
import { checkPlans, checkStory, type PlanIssue, type StoryRow } from '../../server/domain/v2/planCheck';
import { buildTrips } from '../../server/domain/v2/trips';
import { createCachedProvider } from '../../server/geo/providers';

/** Explicit per-test limit (DECISIONS pass 19 and 52): one default run takes about 30 ms locally. */
export const STORY_TEST_TIMEOUT_MS = 10_000;

export const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/nyc');

function readFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8')) as T;
}

export type NycFixtures = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  matrix: TravelMatrixFile;
};

export function loadNycFixtures(): NycFixtures {
  return {
    businessesFile: readFixture<NycBusinessesFile>('businesses.json'),
    neighborhoodsFile: readFixture<NycNeighborhoodsFile>('neighborhoods.json'),
    storyFile: readFixture<NycDemoStoryFile>('demoStory.json'),
    matrix: readFixture<TravelMatrixFile>('matrix.json'),
  };
}

export type StoryRun = {
  scenario: Scenario;
  trips: Trip[];
  ctx: MatchContext;
  result: AssignmentResult;
  issues: PlanIssue[];
  storyRows: StoryRow[];
};

/**
 * The default scenario (`preset: "demo"`, every other value the schema default, so the detour limit is the
 * default too), matched on the committed matrix and checked. A missing travel pair throws TravelDataMissingError.
 */
export function runDefaultStory(fixtures: NycFixtures): StoryRun {
  const request = GenerateScenarioRequest.parse({ preset: 'demo' });
  const scenario = buildNycScenario({ ...fixtures, places: fixtures.matrix.places, request });
  const travel = createCachedProvider({
    matrix: fixtures.matrix,
    polylines: { schemaVersion: 1, polylines: {} },
  });
  const trips = scenario.employees.flatMap(employee => buildTrips(employee, travel));
  const ctx: MatchContext = {
    travel, trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings,
  };
  const result = assignShipments(scenario.shipments, ctx);
  const issues = checkPlans({
    plans: result.plans, shipments: scenario.shipments, employees: scenario.employees, trips,
    businesses: scenario.businesses, settings: scenario.settings, travel,
  });
  const storyRows = checkStory(
    fixtures.storyFile.shipments.map((row, index) => ({
      shipmentId: scenario.shipments[index]!.id, label: row.label, expect: row.expect,
    })),
    result,
  );
  return { scenario, trips, ctx, result, issues, storyRows };
}

/** The plan of the story row at `index` (0-based file order), or undefined when it did not match. */
export function planOfRow(run: StoryRun, index: number): DeliveryPlan | undefined {
  const shipmentId = run.scenario.shipments[index]?.id;
  return run.result.plans.find(plan => plan.shipmentId === shipmentId);
}

/** The network business a relay row's `note` names, when it names exactly one. Longer names win ("Blue Bottle Coffee"). */
export function relayBusinessNamedIn(note: string | undefined, businesses: NycBusinessesFile['businesses']): string | undefined {
  if (!note) return undefined;
  const named = businesses.filter(business => note.includes(business.name));
  return named.length === 1 ? named[0]!.id : undefined;
}

/**
 * Pairs for the live demo: a delivery request typed into the New delivery form after the 24 story packages.
 * Each is tried alone on top of the default run. The times are the form's defaults (ready Day 1 16:00, deliver
 * by Day 2 10:00), so the demo needs no time edits. The README demo script uses one of these.
 */
export const LIVE_DEMO_PAIRS: ReadonlyArray<{
  originBusinessId: string; destinationBusinessId: string; kind: DeliveryPlan['kind']; relayBusinessId?: string;
}> = [
  { originBusinessId: 'biz-titan-foods', destinationBusinessId: 'biz-brooklyn-roasting', kind: 'direct' },
  { originBusinessId: 'biz-community-bookstore', destinationBusinessId: 'biz-jetblue', kind: 'direct' },
  { originBusinessId: 'biz-brooklyn-roasting', destinationBusinessId: 'biz-blue-bottle-wall', kind: 'relay', relayBusinessId: 'biz-etsy' },
  { originBusinessId: 'biz-titan-foods', destinationBusinessId: 'biz-wework-montague', kind: 'relay', relayBusinessId: 'biz-brooklyn-roasting' },
];

export const LIVE_READY_MIN = 960;     // Day 1 16:00, the New delivery form default
export const LIVE_DEADLINE_MIN = 2040; // Day 2 10:00, the New delivery form default

/** One more delivery request on top of the default run: the 24 plans stay, only free trips can carry it. */
export function requestLiveDelivery(
  run: StoryRun, originBusinessId: string, destinationBusinessId: string,
): { shipment: Shipment; plan: DeliveryPlan | undefined; result: AssignmentResult } {
  const sequence = run.scenario.shipments.length + 1;
  const shipment: Shipment = {
    id: `shp-${sequence}`,
    clientRequestId: `live-${originBusinessId}-${destinationBusinessId}`,
    originBusinessId,
    destinationBusinessId,
    label: 'Live demo package',
    category: 'envelope',
    description: 'A delivery request created during the demo.',
    weightGrams: 500,
    readyMin: LIVE_READY_MIN,
    deadlineMin: LIVE_DEADLINE_MIN,
    pickupInstructions: '',
    dropoffInstructions: '',
    createdSeq: sequence,
  };
  const result = assignShipments([...run.scenario.shipments, shipment], run.ctx, { existing: run.result.plans });
  return { shipment, plan: result.plans.find(plan => plan.shipmentId === shipment.id), result };
}

/** The independent plan check over the story plans plus the live request's plan. */
export function checkWithLiveShipment(run: StoryRun, shipment: Shipment, plans: DeliveryPlan[]): PlanIssue[] {
  return checkPlans({
    plans, shipments: [...run.scenario.shipments, shipment], employees: run.scenario.employees, trips: run.trips,
    businesses: run.scenario.businesses, settings: run.scenario.settings, travel: run.ctx.travel,
  });
}
