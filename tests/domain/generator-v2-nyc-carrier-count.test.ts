// More employees must not move the story (#963, #966). `scripts/carrier-count-check.ts` builds the demo scenario
// at 60 employees and at 70, 80, ... 120 on the committed matrix and compares the 24 plans, matched plainly and
// story first; this file runs the same functions and holds the rules:
// - the default run, as the server builds it, has exactly the plans of the 60-employee story (every field: kind,
//   carriers, relay point, stop times) with a passing story check, and its added employees carry nothing;
// - Recompute, a new planning cycle and Play then Back to start leave those plans as they are;
// - matched story first, every count the check tries keeps them; matched plainly, the counts that do not are
//   only reported, never pinned.
// Rules only (DECISIONS pass 54): no story ID and no count of plans that differ is pinned here, so the story
// can be retuned.
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { DEFAULT_RUN_EMPLOYEES, DEFAULT_RUN_REQUEST } from '../../server/api/v2/bootRun';
import { STORY_EMPLOYEES } from '../../server/api/v2/storyFirst';
import {
  afterActions, BASELINE_EMPLOYEES, CANDIDATE_COUNTS, carrierCountReport, changedPlans, countRunOf, defaultRun,
  freeCommutes, largestIdenticalCount, readCarrierFixtures, runAt, storyHolds, verdictAt, type CountVerdict,
} from '../../scripts/carrier-count-check';
import { fixturesDir } from './generator-v2-nyc-story-helper';

/** Explicit limit (DECISIONS pass 19): one run takes about 30 ms locally, the report builds about twenty. */
const TIMEOUT_MS = 30_000;

const fixtures = readCarrierFixtures(fixturesDir);
const base = runAt(fixtures, BASELINE_EMPLOYEES);
const booted = defaultRun(fixtures);
const bootedRun = countRunOf(fixtures, booted);

