// #530 and #555, the cases where Google does not answer. A live action waits 4 s for each attempt and tries
// twice with 0.5 s of backoff, so ONE request that never answers costs 8.5 s, and the call's deadline (10 s for
// the pair fetch, 5 s for the two lines, counted from the call) cuts whatever would run past it:
// - (b) Google never answers: the pair fetch rejects after 8.5 s;
// - (e, silent) only the very first attempt is lost and everything else answers in 300 ms: 5.1 s;
// - (f) the matrix answers and the route lines never do: the lines reject after exactly 5 s (the deadline cuts
//   the retry to 0.5 s);
// - (extra) the first matrix request answers, the second never does: 8.8 s, and half of the pairs stay cached;
// - (extra) the longest wait the retry rules allow: the deadline ends it after exactly 10 s, as a failure.
// The budget is 10 s for the pair fetch and 5 s more for the two lines. Before #555 these cases measured
// 63.5 s, 16.1 s, 63.5 s, 63.8 s and 127 s + 127 s (the client's bulk limits: 15 s per attempt, 3 retries), and
// the budget tests below were `it.fails` (DECISIONS pass 54). They are plain `it` now.
// Time is virtual (tests/geo/travel-service-slow-helper.ts): nothing here waits in real time or has a
// wall-clock limit. Sample cache in a temp folder, a fake Google, a fake key: no network, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import {
  LINES_BUDGET_MS, PAIR_BUDGET_MS, SLOW_TEST_TIMEOUT_MS, expectHonestClock, expectNoKeyIn, expectWholeCache, homeIn, measureCases, rejectionsOf, traceOf,
} from './travel-service-slow-helper';
import type { Measurement } from './travel-service-slow-helper';
import { watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();
let m: Record<'b' | 'eSilent' | 'f' | 'half' | 'worst', Measurement>;
beforeAll(async () => {
  m = await measureCases(['b', 'eSilent', 'f', 'half', 'worst']);
  suite.errors.push(...rejectionsOf(Object.values(m)));
});

/** A request that got no answer at all: status 0, NETWORK_ERROR, and the message names the timeout. */
function expectNoResponse(error: unknown, endpoint: string) {
  expect(error).toBeInstanceOf(GoogleApiError);
  expect((error as GoogleApiError).name).toBe('GoogleApiError');
  expect(error).toMatchObject({ status: 0, googleStatus: 'NETWORK_ERROR', endpoint });
  expect((error as GoogleApiError).message).toContain('TimeoutError');
}

const TWO_SILENT_TRIES = [1, 2].map((attempt) => `try ${attempt}: no answer for 4000 ms`);

describe('(b) Google never answers', () => {
  it('measures 8.5 s for the pair fetch: 2 attempts of 4 s on the first request and 0.5 s of backoff, then it rejects', () => {
    expect(m.b.pairs).toMatchObject({ ms: 8500, requests: 2, settled: 'rejected', fetched: null });
    expect(m.b.sleeps).toEqual([500]);
    expect(traceOf(m.b)).toEqual(TWO_SILENT_TRIES.map((attempt) => `matrix 1 ${attempt}`));
  });

  it('answers 503 after 8.5 s: the two lines are not asked for', () => {
    expect(m.b.lines).toEqual({ ms: 0, requests: 0, settled: 'not called', fetched: null, error: undefined });
    expect(m.b).toMatchObject({ totalMs: 8500, requests: 2, save: 'refused' });
  });

  it('is within budget: the pair fetch settles within 10 s (8.5 s; it was 63.5 s)', () => {
    expect(m.b.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('rejects with a GoogleApiError for "no response"', () => {
    expectNoResponse(m.b.pairs.error, ROUTE_MATRIX_URL);
  });

  it('leaves no trace of the home, and the cache files are byte for byte as before', () => {
    expect(homeIn(m.b.disk.files)).toEqual({ place: false, pairs: 0, lines: 0 });
    expect(homeIn(m.b.memory)).toEqual({ place: false, pairs: 0, lines: 0 });
    expect(m.b.disk).toMatchObject({ matrixChanged: false, polylinesChanged: false });
  });
});

describe('(e, silent) only the very first attempt never answers, the second answers', () => {
  it('measures 5.1 s for the pair fetch (3 requests): 4 s for the lost attempt, 0.5 s of backoff, two answers of 300 ms', () => {
    expect(m.eSilent.pairs).toEqual({ ms: 5100, requests: 3, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.eSilent.sleeps).toEqual([500]);
    expect(traceOf(m.eSilent).slice(0, 3)).toEqual([
      'matrix 1 try 1: no answer for 4000 ms',
      'matrix 1 try 2: 200 after 300 ms',
      'matrix 2 try 1: 200 after 300 ms',
    ]);
  });

  it('measures 0.6 s more for the two lines (2 requests): saved after 5.7 s', () => {
    expect(m.eSilent.lines).toEqual({ ms: 600, requests: 2, settled: 'resolved', fetched: 2, error: undefined });
    expect(m.eSilent).toMatchObject({ totalMs: 5700, requests: 5, save: 'saved' });
  });

  it('is within budget: the pair fetch settles within 10 s (5.1 s; it was 16.1 s)', () => {
    expect(m.eSilent.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('is within budget for the lines: they add at most 5 s (0.6 s)', () => {
    expect(m.eSilent.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and both lines in the cache files', () => {
    expect(homeIn(m.eSilent.disk.files)).toEqual({ place: true, pairs: 36, lines: 2 });
  });
});

describe('(f) the matrix answers, the route lines never do', () => {
  it('measures 0.6 s for the pair fetch (2 requests): all 36 pairs', () => {
    expect(m.f.pairs).toEqual({ ms: 600, requests: 2, settled: 'resolved', fetched: 36, error: undefined });
  });

  it('measures 5 s more for the lines: 4 s for the first attempt, 0.5 s of backoff, and a retry the deadline cuts to 0.5 s; the second line is never asked for', () => {
    expect(m.f.lines).toMatchObject({ ms: 5000, requests: 2, settled: 'rejected', fetched: null });
    expect(m.f.sleeps).toEqual([500]);
    expect(traceOf(m.f).slice(2)).toEqual(['line 1 try 1: no answer for 4000 ms', 'line 1 try 2: no answer for 500 ms']);
  });

  it('saves without route lines after 5.6 s: the rejection of the lines is swallowed by the route', () => {
    expect(m.f).toMatchObject({ totalMs: 5600, requests: 4, save: 'saved without route lines' });
    expectNoResponse(m.f.lines.error, ROUTES_URL);
  });

  it('is within budget for the pairs: the pair fetch settles within 10 s (0.6 s)', () => {
    expect(m.f.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('is within budget for the lines: they add at most 5 s (5 s; it was 63.5 s)', () => {
    expect(m.f.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and no line; polylines.json is byte for byte as before', () => {
    expect(homeIn(m.f.disk.files)).toEqual({ place: true, pairs: 36, lines: 0 });
    expect(m.f.disk).toMatchObject({ matrixChanged: true, polylinesChanged: false });
  });
});

describe('(extra) the first matrix request answers, the second never does', () => {
  it('measures 8.8 s for the pair fetch (3 requests): one answer of 300 ms, then 2 attempts of 4 s and 0.5 s of backoff', () => {
    expect(m.half.pairs).toMatchObject({ ms: 8800, requests: 3, settled: 'rejected', fetched: null });
    expect(traceOf(m.half)).toEqual(['matrix 1 try 1: 200 after 300 ms', ...TWO_SILENT_TRIES.map((attempt) => `matrix 2 ${attempt}`)]);
    expect(m.half).toMatchObject({ totalMs: 8800, requests: 3, save: 'refused' });
    expect(m.half.lines.settled).toBe('not called');
  });

  it('is within budget: the pair fetch settles within 10 s (8.8 s; it was 63.8 s)', () => {
    expect(m.half.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('rejects with a GoogleApiError for "no response"', () => {
    expectNoResponse(m.half.pairs.error, ROUTE_MATRIX_URL);
  });

  it('keeps the 18 pairs that got an answer, with the place, in memory and on disk; a retry fills the rest', () => {
    expect(homeIn(m.half.disk.files)).toEqual({ place: true, pairs: 18, lines: 0 });
    expect(homeIn(m.half.memory)).toEqual({ place: true, pairs: 18, lines: 0 });
    expect(m.half.disk).toMatchObject({ matrixChanged: true, polylinesChanged: false });
  });
});

describe('(extra) the longest wait the retry rules allow: every request answers on its last attempt, 1 ms before the timeout', () => {
  it('measures exactly 10 s for the pair fetch (3 requests): 8.499 s for the first request, then the deadline cuts the second one to 1.501 s', () => {
    // First request: an attempt of 4 s, 0.5 s of backoff, then an answer after 3.999 s. The second request has
    // 1.501 s left of the 10 s: its first attempt gets that as its timeout, and there is no time for a retry.
    expect(m.worst.pairs).toMatchObject({ ms: 10_000, requests: 3, settled: 'rejected', fetched: null });
    expect(traceOf(m.worst)).toEqual([
      'matrix 1 try 1: no answer for 4000 ms',
      'matrix 1 try 2: 200 after 3999 ms',
      'matrix 2 try 1: no answer for 1501 ms',
    ]);
    expect(m.worst.sleeps).toEqual([500]); // the backoff after the cut attempt is not slept
  });

  it('answers 503 after 10 s: a deadline is a failure, the two lines are not asked for', () => {
    expect(m.worst.lines).toEqual({ ms: 0, requests: 0, settled: 'not called', fetched: null, error: undefined });
    expect(m.worst).toMatchObject({ totalMs: 10_000, requests: 3, save: 'refused' });
    expectNoResponse(m.worst.pairs.error, ROUTE_MATRIX_URL);
  });

  it('is within budget: the pair fetch settles within 10 s (10 s; it was 126.998 s, and 126.998 s more for the lines)', () => {
    expect(m.worst.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it('keeps the 18 pairs that got an answer, with the place, in memory and on disk; no time was made up for the other 18', () => {
    expect(homeIn(m.worst.disk.files)).toEqual({ place: true, pairs: 18, lines: 0 });
    expect(homeIn(m.worst.memory)).toEqual({ place: true, pairs: 18, lines: 0 });
    expect(m.worst.disk).toMatchObject({ matrixChanged: true, polylinesChanged: false });
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
    suite.expectNoLeak(4); // (b) and the two extras from the pair fetch, (f) from the lines
  });
});
