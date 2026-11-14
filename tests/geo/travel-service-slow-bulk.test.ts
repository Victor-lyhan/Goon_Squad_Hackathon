// #555: the short limits of a live action (4 s per attempt, one retry, a deadline) belong to the travel service
// only. `npm run fetch:routes` builds its own client from the key alone, so it keeps the client's bulk limits:
// 15 s per attempt, 3 retries with 0.5 s, 1 s and 2 s of backoff, and no deadline.
// - the client's defaults are still those numbers;
// - the real command (`runFetchScript`, with the client it builds itself) asks for exactly them: its
//   `--check-key` mode makes one geocoding, one matrix and one route request, here against a Google that never
//   answers, and each one is tried 4 times with 15 s per attempt.
// Nothing waits in real time: the global `fetch` is a fake that fails like a timeout at once, the number given
// to `AbortSignal.timeout` is recorded, and the backoff runs on vitest's fake timers. Temp copies of the three
// fixture files, a fake key, an `.env` path that does not exist: no network, no real key, no .env.
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runFetchScript } from '../../server/geo/fetchScript';
import { bindGoogleClient } from '../../server/geo/fetchRunner';
import {
  BACKOFF_BASE_MS, DEFAULT_TIMEOUT_MS, GEOCODE_URL, GoogleApiError, MAX_RETRIES, ROUTES_URL, ROUTE_MATRIX_URL,
} from '../../server/geo/googleClient';
import { LIVE_ATTEMPT_TIMEOUT_MS, LIVE_MAX_RETRIES } from '../../server/geo/travelService';
import { removeTempDirs, snapshot, tempFixturesDir } from './fetch-script-helpers';
import { SLOW_TEST_TIMEOUT_MS } from './travel-service-slow-helper';
import { KEY, KEY_FORMS } from './travelServiceHarness';

vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT_MS, hookTimeout: SLOW_TEST_TIMEOUT_MS });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(removeTempDirs);

interface Seen {
  endpoint: string;
  /** The number the client gave `AbortSignal.timeout` for this attempt. */
  timeoutMs: number | undefined;
  /** Fake-timer ms since the watch began when the attempt was sent. */
  atMs: number;
}

/**
 * Replaces the global `fetch` with a Google that never answers (it rejects at once with what Node's fetch
 * rejects with after a timeout) and freezes the timers. `finish` runs the timers until the promise settles.
 */
function silentGoogle() {
  const seen: Seen[] = [];
  const timeoutOf = new WeakMap<AbortSignal, number>();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
    const { signal } = new AbortController();
    timeoutOf.set(signal, ms);
    return signal;
  });
  vi.useFakeTimers();
  const startMs = Date.now();
  vi.stubGlobal('fetch', async (url: string, init?: { signal?: AbortSignal }) => {
    seen.push({ endpoint: String(url).split('?')[0], timeoutMs: init?.signal ? timeoutOf.get(init.signal) : undefined, atMs: Date.now() - startMs });
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  const finish = async <T>(promise: Promise<T>): Promise<T> => {
    let settled = false;
    const watched = promise.finally(() => {
      settled = true;
    });
    watched.catch(() => undefined);
    for (let turn = 0; turn < 1000 && !settled; turn++) await vi.advanceTimersByTimeAsync(BACKOFF_BASE_MS);
    if (!settled) throw new Error('the command did not finish on the fake timers');
    return watched;
  };
  return { seen, finish };
}

const BULK_TIMEOUTS = [15_000, 15_000, 15_000, 15_000];
const BULK_BACKOFF = [500, 1000, 2000];
const gaps = (attempts: readonly Seen[]) => attempts.slice(1).map((attempt, i) => attempt.atMs - attempts[i].atMs);

describe('the bulk limits of the Google client', () => {
  it('are its defaults: 15 s per attempt and 3 retries, not the live 4 s and 1 retry', () => {
    expect([DEFAULT_TIMEOUT_MS, MAX_RETRIES, BACKOFF_BASE_MS]).toEqual([15_000, 3, 500]);
    expect([LIVE_ATTEMPT_TIMEOUT_MS, LIVE_MAX_RETRIES]).toEqual([4000, 1]);
  });

  it('are what the fetch runner\'s client asks for when it is built from the key alone, as the command builds it', async () => {
    const google = silentGoogle();
    const client = bindGoogleClient({ apiKey: KEY });
    const from = { lat: 40.7484, lng: -73.9857 };
    const to = { lat: 40.7033, lng: -73.9881 };
    const error = await google.finish(client.computeRouteMatrix([from], [to]).then(() => null, (err: unknown) => err));

    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ status: 0, googleStatus: 'NETWORK_ERROR' });
    expect(google.seen.map(({ endpoint }) => endpoint)).toEqual(Array(4).fill(ROUTE_MATRIX_URL));
    expect(google.seen.map(({ timeoutMs }) => timeoutMs)).toEqual(BULK_TIMEOUTS);
    expect(gaps(google.seen)).toEqual(BULK_BACKOFF);
  });
});

describe('npm run fetch:routes, with the client it builds itself', () => {
  it('--check-key tries each of its three requests 4 times, 15 s per attempt, with 0.5 s, 1 s and 2 s of backoff', async () => {
    const dir = tempFixturesDir();
    const before = snapshot(dir);
    const lines: string[] = [];
    const google = silentGoogle();

    // No `makeClient`: the command's own client, which calls the (faked) global fetch.
    const code = await google.finish(
      runFetchScript({
        argv: ['--check-key'],
        env: { GOOGLE_MAPS_SERVER_KEY: KEY },
        envPath: path.join(dir, 'no-such.env'),
        fixturesDir: dir,
        out: (line) => lines.push(line),
      }),
    );

    expect(code).toBe(1); // nothing answered
    const byEndpoint = (endpoint: string) => google.seen.filter((attempt) => attempt.endpoint === endpoint);
    expect(google.seen).toHaveLength(3 * (1 + MAX_RETRIES));
    for (const endpoint of [GEOCODE_URL, ROUTE_MATRIX_URL, ROUTES_URL]) {
      const attempts = byEndpoint(endpoint);
      expect(attempts.map(({ timeoutMs }) => timeoutMs)).toEqual(BULK_TIMEOUTS);
      expect(gaps(attempts)).toEqual(BULK_BACKOFF);
    }
    // No live limit anywhere: no attempt was cut, none was skipped.
    expect(google.seen.every(({ timeoutMs }) => timeoutMs === DEFAULT_TIMEOUT_MS)).toBe(true);

    // The command wrote nothing and printed no key.
    expect(snapshot(dir)).toEqual(before);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (const form of KEY_FORMS) expect(line).not.toContain(form);
  });
});
