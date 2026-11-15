// How many employees the default NYC run can have without moving the story (#963, #966):
//
//   npx tsx scripts/carrier-count-check.ts
//
// The default run had 60 employees, about 3 per business, so a few test sends used up a business's commutes
// ("Every matching commute is already carrying a package"). More employees mean more free commutes, but the 24
// story packages must stay exactly as they are. This builds the demo scenario at 60 and at each candidate count
// on the committed travel matrix (fixtures/nyc/matrix.json; no Google call, no route line read), matches it, and
// compares the 24 plans with the plans at 60: every field of every plan, so the kind, the carriers, the relay
// point and every stop time. Each count is matched in two ways:
//   - plain: every package on every employee at once. #963 found that this moves the story at every count;
//   - story first (server/api/v2/storyFirst.ts, #966): the story's packages on the first 60 employees only, the
//     added employees only for requests sent later. This is how the server matches the default run.
// Then it takes the default run itself, as the server builds it (`buildDefaultRun`), and matches it again the
// way Recompute and a new planning cycle do, and plays it and goes back to the start. It prints one line per
// count and way, the default run's count, what the three actions leave of the 24 plans, the free commutes per
// business at 60 and at the default count, and the story check at the default count.
//
// Only reads. `tests/domain/generator-v2-nyc-carrier-count.test.ts` runs the same functions, so a story or
// matrix change that moves a plan fails a test instead of the demo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { GenerateScenarioRequest } from '../shared/v2/schemas';
import type {
  AssignmentResult, DeliveryPlan, NycBusinessesFile, NycDemoStoryFile, NycNeighborhoodsFile, Run, Scenario,
  TravelMatrixFile, TravelProvider, Trip,
} from '../shared/v2/types';
import { buildDefaultRun, DEFAULT_RUN_REQUEST } from '../server/api/v2/bootRun';
import { planControl } from '../server/api/v2/controlOps';
import { matchEverything, type PipelineDeps } from '../server/api/v2/pipeline';
import { beginNewCycle, clearForRecompute } from '../server/api/v2/planningOps';
import { assignStoryFirst, STORY_EMPLOYEES } from '../server/api/v2/storyFirst';
import { buildNycScenario } from '../server/domain/v2/generator';
import { assignShipments } from '../server/domain/v2/matching';
import { checkPlans, checkStory, formatCheckReport, type PlanIssue, type StoryRow } from '../server/domain/v2/planCheck';
import { buildTimeline } from '../server/domain/v2/timeline';
import { buildTrips } from '../server/domain/v2/trips';
import { createCachedProvider } from '../server/geo/providers';

/** The employees the story is matched on (the contract's default count): the plans every run is compared with. */
export const BASELINE_EMPLOYEES = STORY_EMPLOYEES;
/** The counts #963 names, smallest first. */
export const CANDIDATE_COUNTS: readonly number[] = [70, 80, 90, 100, 110, 120];

/** `plain`: every package on every employee at once. `story-first`: as the server matches (storyFirst.ts). */
export type MatchWay = 'plain' | 'story-first';

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

/** The matrix alone as the travel data: no route line is read, and a pair it lacks throws. */
export function travelOf(fixtures: CarrierFixtures): TravelProvider {
  return createCachedProvider({ matrix: fixtures.matrix, polylines: { schemaVersion: 1, polylines: {} } });
}

/** A scenario with its trips and plans, checked: the independent plan check and the story file's expectations. */
function checked(
  fixtures: CarrierFixtures, travel: TravelProvider, run: Pick<CountRun, 'scenario' | 'trips' | 'result'>,
): CountRun {
  const { scenario, trips, result } = run;
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
  return { employees: scenario.employees.length, scenario, trips, result, issues, storyRows };
}

/**
 * The demo scenario with `employees` employees and every other value the schema default, matched and checked
 * on the matrix alone. Throws TravelDataMissingError when the matrix lacks a pair the run needs.
 */
