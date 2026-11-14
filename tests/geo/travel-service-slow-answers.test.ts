// #530, the cases where Google answers: how long a new-address commute save waits when every request answers
// after 300 ms (a), when the first attempt of every request is a 500 and the retry answers (e), and when the
// server has no key at all (no request, no wait). All three are within the budget: 10 s for the pair fetch,
// 5 s more for the two commute lines.
// Time is virtual (tests/geo/travel-service-slow-helper.ts): nothing here waits in real time or has a
// wall-clock limit. Sample cache in a temp folder, a fake Google, a fake key: no network, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleKeyMissingError } from '../../server/geo/googleClient';
import {
  LINES_BUDGET_MS, PAIR_BUDGET_MS, SLOW_TEST_TIMEOUT_MS, expectHonestClock, expectNoKeyIn, expectWholeCache, homeIn, measureCases, rejectionsOf, traceOf,
} from './travel-service-slow-helper';
import type { Measurement } from './travel-service-slow-helper';
import { watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();
let m: Record<'a' | 'e' | 'noKey', Measurement>;
beforeAll(async () => {
  m = await measureCases(['a', 'e', 'noKey']);
  suite.errors.push(...rejectionsOf(Object.values(m)));
});

describe('(a) every request answers after 300 ms', () => {
  it('measures 0.6 s for the 36 pairs (2 requests) and 0.6 s more for the two lines (2 requests): saved after 1.2 s', () => {
    expect(m.a.pairs).toEqual({ ms: 600, requests: 2, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.a.lines).toEqual({ ms: 600, requests: 2, settled: 'resolved', fetched: 2, error: undefined });
    expect(m.a).toMatchObject({ totalMs: 1200, requests: 4, save: 'saved', sleeps: [] });
    // The 36 pairs are two matrix requests (18 businesses -> home, home -> 18 businesses), one after the other.
    expect(traceOf(m.a)).toEqual([
      'matrix 1 try 1: 200 after 300 ms',
      'matrix 2 try 1: 200 after 300 ms',
      'line 1 try 1: 200 after 300 ms',
      'line 2 try 1: 200 after 300 ms',
    ]);
  });

  it('is within budget: the pair fetch settles within 10 s (0.6 s) and the two lines add at most 5 s (0.6 s)', () => {
    expect(m.a.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    expect(m.a.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and both lines in the cache files', () => {
    expect(homeIn(m.a.disk.files)).toEqual({ place: true, pairs: 36, lines: 2 });
  });
});

describe('(e) the first attempt of every request is a 500, the second answers', () => {
  it('measures 2.2 s for the pairs (4 requests) and 2.2 s more for the lines (4 requests): saved after 4.4 s', () => {
    expect(m.e.pairs).toEqual({ ms: 2200, requests: 4, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.e.lines).toEqual({ ms: 2200, requests: 4, settled: 'resolved', fetched: 2, error: undefined });
    // Each of the four requests: 300 ms for the 500, 500 ms of backoff, 300 ms for the answer.
    expect(m.e).toMatchObject({ totalMs: 4400, requests: 8, save: 'saved', sleeps: [500, 500, 500, 500] });
    expect(traceOf(m.e)).toEqual(
      ['matrix 1', 'matrix 2', 'line 1', 'line 2'].flatMap((request) => [`${request} try 1: 500 after 300 ms`, `${request} try 2: 200 after 300 ms`]),
    );
  });

  it('is within budget: the pair fetch settles within 10 s (2.2 s) and the two lines add at most 5 s (2.2 s)', () => {
    expect(m.e.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    expect(m.e.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and both lines in the cache files', () => {
    expect(homeIn(m.e.disk.files)).toEqual({ place: true, pairs: 36, lines: 2 });
  });
});

describe('(extra) the server has no Google key', () => {
  it('measures 0 s and 0 requests: GoogleKeyMissingError at once, the lines are not asked for', () => {
    expect(m.noKey.pairs).toMatchObject({ ms: 0, requests: 0, settled: 'rejected', fetched: null });
    expect(m.noKey.pairs.error).toBeInstanceOf(GoogleKeyMissingError);
    expect(m.noKey.lines.settled).toBe('not called');
    expect(m.noKey).toMatchObject({ totalMs: 0, requests: 0, save: 'refused', sleeps: [] });
  });

  it('is within budget: the pair fetch settles within 10 s (0 s)', () => {
    expect(m.noKey.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('leaves no trace of the home, and the cache files are byte for byte as before', () => {
    expect(homeIn(m.noKey.disk.files)).toEqual({ place: false, pairs: 0, lines: 0 });
    expect(homeIn(m.noKey.memory)).toEqual({ place: false, pairs: 0, lines: 0 });
    expect(m.noKey.disk).toMatchObject({ matrixChanged: false, polylinesChanged: false });
  });
});

describe('every case of this file', () => {
  it('ran on an honest virtual clock: one request at a time, no timer armed, every millisecond accounted for', () => {
    for (const measured of Object.values(m)) expectHonestClock(measured);
  });

  it('left nothing half-written in the temp cache files', () => {
    for (const measured of Object.values(m)) expectWholeCache(measured);
  });

  it('printed nothing, and no rejection holds the key', () => {
    for (const measured of Object.values(m)) expectNoKeyIn(measured);
    suite.expectNoLeak(1); // the one rejection here: the missing key
  });
});
