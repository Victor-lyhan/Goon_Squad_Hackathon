// The default employee count must not move the story (#963). `scripts/carrier-count-check.ts` builds the demo
// scenario at 60 employees and at 70, 80, ... 120 on the committed matrix and compares the 24 plans; this file
// runs the same functions and holds the rule: the schema default gives exactly the plans of the 60-employee
// story (every field: kind, carriers, relay point, stop times) with a passing story check.
// Rules only (DECISIONS pass 54): no story ID and no count of plans that differ is pinned here, so the story
// can be retuned. If the first test fails after raising the default, run the script and take the count it names.
import { describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/v2/schemas';
import { DEFAULT_RUN_REQUEST } from '../../server/api/v2/bootRun';
import {
  BASELINE_EMPLOYEES, CANDIDATE_COUNTS, carrierCountReport, changedPlans, freeCommutes, largestIdenticalCount,
  readCarrierFixtures, runAt, storyHolds, verdictAt, type CountVerdict,
} from '../../scripts/carrier-count-check';
import { fixturesDir } from './generator-v2-nyc-story-helper';

/** Explicit limit (DECISIONS pass 19): one run takes about 30 ms locally, the report builds seven. */
const TIMEOUT_MS = 20_000;

const fixtures = readCarrierFixtures(fixturesDir);
const base = runAt(fixtures, BASELINE_EMPLOYEES);
const defaultCount = GenerateScenarioRequest.parse({ preset: 'demo' }).employees;

describe('the default employee count leaves the NYC story as it is', () => {
  it('gives the 24 plans of the 60-employee story, field for field, with a passing story check', () => {
    const run = runAt(fixtures, defaultCount);
    expect(storyHolds(base)).toBe(true);
    expect(storyHolds(run)).toBe(true);
    expect(changedPlans(base, run)).toEqual([]);
    expect(run.result.plans).toEqual(base.result.plans);
  }, TIMEOUT_MS);

  it('is the count the server boots with, and the baseline or one of the counts the check tries', () => {
    expect(DEFAULT_RUN_REQUEST.employees).toBe(defaultCount);
    expect([BASELINE_EMPLOYEES, ...CANDIDATE_COUNTS]).toContain(defaultCount);
  }, TIMEOUT_MS);

  it('is the count the check names: the largest one that changes no plan', () => {
    expect(carrierCountReport(fixtures).chosen).toBe(defaultCount);
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

  it('prints one line per count, the count it names, the free commutes and the story check', () => {
    const report = carrierCountReport(fixtures);
    expect(report.verdicts.map((verdict) => verdict.employees)).toEqual([...CANDIDATE_COUNTS]);
    for (const count of CANDIDATE_COUNTS) {
      expect(report.lines.filter((line) => line.trimStart().startsWith(`${count} employees: `)), `${count}`).toHaveLength(1);
    }
    expect(report.lines.filter((line) => line.startsWith('Largest count that changes nothing: '))).toHaveLength(1);
    for (const business of base.scenario.businesses) {
      expect(report.lines.filter((line) => line.startsWith(`  ${business.name} `)), business.name).toHaveLength(1);
    }
    expect(report.lines).toContain(`Story check at ${report.chosen} employees:`);
    expect(report.lines).toContain(`  ${base.result.plans.length} plans checked, 0 problems`);
    expect(report.lines.filter((line) => line.startsWith('  OK shp-'))).toHaveLength(base.scenario.shipments.length);
    expect(report.lines.filter((line) => line.includes('FAIL'))).toEqual([]);
  }, TIMEOUT_MS);
});
