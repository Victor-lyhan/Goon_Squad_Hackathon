// The v2 matcher on Random cities over the committed Google cache (issue #493). DECISIONS pass 44: the Random
// preset draws its homes from the fetched 120-home pool, so it never needs a live Google call. A missing pair
// would throw TravelDataMissingError, whose message names both place IDs ("No travel matrix data for a|b").
import { describe, expect, it } from 'vitest';
import { TravelDataMissingError } from '../../shared/v2/types';
import { assignShipments, compareAssignments } from '../../server/domain/v2/matching';
import {
  buildCity, NYC_TEST_TIMEOUT_MS, planIssues, ruleViolations, SPEC_MATCH_LIMIT_MS, timedMatch, type NycCity,
} from './matching-v2-nyc-helper';

const SEEDS = [1, 7, 42, 2026, 99_991];
const randomRequest = (seed: number) => ({ preset: 'random', seed, employees: 120, packages: 60 }) as const;

/** Runs `work`; a TravelDataMissingError fails with the two place IDs in the message instead of a bare throw. */
function withoutMissingPairs<T>(seed: number, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TravelDataMissingError) {
      throw new Error(`Random city seed ${seed} needs a pair the committed cache lacks: ${error.from} -> ${error.to} ` +
        `(${error.message})`);
    }
    throw error;
  }
}

describe('v2 matcher on the committed NYC cache: Random cities, 120 employees, 60 packages', () => {
  describe.each(SEEDS)('seed %i', seed => {
    const city = (): NycCity => withoutMissingPairs(seed, () => buildCity(randomRequest(seed)));

    it('builds and matches with no missing travel pair, under the SPEC 2 s limit after one warm-up run', () => {
      const built = city();
      expect(built.scenario.employees).toHaveLength(120);
      expect(built.scenario.shipments).toHaveLength(60);
      const { result, ms } = withoutMissingPairs(seed, () => timedMatch(built));
      console.info(`[matching-v2-nyc] random seed ${seed}: assignShipments ${ms.toFixed(1)} ms, ` +
        `${result.plans.length} of ${built.scenario.shipments.length} matched`);
      // SPEC "Matching" 2 s limit; it keeps its number (DECISIONS pass 52).
      expect(ms).toBeLessThan(SPEC_MATCH_LIMIT_MS);
      expect(result.plans.length + result.unmatched.length).toBe(built.scenario.shipments.length);
    }, NYC_TEST_TIMEOUT_MS);

    it('is deterministic, passes the plan check and keeps every matcher rule', () => {
      const built = city();
      const first = withoutMissingPairs(seed, () => assignShipments(built.scenario.shipments, built.ctx));
      expect(assignShipments(built.scenario.shipments, built.ctx)).toEqual(first);
      const rebuilt = city();
      expect(assignShipments(rebuilt.scenario.shipments, rebuilt.ctx)).toEqual(first);
      expect(withoutMissingPairs(seed, () => planIssues(built, first))).toEqual([]);
      expect(ruleViolations(built, first)).toEqual([]);
    }, NYC_TEST_TIMEOUT_MS);

    it('matches at least as many packages with relay as direct-only', () => {
      const built = city();
      const { directOnly, withRelay } = withoutMissingPairs(seed,
        () => compareAssignments(built.scenario.shipments, built.ctx));
      expect(directOnly.plans.every(plan => plan.kind === 'direct')).toBe(true);
      expect(withRelay.plans.length).toBeGreaterThanOrEqual(directOnly.plans.length);
    }, NYC_TEST_TIMEOUT_MS);
  });
});
