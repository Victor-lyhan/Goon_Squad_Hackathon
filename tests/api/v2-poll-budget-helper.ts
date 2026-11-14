// Helper for the MVP II poll budget tests (tests/api/v2-poll-budget-*.test.ts, issue #495).
// Starts the real app the way server/index.ts does, on the COMMITTED fixtures/nyc (the real Google cache with
// its route lines): `createV2Runtime` with a temp state file and no key, then `createApp({ v2 })`.
// - Nothing is written to fixtures/nyc or data/: with no key the travel service only reads the cache, and the
//   state file and its sidecar live in a temp folder that `close` removes.
// - `fetch` for Google is a function that throws, so a test can never reach the network.
// - The v2 ticker is not started, so the clock only moves when a test seeks.
// The measuring follows tests/api/poll-budget.test.ts (MVP 1): warm-up calls, then the median of N calls
// over a real localhost socket, timed from the request to the end of the body.
import { expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import type { Store } from '../../server/store';
import { NYC_FIXTURES_DIR } from '../../server/api/v2/bootRun';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { POLYLINES_FILE } from '../../server/geo/cache';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { GenerateScenarioRequest } from '../../shared/v2/schemas';
import type { Run } from '../../shared/v2/types';

// ---------- Budgets (issue #495). They are shown to the humans, so they keep their numbers (DECISIONS pass 52). ----------

/** GET /api/v2/simulator and both dashboards: median of `CALLS` calls. The MVP 1 number (pass 9). */
export const POLL_MEDIAN_MS = 40;
/** GET /api/v2/simulator body. The MVP 1 number (pass 9). */
export const SIM_MAX_BYTES = 150 * 1024;
/** GET /api/v2/businesses/:id/dashboard and GET /api/v2/employees/:id/dashboard bodies. */
export const DASH_MAX_BYTES = 100 * 1024;
/** GET /api/v2/map body, route lines included. Pages fetch it once per run, never on the 1 s poll. */
export const MAP_MAX_BYTES = 2 * 1024 * 1024;

export const CALLS = 30;
const WARM_UP_CALLS = 3;

/**
 * Per-test and per-hook limit, set at the top of each file with `vi.setConfig` (DECISIONS pass 17, 19, 52).
 * Locally a whole file (two boots on the real cache, one generate, about 400 requests) takes under 1 s and
 * no single test or hook more than 0.1 s, so this is far more than 10x. The poll budgets above are separate
 * and keep their numbers.
 */
export const T = 30_000;

/**
 * The largest city the generate form allows (shared/v2/schemas.ts: employees max 120, packages max 60), with
 * the seed and detour limit that give the heaviest poll we found. The poll grows with the number of carrying
 * jobs, and a relay plan has two, so the heaviest city is not the one with the highest limit: a sweep of every
 * limit 0..30 with seeds 1..40 (1,240 cities, end of day) found 0 over the budget and this one on top with
 * 86 jobs and 141.5 KB. The Random preset reads no story file, so a story retune does not move it.
 * If a generator change puts it over 150 KB, keep the number: mark the size check `it.fails` with the
 * measurement and report it (DECISIONS pass 54), do not pick a lighter seed.
 */
export const LARGEST_RANDOM: GenerateScenarioRequest = { preset: 'random', seed: 35, employees: 120, packages: 60, maxExtraMin: 13 };

// ---------- The server ----------

export type Timed = { median: number; bytes: number; text: string };
export type PollApi = Awaited<ReturnType<typeof startPollApi>>;

/** The whole server on a free port, with /api/v2 on the committed NYC cache. Call `close` in `afterAll`. */
export async function startPollApi() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-poll-'));
  const runtime = createV2Runtime({
    fixturesDir: NYC_FIXTURES_DIR,
    statePath: path.join(dir, 'state-v2.json'),
    key: null,
    fetch: async (url) => {
      throw new Error(`the poll budget tests must not reach the network (${String(url).split('?')[0]})`);
    },
  });
  if (runtime.status !== 'ready' || !runtime.deps.store) {
    throw new Error(`/api/v2 did not load on the committed fixtures/nyc: ${runtime.reason ?? 'no store'}`);
  }
  const store: Store<Run> = runtime.deps.store;

  const app = createApp({ clientDist: path.join(dir, 'no-dist'), v2: runtime.deps });
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;

  /** GET a path under /api/v2 and return the body exactly as it came over the wire. */
  const getText = async (url: string): Promise<string> => {
    const res = await fetch(base + url);
    const text = await res.text();
    expect(res.status, `GET /api/v2${url}: ${text.slice(0, 200)}`).toBe(200);
    return text;
  };

  const post = async (url: string, body: unknown): Promise<SimulatorResponse> => {
    const res = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    expect(res.status, `POST /api/v2${url}: ${text.slice(0, 200)}`).toBe(200);
    return JSON.parse(text) as SimulatorResponse;
  };

  return {
    /** The v2 store, to read the run's settings and events. The tests never mutate it directly. */
    store,
    getText,
    simulator: async () => JSON.parse(await getText('/simulator')) as SimulatorResponse,
    map: async () => JSON.parse(await getText('/map')) as MapResponse,
    seek: (timeMin: number) => post('/simulator/control', { action: 'seek', timeMin }),
    generate: (request: GenerateScenarioRequest) => post('/scenario/generate', request),

    /**
     * Median wall-clock time of `n` GETs after a warm-up (JIT, keep-alive socket), the body size in bytes and
     * the last body. Every call must answer 200 with the same bytes: the run does not change while we measure.
     */
    timed: async (url: string, n = CALLS): Promise<Timed> => {
      for (let i = 0; i < WARM_UP_CALLS; i++) await getText(url);
      const times: number[] = [];
      let text = '';
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const body = await getText(url);
        times.push(performance.now() - t0);
        if (i > 0 && body !== text) throw new Error(`GET /api/v2${url} answered two different bodies while nothing changed`);
        text = body;
      }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(n / 2)], bytes: Buffer.byteLength(text), text };
    },

    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await runtime.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------- The two runs and the three clock times ----------

