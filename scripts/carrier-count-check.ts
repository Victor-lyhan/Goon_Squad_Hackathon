// How many employees the default NYC run can have without moving the story (#963):
//
//   npx tsx scripts/carrier-count-check.ts
//
// The default run had 60 employees, about 3 per business, so a few test sends used up a business's commutes
// ("Every matching commute is already carrying a package"). More employees mean more free commutes, but the 24
// story packages must stay exactly as they are. This builds the demo scenario at 60 and at each candidate count
// on the committed travel matrix (fixtures/nyc/matrix.json; no Google call, no route line read), matches it, and
// compares the 24 plans with the plans at 60: every field of every plan, so the kind, the carriers, the relay
// point and every stop time. It prints one line per count, the largest count that changes nothing, the free
// commutes per business at 60 and at that count, and the story check at that count.
//
// Only reads. `tests/domain/generator-v2-nyc-carrier-count.test.ts` pins the schema default to the count this
// finds, so a story or matrix change that moves a plan fails a test instead of the demo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { GenerateScenarioRequest } from '../shared/v2/schemas';
import type {
  AssignmentResult, DeliveryPlan, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Scenario,
  TravelMatrixFile, Trip,
} from '../shared/v2/types';
import { buildNycScenario } from '../server/domain/v2/generator';
import { assignShipments } from '../server/domain/v2/matching';
import { checkPlans, checkStory, formatCheckReport, type PlanIssue, type StoryRow } from '../server/domain/v2/planCheck';
import { buildTrips } from '../server/domain/v2/trips';
import { createCachedProvider } from '../server/geo/providers';

/** The default employee count before #963: the plans every candidate is compared with. */
export const BASELINE_EMPLOYEES = 60;
/** The counts #963 names, smallest first. */
export const CANDIDATE_COUNTS: readonly number[] = [70, 80, 90, 100, 110, 120];

export type CarrierFixtures = {
  businessesFile: NycBusinessesFile;
  neighborhoodsFile: NycNeighborhoodsFile;
  storyFile: NycDemoStoryFile;
  matrix: TravelMatrixFile;
};

export type CountRun = {
  employees: number;
  scenario: Scenario;
  trips: Trip[];
  result: AssignmentResult;
  issues: PlanIssue[];
  storyRows: StoryRow[];
};

export function readCarrierFixtures(dir: string): CarrierFixtures {
  const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as T;
  return {
    businessesFile: read<NycBusinessesFile>('businesses.json'),
    neighborhoodsFile: read<NycNeighborhoodsFile>('neighborhoods.json'),
    storyFile: read<NycDemoStoryFile>('demoStory.json'),
    matrix: read<TravelMatrixFile>('matrix.json'),
  };
}

/**
 * The demo scenario with `employees` employees and every other value the schema default, matched and checked
 * on the matrix alone. Throws TravelDataMissingError when the matrix lacks a pair the run needs.
 */
export function runAt(fixtures: CarrierFixtures, employees: number): CountRun {
  const request = GenerateScenarioRequest.parse({ preset: 'demo', employees });
  const scenario = buildNycScenario({ ...fixtures, places: fixtures.matrix.places, request });
  const travel = createCachedProvider({ matrix: fixtures.matrix, polylines: { schemaVersion: 1, polylines: {} } });
  const trips = scenario.employees.flatMap((employee) => buildTrips(employee, travel));
  const result = assignShipments(scenario.shipments, {
    travel, trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings,
  });
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
  return { employees, scenario, trips, result, issues, storyRows };
}

/** The story check passes: every package matched as its row says, and the independent plan check is clean. */
export function storyHolds(run: CountRun): boolean {
  return run.issues.length === 0 && run.result.unmatched.length === 0
    && run.storyRows.length > 0 && run.storyRows.every((row) => row.ok);
}

/** The shipment IDs whose plan differs between the two runs in any field (or exists in only one of them). */
export function changedPlans(base: CountRun, other: CountRun): string[] {
  const plansOf = (run: CountRun) => new Map<string, DeliveryPlan>(run.result.plans.map((plan) => [plan.shipmentId, plan]));
  const [a, b] = [plansOf(base), plansOf(other)];
  return base.scenario.shipments
    .map((shipment) => shipment.id)
    .filter((id) => !isDeepStrictEqual(a.get(id), b.get(id)));
}

export type CountVerdict = { employees: number; changed: string[]; storyOk: boolean; storyMatched: number; storyTotal: number };

export function verdictAt(base: CountRun, run: CountRun): CountVerdict {
  return {
    employees: run.employees,
    changed: changedPlans(base, run),
    storyOk: storyHolds(run),
    storyMatched: run.storyRows.filter((row) => row.ok).length,
    storyTotal: run.storyRows.length,
  };
}

/**
 * The largest candidate whose plans are all identical to the baseline's and whose story check passes, or the
 * baseline count when even the smallest candidate changes a plan.
 */