export function runAt(fixtures: CarrierFixtures, employees: number, way: MatchWay = 'plain'): CountRun {
  const request = GenerateScenarioRequest.parse({ preset: 'demo', employees });
  const scenario = buildNycScenario({ ...fixtures, places: fixtures.matrix.places, request });
  const travel = travelOf(fixtures);
  const trips = scenario.employees.flatMap((employee) => buildTrips(employee, travel));
  const ctx = { travel, trips, employees: scenario.employees, businesses: scenario.businesses, settings: scenario.settings };
  const result = way === 'plain'
    ? assignShipments(scenario.shipments, ctx)
    : assignStoryFirst(scenario.shipments, ctx, scenario);
  return checked(fixtures, travel, { scenario, trips, result });
}

/** A stored run in this file's shape, checked. */
export function countRunOf(fixtures: CarrierFixtures, run: Run): CountRun {
  return checked(fixtures, travelOf(fixtures), { scenario: run.scenario, trips: run.trips, result: run.assignments });
}

/** The default run exactly as the server builds it at start (`buildDefaultRun` in server/api/v2/bootRun.ts). */
export function defaultRun(fixtures: CarrierFixtures): Run {
  const { matrix, ...files } = fixtures;
  return buildDefaultRun({ travel: travelOf(fixtures), places: matrix.places, fixtures: files });
}

export type RunAction = { name: string; run: Run };

/**
 * The default run after each action that could move a plan, done with the server's own steps: Recompute and a
 * new planning cycle empty the run and match everything again (planningOps.ts, pipeline.ts `matchEverything`);
 * Play locks it and Back to start returns it to planning (controlOps.ts), which changes the clock only.
 */
