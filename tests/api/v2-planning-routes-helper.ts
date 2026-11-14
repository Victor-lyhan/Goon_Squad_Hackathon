// Helper for the v2 planning and scenario route tests (tests/api/v2-planning-routes-*.test.ts).
// Starts the real app (createApp -> createV2Router) with three route groups registered through `extraRoutes`:
// the read routes (GET /simulator), the control route (Play) and the planning routes under test.
// The store is the real file store on a temp folder; the timeline and the snapshot are the real domain
// functions; travel is a table (tests/api/v2-pipeline-sample.ts) or the in-memory cache of v2-boot-sample.ts.
// No network beyond localhost, no key.
import { expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { registerControlRoutes } from '../../server/api/v2/controlRoutes';
import { createInitialRun } from '../../server/api/v2/initialRun';
import type { PipelineDeps } from '../../server/api/v2/pipeline';
import type { GenerateInputs, TravelPairs } from '../../server/api/v2/planningOps';
import { registerPlanningRoutes, type PlanningRouteDeps } from '../../server/api/v2/planningRoutes';
import { registerReadRoutes } from '../../server/api/v2/readRoutes';
import { markersAt, packagePositionsAt } from '../../server/domain/v2/movement';
import { createSnapshotAt } from '../../server/domain/v2/simulation';
import { buildTimeline } from '../../server/domain/v2/timeline';
import { pairKey, type Run, type Scenario, type TravelProvider } from '../../shared/v2/types';
import { generateInputs as fixtureInputs } from './v2-planning-ops-sample';
import { sampleScenario, sampleTable, tableTravel, type TravelTable } from './v2-pipeline-sample';

export const T = 10_000; // every test here talks to a real HTTP server (DECISIONS pass 19)

const realSnapshotAt = createSnapshotAt({ markersAt, packagePositionsAt });

/** The pipeline on a travel provider, with the real timeline builder. */
export const pipelineOn = (travel: TravelProvider): PipelineDeps => ({ travel, buildEvents: buildTimeline });

/** `has` over a travel table: exactly the pairs the table provider can answer. */
export const pairsOf = (table: TravelTable): TravelPairs => ({
  has: (from, to) => from === to || Object.hasOwn(table, pairKey(from, to)),
});

/**
 * The small city of v2-pipeline-sample.ts: shp-1 relay (emp-1 evening, emp-2 morning, via the cafe),
 * shp-2 direct (emp-3 evening) and shp-3, which nobody can carry.
 */
export const smallScenario = (): Scenario => sampleScenario();

/** The same city without the package nobody can carry, so every package has a plan. */
export function matchedScenario(): Scenario {
  const scenario = sampleScenario();
  scenario.shipments = scenario.shipments.filter((s) => s.id !== 'shp-3');
  return scenario;
}

/** The first run of a scenario on the table: trips built, everything matched, paused at 930 in `planning`. */
export const initialRun = (scenario: Scenario, table: TravelTable = sampleTable()): Run =>
  createInitialRun(scenario, pipelineOn(tableTravel(table)));

export type PlanningApiOptions = {
  run: Run;
  /** The table behind `travel` and `travelPairs`. A test may delete pairs from it while the server runs. */
  table?: TravelTable;
  /** Replaces the table provider (the generate tests pass the cached provider of v2-boot-sample.ts). */
  travel?: TravelProvider;
  travelPairs?: TravelPairs;
  generateInputs?: GenerateInputs;
  /** Puts a test's own store in front of the real one, for the planning routes only. */
  wrapStore?: (store: Store<Run>) => Store<Run>;
};

export type Answer = { status: number; headers: Headers; body: Record<string, any> };
export type PlanningApi = Awaited<ReturnType<typeof startPlanningApi>>;

export async function startPlanningApi(opts: PlanningApiOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-planning-'));
  const stateFile = path.join(dir, 'state-v2.json');
  const table = opts.table ?? sampleTable();
  const travel = opts.travel ?? tableTravel(table);
  const store = createStore<Run>({ filePath: stateFile, initial: () => opts.run });
  const snapshotAt = (run: Run, timeMin: number) => realSnapshotAt(run, timeMin, travel);
  const deps: PlanningRouteDeps = {
    ...pipelineOn(travel),
    store: opts.wrapStore ? opts.wrapStore(store) : store,
    snapshotAt,
    generateInputs: opts.generateInputs ?? fixtureInputs,
    travelPairs: opts.travelPairs ?? pairsOf(table),
  };

  const app = createApp({
    clientDist: path.join(dir, 'no-dist'),
    v2: {
      travel,
      store,
      extraRoutes: (router) => {
        registerReadRoutes(router, { store, travel, snapshotAt });
        registerControlRoutes(router, { store, snapshotAt });
        registerPlanningRoutes(router, deps);
      },
    },
  });
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;

  /** `url` is relative to /api/v2. A string body is sent as it is (to send malformed JSON). */
  const call = async (method: string, url: string, body?: unknown): Promise<Answer> => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any> };
  };

  return {
    store,
    stateFile,
    table,
    call,
    get: (url: string) => call('GET', url),
    post: (url: string, body?: unknown) => call('POST', url, body),
    /** GET /simulator: what every planning success must answer. */
    simulator: async () => (await call('GET', '/simulator')).body,
    /** POST /simulator/control {action: 'play'} and then pause, so the run is locked and the ticker-less clock stays put. */
    lock: async () => {
      const played = await call('POST', '/simulator/control', { action: 'play' });
      const paused = await call('POST', '/simulator/control', { action: 'pause' });
      if (played.status !== 200 || paused.status !== 200) throw new Error('could not lock the run');
    },
    /** The run in the state file, or null when nothing was ever written. */
    savedRun: async (): Promise<Run | null> => {
      await store.flush();
      return fs.existsSync(stateFile) ? (JSON.parse(fs.readFileSync(stateFile, 'utf8')).run as Run) : null;
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await store.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What a JSON round trip does to a value: the form a response body has on the wire. */
export const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Checks that a refused request changed nothing: the stored run is the same object (no mutation ran),
 * the state file was not written since `savedBefore`, and GET /simulator still answers the old run.
 */
export async function expectUntouched(api: PlanningApi, before: Run, savedBefore: Run | null, simulatorBefore: unknown) {
  await api.store.flush();
  expect(api.store.get()).toBe(before);
  expect(api.store.get().version).toBe(before.version);
  expect(await api.savedRun()).toStrictEqual(savedBefore);
  expect(await api.simulator()).toStrictEqual(simulatorBefore);
}

/** The stored run, the state file and the simulator view right now, for `expectUntouched`. */
export async function stateOf(api: PlanningApi) {
  return { run: api.store.get(), saved: await api.savedRun(), simulator: await api.simulator() };
}

/** A valid delivery request for the small city (Print Shop -> Agency). */
export const deliveryRequest = (clientRequestId = 'after-reset-1') => ({
  clientRequestId,
  originBusinessId: 'biz-print-shop',
  destinationBusinessId: 'biz-agency',
  label: 'Late proofs',
  category: 'envelope',
  description: 'Printed proofs',
  weightKg: 0.3,
  readyMin: 960,
  deadlineMin: 1980,
});
