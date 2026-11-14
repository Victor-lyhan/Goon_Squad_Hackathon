// The v2 matcher on the default city (preset "demo") and the committed Google cache (issue #493).
// No assertion names a story package, employee, relay business or matched count: the story is being retuned.
import { describe, expect, it } from 'vitest';
import { assignShipments, compareAssignments } from '../../server/domain/v2/matching';
import {
  buildCity, NYC_TEST_TIMEOUT_MS, planIssues, ruleViolations, SPEC_MATCH_LIMIT_MS, timedMatch,
} from './matching-v2-nyc-helper';

const DEFAULT_REQUEST = { preset: 'demo' } as const;

describe('v2 matcher on the committed NYC cache: default workload', () => {
  it('matches the default city under the SPEC 2 s limit after one warm-up run', () => {
    const city = buildCity(DEFAULT_REQUEST);
    const { result, ms } = timedMatch(city);
    console.info(`[matching-v2-nyc] default workload (${city.scenario.employees.length} employees, ` +
      `${city.scenario.shipments.length} packages): assignShipments ${ms.toFixed(1)} ms, ` +
      `${result.plans.length} matched`);
    // SPEC "Matching": under 2 s on the default workload using the cache. A SPEC limit keeps its number (pass 52).
    expect(ms).toBeLessThan(SPEC_MATCH_LIMIT_MS);
    expect(result.plans.length + result.unmatched.length).toBe(city.scenario.shipments.length);
  }, NYC_TEST_TIMEOUT_MS);

  it('gives deep-equal results on two runs, including two separately built scenarios', () => {
    const city = buildCity(DEFAULT_REQUEST);
    const first = assignShipments(city.scenario.shipments, city.ctx);
    expect(assignShipments(city.scenario.shipments, city.ctx)).toEqual(first);
    const rebuilt = buildCity(DEFAULT_REQUEST);
    expect(rebuilt.scenario).toEqual(city.scenario);
    expect(assignShipments(rebuilt.scenario.shipments, rebuilt.ctx)).toEqual(first);
  }, NYC_TEST_TIMEOUT_MS);

  it('passes the independent plan check and every matcher rule', () => {
    const city = buildCity(DEFAULT_REQUEST);
    const result = assignShipments(city.scenario.shipments, city.ctx);
    expect(planIssues(city, result)).toEqual([]);
    expect(ruleViolations(city, result)).toEqual([]);
  }, NYC_TEST_TIMEOUT_MS);

  it('the rule check reports a broken plan (so an empty list above means something)', () => {
    const city = buildCity(DEFAULT_REQUEST);
    const result = structuredClone(assignShipments(city.scenario.shipments, city.ctx));
    const plan = result.plans[0];
    expect(plan).toBeDefined();
    const leg = plan!.legs[0]!;
    leg.stops[0]!.placeId = city.scenario.employees[0]!.homeId;
    leg.extraMin = city.scenario.employees.find(employee => employee.id === leg.employeeId)!.maxExtraMin + 1;
    result.plans.push({ ...plan!, id: `${plan!.id}-copy` });
    const problems = ruleViolations(city, result).join('\n');
    expect(problems).toContain('stop at home');
    expect(problems).toContain('limit');
    expect(problems).toContain('also carries');
  }, NYC_TEST_TIMEOUT_MS);

  it('matches at least as many packages with relay as direct-only', () => {
    const city = buildCity(DEFAULT_REQUEST);
    const { directOnly, withRelay } = compareAssignments(city.scenario.shipments, city.ctx);
    expect(directOnly.plans.every(plan => plan.kind === 'direct')).toBe(true);
    expect(withRelay.plans.length).toBeGreaterThanOrEqual(directOnly.plans.length);
    expect(planIssues(city, directOnly)).toEqual([]);
    expect(ruleViolations(city, directOnly)).toEqual([]);
  }, NYC_TEST_TIMEOUT_MS);
});
