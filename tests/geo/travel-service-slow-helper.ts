// Helper for tests/geo/travel-service-slow-*.test.ts (#530): how long can a commute save with a typed address
// wait on Google? It replays what the commute route does for one new home (server/api/v2/commuteRoutes.ts) on
// the real travel service, against a fake Google that is slow, failing or silent, and measures the wait on a
// VIRTUAL clock:
// - the fake `fetch` adds each request's answer time to a counter, and the injected `sleep` adds each backoff;
// - an attempt that never answers counts as its timeout. The timeout is not assumed: the helper records the
//   number the client passes to `AbortSignal.timeout(ms)` for that very request;
// - the service reads the same counter as its clock (`now`), so its deadlines (#555: 10 s for the pair fetch,
//   5 s for the two lines) run on the virtual clock too;
// - setTimeout, setInterval and setImmediate are frozen while the replay runs. A replay that needed real time
//   would never settle, and a timer left behind is counted in `pendingTimers`.
// So no test here waits in real time and none has a wall-clock limit (DECISIONS pass 52): the numbers are the
// same on a laptop and on a slow CI runner. What is not modelled: the time the cache write takes on disk.
// The cache is a copy of the made-up sample cache (tests/api/v2-boot-sample.ts: 18 businesses, 130 homes) in a
// temp folder. No network, no real key, no .env.
import { expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pairKey } from '../../shared/v2/types';
import type { LatLng } from '../../shared/v2/types';
import { pairsToEnsure } from '../../server/api/v2/commutePlan';
import { MATRIX_FILE, POLYLINES_FILE, readTravelFiles, writeTravelFiles } from '../../server/geo/cache';
import type { TravelFiles } from '../../server/geo/cache';
import { GoogleApiError, ROUTES_URL, ROUTE_MATRIX_URL } from '../../server/geo/googleClient';
import type { FetchLike } from '../../server/geo/googleClient';
import type { PlacePair } from '../../server/geo/googleProvider';
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_MAX_RETRIES, createTravelService } from '../../server/geo/travelService';
import type { TravelService } from '../../server/geo/travelService';
import { bootSample } from '../api/v2-boot-sample';
import { KEY, KEY_FORMS, NEW_HOME, NEW_HOME_POINT, OTHER_HOME, OTHER_HOME_POINT, expectNoText, google500, lineFor, metersFor, secondsFor } from './travelServiceHarness';
import type { GoogleReply } from './travelServiceHarness';

/** Explicit limit for every test and hook of these files (DECISIONS pass 19). A whole file takes well under 1 s locally. */
export const SLOW_TEST_TIMEOUT_MS = 20_000;

/** The budget of #530, kept by the service since #555: the pair fetch settles within 10 s; the two commute lines add at most 5 s. */
export const PAIR_BUDGET_MS = 10_000;
export const LINES_BUDGET_MS = 5_000;

/** How long the fake Google takes for a request it answers (a 200 and an error alike), unless a case says otherwise. */
export const ANSWER_MS = 300;

// ---------- the sample cache and the new home ----------

let sampleFiles: TravelFiles | undefined;
/** The sample cache, built once per test file. Never changed: every case writes its own copy to a temp folder. */
export function sampleCache(): TravelFiles {
  return (sampleFiles ??= bootSample().files);
}

export const HOME = NEW_HOME;
export const HOME_POINT: LatLng = NEW_HOME_POINT;
/** The 18 businesses of the sample cache, sorted. */
export const businessIds = (): string[] => Object.keys(sampleCache().matrix.places).filter((id) => id.startsWith('biz-')).sort();
/** The business the employee works at: the commute lines run between it and the home. */
export const workplaceId = (): string => businessIds()[0];
/** Exactly what the commute route asks the travel service for: 36 matrix pairs and the 2 commute lines. */
export const neededForHome = (home: string = HOME): { matrix: PlacePair[]; polylines: PlacePair[] } => pairsToEnsure({ id: home }, workplaceId(), businessIds());
/** A second new home, for a save that starts while the first one is still waiting (#555). The fake Google knows it too. */
export const SECOND_HOME = OTHER_HOME;
export const SECOND_HOME_POINT: LatLng = OTHER_HOME_POINT;