export function largestIdenticalCount(verdicts: readonly CountVerdict[], baseline = BASELINE_EMPLOYEES): number {
  return verdicts
    .filter((verdict) => verdict.changed.length === 0 && verdict.storyOk)
    .reduce((best, verdict) => Math.max(best, verdict.employees), baseline);
}

export type FreeCommutes = { businessId: string; name: string; employees: number; evening: number; morning: number };

/**
 * Per business, in file order: its employees, and how many of their evening commutes (leaving the business)
 * and morning commutes (arriving at it) carry no story package, so a new request can still use them.
 */
export function freeCommutes(run: CountRun): FreeCommutes[] {
  const reserved = new Set(run.result.plans.flatMap((plan) => plan.legs.map((leg) => leg.tripId)));
  const employer = new Map(run.scenario.employees.map((employee) => [employee.id, employee.businessId]));
  return run.scenario.businesses.map((business) => {
    const free = (direction: Trip['direction']) => run.trips.filter((trip) =>
      trip.direction === direction && employer.get(trip.employeeId) === business.id && !reserved.has(trip.id)).length;
    return {
      businessId: business.id,
      name: business.name,
      employees: run.scenario.employees.filter((employee) => employee.businessId === business.id).length,
      evening: free('evening'),
      morning: free('morning'),
    };
  });
}

export type CarrierCountReport = { chosen: number; verdicts: CountVerdict[]; lines: string[] };

export function carrierCountReport(fixtures: CarrierFixtures): CarrierCountReport {
  const base = runAt(fixtures, BASELINE_EMPLOYEES);
  const runs = CANDIDATE_COUNTS.map((employees) => runAt(fixtures, employees));
  const verdicts = runs.map((run) => verdictAt(base, run));
  const chosen = largestIdenticalCount(verdicts);
  const chosenRun = runs.find((run) => run.employees === chosen) ?? base;

  const kept = chosen === BASELINE_EMPLOYEES;
  const lines: string[] = [
    `Story plans at each employee count, compared with ${BASELINE_EMPLOYEES} employees (${base.result.plans.length} plans, story check ${base.storyRows.filter((row) => row.ok).length}/${base.storyRows.length}):`,
    ...verdicts.map((verdict) => {
      const plans = verdict.changed.length === 0
        ? `all ${base.result.plans.length} plans identical`
        : `${verdict.changed.length} ${verdict.changed.length === 1 ? 'plan differs' : 'plans differ'} (${verdict.changed.join(', ')})`;
      return `${String(verdict.employees).padStart(4)} employees: ${plans}; story check ${verdict.storyMatched}/${verdict.storyTotal}`;
    }),
    '',
    kept
      ? `Largest count that changes nothing: none of ${CANDIDATE_COUNTS.join(', ')}. Keep ${BASELINE_EMPLOYEES}.`
      : `Largest count that changes nothing: ${chosen}.`,
    '',
    `Free commutes per business (evening: leaving it, morning: arriving at it), ${kept ? `${BASELINE_EMPLOYEES} employees, unchanged` : `${BASELINE_EMPLOYEES} employees -> ${chosen} employees`}:`,
  ];
  const before = freeCommutes(base);
  const after = freeCommutes(chosenRun);
  const width = Math.max(...before.map((row) => row.name.length));
  // "3" when the count is kept, " 3 ->  5" when it moves.
  const cell = (was: number, now: number) => (kept ? String(was).padStart(2) : `${String(was).padStart(2)} -> ${String(now).padStart(2)}`);
  const sum = (rows: FreeCommutes[], key: 'employees' | 'evening' | 'morning') => rows.reduce((total, row) => total + row[key], 0);
  const least = (rows: FreeCommutes[], key: 'evening' | 'morning') => Math.min(...rows.map((row) => row[key]));
  before.forEach((row, index) => {
    const now = after[index]!;
    lines.push(`  ${row.name.padEnd(width)}  employees ${cell(row.employees, now.employees)}   evening ${cell(row.evening, now.evening)}   morning ${cell(row.morning, now.morning)}`);
  });
  lines.push(`  ${'Total'.padEnd(width)}  employees ${cell(sum(before, 'employees'), sum(after, 'employees'))}   evening ${cell(sum(before, 'evening'), sum(after, 'evening'))}   morning ${cell(sum(before, 'morning'), sum(after, 'morning'))}`);
  lines.push(`  Fewest at one business: evening ${cell(least(before, 'evening'), least(after, 'evening')).trim()}, morning ${cell(least(before, 'morning'), least(after, 'morning')).trim()}`);
  lines.push('', `Story check at ${chosen} employees:`,
    ...formatCheckReport(chosenRun.issues, chosenRun.storyRows, chosenRun.result.plans.length).map((line) => `  ${line}`));
  return { chosen, verdicts, lines };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isEntry = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isEntry) {
  const report = carrierCountReport(readCarrierFixtures(path.join(repoRoot, 'fixtures', 'nyc')));
  for (const line of report.lines) console.log(line);
}