describe('the default run has more employees than the story and leaves the story as it is', () => {
  it('gives the 24 plans of the 60-employee story, field for field, with a passing story check', () => {
    expect(storyHolds(base)).toBe(true);
    expect(storyHolds(bootedRun)).toBe(true);
    expect(changedPlans(base, bootedRun)).toEqual([]);
    expect(booted.assignments.plans).toEqual(base.result.plans);
    expect(booted.assignments.unmatched).toEqual([]);
    expect(bootedRun.issues).toEqual([]);
  }, TIMEOUT_MS);

  it('has the story\'s 60 employees first, unchanged, then the added ones, and the same 24 packages', () => {
    expect(BASELINE_EMPLOYEES).toBe(STORY_EMPLOYEES);
    expect(STORY_EMPLOYEES).toBe(GenerateScenarioRequest.parse({ preset: 'demo' }).employees);
    expect(DEFAULT_RUN_REQUEST.employees).toBe(DEFAULT_RUN_EMPLOYEES);
    expect(DEFAULT_RUN_EMPLOYEES).toBeGreaterThan(STORY_EMPLOYEES);
    expect(booted.scenario.employees).toHaveLength(DEFAULT_RUN_EMPLOYEES);
    expect(booted.scenario.employees.slice(0, STORY_EMPLOYEES)).toEqual(base.scenario.employees);
    expect(booted.scenario.homes.slice(0, STORY_EMPLOYEES)).toEqual(base.scenario.homes);
    expect(booted.trips.slice(0, base.trips.length)).toEqual(base.trips);
    expect(booted.scenario.shipments).toEqual(base.scenario.shipments);
    expect(booted.scenario.businesses).toEqual(base.scenario.businesses);
    expect(booted.scenario.settings).toEqual(base.scenario.settings);
  }, TIMEOUT_MS);

  it('gives the added employees nothing to carry: both commutes of each are free, at their own business', () => {
    const added = booted.scenario.employees.slice(STORY_EMPLOYEES);
    const addedIds = new Set(added.map((employee) => employee.id));
    expect(booted.jobs.filter((job) => addedIds.has(job.employeeId))).toEqual([]);
    expect(booted.assignments.plans.flatMap((plan) => plan.legs).filter((leg) => addedIds.has(leg.employeeId))).toEqual([]);
    for (const employee of added) {
      expect(booted.trips.filter((trip) => trip.employeeId === employee.id).map((trip) => trip.direction).sort(), employee.id)
        .toEqual(['evening', 'morning']);
    }
    // So every business has at least the free commutes it had, plus two per added employee.
    const before = freeCommutes(base);
    const after = freeCommutes(bootedRun);
    after.forEach((row, index) => {
      const was = before[index]!;
      const more = row.employees - was.employees;
      expect(more, row.name).toBeGreaterThanOrEqual(0);
      expect([row.evening, row.morning], row.name).toEqual([was.evening + more, was.morning + more]);
    });
    const total = (rows: typeof after) => rows.reduce((sum, row) => sum + row.evening + row.morning, 0);
    expect(total(after) - total(before)).toBe(2 * (DEFAULT_RUN_EMPLOYEES - STORY_EMPLOYEES));
    // The reason for the change (#963): no business is left without a free commute in either direction.
    expect(Math.min(...after.map((row) => Math.min(row.evening, row.morning)))).toBeGreaterThan(0);
  }, TIMEOUT_MS);

  it('uses only homes the committed matrix has against every business, both ways: nothing to fetch', () => {
    const { pairs, places } = fixtures.matrix;
    for (const employee of booted.scenario.employees) {
      expect(Object.hasOwn(places, employee.homeId), employee.homeId).toBe(true);
      for (const business of booted.scenario.businesses) {
        expect(Object.hasOwn(pairs, `${employee.homeId}|${business.id}`), `${employee.homeId} -> ${business.id}`).toBe(true);
        expect(Object.hasOwn(pairs, `${business.id}|${employee.homeId}`), `${business.id} -> ${employee.homeId}`).toBe(true);
      }
    }
    // The added employees live in pool homes (`home-001` ... `home-120`), never in a new place.
    for (const employee of booted.scenario.employees.slice(STORY_EMPLOYEES)) {
      expect(employee.homeId, employee.id).toMatch(/^home-\d{3}$/);
    }
    expect(new Set(booted.scenario.employees.map((employee) => employee.homeId)).size).toBe(DEFAULT_RUN_EMPLOYEES);
  }, TIMEOUT_MS);

  it('keeps the 24 plans through Recompute, a new planning cycle, and Play then Back to start', () => {
    const actions = afterActions(fixtures, booted);
    expect(actions.map((action) => action.name)).toEqual(['Recompute', 'a new planning cycle', 'Play and Back to start']);
    for (const { name, run } of actions) {
      expect(run.assignments.plans, name).toEqual(booted.assignments.plans);
      expect(run.assignments.unmatched, name).toEqual([]);
      expect(run.jobs, name).toEqual(booted.jobs);
      expect(run.events, name).toEqual(booted.events);
      expect(run.scenario, name).toEqual(booted.scenario);
      expect(run.trips, name).toEqual(booted.trips);
      expect(storyHolds(countRunOf(fixtures, run)), name).toBe(true);
    }
    const [recompute, cycle, backToStart] = actions.map((action) => action.run);
    expect(recompute!.runId).toBe(booted.runId);
    expect(cycle!.runId).not.toBe(booted.runId);
    expect(backToStart!.clock).toEqual({ ...booted.clock, phase: 'planning', playing: false });
    // The run the actions started from is not changed by them.
    expect(booted.assignments.plans).toEqual(base.result.plans);
  }, TIMEOUT_MS);

  it('is the count the check names, with every candidate count keeping the plans when matched story first', () => {
    const report = carrierCountReport(fixtures);
    expect(report.chosen).toBe(DEFAULT_RUN_REQUEST.employees);
    expect([BASELINE_EMPLOYEES, ...CANDIDATE_COUNTS]).toContain(DEFAULT_RUN_REQUEST.employees);
    expect(report.storyFirst.map((verdict) => verdict.employees)).toEqual([...CANDIDATE_COUNTS]);
    for (const verdict of report.storyFirst) {
      expect(verdict.changed, `${verdict.employees}`).toEqual([]);
      expect(verdict.storyOk, `${verdict.employees}`).toBe(true);
    }
    for (const action of report.actions) {
      expect(action.changed, action.name).toEqual([]);
      expect(action.storyOk, action.name).toBe(true);
    }
  }, TIMEOUT_MS);

  it('needs the story-first order: matched plainly, the default count would not be the count the check names', () => {
    // Whatever a plain match does at the default count (today it moves plans, #963), the server does not use it:
    // the plain verdict and the story-first verdict are computed apart, and only the second one is the run's.
    const plain = verdictAt(base, runAt(fixtures, DEFAULT_RUN_EMPLOYEES));
    const storyFirst = verdictAt(base, runAt(fixtures, DEFAULT_RUN_EMPLOYEES, 'story-first'));
    expect(storyFirst).toEqual({ ...verdictAt(base, bootedRun), employees: DEFAULT_RUN_EMPLOYEES });
    expect(storyFirst.changed).toEqual([]);
    if (plain.changed.length === 0) {
      // The story was retuned so that even a plain match keeps it: then both ways agree.
      expect(runAt(fixtures, DEFAULT_RUN_EMPLOYEES).result.plans).toEqual(booted.assignments.plans);
    } else {
      expect(largestIdenticalCount([plain])).toBe(BASELINE_EMPLOYEES);
    }
  }, TIMEOUT_MS);
});