// ---------- what the fake Google does with one HTTP attempt ----------

export interface Attempt {
  what: 'matrix' | 'line';
  /** 0-based: which distinct request of its kind this is (the save sends 2 matrix requests and 2 line requests). */
  request: number;
  /** 0-based: 0 is the first try of that request, 1 its first retry. */
  attempt: number;
  /** 0-based: position among all HTTP attempts of the save. */
  index: number;
}
/** `afterMs: Infinity` never answers. `reply: null` is Google's normal 200 answer. */
export interface Behaviour {
  afterMs: number;
  reply: GoogleReply | null;
}
export type Script = (attempt: Attempt) => Behaviour;

export const answers = (afterMs = ANSWER_MS): Behaviour => ({ afterMs, reply: null });
export const fails = (reply: GoogleReply, afterMs = ANSWER_MS): Behaviour => ({ afterMs, reply });
export const never: Behaviour = { afterMs: Infinity, reply: null };

// Like `google500` of the harness, Google's message holds the key, so a leak would show.
export const google429: GoogleReply = { status: 429, body: { error: { code: 429, message: `Quota exceeded for key ${KEY}`, status: 'RESOURCE_EXHAUSTED' } } };

export interface CaseSpec {
  label: string;
  script: Script;
  /** Defaults to the fake key. `''` is a server without a key. */
  key?: string;
}

/**
 * The six cases of #530 (a–f) and four more that the numbers needed (see each label). "Its last attempt" and
 * "the timeout" of the longest wait are the live limits of the service (one retry, 4 s per attempt).
 */
export const CASES = {
  a: { label: '(a) every request answers after 300 ms', script: () => answers() },
  b: { label: '(b) Google never answers', script: () => never },
  c: { label: '(c) every request is a 429 (after 300 ms)', script: () => fails(google429) },
  d: { label: '(d) every request is a 500 (after 300 ms)', script: () => fails(google500) },
  e: { label: '(e) the first attempt of every request is a 500, the second answers', script: ({ attempt }) => (attempt === 0 ? fails(google500) : answers()) },
  eSilent: { label: '(e, silent) only the very first attempt never answers, the second answers', script: ({ index }) => (index === 0 ? never : answers()) },
  f: { label: '(f) the matrix answers, the route lines never do', script: ({ what }) => (what === 'matrix' ? answers() : never) },
  half: {
    label: '(extra) the first matrix request answers, the second never does',
    script: ({ what, request }) => (what === 'matrix' && request === 0 ? answers() : never),
  },
  worst: {
    label: '(extra) the longest wait the retry rules allow: every request answers on its last attempt, 1 ms before the timeout',
    script: ({ attempt }) => (attempt < LIVE_MAX_RETRIES ? never : answers(LIVE_ATTEMPT_TIMEOUT_MS - 1)),
  },
  noKey: { label: '(extra) the server has no Google key', script: () => answers(), key: '' },
} satisfies Record<string, CaseSpec>;
export type CaseId = keyof typeof CASES;

// ---------- the measurement ----------

export interface AttemptLog extends Attempt {
  /** Virtual ms since the replay began when this attempt was sent. */
  startMs: number;
  /** Virtual ms this attempt took: its answer time, or its timeout when it never answered. */
  ms: number;
  /** The HTTP status, or 'timeout'. */
  result: number | 'timeout';
  /** The number the client gave `AbortSignal.timeout` for this attempt. */
  timeoutMs: number;
}

export interface Step {
  /** Virtual ms from the call until it settled. */
  ms: number;
  /** HTTP requests the fake Google saw during the step, retries included. */
  requests: number;
  settled: 'resolved' | 'rejected' | 'not called';
  /** What it resolved with, else null. */
  fetched: number | null;
  /** What it rejected with, else undefined. */
  error: unknown;
}