export type RunKind = 'nyc' | 'random';

export const RUNS: { kind: RunKind; name: string }[] = [
  { kind: 'nyc', name: 'NYC default run' },
  { kind: 'random', name: `largest Random city (${LARGEST_RANDOM.employees} employees, ${LARGEST_RANDOM.packages} packages, seed ${LARGEST_RANDOM.seed}, limit ${LARGEST_RANDOM.maxExtraMin} min)` },
];

/** Boots the server on the committed cache; for `random` it then generates the largest city over HTTP. */
export async function startRun(kind: RunKind): Promise<PollApi> {
  const api = await startPollApi();
  if (kind === 'random') {
    const before = api.store.get().runId;
    const generated = await api.generate(LARGEST_RANDOM);
    // A wrong body would leave us measuring the small default run, so check what was built.
    const { employees, shipments } = api.store.get().scenario;
    if (generated.runId === before || employees.length !== LARGEST_RANDOM.employees || shipments.length !== LARGEST_RANDOM.packages) {
      await api.close();
      throw new Error(`generate did not build the largest city: ${employees.length} employees, ${shipments.length} packages`);
    }
  }
  return api;
}

/**
 * The three clock times of the issue, each read from the run itself: the start of the run (before the first
 * event), 18:00 on Day 1 (mid evening, as in the MVP 1 budget test) and the end of the run (every event has
 * happened). In this order the clock only moves forward.
 */
export const CLOCK_TIMES: { label: string; timeOf: (run: Run) => number }[] = [
  { label: 'before the first event', timeOf: (run) => run.scenario.settings.simStartMin },
  { label: 'mid evening', timeOf: () => 18 * 60 },
  { label: 'end of day', timeOf: (run) => run.scenario.settings.simEndMin },
];

// ---------- Route lines ----------

/**
 * Every encoded route line of the committed fixtures/nyc/polylines.json, as it would appear inside a JSON
 * body (backslashes and quotes escaped), so `body.includes(line)` finds it wherever a response puts it.
 */
export function committedRouteLines(): string[] {
  const file = JSON.parse(fs.readFileSync(path.join(NYC_FIXTURES_DIR, POLYLINES_FILE), 'utf8')) as {
    polylines: Record<string, string | null>;
  };
  const lines = Object.values(file.polylines).filter((line): line is string => typeof line === 'string' && line.length > 0);
  return [...new Set(lines)].map((line) => JSON.stringify(line).slice(1, -1));
}

/** How many of `lines` appear in a response body. */
export const routeLinesIn = (body: string, lines: string[]): number => lines.filter((line) => body.includes(line)).length;

// ---------- Reporting ----------

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** One printed measurement next to its budget, e.g. `NYC default run, mid evening: simulator 2.1 ms (budget 40 ms), 31.0 KB (budget 150.0 KB)`. */
export function report(where: string, what: string, t: Timed, maxBytes: number): void {
  console.log(`${where}: ${what} median ${t.median.toFixed(1)} ms of ${CALLS} (budget ${POLL_MEDIAN_MS} ms), ${kb(t.bytes)} (budget ${kb(maxBytes)})`);
}
