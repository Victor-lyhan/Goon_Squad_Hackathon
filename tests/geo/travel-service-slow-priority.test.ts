// #601: a commute save goes ahead of route-line fetches on Google (DECISIONS pass 61).
// The travel service has one queue per kind of live call: the pairs of a save (`ensurePairs`), the two lines
// of a save (`ensurePolylines`) and the leg lines (`ensureLegPolylines`: the map's background fetch of up to
// 60 lines, and a new delivery's lines). So:
// - a pair fetch started 1 s after the map began 60 lines on a Google that takes 3.9 s per request is sent at
//   once and answers within its own 10 s (before #601 it waited for the lines and was refused);
// - the leg lines keep their 10 s, the ones they did not get to stay missing, and the next request for the same
//   lines fetches exactly those;
// - a save's two lines are not held by the leg lines either, and another save's two lines hold no pair fetch;
// - a save that finds everything cached answers at once, whatever is open on Google;
// - the cache files are whole after all of it: only the two files, readable, the same data as in memory.
// Time is virtual (tests/geo/travel-service-slow-helper.ts): requests that are open together share the clock,
// and nothing here waits in real time or has a wall-clock limit. Sample cache in a temp folder, a fake Google,
// a fake key: no network, no .env.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pairKey } from '../../shared/v2/types';
import { MAP_LINE_PAIRS_PER_REQUEST } from '../../server/api/v2/mapLines';
import { MATRIX_FILE, POLYLINES_FILE } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { GoogleApiError, ROUTES_URL } from '../../server/geo/googleClient';
import type { PlacePair } from '../../server/geo/googleProvider';
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_LEG_LINES_DEADLINE_MS, LIVE_LINES_DEADLINE_MS, LIVE_PAIRS_DEADLINE_MS } from '../../server/geo/travelService';
import {
  HOME, HOME_POINT, LINES_BUDGET_MS, PAIR_BUDGET_MS, SECOND_HOME, SECOND_HOME_POINT, SLOW_TEST_TIMEOUT_MS, answers, businessIds, homeIn, neededForHome,
  never, replay, sampleCache, workplaceId,
} from './travel-service-slow-helper';
import type { AttemptLog, Bench, Step } from './travel-service-slow-helper';
import { KEY_FORMS, expectNoText, lineFor, metersFor, secondsFor, watchSuite } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

const suite = watchSuite();

/** A Google that takes this long for every request: under the 4 s of one attempt, so nothing is retried. */
const SLOW_MS = LIVE_ATTEMPT_TIMEOUT_MS - 100;

/**
 * What the map's background fetch passes to `ensureLegPolylines` (server/api/v2/mapLines.ts): 60 two-place
 * legs. Here they are 60 route lines between businesses; the sample cache holds no route line at all.
 */
function mapLegs(): { pairs: PlacePair[]; legs: { placeIds: string[] }[] } {
  const businesses = businessIds();
  const pairs = businesses.flatMap((from) => businesses.filter((to) => to !== from).map((to) => ({ from, to }))).slice(0, MAP_LINE_PAIRS_PER_REQUEST);
  return { pairs, legs: pairs.map(({ from, to }) => ({ placeIds: [from, to] })) };
}

const countLines = (files: TravelFiles, pairs: readonly PlacePair[]) =>
  pairs.filter(({ from, to }) => files.polylines.polylines[pairKey(from, to)] === lineFor(from, to)).length;

/** `[what, sent at, timeout]` of every attempt, in the order sent. */
const sent = (attempts: readonly AttemptLog[]) => attempts.map(({ what, startMs, timeoutMs }) => [what, startMs, timeoutMs]);
/** `[sent at, timeout, result]` of the attempts of one kind. */
const of = (attempts: readonly AttemptLog[], what: 'matrix' | 'line') => attempts.filter((a) => a.what === what).map(({ startMs, timeoutMs, result }) => [startMs, timeoutMs, result]);

interface Snapshot {
  disk: { entries: string[]; files: TravelFiles };
  memory: TravelFiles;
  maxInFlight: number;
  pendingTimers: number;
  attempts: AttemptLog[];
}
const snapshot = (bench: Bench): Snapshot => ({
  disk: bench.disk(),
  memory: structuredClone(bench.service.files),
  maxInFlight: bench.maxInFlight(),
  pendingTimers: vi.getTimerCount(),
  attempts: [...bench.attempts],
});

/** Only the two cache files, readable, the same data as in memory, and every sample entry untouched. */
function expectWholeFiles({ disk, memory }: Snapshot) {
  expect(disk.entries).toEqual([MATRIX_FILE, POLYLINES_FILE]);
  expect(disk.files).toEqual(memory);
  const sample = sampleCache();
  for (const [key, pair] of Object.entries(sample.matrix.pairs)) expect(disk.files.matrix.pairs[key]).toEqual(pair);
  for (const [id, place] of Object.entries(sample.matrix.places)) expect(disk.files.matrix.places[id]).toEqual(place);
}