export interface Measurement {
  label: string;
  /** `ensurePairs` for the home against the 18 businesses both ways. */
  pairs: Step;
  /** `ensurePolylines` for the two commute lines. Not called when the pair fetch rejected (the route answers 503 then). */
  lines: Step;
  /** Virtual ms from the start of the save until the route would go on (or answer 503). */
  totalMs: number;
  requests: number;
  /** What the route does next: the save goes on (with or without route lines), or it answers 503. */
  save: 'saved' | 'saved without route lines' | 'refused';
  attempts: AttemptLog[];
  /** Every backoff the client slept, in order. */
  sleeps: number[];
  /** The most requests that were ever open at once. 1 means adding the times up is exact. */
  maxInFlight: number;
  /** Timers the replay armed (they are frozen, so none could have fired). Must be 0. */
  pendingTimers: number;
  /** The temp cache folder after the save. */
  disk: {
    /** File names in the folder, sorted. */
    entries: string[];
    /** Both files parsed and checked by the cache reader. */
    files: TravelFiles;
    matrixChanged: boolean;
    polylinesChanged: boolean;
  };
  /** A copy of the service's cache in memory after the save. */
  memory: TravelFiles;
}

/** What a replay works with: the real service on a temp copy of the sample cache, the fake Google and the virtual clock. */
export interface Bench {
  service: TravelService;
  /** Virtual ms since the replay began. */
  now(): number;
  /** Runs one call of the service and measures it on the virtual clock, from the call until it settles. */
  step(call: () => Promise<{ fetched: number }>): Promise<Step>;
  /** Every HTTP attempt so far, and every backoff slept, in order. */
  attempts: AttemptLog[];
  sleeps: number[];
  /** The most requests that were ever open at once. */
  maxInFlight(): number;
  /** The two cache files as text, to compare before and after. */
  bytes(): string[];
  /** The temp cache folder: its file names (sorted) and both files parsed and checked by the cache reader. */
  disk(): { entries: string[]; files: TravelFiles };
}

/**
 * Runs `run` against a fresh copy of the sample cache in a temp folder, with the fake Google of `spec` and the
 * timers frozen. Throws when the replay did something the virtual clock cannot measure.
 */