export function afterActions(fixtures: CarrierFixtures, run: Run = defaultRun(fixtures)): RunAction[] {
  const deps: PipelineDeps = { travel: travelOf(fixtures), buildEvents: buildTimeline };
  const rematched = (emptied: Run): Run => {
    emptied.notifications = structuredClone(run.notifications); // as the route does, for the notification IDs
    matchEverything(emptied, deps);
    return emptied;
  };
  const recompute = clearForRecompute(run);
  if (recompute.kind !== 'recompute') throw new Error('The default run starts in planning, so Recompute is allowed');
  const control = (from: Run, action: 'play' | 'reset_playback'): Run => {
    const plan = planControl(from, { action });
    if (plan.kind !== 'apply') throw new Error(`The control ${action} was refused`);
    return { ...from, clock: plan.clock };
  };
  return [
    { name: 'Recompute', run: rematched(recompute.run) },
    { name: 'a new planning cycle', run: rematched(beginNewCycle(run)) },
    { name: 'Play and Back to start', run: control(control(run, 'play'), 'reset_playback') },
  ];
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

export type CarrierCountReport = {
  /** The employees of the default run, when its plans are the baseline's and its story check passes; else the baseline count. */
  chosen: number;
  /** Per candidate count, every package matched on every employee at once (#963). */
  verdicts: CountVerdict[];
  /** Per candidate count, matched story first, as the server does (#966). */
  storyFirst: CountVerdict[];
  /** The default run after Recompute, a new planning cycle, and Play then Back to start: the plans that differ. */
  actions: { name: string; changed: string[]; storyOk: boolean }[];
  lines: string[];
};

export function carrierCountReport(fixtures: CarrierFixtures): CarrierCountReport {
  const base = runAt(fixtures, BASELINE_EMPLOYEES);
  const total = base.result.plans.length;
  const verdicts = CANDIDATE_COUNTS.map((employees) => verdictAt(base, runAt(fixtures, employees)));
  const storyFirst = CANDIDATE_COUNTS.map((employees) => verdictAt(base, runAt(fixtures, employees, 'story-first')));

  const booted = defaultRun(fixtures);
  const defaultCount = countRunOf(fixtures, booted);
  const defaultVerdict = verdictAt(base, defaultCount);
  const chosen = largestIdenticalCount([defaultVerdict]);
  const kept = chosen === BASELINE_EMPLOYEES;
  const actions = afterActions(fixtures, booted).map(({ name, run }) => {
    const after = countRunOf(fixtures, run);
    return { name, changed: changedPlans(base, after), storyOk: storyHolds(after) };
  });

  const plansText = (changed: string[]) => (changed.length === 0
    ? `all ${total} plans identical`
    : `${changed.length} ${changed.length === 1 ? 'plan differs' : 'plans differ'} (${changed.join(', ')})`);
  const countLine = (verdict: CountVerdict) =>
    `${String(verdict.employees).padStart(4)} employees: ${plansText(verdict.changed)}; story check ${verdict.storyMatched}/${verdict.storyTotal}`;

  const lines: string[] = [
    `Story plans at each employee count, compared with ${BASELINE_EMPLOYEES} employees (${total} plans, story check ${base.storyRows.filter((row) => row.ok).length}/${base.storyRows.length}).`,
    '',
    'Plain: every package matched on every employee at once (#963):',
    ...verdicts.map(countLine),
    `Largest count that changes nothing: ${largestIdenticalCount(verdicts) === BASELINE_EMPLOYEES ? `none of ${CANDIDATE_COUNTS.join(', ')}` : largestIdenticalCount(verdicts)}.`,
    '',
    `Story first: the story's packages on the first ${BASELINE_EMPLOYEES} employees only, the added employees only for requests sent later (#966):`,
    ...storyFirst.map(countLine),
    `Largest count that changes nothing: ${largestIdenticalCount(storyFirst) === BASELINE_EMPLOYEES ? `none of ${CANDIDATE_COUNTS.join(', ')}` : largestIdenticalCount(storyFirst)}.`,
    '',
    `The default run as the server builds it (${DEFAULT_RUN_REQUEST.employees} employees, story first): ${plansText(defaultVerdict.changed)}; story check ${defaultVerdict.storyMatched}/${defaultVerdict.storyTotal}; plan check ${defaultCount.issues.length === 0 ? 'clean' : `${defaultCount.issues.length} problems`}.`,
    ...actions.map((action) => `  After ${action.name}: ${plansText(action.changed)}; story check ${action.storyOk ? 'passes' : 'FAILS'}`),
    '',
    `Free commutes per business (evening: leaving it, morning: arriving at it), ${kept ? `${BASELINE_EMPLOYEES} employees, unchanged` : `${BASELINE_EMPLOYEES} employees -> ${chosen} employees`}:`,
  ];
  const chosenRun = kept ? base : defaultCount;
  const before = freeCommutes(base);
  const after = freeCommutes(chosenRun);
  const width = Math.max(...before.map((row) => row.name.length));
  // "3" when the count is kept, " 3 ->  5" when it moves.
  const cell = (was: number, now: number) => (kept ? String(was).padStart(2) : `${String(was).padStart(2)} -> ${String(now).padStart(2)}`);
  const sum = (rows: FreeCommutes[], key: 'employees' | 'evening' | 'morning') => rows.reduce((all, row) => all + row[key], 0);
  const least = (rows: FreeCommutes[], key: 'evening' | 'morning') => Math.min(...rows.map((row) => row[key]));
  before.forEach((row, index) => {
    const now = after[index]!;
    lines.push(`  ${row.name.padEnd(width)}  employees ${cell(row.employees, now.employees)}   evening ${cell(row.evening, now.evening)}   morning ${cell(row.morning, now.morning)}`);
  });
  lines.push(`  ${'Total'.padEnd(width)}  employees ${cell(sum(before, 'employees'), sum(after, 'employees'))}   evening ${cell(sum(before, 'evening'), sum(after, 'evening'))}   morning ${cell(sum(before, 'morning'), sum(after, 'morning'))}`);
  lines.push(`  Fewest at one business: evening ${cell(least(before, 'evening'), least(after, 'evening')).trim()}, morning ${cell(least(before, 'morning'), least(after, 'morning')).trim()}`);
  lines.push('', `Story check at ${chosen} employees:`,
    ...formatCheckReport(chosenRun.issues, chosenRun.storyRows, chosenRun.result.plans.length).map((line) => `  ${line}`));
  return { chosen, verdicts, storyFirst, actions, lines };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isEntry = process.argv[1] !== undefined && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isEntry) {
  const report = carrierCountReport(readCarrierFixtures(path.join(repoRoot, 'fixtures', 'nyc')));
  for (const line of report.lines) console.log(line);
}
