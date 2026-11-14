// #555, the deadline of a live call beyond the table of travel-service-slow-table.test.ts:
// - a second commute save started while the first one waits on a silent Google is not held up longer than the
//   first one's deadline, and still answers within its own 10 s (the wait in the queue counts);
// - after two saves that both ran into the deadline, the cache files are byte for byte as before, both homes
//   are gone, and the next save has its whole budget again;
// - a backoff that would cross the deadline is not slept: the call fails at once with Google's last error;
// - a call whose deadline passes while it waits for an earlier call sends nothing and rejects with the
//   client's own GoogleApiError (CALL_DEADLINE), never with a guessed answer;
// - the route lines of a new delivery (`ensureLegPolylines`) stop asking after 10 s, so they never hold the
//   queue longer than a pair fetch may.
// Time is virtual (tests/geo/travel-service-slow-helper.ts): nothing here waits in real time or has a
// wall-clock limit. Sample cache in a temp folder, a fake Google, a fake key: no network, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { CALL_DEADLINE_STATUS, GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { PlacePair } from '../../server/geo/googleProvider';
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_LEG_LINES_DEADLINE_MS, LIVE_LINES_DEADLINE_MS, LIVE_PAIRS_DEADLINE_MS } from '../../server/geo/travelService';
import {
  HOME, HOME_POINT, PAIR_BUDGET_MS, SECOND_HOME, SECOND_HOME_POINT, SLOW_TEST_TIMEOUT_MS, answers, businessIds, fails, neededForHome, never, replay,
  sampleCache, traceOf,
} from './travel-service-slow-helper';
import type { AttemptLog, Step } from './travel-service-slow-helper';
import type { TravelFiles } from '../../server/geo/cache';
import { KEY_FORMS, expectNoText, google500, watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();

/** What the cache holds about a home. Counts only: a home's ID holds its coordinates. */
const about = (files: TravelFiles, home: string) => ({
  place: Object.hasOwn(files.matrix.places, home),
  pairs: Object.keys(files.matrix.pairs).filter((key) => key.split('|').includes(home)).length,
});

interface Outcome {
  first: Step;
  second: Step;
  attempts: AttemptLog[];
  sleeps: number[];
  maxInFlight: number;
  pendingTimers: number;
  unchanged: boolean;
  disk: TravelFiles;
  memory: TravelFiles;
}

/** Two saves with different new homes, the second started before the first has sent anything. */
function twoSaves(script: Parameters<typeof replay>[0]['script'], then?: Parameters<typeof replay>[1]): Promise<Outcome & { third?: unknown }> {
  return replay({ script }, async (bench) => {
    const { service, step } = bench;
    const before = bench.bytes();
    service.addPlaces({ [HOME]: HOME_POINT });
    const first = step(() => service.ensurePairs(neededForHome(HOME).matrix));
    service.addPlaces({ [SECOND_HOME]: SECOND_HOME_POINT });
    const second = step(() => service.ensurePairs(neededForHome(SECOND_HOME).matrix));
    const settled = { first: await first, second: await second };
    const after = bench.bytes();
    const outcome: Outcome = {
      ...settled,
      attempts: [...bench.attempts],
      sleeps: [...bench.sleeps],
      maxInFlight: bench.maxInFlight(),
      pendingTimers: vi.getTimerCount(),
      unchanged: after[0] === before[0] && after[1] === before[1],
      disk: bench.disk().files,
      memory: structuredClone(service.files),
    };
    return { ...outcome, third: then ? await then(bench) : undefined };
  });
}

const starts = (attempts: readonly AttemptLog[]) => attempts.map(({ startMs, timeoutMs }) => [startMs, timeoutMs]);

function expectNoResponse(error: unknown, endpoint: string) {
  expect((error as Error).constructor).toBe(GoogleApiError);
  expect(error).toMatchObject({ name: 'GoogleApiError', status: 0, googleStatus: 'NETWORK_ERROR', endpoint });
  expect((error as GoogleApiError).message).toContain('TimeoutError');
}

describe('a second save started right after one that waits on a silent Google, when Google answers again', () => {
  let m: Outcome;
  beforeAll(async () => {
    // The first save's two attempts get no answer; everything after them answers in 300 ms.
    m = await twoSaves(({ index }) => (index < 2 ? never : answers()));
    suite.errors.push(m.first.error);
  });

  it('the first save rejects after 8.5 s, inside its 10 s', () => {
    expect(m.first).toMatchObject({ ms: 8500, settled: 'rejected', fetched: null });
    expectNoResponse(m.first.error, ROUTE_MATRIX_URL);
  });

  it('the second save sends its first request at 8.5 s: it is held up exactly as long as the first one took, never longer than its deadline', () => {
    expect(traceOf(m)).toEqual([
      'matrix 1 try 1: no answer for 4000 ms',
      'matrix 1 try 2: no answer for 4000 ms',
      'matrix 2 try 1: 200 after 300 ms',
      'matrix 3 try 1: 200 after 300 ms',
    ]);
    expect(m.attempts[2].startMs).toBe(8500);
    expect(m.attempts[2].startMs).toBeLessThanOrEqual(LIVE_PAIRS_DEADLINE_MS);
  });

  it('the second save resolves with its 36 pairs 9.1 s after it was started: within its own 10 s, the wait included', () => {
    expect(m.second).toMatchObject({ ms: 9100, settled: 'resolved', fetched: 36, error: undefined });
    expect(m.second.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    // Its attempts get what is left of its own 10 s, not a fresh 4 s.
    expect(starts(m.attempts.slice(2))).toEqual([[8500, 1500], [8800, 1200]]);
  });

  it('leaves the first home out completely and the second home with all its pairs, in memory and on disk', () => {
    for (const files of [m.disk, m.memory]) {
      expect(about(files, HOME)).toEqual({ place: false, pairs: 0 });
      expect(about(files, SECOND_HOME)).toEqual({ place: true, pairs: 36 });
    }
    expect(m.disk).toEqual(m.memory);
  });

  it('ran on an honest virtual clock: one request at a time, no timer armed', () => {
    expect(m.maxInFlight).toBe(1);
    expect(m.pendingTimers).toBe(0);
  });
});

describe('two saves started together on a Google that never answers, and a third one after them', () => {
  let m: Outcome & { third?: unknown };
  beforeAll(async () => {
    // Silent for the three attempts of the two saves; it answers again for the third save.
    m = await twoSaves(
      ({ index }) => (index < 3 ? never : answers()),
      async ({ service, step, now }) => {
        const startedMs = now();
        service.addPlaces({ [HOME]: HOME_POINT }); // the same point again: nothing of the refused save is in the way
        return { startedMs, pairs: await step(() => service.ensurePairs(neededForHome(HOME).matrix)) };
      },
    );
    suite.errors.push(m.first.error, m.second.error);
  });

  it('the first rejects after 8.5 s and the second after exactly 10 s: its one attempt is cut to the 1.5 s it has left', () => {
    expect(m.first).toMatchObject({ ms: 8500, settled: 'rejected' });
    expect(m.second).toMatchObject({ ms: 10_000, settled: 'rejected' });
    expect(starts(m.attempts.slice(0, 3))).toEqual([[0, 4000], [4500, 4000], [8500, 1500]]);
    expect(m.sleeps).toEqual([500]); // the second save has no time for a backoff and a retry
  });

  it('both reject with the GoogleApiError for "no response", without the key', () => {
    for (const error of [m.first.error, m.second.error]) {
      expectNoResponse(error, ROUTE_MATRIX_URL);
      expectNoText(error, KEY_FORMS);
    }
  });

  it('leaves the cache files byte for byte as before, and neither home in memory', () => {
    expect(m.unchanged).toBe(true);
    for (const files of [m.disk, m.memory]) {
      expect(about(files, HOME)).toEqual({ place: false, pairs: 0 });
      expect(about(files, SECOND_HOME)).toEqual({ place: false, pairs: 0 });
    }
    expect(m.disk).toEqual(sampleCache());
  });

  it('a third save started right after them is not held up at all and has its whole budget: 0.6 s, attempts of 4 s', () => {
    const third = m.third as { startedMs: number; pairs: Step };
    expect(third.startedMs).toBe(10_000);
    expect(third.pairs).toMatchObject({ ms: 600, requests: 2, settled: 'resolved', fetched: 36 });
  });
});

describe('a backoff that would cross the deadline', () => {
  let pairs: Step;
  let attempts: AttemptLog[];
  let sleeps: number[];
  let home: { place: boolean; pairs: number };
  beforeAll(async () => {
    // Slow answers: 3.9 s each. The first request fails once and then answers (8.3 s); the second one is a 500
    // after 1.5 s, at 9.8 s. The 0.5 s of backoff would end at 10.3 s.
    await replay(
      {
        script: ({ request, attempt }) =>
          request === 0 ? (attempt === 0 ? fails(google500, 3900) : answers(3900)) : fails(google500, 1500),
      },
      async (bench) => {
        bench.service.addPlaces({ [HOME]: HOME_POINT });
        pairs = await bench.step(() => bench.service.ensurePairs(neededForHome().matrix));
        attempts = [...bench.attempts];
        sleeps = [...bench.sleeps];
        home = about(bench.disk().files, HOME);
      },
    );
    suite.errors.push(pairs.error);
  });

  it('is not slept: the pair fetch rejects at 9.8 s, the moment Google sent its error', () => {
    expect(pairs).toMatchObject({ ms: 9800, requests: 3, settled: 'rejected', fetched: null });
    expect(traceOf({ attempts })).toEqual([
      'matrix 1 try 1: 500 after 3900 ms',
      'matrix 1 try 2: 200 after 3900 ms',
      'matrix 2 try 1: 500 after 1500 ms',
    ]);
    expect(sleeps).toEqual([500]); // only the one between the first request's two attempts
  });

  it("rejects with Google's own error (HTTP 500 INTERNAL), with the key redacted", () => {
    expect((pairs.error as Error).constructor).toBe(GoogleApiError);
    expect(pairs.error).toMatchObject({ status: 500, googleStatus: 'INTERNAL', endpoint: ROUTE_MATRIX_URL });
    expect((pairs.error as GoogleApiError).message).toContain('[redacted]');
    expectNoText(pairs.error, KEY_FORMS);
  });

  it('keeps the place with exactly the 18 pairs that got an answer', () => {
    expect(home).toEqual({ place: true, pairs: 18 });
  });
});

describe('a call whose deadline passes while it waits for an earlier call', () => {
  let pairs: Step;
  let lines: Step;
  let requests: number;
  let linesAfter: number;
  let wanted: PlacePair[];
  beforeAll(async () => {
    // Two route lines between businesses that the sample cache has no line for.
    const [a, b] = businessIds();
    wanted = [{ from: a, to: b }, { from: b, to: a }];
    await replay({ script: () => never }, async (bench) => {
      bench.service.addPlaces({ [HOME]: HOME_POINT });
      const pairFetch = bench.step(() => bench.service.ensurePairs(neededForHome().matrix)); // 10 s, holds the queue for 8.5 s
      const lineFetch = bench.step(() => bench.service.ensurePolylines(wanted)); // 5 s, waits behind it
      pairs = await pairFetch;
      lines = await lineFetch;
      requests = bench.attempts.length;
      linesAfter = wanted.filter(({ from, to }) => Object.hasOwn(bench.service.files.polylines.polylines, pairKey(from, to))).length;
    });
    suite.errors.push(pairs.error, lines.error);
  });

  it('starts from a cache without those two lines', () => {
    for (const { from, to } of wanted) expect(Object.hasOwn(sampleCache().polylines.polylines, pairKey(from, to))).toBe(false);
  });

  it('sends nothing: only the two attempts of the pair fetch reach Google', () => {
    expect(pairs).toMatchObject({ ms: 8500, settled: 'rejected' });
    expect(requests).toBe(2);
  });

  it('settles when the earlier call ends (8.5 s), not at its own 5 s: the one case that is later than the deadline', () => {
    expect(lines).toMatchObject({ ms: 8500, settled: 'rejected', fetched: null });
    expect(lines.ms).toBeGreaterThan(LIVE_LINES_DEADLINE_MS);
    expect(lines.ms).toBeLessThanOrEqual(LIVE_PAIRS_DEADLINE_MS); // never later than the longest deadline ahead of it
  });

  it('rejects with a GoogleApiError that says so (status 0, CALL_DEADLINE), and makes up no line', () => {
    expect((lines.error as Error).constructor).toBe(GoogleApiError);
    expect(lines.error).toMatchObject({ name: 'GoogleApiError', status: 0, googleStatus: CALL_DEADLINE_STATUS, endpoint: ROUTES_URL });
    expect((lines.error as GoogleApiError).message).toContain('time limit');
    expectNoText(lines.error, KEY_FORMS);
    expect(linesAfter).toBe(0);
  });
});

describe('the route lines of a new delivery (ensureLegPolylines)', () => {
  // One leg through five businesses: four lines the sample cache does not hold.
  const leg = () => ({ placeIds: businessIds().slice(0, 5) });

  it('give up after 8.5 s on a Google that never answers: two attempts of 4 s on the first line, the others are not asked for', async () => {
    const seen = await replay({ script: () => never }, async (bench) => {
      const result = await bench.service.ensureLegPolylines([leg()]);
      return { result, ms: bench.now(), trace: traceOf(bench) };
    });
    expect(seen.result).toEqual({ fetched: 0, failed: 4 });
    expect(seen.ms).toBe(8500);
    expect(seen.trace).toEqual(['line 1 try 1: no answer for 4000 ms', 'line 1 try 2: no answer for 4000 ms']);
  });

  it('stop asking 10 s after the call on a Google that answers slowly: two lines of 3.9 s are kept, the third is cut, the fourth is not asked for', async () => {
    const seen = await replay({ script: () => answers(LIVE_ATTEMPT_TIMEOUT_MS - 100) }, async (bench) => {
      const result = await bench.service.ensureLegPolylines([leg()]);
      return { result, ms: bench.now(), trace: traceOf(bench), lines: Object.keys(bench.disk().files.polylines.polylines).length };
    });
    expect(seen.result).toEqual({ fetched: 2, failed: 2 });
    expect(seen.ms).toBe(LIVE_LEG_LINES_DEADLINE_MS);
    expect(seen.trace).toEqual(['line 1 try 1: 200 after 3900 ms', 'line 2 try 1: 200 after 3900 ms', 'line 3 try 1: no answer for 2200 ms']);
    expect(seen.lines).toBe(Object.keys(sampleCache().polylines.polylines).length + 2); // the two that got an answer are on disk
  });
});

describe('every case of this file', () => {
  it('printed nothing, and no rejection holds the key', () => {
    suite.expectNoLeak(6);
  });
});