export async function replay<T>(spec: Pick<CaseSpec, 'script' | 'key'>, run: (bench: Bench) => Promise<T>): Promise<T> {
  const sample = sampleCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-travel-slow-'));
  const dir = path.join(root, 'nyc');
  const bytes = () => [MATRIX_FILE, POLYLINES_FILE].map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));

  let nowMs = 0;
  const sleeps: number[] = [];
  const attempts: AttemptLog[] = [];
  const problems: string[] = [];
  const flight = { open: 0, max: 0 };

  // The fake Google knows the places of a save by their coordinates, like the harness's fake does.
  const idByPoint = new Map<string, string>();
  const newHomes: Record<string, LatLng> = { [HOME]: HOME_POINT, [SECOND_HOME]: SECOND_HOME_POINT };
  for (const id of [...businessIds(), HOME, SECOND_HOME]) {
    const point = newHomes[id] ?? sample.matrix.places[id];
    idByPoint.set(`${point.lat},${point.lng}`, id);
  }
  type Waypoint = { location: { latLng: { latitude: number; longitude: number } } };
  const idOf = ({ location: { latLng } }: Waypoint) => idByPoint.get(`${latLng.latitude},${latLng.longitude}`) ?? '?';

  // The client asks for one timeout signal per attempt. The stand-in never fires (no real timer); the fake
  // fetch looks its number up and charges it to the clock when the attempt gets no answer.
  const timeoutOf = new WeakMap<AbortSignal, number>();
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const { signal } = new AbortController();
    timeoutOf.set(signal, ms);
    return signal;
  });

  const bodies = new Map<string, { request: number; tries: number }>();
  const seen = { matrix: 0, line: 0 };
  const fetchImpl: FetchLike = async (url, init) => {
    const what = url === ROUTE_MATRIX_URL ? 'matrix' : url === ROUTES_URL ? 'line' : null;
    if (what === null) {
      problems.push('a request went to an endpoint the fake Google does not know');
      throw new Error('unknown endpoint');
    }
    // The same body sent again is a retry of the same request.
    const bodyKey = `${what}:${init?.body ?? ''}`;
    const known = bodies.get(bodyKey) ?? { request: seen[what]++, tries: 0 };
    bodies.set(bodyKey, known);
    const attempt: Attempt = { what, request: known.request, attempt: known.tries++, index: attempts.length };

    const timeoutMs = init?.signal ? timeoutOf.get(init.signal) : undefined;
    if (timeoutMs === undefined) {
      // Without the number an attempt that never answers has no length. The measurement is refused below.
      problems.push('a request had no signal from AbortSignal.timeout(ms): this helper reads the attempt timeout there');
      throw new Error('no timeout signal');
    }
    const log: AttemptLog = { ...attempt, startMs: nowMs, ms: 0, result: 'timeout', timeoutMs };
    attempts.push(log);

    flight.open += 1;
    flight.max = Math.max(flight.max, flight.open);
    await Promise.resolve(); // a promise job, not a timer: a second request sent meanwhile would show in `max`
    flight.open -= 1;
    // Time moves only when nothing else is due. With two calls in the queue, the first one's rejection is still
    // on its way to its caller when the second one sends its request; on a real clock that takes no time, so
    // every promise job that is already waiting runs before this request is charged. (Timers are frozen, so
    // promise jobs are all there is; the chain from the client to the caller is far shorter than this.)
    for (let job = 0; job < 50; job++) await Promise.resolve();

    const { afterMs, reply } = spec.script(attempt);
    if (afterMs >= timeoutMs) {
      // What Node's fetch rejects with when its AbortSignal.timeout fires.
      log.ms = timeoutMs;
      nowMs += timeoutMs;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    log.ms = afterMs;
    nowMs += afterMs;

    const body = JSON.parse(init?.body ?? '{}');
    const origins: string[] = what === 'matrix' ? body.origins.map((o: { waypoint: Waypoint }) => idOf(o.waypoint)) : [idOf(body.origin)];
    const destinations: string[] = what === 'matrix' ? body.destinations.map((d: { waypoint: Waypoint }) => idOf(d.waypoint)) : [idOf(body.destination)];
    const answer: GoogleReply = reply ?? {
      status: 200,
      body:
        what === 'matrix'
          ? origins.flatMap((from, originIndex) =>
              destinations.map((to, destinationIndex) => ({
                originIndex, destinationIndex, duration: `${secondsFor(from, to)}s`, distanceMeters: metersFor(from, to), condition: 'ROUTE_EXISTS', status: {},
              })),
            )
          : { routes: [{ duration: `${secondsFor(origins[0], destinations[0])}s`, distanceMeters: metersFor(origins[0], destinations[0]), polyline: { encodedPolyline: lineFor(origins[0], destinations[0]) } }] },
    };
    log.result = answer.status;
    return { status: answer.status, text: async () => JSON.stringify(answer.body) };
  };

  const step = async (call: () => Promise<{ fetched: number }>): Promise<Step> => {
    const startMs = nowMs;
    const startRequests = attempts.length;
    let outcome: Pick<Step, 'settled' | 'fetched' | 'error'>;
    try {
      outcome = { settled: 'resolved', fetched: (await call()).fetched, error: undefined };
    } catch (error) {
      outcome = { settled: 'rejected', fetched: null, error };
    }
    return { ms: nowMs - startMs, requests: attempts.length - startRequests, ...outcome };
  };

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
  try {
    writeTravelFiles(dir, sample);
    const service = createTravelService({
      dir,
      key: spec.key ?? KEY,
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
        nowMs += ms;
      },
      now: () => nowMs,
    });
    const result = await run({
      service,
      now: () => nowMs,
      step,
      attempts,
      sleeps,
      maxInFlight: () => flight.max,
      bytes,
      disk: () => {
        const files = readTravelFiles(dir);
        if (files === null) throw new Error('travel-service-slow-helper: the temp cache has no matrix.json');
        return { entries: fs.readdirSync(dir).sort(), files };
      },
    });
    if (problems.length > 0) throw new Error(`travel-service-slow-helper cannot measure this: ${[...new Set(problems)].join('; ')}`);
    return result;
  } finally {
    vi.useRealTimers();
    timeoutSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Replays one commute save with a new home and measures it on the virtual clock. The steps are the route's:
 * `addPlaces`, `await ensurePairs` (a rejection ends the save), then `await ensurePolylines` with its rejection
 * swallowed.
 */
export function measure(spec: CaseSpec): Promise<Measurement> {
  const needed = neededForHome();
  return replay(spec, async ({ service, now, step, attempts, sleeps, maxInFlight, bytes, disk }) => {
    const before = bytes();

    // The route (server/api/v2/commuteRoutes.ts), step for step.
    service.addPlaces({ [HOME]: HOME_POINT });
    const pairs = await step(() => service.ensurePairs(needed.matrix));
    const lines: Step =
      pairs.settled === 'resolved'
        ? await step(() => service.ensurePolylines(needed.polylines))
        : { ms: 0, requests: 0, settled: 'not called', fetched: null, error: undefined };

    const pendingTimers = vi.getTimerCount();
    const after = bytes();
    return {
      label: spec.label,
      pairs,
      lines,
      totalMs: now(),
      requests: attempts.length,
      save: pairs.settled !== 'resolved' ? 'refused' : lines.settled === 'resolved' ? 'saved' : 'saved without route lines',
      attempts,
      sleeps,
      maxInFlight: maxInFlight(),
      pendingTimers,
      disk: { ...disk(), matrixChanged: after[0] !== before[0], polylinesChanged: after[1] !== before[1] },
      memory: structuredClone(service.files),
    };
  });
}

/** Runs the cases one after another (never at the same time: they share the faked timers). */
export async function measureCases<Id extends CaseId>(ids: readonly Id[]): Promise<Record<Id, Measurement>> {
  const out = {} as Record<Id, Measurement>;
  for (const id of ids) out[id] = await measure(CASES[id]);
  return out;
}

/** Every HTTP attempt in order, e.g. `matrix 1 try 2: 500 after 300 ms` or `line 1 try 1: no answer for 4000 ms`. */
export function traceOf(m: Pick<Measurement, 'attempts'>): string[] {
  return m.attempts.map((a) => `${a.what} ${a.request + 1} try ${a.attempt + 1}: ${a.result === 'timeout' ? `no answer for ${a.ms} ms` : `${a.result} after ${a.ms} ms`}`);
}

/** What the two steps rejected with, for the harness's leak scan (`watchSuite().errors`). */
export function rejectionsOf(measurements: readonly Measurement[]): unknown[] {
  return measurements.flatMap((m) => [m.pairs.error, m.lines.error]).filter((error) => error !== undefined);
}

// ---------- checks every case shares ----------

/** What the cache (on disk or in memory) holds about the new home. Counts only: the home's ID holds its coordinates. */
export function homeIn(files: TravelFiles): { place: boolean; pairs: number; lines: number } {
  const names = (key: string) => key.split('|').includes(HOME);
  return {
    place: Object.hasOwn(files.matrix.places, HOME),
    pairs: Object.keys(files.matrix.pairs).filter(names).length,
    lines: Object.keys(files.polylines.polylines).filter(names).length,
  };
}

/**
 * Nothing half-written is left in the temp cache: only the two cache files (no temp file), both readable, the
 * same data as in memory, every sample entry untouched, and for the new home either nothing at all or its place
 * with only pairs and lines that got an answer, each exactly as the fake Google sent it.
 */
export function expectWholeCache(m: Measurement): void {
  expect(m.disk.entries).toEqual([MATRIX_FILE, POLYLINES_FILE]);
  expect(m.disk.files).toEqual(m.memory);

  const sample = sampleCache();
  const { matrix, polylines } = m.disk.files;
  const withoutHome = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => !key.split('|').includes(HOME)));
  expect(withoutHome(matrix.places)).toEqual(sample.matrix.places);
  expect(withoutHome(matrix.pairs)).toEqual(sample.matrix.pairs);
  expect(withoutHome(polylines.polylines)).toEqual(sample.polylines.polylines);

  const home = homeIn(m.disk.files);
  // A place without a pair is a typed address with no travel data (#520); a pair or line without its place is half a save.
  expect(home.place).toBe(home.pairs > 0);
  if (!home.place) expect(home.lines).toBe(0);
  if (home.place) expect(matrix.places[HOME]).toEqual(HOME_POINT);

  const wantedPairs = new Set(neededForHome().matrix.map(({ from, to }) => pairKey(from, to)));
  const wantedLines = new Set(neededForHome().polylines.map(({ from, to }) => pairKey(from, to)));
  let wrong = 0; // counted, so a failure prints a number and never a place ID
  for (const [key, pair] of Object.entries(matrix.pairs)) {
    const [from, to] = key.split('|');
    if (from !== HOME && to !== HOME) continue;
    if (!wantedPairs.has(key) || pair.durationS !== secondsFor(from, to) || pair.distanceM !== metersFor(from, to)) wrong += 1;
  }
  for (const [key, encoded] of Object.entries(polylines.polylines)) {
    const [from, to] = key.split('|');
    if (from !== HOME && to !== HOME) continue;
    if (!wantedLines.has(key) || encoded !== lineFor(from, to)) wrong += 1;
  }
  expect(wrong).toBe(0);

  // The files changed exactly when something was fetched.
  expect(m.disk.matrixChanged).toBe(home.pairs > 0);
  expect(m.disk.polylinesChanged).toBe(home.lines > 0);
}

