// Random city at the edges of the simulator's Scenario form, on the committed NYC cache (issue #604).
// A judge can type any allowed value into the form and press Generate. The other Random city tests on the cache
// run only the largest size; here every corner of the form runs for three seeds: the smallest and the largest
// employee count, the smallest and the largest package count, and four detour limits, plus the defaults.
// The ranges come from the generate-request schema. Only rules are asserted: no name, no ID, and no count of
// matches other than "none when the detour limit is 0" (DECISIONS pass 54 and 61).
import { describe, expect, it } from 'vitest';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { planIssues, ruleViolations, SPEC_MATCH_LIMIT_MS } from './matching-v2-nyc-helper';
import {
  daySampleMinutes, detourLimits, EDGE_TEST_TIMEOUT_MS, edgeRequests, edgeRun, formRanges, HANDLING_ONLY_MIN,
  matchAgain, midLegMinutes, missingTravelPairs, reasonWithNoRoomForAStop, schemaAccepts, snapshotProblems,
  unmatchedProblems, type RangeField,
} from './generator-v2-nyc-edges-helper';

const ranges = formRanges();
// The seed the form starts with, and two more.
const SEEDS = [...new Set([ranges.seedDefault, 3, 604])];

describe('Random city at the edges of the Scenario form, on the committed NYC cache', () => {
  describe('the grid', () => {
    it.each(['employees', 'packages', 'maxExtraMin'] as RangeField[])(
      'the %s range read from the schema is the range the schema enforces', field => {
        const { min, max, default: byDefault } = ranges[field];
        expect(min).toBeLessThan(max);
        expect(byDefault).toBeGreaterThanOrEqual(min);
        expect(byDefault).toBeLessThanOrEqual(max);
        expect(schemaAccepts(field, min)).toBe(true);
        expect(schemaAccepts(field, max)).toBe(true);
        expect(schemaAccepts(field, min - 1)).toBe(false);
        expect(schemaAccepts(field, max + 1)).toBe(false);
      });

    it('has the detour limits 0, one minute under the handling time, the handling time and the largest', () => {
      // Pickup and drop-off handling alone add HANDLING_ONLY_MIN minutes, so a limit of 0 has no room for a stop.
      // If the form's smallest limit ever stops being 0, the "matches nothing" rule below needs a new look.
      expect(detourLimits(ranges)).toEqual([0, HANDLING_ONLY_MIN - 1, HANDLING_ONLY_MIN, ranges.maxExtraMin.max]);
    });

    it('covers every corner of the form and the defaults, for three seeds', () => {
      expect(SEEDS).toHaveLength(3);
      for (const seed of SEEDS) {
        const requests = edgeRequests(seed, ranges).map(edge => edge.request);
        expect(new Set(requests.map(request => JSON.stringify(request))).size).toBe(requests.length);
        for (const employees of [ranges.employees.min, ranges.employees.max]) {
          for (const packages of [ranges.packages.min, ranges.packages.max]) {
            for (const maxExtraMin of detourLimits(ranges)) {
              expect(requests).toContainEqual({ preset: 'random', seed, employees, packages, maxExtraMin });
            }
          }
        }
        expect(requests).toContainEqual({
          preset: 'random', seed, employees: ranges.employees.default, packages: ranges.packages.default,
          maxExtraMin: ranges.maxExtraMin.default,
        });
      }
    });
  });

  describe.each(SEEDS)('seed %i', seed => {
    const edges = edgeRequests(seed, ranges);

    describe.each(edges)('$label', ({ request }) => {
      it('generates and matches with no missing travel pair, and the plan check reports nothing', () => {
        const edge = edgeRun(request); // a missing pair fails here, with both place IDs in the message
        const { scenario, assignments } = edge.run;
        expect(scenario.preset).toBe('random');
        expect(scenario.employees).toHaveLength(request.employees);
        expect(scenario.shipments).toHaveLength(request.packages);
        expect(scenario.employees.filter(employee => employee.maxExtraMin !== request.maxExtraMin)).toEqual([]);
        expect(missingTravelPairs(edge)).toEqual([]);
        expect(assignments.plans.length + assignments.unmatched.length).toBe(request.packages);
        expect(planIssues(edge.city, assignments)).toEqual([]);
        expect(ruleViolations(edge.city, assignments)).toEqual([]);
      }, EDGE_TEST_TIMEOUT_MS);

      it('gives the same scenario and the same plans a second time, matched under the SPEC 2 s limit', () => {
        const edge = edgeRun(request);
        const again = matchAgain(request);
        expect(again.city.scenario).toEqual(edge.run.scenario);
        expect(again.result).toEqual(edge.run.assignments);
        // SPEC "Matching" 2 s limit; it keeps its number (DECISIONS pass 52). The largest size is the slowest.
        expect(again.ms).toBeLessThan(SPEC_MATCH_LIMIT_MS);
      }, EDGE_TEST_TIMEOUT_MS);

      it('gives every unmatched package one of the matcher\'s sentences as its reason', () => {
        expect(unmatchedProblems(edgeRun(request))).toEqual([]);
      }, EDGE_TEST_TIMEOUT_MS);

      it('has a sound snapshot at the start, at five minutes over the day, at the end and halfway through every leg', () => {
        const edge = edgeRun(request);
        const problems: string[] = [];
        for (const minute of daySampleMinutes(edge.run)) {
          problems.push(...snapshotProblems(edge, snapshotAt(edge.run, minute, edge.travel)));
        }
        for (const [minute, carriers] of midLegMinutes(edge.run)) {
          problems.push(...snapshotProblems(edge, snapshotAt(edge.run, minute, edge.travel), carriers));
        }
        expect(problems).toEqual([]);
      }, EDGE_TEST_TIMEOUT_MS);
    });

    describe.each(edges.filter(edge => edge.request.maxExtraMin === 0))('$label: no room for a stop', ({ request }) => {
      it('matches no package, and every reason is the added-time sentence wherever a commute could be in time', () => {
        const edge = edgeRun(request);
        const { plans, unmatched } = edge.run.assignments;
        expect(plans).toEqual([]);
        const reasons = new Map(unmatched.map(row => [row.shipmentId, row.reason]));
        const wrong = edge.run.scenario.shipments.flatMap(shipment => {
          const expected = reasonWithNoRoomForAStop(edge, shipment);
          const actual = reasons.get(shipment.id);
          return actual === expected ? [] : [`${shipment.id}: "${String(actual)}", expected "${expected}"`];
        });
        expect(wrong).toEqual([]);
      }, EDGE_TEST_TIMEOUT_MS);
    });
  });
});
