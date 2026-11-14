// #530, the whole picture: every case of travel-service-slow-helper.ts measured once, and
// - the replay is the commute route's (same pairs, same order of calls) on the 18-business sample cache;
// - the virtual clock is honest: it charges what the client itself asks for (15 s per attempt, read from the
//   client's AbortSignal.timeout call; 0.5 s, 1 s, 2 s of backoff, read from the injected sleep), one request
//   at a time, with no real timer;
// - every rejection is a known error class without the key, and no cache file is left half-written;
// - the Markdown table of the PR is pinned word for word, so the numbers in SUMMARY.md are the tested ones.
// Nothing here waits in real time or has a wall-clock limit. No network, no real key, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { BACKOFF_BASE_MS, DEFAULT_TIMEOUT_MS, GoogleApiError, GoogleKeyMissingError, MAX_RETRIES } from '../../server/geo/googleClient';
import {
  CASES, HOME, SLOW_TEST_TIMEOUT_MS, businessIds, expectHonestClock, expectNoKeyIn, expectWholeCache, homeIn, measureCases, neededForHome,
  rejectionsOf, sampleCache, tableOf, workplaceId,
} from './travel-service-slow-helper';
import type { CaseId, Measurement } from './travel-service-slow-helper';
import { watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();
const IDS = Object.keys(CASES) as CaseId[];
let m: Record<CaseId, Measurement>;
let all: Measurement[];
beforeAll(async () => {
  m = await measureCases(IDS);
  all = IDS.map((id) => m[id]);
  suite.errors.push(...rejectionsOf(all));
});

describe('the replay is the commute route for one new home', () => {
  it('runs on the sample cache: 18 businesses with every pair among them, and the new home is not in it', () => {
    const sample = sampleCache();
    const businesses = businessIds();
    expect(businesses).toHaveLength(18);
    for (const a of businesses) for (const b of businesses) if (a !== b) expect(Object.hasOwn(sample.matrix.pairs, pairKey(a, b))).toBe(true);
    expect(homeIn(sample)).toEqual({ place: false, pairs: 0, lines: 0 });
  });

  it('asks for the home against the 18 businesses both ways (36 pairs) and for the two commute lines', () => {
    const { matrix, polylines } = neededForHome();
    const keys = matrix.map(({ from, to }) => pairKey(from, to));
    expect(new Set(keys).size).toBe(36);
    expect(new Set(keys)).toEqual(new Set(businessIds().flatMap((biz) => [pairKey(HOME, biz), pairKey(biz, HOME)])));
    expect(polylines).toEqual([{ from: workplaceId(), to: HOME }, { from: HOME, to: workplaceId() }]);
  });

  it('sends the 36 pairs as 2 matrix requests and the lines as 2 requests, pairs first', () => {
    expect(m.a.attempts.map(({ what, request }) => `${what} ${request + 1}`)).toEqual(['matrix 1', 'matrix 2', 'line 1', 'line 2']);
  });

  it('never asks for the lines after a rejected pair fetch, like the route (it answers 503 there)', () => {
    for (const measured of all) {
      expect(measured.lines.settled === 'not called').toBe(measured.pairs.settled === 'rejected');
      expect(measured.save === 'refused').toBe(measured.pairs.settled === 'rejected');
    }
  });
});

describe('the virtual clock charges what the client asks for', () => {
  it('every attempt has the timeout the client gave AbortSignal.timeout: 15 s, the client default', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    for (const measured of all) for (const attempt of measured.attempts) expect(attempt.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(m.b.attempts.length).toBeGreaterThan(0); // the loop above had something to look at
  });

  it('an attempt without an answer costs exactly its timeout, an answered one its answer time', () => {
    for (const measured of all) {
      for (const attempt of measured.attempts) {
        if (attempt.result === 'timeout') expect(attempt.ms).toBe(attempt.timeoutMs);
        else expect(attempt.ms).toBeLessThan(attempt.timeoutMs);
      }
    }
  });

  it('a request is tried 4 times, with 0.5 s, 1 s and 2 s of backoff in between', () => {
    expect([MAX_RETRIES, BACKOFF_BASE_MS]).toEqual([3, 500]);
    expect(m.b.attempts.map(({ request, attempt }) => [request, attempt])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
    expect(m.b.sleeps).toEqual([500, 1000, 2000]);
  });

  it('is honest in every case: one request at a time, no timer armed, every millisecond accounted for', () => {
    for (const measured of all) expectHonestClock(measured);
  });

  it('puts the real timers and the real AbortSignal.timeout back', () => {
    expect(vi.isFakeTimers()).toBe(false);
    expect(vi.isMockFunction(AbortSignal.timeout)).toBe(false);
  });
});

describe('every failing case', () => {
  const failing = () => all.filter((measured) => measured.pairs.settled === 'rejected' || measured.lines.settled === 'rejected');

  it('rejects with a known error class: GoogleApiError, or GoogleKeyMissingError without a key', () => {
    expect(failing().map((measured) => measured.label)).toEqual([CASES.b.label, CASES.c.label, CASES.d.label, CASES.f.label, CASES.half.label, CASES.noKey.label]);
    for (const error of rejectionsOf(failing())) {
      // The exact class, not a subclass: these are the two names the 503 handler knows.
      expect([GoogleApiError, GoogleKeyMissingError]).toContain((error as Error).constructor);
    }
    expect(rejectionsOf(failing())).toHaveLength(6);
    expect(m.noKey.pairs.error).toBeInstanceOf(GoogleKeyMissingError);
  });

  it('holds the key in no view of its error, and printed nothing', () => {
    for (const measured of all) expectNoKeyIn(measured);
    suite.expectNoLeak(6);
  });

  it('leaves nothing half-written in the temp cache files (and neither does a case that succeeds)', () => {
    for (const measured of all) expectWholeCache(measured);
  });
});

// The table of the PR (SUMMARY.md). "(n)" is the number of Google requests, retries included.
const TABLE = `
| Case | Pair fetch (requests) | Two lines add (requests) | Total wait (requests) | Outcome | Budget 10 s + 5 s |
| --- | --- | --- | --- | --- | --- |
| (a) every request answers after 300 ms | 0.6 s (2) | 0.6 s (2) | 1.2 s (4) | saved; 36 of 36 pairs and 2 of 2 lines cached | within |
| (b) Google never answers | 63.5 s (4) | not called | 63.5 s (4) | 503, run untouched: GoogleApiError (no response, NETWORK_ERROR); 0 of 36 pairs and 0 of 2 lines cached | OVER: pairs over 10 s |
| (c) every request is a 429 (after 300 ms) | 4.7 s (4) | not called | 4.7 s (4) | 503, run untouched: GoogleApiError (HTTP 429, RESOURCE_EXHAUSTED); 0 of 36 pairs and 0 of 2 lines cached | within |
| (d) every request is a 500 (after 300 ms) | 4.7 s (4) | not called | 4.7 s (4) | 503, run untouched: GoogleApiError (HTTP 500, INTERNAL); 0 of 36 pairs and 0 of 2 lines cached | within |
| (e) the first attempt of every request is a 500, the second answers | 2.2 s (4) | 2.2 s (4) | 4.4 s (8) | saved; 36 of 36 pairs and 2 of 2 lines cached | within |
| (e, silent) only the very first attempt never answers, the second answers | 16.1 s (3) | 0.6 s (2) | 16.7 s (5) | saved; 36 of 36 pairs and 2 of 2 lines cached | OVER: pairs over 10 s |
| (f) the matrix answers, the route lines never do | 0.6 s (2) | 63.5 s (4) | 64.1 s (6) | saved without route lines: GoogleApiError (no response, NETWORK_ERROR); 36 of 36 pairs and 0 of 2 lines cached | OVER: lines over 5 s |
| (extra) the first matrix request answers, the second never does | 63.8 s (5) | not called | 63.8 s (5) | 503, run untouched: GoogleApiError (no response, NETWORK_ERROR); 18 of 36 pairs and 0 of 2 lines cached | OVER: pairs over 10 s |
| (extra) the longest wait the retry rules allow: every request answers on its last attempt, 1 ms before the timeout | 126.998 s (8) | 126.998 s (8) | 253.996 s (16) | saved; 36 of 36 pairs and 2 of 2 lines cached | OVER: pairs over 10 s, lines over 5 s |
| (extra) the server has no Google key | 0 s (0) | not called | 0 s (0) | 503, run untouched: GoogleKeyMissingError; 0 of 36 pairs and 0 of 2 lines cached | within |
`.trim();

describe('the table of all cases', () => {
  it('is exactly the table in the PR description', () => {
    expect(tableOf(all)).toBe(TABLE);
  });

  it('is the same on a second run: the measurement does not depend on the machine or the moment', async () => {
    const again = await measureCases(IDS);
    expect(tableOf(IDS.map((id) => again[id]))).toBe(TABLE);
  });
});