describe('the carrier count check', () => {
  it('adds employees to the 60 it starts from: every larger run keeps them, their homes and the 24 packages', () => {
    for (const count of CANDIDATE_COUNTS) {
      const run = runAt(fixtures, count);
      expect(run.scenario.employees, `${count}`).toHaveLength(count);
      expect(run.scenario.employees.slice(0, BASELINE_EMPLOYEES), `${count}`).toEqual(base.scenario.employees);
      expect(run.scenario.shipments, `${count}`).toEqual(base.scenario.shipments);
      // Matched on the committed matrix alone: a pair it lacked would have thrown, and no plan may break a rule.
      expect(run.issues, `${count}`).toEqual([]);
    }
  }, TIMEOUT_MS);

  it('counts a plan as changed when any field differs, when it is gone and when it is new', () => {
    expect(changedPlans(base, base)).toEqual([]);
    const [first, second] = base.result.plans;
    const later = { ...first!, legs: first!.legs.map((leg) => ({ ...leg, stops: leg.stops.map((stop) => ({ ...stop, arrivalMin: stop.arrivalMin + 1 })) })) };
    const moved = { ...base, result: { ...base.result, plans: [later, ...base.result.plans.slice(1)] } };
    expect(changedPlans(base, moved)).toEqual([first!.shipmentId]);
    const gone = { ...base, result: { ...base.result, plans: base.result.plans.filter((plan) => plan !== second) } };
    expect(changedPlans(base, gone)).toEqual([second!.shipmentId]);
    expect(changedPlans(gone, base)).toEqual([second!.shipmentId]);
  }, TIMEOUT_MS);

  it('picks the largest count with no changed plan and a passing story check, else the baseline', () => {
    const verdict = (employees: number, changed: string[], storyOk = true): CountVerdict =>
      ({ employees, changed, storyOk, storyMatched: storyOk ? 24 : 23, storyTotal: 24 });
    expect(largestIdenticalCount([])).toBe(BASELINE_EMPLOYEES);
    expect(largestIdenticalCount([verdict(70, ['shp-1']), verdict(80, ['shp-2'])])).toBe(BASELINE_EMPLOYEES);
    expect(largestIdenticalCount([verdict(70, []), verdict(80, []), verdict(90, ['shp-2'])])).toBe(80);
    // A count is judged on its own run: a smaller count that moves a plan does not rule out a larger one.
    expect(largestIdenticalCount([verdict(70, ['shp-1']), verdict(80, [])])).toBe(80);
    expect(largestIdenticalCount([verdict(70, []), verdict(80, [], false)])).toBe(70);
    expect(verdictAt(base, base)).toEqual({ employees: BASELINE_EMPLOYEES, changed: [], storyOk: true, storyMatched: 24, storyTotal: 24 });
  }, TIMEOUT_MS);

  it('counts as free every commute of a business that carries no package', () => {
    for (const run of [base, runAt(fixtures, CANDIDATE_COUNTS.at(-1)!)]) {
      const rows = freeCommutes(run);
      const reserved = new Set(run.result.plans.flatMap((plan) => plan.legs.map((leg) => leg.tripId)));
      expect(rows.map((row) => row.businessId)).toEqual(run.scenario.businesses.map((business) => business.id));
      expect(rows.reduce((sum, row) => sum + row.employees, 0)).toBe(run.scenario.employees.length);
      expect(rows.reduce((sum, row) => sum + row.evening + row.morning, 0)).toBe(run.trips.length - reserved.size);
      for (const row of rows) {
        expect(row.evening, row.name).toBeLessThanOrEqual(row.employees);
        expect(row.morning, row.name).toBeLessThanOrEqual(row.employees);
      }
    }
  }, TIMEOUT_MS);

  it('prints one line per count and way, the default run, the three actions, the free commutes and the story check', () => {
    const report = carrierCountReport(fixtures);
    expect(report.verdicts.map((verdict) => verdict.employees)).toEqual([...CANDIDATE_COUNTS]);
    for (const count of CANDIDATE_COUNTS) {
      // Once matched plainly and once story first.
      expect(report.lines.filter((line) => line.trimStart().startsWith(`${count} employees: `)), `${count}`).toHaveLength(2);
    }
    expect(report.lines.filter((line) => line.startsWith('Largest count that changes nothing: '))).toHaveLength(2);
    expect(report.lines.filter((line) => line.startsWith('The default run as the server builds it ('))).toHaveLength(1);
    for (const name of ['Recompute', 'a new planning cycle', 'Play and Back to start']) {
      expect(report.lines, name).toContain(`  After ${name}: all ${base.result.plans.length} plans identical; story check passes`);
    }
    for (const business of base.scenario.businesses) {
      expect(report.lines.filter((line) => line.startsWith(`  ${business.name} `)), business.name).toHaveLength(1);
    }
    expect(report.lines).toContain(`Story check at ${report.chosen} employees:`);
    expect(report.lines).toContain(`  ${base.result.plans.length} plans checked, 0 problems`);
    expect(report.lines.filter((line) => line.startsWith('  OK shp-'))).toHaveLength(base.scenario.shipments.length);
    expect(report.lines.filter((line) => line.includes('FAIL'))).toEqual([]);
  }, TIMEOUT_MS);
});