/** The virtual clock was honest for this case: one request at a time, no timer armed, every wait accounted for. */
export function expectHonestClock(m: Measurement): void {
  expect(m.maxInFlight).toBeLessThanOrEqual(1);
  expect(m.pendingTimers).toBe(0);
  const waited = m.attempts.reduce((sum, a) => sum + a.ms, 0) + m.sleeps.reduce((sum, ms) => sum + ms, 0);
  expect(m.totalMs).toBe(waited);
  expect(m.totalMs).toBe(m.pairs.ms + m.lines.ms);
  expect(m.requests).toBe(m.pairs.requests + m.lines.requests);
}

/** No view of a rejection (message, stack, inspect, JSON) holds the fake key in any form. */
export function expectNoKeyIn(m: Measurement): void {
  for (const error of [m.pairs.error, m.lines.error]) if (error !== undefined) expectNoText(error, KEY_FORMS);
}

// ---------- the table of the PR ----------

const seconds = (ms: number) => `${ms / 1000} s`;

function errorText(error: unknown): string {
  if (error instanceof GoogleApiError) {
    return `${error.name} (${error.status === 0 ? 'no response' : `HTTP ${error.status}`}${error.googleStatus ? `, ${error.googleStatus}` : ''})`;
  }
  return error instanceof Error ? error.name : typeof error;
}

