// #530, the cases where Google does not answer. The client waits 15 s for each attempt and tries 4 times with
// 0.5 s, 1 s and 2 s of backoff, so ONE request that never answers costs 63.5 s:
// - (b) Google never answers: the pair fetch rejects after 63.5 s;
// - (e, silent) only the very first attempt is lost and everything else answers in 300 ms: 16.1 s;
// - (f) the matrix answers and the route lines never do: the save waits 63.5 s more for lines it then drops;
// - (extra) the first matrix request answers, the second never does: 63.8 s, and half of the pairs stay cached;
// - (extra) the longest wait the retry rules allow: 127 s for the pairs and 127 s more for the lines.
// The budget is 10 s for the pair fetch and 5 s more for the two lines. Every number over it stays here as an
// `it.fails` test with the measured seconds in its title (DECISIONS pass 54): when the product is fixed, that
// test turns red and is changed back to `it`. No product code is changed by this issue.
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

const FOUR_SILENT_TRIES = [1, 2, 3, 4].map((attempt) => `try ${attempt}: no answer for 15000 ms`);

describe('(b) Google never answers', () => {
  it('measures 63.5 s for the pair fetch: 4 attempts of 15 s on the first request and 3.5 s of backoff, then it rejects', () => {
    expect(m.b.pairs).toMatchObject({ ms: 63_500, requests: 4, settled: 'rejected', fetched: null });
    expect(m.b.sleeps).toEqual([500, 1000, 2000]);
    expect(traceOf(m.b)).toEqual(FOUR_SILENT_TRIES.map((attempt) => `matrix 1 ${attempt}`));
  });

  it('answers 503 after 63.5 s: the two lines are not asked for', () => {
    expect(m.b.lines).toEqual({ ms: 0, requests: 0, settled: 'not called', fetched: null, error: undefined });
    expect(m.b).toMatchObject({ totalMs: 63_500, requests: 4, save: 'refused' });
  });

  it.fails('OVER BUDGET: the pair fetch settles within 10 s (measured: 63.5 s)', () => {
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
  it('measures 16.1 s for the pair fetch (3 requests): 15 s for the lost attempt, 0.5 s of backoff, two answers of 300 ms', () => {
    expect(m.eSilent.pairs).toEqual({ ms: 16_100, requests: 3, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.eSilent.sleeps).toEqual([500]);
    expect(traceOf(m.eSilent).slice(0, 3)).toEqual([
      'matrix 1 try 1: no answer for 15000 ms',
      'matrix 1 try 2: 200 after 300 ms',
      'matrix 2 try 1: 200 after 300 ms',
    ]);
  });

  it('measures 0.6 s more for the two lines (2 requests): saved after 16.7 s', () => {
    expect(m.eSilent.lines).toEqual({ ms: 600, requests: 2, settled: 'resolved', fetched: 2, error: undefined });
    expect(m.eSilent).toMatchObject({ totalMs: 16_700, requests: 5, save: 'saved' });
  });

  it.fails('OVER BUDGET: the pair fetch settles within 10 s (measured: 16.1 s)', () => {
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

  it('measures 63.5 s more for the lines: 4 attempts of 15 s on the first line, the second line is never asked for', () => {
    expect(m.f.lines).toMatchObject({ ms: 63_500, requests: 4, settled: 'rejected', fetched: null });
    expect(m.f.sleeps).toEqual([500, 1000, 2000]);
    expect(traceOf(m.f).slice(2)).toEqual(FOUR_SILENT_TRIES.map((attempt) => `line 1 ${attempt}`));
  });

  it('saves without route lines after 64.1 s: the rejection of the lines is swallowed by the route', () => {
    expect(m.f).toMatchObject({ totalMs: 64_100, requests: 6, save: 'saved without route lines' });
    expectNoResponse(m.f.lines.error, ROUTES_URL);
  });

  it('is within budget for the pairs: the pair fetch settles within 10 s (0.6 s)', () => {
    expect(m.f.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it.fails('OVER BUDGET: the two lines add at most 5 s (measured: 63.5 s)', () => {
    expect(m.f.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and no line; polylines.json is byte for byte as before', () => {
    expect(homeIn(m.f.disk.files)).toEqual({ place: true, pairs: 36, lines: 0 });
    expect(m.f.disk).toMatchObject({ matrixChanged: true, polylinesChanged: false });
  });
});

describe('(extra) the first matrix request answers, the second never does', () => {
  it('measures 63.8 s for the pair fetch (5 requests): one answer of 300 ms, then 4 attempts of 15 s and 3.5 s of backoff', () => {
    expect(m.half.pairs).toMatchObject({ ms: 63_800, requests: 5, settled: 'rejected', fetched: null });
    expect(traceOf(m.half)).toEqual(['matrix 1 try 1: 200 after 300 ms', ...FOUR_SILENT_TRIES.map((attempt) => `matrix 2 ${attempt}`)]);
    expect(m.half).toMatchObject({ totalMs: 63_800, requests: 5, save: 'refused' });
    expect(m.half.lines.settled).toBe('not called');
  });

  it.fails('OVER BUDGET: the pair fetch settles within 10 s (measured: 63.8 s)', () => {
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
  it('measures 126.998 s for the pair fetch (8 requests) and 126.998 s more for the lines (8 requests): saved after 253.996 s', () => {
    // Per request: 3 attempts of 15 s, 3.5 s of backoff, then an answer after 14.999 s. Two requests per step.
    expect(m.worst.pairs).toEqual({ ms: 126_998, requests: 8, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.worst.lines).toEqual({ ms: 126_998, requests: 8, settled: 'resolved', fetched: 2, error: undefined });
    expect(m.worst).toMatchObject({ totalMs: 253_996, requests: 16, save: 'saved' });
    expect(m.worst.sleeps).toEqual([500, 1000, 2000, 500, 1000, 2000, 500, 1000, 2000, 500, 1000, 2000]);
  });

  it.fails('OVER BUDGET: the pair fetch settles within 10 s (measured: 126.998 s)', () => {
    expect(m.worst.pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
  });

  it.fails('OVER BUDGET: the two lines add at most 5 s (measured: 126.998 s)', () => {
    expect(m.worst.lines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
  });

  it('leaves the home with all 36 pairs and both lines in the cache files', () => {
    expect(homeIn(m.worst.disk.files)).toEqual({ place: true, pairs: 36, lines: 2 });
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
    suite.expectNoLeak(3); // (b) and (extra, half) from the pair fetch, (f) from the lines
  });
});
