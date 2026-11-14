// #530 and #555, the cases where Google answers every request with an error: a 429 (c) and a 500 (d), each
// 300 ms after the request. A live action tries twice with 0.5 s of backoff, so the pair fetch rejects after
// 1.1 s (it was 4.7 s with the client's bulk limits: 4 tries and 3.5 s of backoff). The budget is 10 s.
// Time is virtual (tests/geo/travel-service-slow-helper.ts): nothing here waits in real time or has a
// wall-clock limit. Sample cache in a temp folder, a fake Google, a fake key: no network, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleApiError } from '../../server/geo/googleClient';
import {
  PAIR_BUDGET_MS, SLOW_TEST_TIMEOUT_MS, expectHonestClock, expectNoKeyIn, expectWholeCache, homeIn, measureCases, rejectionsOf, traceOf,
} from './travel-service-slow-helper';
import type { Measurement } from './travel-service-slow-helper';
import { watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();
let m: Record<'c' | 'd', Measurement>;
beforeAll(async () => {
  m = await measureCases(['c', 'd']);
  suite.errors.push(...rejectionsOf(Object.values(m)));
});

const CASES_HERE = [
  { id: 'c', name: '(c) every request is a 429', status: 429, googleStatus: 'RESOURCE_EXHAUSTED' },
  { id: 'd', name: '(d) every request is a 500', status: 500, googleStatus: 'INTERNAL' },
] as const;

for (const { id, name, status, googleStatus } of CASES_HERE) {
  describe(name, () => {
    it('measures 1.1 s for the pair fetch: 2 requests of 300 ms and 0.5 s of backoff, then it rejects', () => {
      expect(m[id].pairs).toMatchObject({ ms: 1100, requests: 2, settled: 'rejected', fetched: null });
      expect(m[id].sleeps).toEqual([500]);
      // The first matrix request is given up; the second one is never sent.
      expect(traceOf(m[id])).toEqual([1, 2].map((attempt) => `matrix 1 try ${attempt}: ${status} after 300 ms`));
    });

    it('answers 503 after 1.1 s: the two lines are not asked for', () => {
      expect(m[id].lines).toEqual({ ms: 0, requests: 0, settled: 'not called', fetched: null, error: undefined });
      expect(m[id]).toMatchObject({ totalMs: 1100, requests: 2, save: 'refused' });
    });

    it('is within budget: the pair fetch settles within 10 s (1.1 s)', () => {
      expect(m[id].pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    });

    it(`rejects with Google's own error, a GoogleApiError (HTTP ${status} ${googleStatus}), with the key redacted`, () => {
      const error = m[id].pairs.error as GoogleApiError;
      expect(error).toBeInstanceOf(GoogleApiError);
      expect(error.name).toBe('GoogleApiError');
      expect(error).toMatchObject({ status, googleStatus });
      expect(error.message).toContain('[redacted]'); // the fake Google's message held the key
    });

    it('leaves no trace of the home, and the cache files are byte for byte as before', () => {
      expect(homeIn(m[id].disk.files)).toEqual({ place: false, pairs: 0, lines: 0 });
      expect(homeIn(m[id].memory)).toEqual({ place: false, pairs: 0, lines: 0 });
      expect(m[id].disk).toMatchObject({ matrixChanged: false, polylinesChanged: false });
    });
  });
}

describe('every case of this file', () => {
  it('ran on an honest virtual clock: one request at a time, no timer armed, every millisecond accounted for', () => {
    for (const measured of Object.values(m)) expectHonestClock(measured);
  });

  it('left nothing half-written in the temp cache files', () => {
    for (const measured of Object.values(m)) expectWholeCache(measured);
  });

  it('printed nothing, and no rejection holds the key', () => {
    for (const measured of Object.values(m)) expectNoKeyIn(measured);
    suite.expectNoLeak(2);
  });
});