describe('a new home saved 1 s after the map began to fetch 60 route lines, on a Google that takes 3.9 s per request', () => {
  const { pairs: linePairs, legs } = mapLegs();
  let pairs: Step;
  let pairsCalledMs: number;
  let saveLines: Step;
  let saveLinesCalledMs: number;
  let mapLines: { fetched: number; failed: number };
  let mapLinesEndedMs: number;
  let after: Snapshot;
  let again: { result: { fetched: number; failed: number }; requests: number; after: Snapshot };

  beforeAll(async () => {
    let answerMs = SLOW_MS;
    await replay({ script: () => answers(answerMs) }, async (bench) => {
      const { service, step, wait, now } = bench;
      const needed = neededForHome();

      // GET /api/v2/map has answered and started its background fetch. Nothing awaits it.
      const background = service.ensureLegPolylines(legs).then((result) => {
        mapLinesEndedMs = now();
        return result;
      });

      // One second later an employee saves a new address: the commute route, step for step.
      await wait(1000);
      service.addPlaces({ [HOME]: HOME_POINT });
      pairsCalledMs = now();
      pairs = await step(() => service.ensurePairs(needed.matrix));
      saveLinesCalledMs = now();
      saveLines = await step(() => service.ensurePolylines(needed.polylines));

      mapLines = await background;
      after = snapshot(bench);

      // The next map request asks for the same 60 lines again (PR #577). Google is quick by then.
      answerMs = 100;
      const before = bench.attempts.length;
      const result = await service.ensureLegPolylines(legs);
      again = { result, requests: bench.attempts.length - before, after: snapshot(bench) };
    });
    suite.errors.push(saveLines.error);
  });

  it('starts from 60 distinct lines that the cache does not hold', () => {
    expect(linePairs).toHaveLength(60);
    expect(new Set(linePairs.map(({ from, to }) => pairKey(from, to))).size).toBe(60);
    expect(countLines(sampleCache(), linePairs)).toBe(0);
    expect(Object.keys(sampleCache().polylines.polylines)).toHaveLength(0);
  });

  it('sends the first pair request the moment the save is made, with a whole 4 s attempt: it does not wait for a line', () => {
    expect(pairsCalledMs).toBe(1000);
    expect(of(after.attempts, 'matrix')).toEqual([[1000, 4000, 200], [4900, 4000, 200]]);
  });

  it('answers the 36 pairs 7.8 s after the call: two requests of 3.9 s and nothing else, inside the 10 s', () => {
    expect(pairs).toMatchObject({ ms: 2 * SLOW_MS, settled: 'resolved', fetched: 36, error: undefined });
    expect(pairs.ms).toBe(7800);
    expect(pairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    expect(pairs.ms).toBeLessThanOrEqual(LIVE_PAIRS_DEADLINE_MS);
  });

  it('keeps the two requests side by side, never more: the lines and the pairs each send one at a time', () => {
    expect(after.maxInFlight).toBe(2);
    expect(after.pendingTimers).toBe(0);
    expect(sent(after.attempts)).toEqual([
      ['line', 0, 4000],
      ['matrix', 1000, 4000],
      ['line', 3900, 4000],
      ['matrix', 4900, 4000],
      ['line', 7800, 2200], // the map's third line: cut to what is left of its 10 s
      ['line', 8800, 4000], // the save's first line
      ['line', 12_700, 1100], // the save's second line: cut to what is left of its 5 s
    ]);
  });

  it('the map lines keep their own limit: they stop 10 s after their call with the 2 lines that got an answer', () => {
    expect(mapLines).toEqual({ fetched: 2, failed: 58 });
    expect(mapLinesEndedMs).toBe(LIVE_LEG_LINES_DEADLINE_MS);
    expect(countLines(after.disk.files, linePairs)).toBe(2);
  });

  it("the save's two lines keep their 5 s: on this Google only one fits, and the save goes on without the other (a 503 never, a guessed line never)", () => {
    expect(saveLinesCalledMs).toBe(8800);
    expect(saveLines).toMatchObject({ ms: LIVE_LINES_DEADLINE_MS, settled: 'rejected', fetched: null });
    expect(saveLines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
    expect((saveLines.error as Error).constructor).toBe(GoogleApiError);
    expect(saveLines.error).toMatchObject({ status: 0, googleStatus: 'NETWORK_ERROR', endpoint: ROUTES_URL });
    expectNoText(saveLines.error, KEY_FORMS);
    expect(homeIn(after.disk.files)).toEqual({ place: true, pairs: 36, lines: 1 });
  });

  it('leaves the cache files whole: the home with its 36 pairs as Google sent them, 3 lines, nothing half-written', () => {
    expectWholeFiles(after);
    const { matrix, polylines } = after.disk.files;
    expect(matrix.places[HOME]).toEqual(HOME_POINT);
    for (const { from, to } of neededForHome().matrix) {
      expect(matrix.pairs[pairKey(from, to)]).toEqual({ durationS: secondsFor(from, to), distanceM: metersFor(from, to) });
    }
    expect(Object.keys(matrix.pairs)).toHaveLength(Object.keys(sampleCache().matrix.pairs).length + 36);
    expect(Object.keys(polylines.polylines)).toHaveLength(3);
    for (const [key, encoded] of Object.entries(polylines.polylines)) expect(encoded).toBe(lineFor(...(key.split('|') as [string, string])));
  });

  it('the next map request asks for exactly the 58 lines that are still missing, and gets them', () => {
    expect(again.result).toEqual({ fetched: 58, failed: 0 });
    expect(again.requests).toBe(58);
    expect(countLines(again.after.disk.files, linePairs)).toBe(60);
    expectWholeFiles(again.after);
    expect(again.after.maxInFlight).toBe(2);
  });
});

describe('a whole save while the map lines have Google, at 1.9 s per request', () => {
  const { legs } = mapLegs();
  let pairs: Step;
  let saveLines: Step;
  let mapLines: { fetched: number; failed: number };
  let after: Snapshot;
  beforeAll(async () => {
    await replay({ script: () => answers(1900) }, async (bench) => {
      const { service, step, wait } = bench;
      const needed = neededForHome();
      const background = service.ensureLegPolylines(legs);
      await wait(1000);
      service.addPlaces({ [HOME]: HOME_POINT });
      pairs = await step(() => service.ensurePairs(needed.matrix));
      saveLines = await step(() => service.ensurePolylines(needed.polylines));
      mapLines = await background;
      after = snapshot(bench);
    });
  });

  it('is saved with both route lines in 7.6 s: 3.8 s for the pairs and 3.8 s for the lines, each sent at once', () => {
    expect(pairs).toMatchObject({ ms: 3800, settled: 'resolved', fetched: 36 });
    expect(saveLines).toMatchObject({ ms: 3800, settled: 'resolved', fetched: 2 });
    expect(saveLines.ms).toBeLessThanOrEqual(LINES_BUDGET_MS);
    expect(of(after.attempts, 'matrix')).toEqual([[1000, 4000, 200], [2900, 4000, 200]]);
    // The save's two lines go out at 4.8 s and 6.7 s, between the map's lines (every 1.9 s from 0).
    const lineStarts = after.attempts.filter((a) => a.what === 'line').map((a) => a.startMs);
    expect(lineStarts).toEqual([0, 1900, 3800, 4800, 5700, 6700, 7600, 9500]);
    expect(homeIn(after.disk.files)).toEqual({ place: true, pairs: 36, lines: 2 });
  });

  it('does not slow the map lines down: 5 lines in their 10 s, the sixth cut', () => {
    expect(mapLines).toEqual({ fetched: 5, failed: 55 });
    expect(after.attempts.at(-1)).toMatchObject({ what: 'line', startMs: 9500, timeoutMs: 500, result: 'timeout' });
    expect(after.maxInFlight).toBe(2);
    expect(after.pendingTimers).toBe(0);
    expectWholeFiles(after);
  });
});

describe("a second save started while the first save's two route lines are being fetched, at 3.9 s per request", () => {
  let firstPairs: Step;
  let secondPairs: Step;
  let secondCalledMs: number;
  let firstLines: Step;
  let after: Snapshot;
  beforeAll(async () => {
    await replay({ script: () => answers(SLOW_MS) }, async (bench) => {
      const { service, step, wait, now } = bench;
      service.addPlaces({ [HOME]: HOME_POINT });
      firstPairs = await step(() => service.ensurePairs(neededForHome(HOME).matrix));
      const lines = step(() => service.ensurePolylines(neededForHome(HOME).polylines)); // from 7.8 s, for 5 s

      await wait(1000);
      service.addPlaces({ [SECOND_HOME]: SECOND_HOME_POINT });
      secondCalledMs = now();
      secondPairs = await step(() => service.ensurePairs(neededForHome(SECOND_HOME).matrix));
      firstLines = await lines;
      after = snapshot(bench);
    });
    suite.errors.push(firstLines.error);
  });

  it("sends its first pair request at once, at 8.8 s, while the first save's line is open", () => {
    expect(firstPairs).toMatchObject({ ms: 7800, settled: 'resolved', fetched: 36 });
    expect(secondCalledMs).toBe(8800);
    expect(of(after.attempts, 'matrix').slice(2)).toEqual([[8800, 4000, 200], [12_700, 4000, 200]]);
    expect(of(after.attempts, 'line')).toEqual([[7800, 4000, 200], [11_700, 1100, 'timeout']]);
    expect(after.maxInFlight).toBe(2);
  });

  it('answers its 36 pairs in 7.8 s, like a save with nothing ahead of it', () => {
    expect(secondPairs).toMatchObject({ ms: 7800, settled: 'resolved', fetched: 36, error: undefined });
    expect(secondPairs.ms).toBeLessThanOrEqual(PAIR_BUDGET_MS);
    expect(firstLines).toMatchObject({ ms: LIVE_LINES_DEADLINE_MS, settled: 'rejected' });
    expectWholeFiles(after);
  });
});

describe('a save that finds everything cached, while Google answers nothing and every queue is taken', () => {
  // A home of the sample cache: all its 36 pairs are cached. Its two commute lines are fetched first.
  const knownHome = () => Object.keys(sampleCache().matrix.places).filter((id) => id.startsWith('home-')).sort()[0];
  let silent = false;
  let cached: { pairs: Step; lines: Step; atMs: number; endedMs: number; requestsDuring: number };
  let held: { pairs: Step; lines: Step; mapLines: { fetched: number; failed: number } };
  let after: Snapshot;
  beforeAll(async () => {
    const [a, b] = businessIds();
    await replay({ script: () => (silent ? never : answers(100)) }, async (bench) => {
      const { service, step, wait, now } = bench;
      const known = neededForHome(knownHome());
      await service.ensurePolylines(known.polylines); // the lines of an earlier save of this home
      const startMs = now();

      // Google goes silent. The map lines, another save's pairs and another save's two lines take all three queues.
      silent = true;
      const mapLines = service.ensureLegPolylines(mapLegs().legs);
      service.addPlaces({ [HOME]: HOME_POINT });
      const otherPairs = step(() => service.ensurePairs(neededForHome(HOME).matrix));
      const otherLines = step(() => service.ensurePolylines([{ from: a, to: b }, { from: b, to: a }]));

      await wait(1000);
      const atMs = now() - startMs;
      const before = bench.attempts.length;
      const pairs = await step(() => service.ensurePairs(known.matrix));
      const lines = await step(() => service.ensurePolylines(known.polylines));
      cached = { pairs, lines, atMs, endedMs: now() - startMs, requestsDuring: bench.attempts.length - before };

      held = { pairs: await otherPairs, lines: await otherLines, mapLines: await mapLines };
      after = snapshot(bench);
    });
    suite.errors.push(held.pairs.error, held.lines.error);
  });

  it('uses a home whose 36 pairs are in the sample cache and whose workplace is one of its businesses', () => {
    const sample = sampleCache();
    const { matrix, polylines } = neededForHome(knownHome());
    expect(matrix).toHaveLength(36);
    for (const { from, to } of matrix) expect(Object.hasOwn(sample.matrix.pairs, pairKey(from, to))).toBe(true);
    expect(polylines).toEqual([{ from: workplaceId(), to: knownHome() }, { from: knownHome(), to: workplaceId() }]);
  });

  it('answers at once, pairs and lines, 1 s into the silence, and sends nothing', () => {
    expect(cached.atMs).toBe(1000);
    expect(cached.pairs).toMatchObject({ ms: 0, settled: 'resolved', fetched: 0 });
    expect(cached.lines).toMatchObject({ ms: 0, settled: 'resolved', fetched: 0 });
    expect(cached.endedMs).toBe(1000);
    expect(cached.requestsDuring).toBe(0);
  });

  it('while three requests were open: the calls that had the queues fail at their own limits, 8.5 s, 5 s and 8.5 s', () => {
    expect(after.maxInFlight).toBe(3);
    expect(held.pairs).toMatchObject({ ms: 8500, settled: 'rejected' });
    expect(held.lines).toMatchObject({ ms: LIVE_LINES_DEADLINE_MS, settled: 'rejected' });
    expect(held.mapLines).toEqual({ fetched: 0, failed: 60 });
    for (const error of [held.pairs.error, held.lines.error]) {
      expect((error as Error).constructor).toBe(GoogleApiError);
      expectNoText(error, KEY_FORMS);
    }
  });

  it('leaves the files whole: the refused home is gone, and only the two lines fetched before the silence were added', () => {
    expectWholeFiles(after);
    expect(homeIn(after.disk.files)).toEqual({ place: false, pairs: 0, lines: 0 });
    expect(Object.keys(after.disk.files.polylines.polylines)).toHaveLength(2);
    expect(after.pendingTimers).toBe(0);
  });
});

describe('every case of this file', () => {
  it('printed nothing, and no rejection holds the key', () => {
    suite.expectNoLeak(4);
  });
});