/** One sentence: what the route does after this case, and what the cache then holds for the home. */
export function outcomeOf(m: Measurement): string {
  const home = homeIn(m.disk.files);
  const kept = `${home.pairs} of 36 pairs and ${home.lines} of 2 lines cached`;
  if (m.save === 'refused') return `503, run untouched: ${errorText(m.pairs.error)}; ${kept}`;
  if (m.save === 'saved') return `saved; ${kept}`;
  return `saved without route lines: ${errorText(m.lines.error)}; ${kept}`;
}

export function budgetOf(m: Measurement): string {
  const over = [
    ...(m.pairs.ms > PAIR_BUDGET_MS ? [`pairs over ${seconds(PAIR_BUDGET_MS)}`] : []),
    ...(m.lines.ms > LINES_BUDGET_MS ? [`lines over ${seconds(LINES_BUDGET_MS)}`] : []),
  ];
  return over.length > 0 ? `OVER: ${over.join(', ')}` : 'within';
}

/** The Markdown table of SUMMARY.md, one row per case. A test pins its exact text. */
export function tableOf(measurements: readonly Measurement[]): string {
  const rows = measurements.map((m) =>
    [
      m.label,
      `${seconds(m.pairs.ms)} (${m.pairs.requests})`,
      m.lines.settled === 'not called' ? 'not called' : `${seconds(m.lines.ms)} (${m.lines.requests})`,
      `${seconds(m.totalMs)} (${m.requests})`,
      outcomeOf(m),
      budgetOf(m),
    ].join(' | '),
  );
  return [
    '| Case | Pair fetch (requests) | Two lines add (requests) | Total wait (requests) | Outcome | Budget 10 s + 5 s |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
  ].join('\n');
}
