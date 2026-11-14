// Helper for the end-to-end tests on the committed NYC cache (tests/api/v2-e2e-nyc-*.test.ts, SPEC M8).
// Starts the whole server the way server/index.ts does: `createV2Runtime` on the real `fixtures/nyc`
// with no key, then `createApp(store, { v2: runtime.deps })` on a free local port. Both state files are
// in a temp folder, so the repo's `data/` folder is never used.
// These tests assert rules only. They never pin a story ID or a count (DECISIONS pass 54), so the story
// in fixtures/nyc/demoStory.json can be retuned without touching them.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { createInitialRun as createMvp1Run, loadDefaultScenario } from '../../server/api/initialRun';
import { createV2Runtime, type V2Runtime } from '../../server/api/v2/bootstrap';
import { NYC_BOUNDS } from '../../server/api/v2/commutePlan';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import type {
  BusinessesResponse, EmployeesResponse, ExportFile, ShipmentResponse, SimulatorResponse,
} from '../../shared/v2/api';
import type { CreateShipmentRequest, PutCommuteRequest } from '../../shared/v2/schemas';
import type {
  DeliveryPlan, Employee, LatLng, NetworkBusiness, Run as RunV2, Settings, ShipmentProgress, Stop,
} from '../../shared/v2/types';

/**
 * Timeout of every test and hook in these files (DECISIONS pass 19): each talks to a real HTTP server.
 * The slowest file takes about 0.6 s locally, so this is far more than 3x.
 */
export const T = 30_000;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The committed cache and fixture files. Read only: nothing here may write to it. */
export const NYC_DIR = path.join(REPO_ROOT, 'fixtures', 'nyc');
/** Where `npm run dev` keeps its state. These tests must leave it exactly as it is. */
export const REPO_DATA_DIR = path.join(REPO_ROOT, 'data');

/** Day 2 starts here (AGENTS.md: time is minutes since Day 1 00:00). */
export const DAY_2_MIN = 1440;

// ---------- the network guard ----------

export type FetchRecorder = ReturnType<typeof recordFetch>;

/**
 * Replaces `globalThis.fetch` with a recorder. Call it at the top of a test file, before the server starts:
 * the runtime gets no `fetch` option, so its Google clients take the global one.
 * A call to an allowed origin (the test server) goes through. Any other call is recorded and rejected,
 * and `expectNoOutgoing()` in `afterEach` fails the test that made it, even when the caller swallowed
 * the rejection. The query string is not recorded, because that is where a key would be.
 */
export function recordFetch() {
  const real = globalThis.fetch;
  const allowed = new Set<string>();
  const outgoing: string[] = [];
  let local = 0;

  const recorder: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (allowed.has(url.origin)) {
      local += 1;
      return real(input, init);
    }
    const line = `${init?.method ?? 'GET'} ${url.origin}${url.pathname}`;
    outgoing.push(line);
    throw new Error(`v2-e2e-nyc: outgoing call ${line}`);
  };
  globalThis.fetch = recorder;

  return {
    /** Calls that were not to the test server. Must stay empty. */
    outgoing,
    /** How many calls went to the test server. */
    localCalls: () => local,
    allow: (origin: string) => void allowed.add(origin),
    /** True while the recorder is still the global `fetch` (nothing swapped it back). */
    installed: () => globalThis.fetch === recorder,
    expectNoOutgoing: () => expect(outgoing).toStrictEqual([]),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

// ---------- files that must not change ----------

function listFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const rel = path.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
    });
}

/** Every file under the repo's `data/` with its size and change time, or null when there is no such folder. */
export function repoDataState(): string[] | null {
  if (!fs.existsSync(REPO_DATA_DIR)) return null;
  return listFiles(REPO_DATA_DIR).map((rel) => {
    const stat = fs.statSync(path.join(REPO_DATA_DIR, rel));
    return `${rel} ${stat.size} ${stat.mtimeMs}`;
  });
}

/** Every file in `fixtures/nyc` with a hash of its content. */
export function nycFilesState(): string[] {
  return listFiles(NYC_DIR).map((rel) =>
    `${rel} ${createHash('sha256').update(fs.readFileSync(path.join(NYC_DIR, rel))).digest('hex')}`);
}

// ---------- the server ----------

export type Answer<B> = { status: number; body: B };

export type NycApi = Awaited<ReturnType<typeof startNycApi>>;

/**
 * A copy of the committed `fixtures/nyc` in a new temp folder, for a test that writes (a delivery request,
 * a commute save): DECISIONS pass 56. The caller removes it.
 */
export function copyNycFixtures(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-e2e-nyc-fixtures-'));
  fs.cpSync(NYC_DIR, dir, { recursive: true });
  return dir;
}

/**
 * The whole server on a free port, MVP II booted from the real `fixtures/nyc` with no key.
 * `stateDir` is a folder of an earlier `startNycApi` (a restart on the same state file); it is then
 * not removed by `close`. `fixturesDir` is a copy of `fixtures/nyc` (`copyNycFixtures`) to boot from
 * instead of the committed folder.
 */
export async function startNycApi(net: FetchRecorder, opts: { stateDir?: string; fixturesDir?: string } = {}) {
  if (!net.installed()) throw new Error('v2-e2e-nyc: call recordFetch() before the server starts');
  const stateDir = opts.stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v2-e2e-nyc-'));
  const statePath = path.join(stateDir, 'state-v2.json');
  const dataBefore = repoDataState();
  const nycBefore = nycFilesState();

  const runtime: V2Runtime = createV2Runtime({ fixturesDir: opts.fixturesDir ?? NYC_DIR, statePath, key: undefined });
  const mvp1Store = createStore({
    filePath: path.join(stateDir, 'state.json'),
    initial: () => createMvp1Run(loadDefaultScenario()),
  });
  const app = createApp(mvp1Store, { clientDist: path.join(stateDir, 'no-dist'), v2: runtime.deps });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  net.allow(origin);

  /** `url` is relative to /api/v2. The body type is the contract's (shared/v2/api.ts), not checked at runtime. */
  const call = async <B>(method: string, url: string, body?: unknown): Promise<Answer<B>> => {
    const res = await globalThis.fetch(`${origin}/api/v2${url}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as B };
  };

  let closed = false;
  return {
    runtime,
    stateDir,
    statePath,
    get: <B>(url: string) => call<B>('GET', url),
    post: <B>(url: string, body?: unknown) => call<B>('POST', url, body),
    put: <B>(url: string, body?: unknown) => call<B>('PUT', url, body),
    /** GET /simulator, which must answer 200. */
    simulator: async (): Promise<SimulatorResponse> => {
      const res = await call<SimulatorResponse>('GET', '/simulator');
      expect(res.status).toBe(200);
      return res.body;
    },
    /** POST /simulator/control, which must answer 200. */
    control: async (body: { action: string; timeMin?: number; speed?: number }): Promise<SimulatorResponse> => {
      const res = await call<SimulatorResponse>('POST', '/simulator/control', body);
      expect(res.status).toBe(200);
      return res.body;
    },
    /** GET /scenario/export: the whole run. The scenario's settings are in no other answer. */
    exportRun: async (): Promise<RunV2> => {
      const res = await call<ExportFile>('GET', '/scenario/export');
      expect(res.status).toBe(200);
      return res.body;
    },
    /** The v2 run in the state file, or null when the file was never written. */
    savedRun: async (): Promise<RunV2 | null> => {
      await runtime.deps.store?.flush();
      return fs.existsSync(statePath) ? (JSON.parse(fs.readFileSync(statePath, 'utf8')).run as RunV2) : null;
    },
    /** Nothing under the repo's `data/` and nothing in `fixtures/nyc` changed since this server started. */
    expectRepoFilesUntouched: () => {
      expect(repoDataState()).toStrictEqual(dataBefore);
      expect(nycFilesState()).toStrictEqual(nycBefore);
    },
    /**
     * Stops the server. `crash: true` skips the runtime's shutdown (no final pause and save), like a killed
     * process: only what the requests already wrote is in the state file.
     */
    close: async (how: { crash?: boolean } = {}) => {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => server.close(resolve));
      if (how.crash) await runtime.deps.store?.flush();
      else await runtime.shutdown();
      await mvp1Store.flush();
      if (!opts.stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

// ---------- requests built from the data ----------

/** The run's businesses and employees, and the settings (from the export). */
export async function readCity(api: NycApi) {
  const businesses = (await api.get<BusinessesResponse>('/businesses')).body.businesses;
  const employees = (await api.get<EmployeesResponse>('/employees')).body.employees;
  const settings: Settings = (await api.exportRun()).scenario.settings;
  return {
    businesses,
    employees,
    settings,
    business: new Map(businesses.map((b) => [b.id, b])),
    employee: new Map(employees.map((e) => [e.id, e])),
  };
}

export type City = Awaited<ReturnType<typeof readCity>>;

/** A delivery request with the widest window the run allows: ready at the start, due at the end. */
export function deliveryRequest(
  clientRequestId: string, originBusinessId: string, destinationBusinessId: string, settings: Settings,
): Omit<CreateShipmentRequest, 'pickupInstructions' | 'dropoffInstructions'> {
  return {
    clientRequestId,
    originBusinessId,
    destinationBusinessId,
    label: 'Signed lease copies',
    category: 'envelope',
    description: 'Two signed copies for the office manager',
    weightKg: 0.3,
    readyMin: settings.simStartMin,
    deadlineMin: settings.simEndMin,
  };
}

/**
 * Finds a delivery request that matches, from the data: sender and recipient pairs in ID order, each with
 * a fresh `clientRequestId`, until one answers `matched: true`. Every try is a stored request (201), so
 * the version goes up by `tries`. Throws when no pair of the city matches: then the live demo request
 * cannot work on this cache.
 */
export async function findMatchingDelivery(api: NycApi, city: City, tag: string) {
  const ids = city.businesses.map((b) => b.id).sort();
  let tries = 0;
  for (const origin of ids) {
    for (const destination of ids) {
      if (origin === destination) continue;
      tries += 1;
      const res = await api.post<ShipmentResponse>('/shipments', deliveryRequest(`${tag}-${tries}`, origin, destination, city.settings));
      expect(res.status).toBe(201);
      if (res.body.matched) return { delivery: res.body, tries, origin, destination };
      expect(res.body.plan).toBeNull();
      expect(res.body.unmatchedReason).toEqual(expect.any(String));
    }
  }
  throw new Error(`None of the ${tries} sender and recipient pairs matched a new delivery on fixtures/nyc`);
}

/** The body of a commute save that keeps everything of `employee` as it is, except `change`. */
export function commuteOf(employee: Employee, change: Partial<Pick<PutCommuteRequest, 'maxExtraMin' | 'home'>> = {}): PutCommuteRequest {
  return {
    businessId: employee.businessId,
    home: { homeId: employee.homeId },
    eveningDepartureMin: employee.eveningDepartureMin,
    morningDepartureMin: employee.morningDepartureMin,
    availableEvening: employee.availableEvening,
    availableMorning: employee.availableMorning,
    maxExtraMin: employee.maxExtraMin,
    ...change,
  };
}

// ---------- rules the answers are checked against ----------

/** Every stop of a plan in travel order. */
export const stopsOf = (plan: DeliveryPlan): Stop[] => plan.legs.flatMap((leg) => leg.stops);

const STATUS_AFTER: Record<Stop['kind'], ShipmentProgress> = {
  pickup: 'picked_up', hub_drop: 'at_hub', hub_pickup: 'out_for_delivery', delivery: 'delivered',
};

/**
 * The status a matched package must show at `timeMin`, read from the plan's own stop times
 * (DECISIONS pass 3): the last stop whose handling has ended decides; before the first, `scheduled`.
 */
export function statusFromPlan(plan: DeliveryPlan, timeMin: number): ShipmentProgress {
  let status: ShipmentProgress = 'scheduled';
  for (const stop of stopsOf(plan)) if (stop.serviceEndMin <= timeMin) status = STATUS_AFTER[stop.kind];
  return status;
}

/** A real point inside the five boroughs' box (the one the commute save uses), so never (0, 0). */
export function expectInNyc(point: LatLng, what: string): void {
  const ok = Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= NYC_BOUNDS.south && point.lat <= NYC_BOUNDS.north
    && point.lng >= NYC_BOUNDS.west && point.lng <= NYC_BOUNDS.east;
  if (!ok) throw new Error(`${what} is outside New York City: (${point.lat}, ${point.lng})`);
}

/** The snapshot's statuses agree with every plan's stop times, and unmatched packages say so. */
export function expectStatusesFromPlans(sim: SimulatorResponse): void {
  const { timeMin } = sim.clock;
  expect(sim.snapshot.timeMin).toBe(timeMin);
  for (const plan of sim.plans) {
    expect(`${plan.shipmentId} ${sim.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} ${statusFromPlan(plan, timeMin)}`);
  }
  for (const { shipmentId } of sim.unmatched) expect(sim.snapshot.shipmentStatus[shipmentId]).toBe('unmatched');
}

/** Every marker and every package position of the snapshot is a point in New York City. */
export function expectPositionsInNyc(sim: SimulatorResponse): void {
  const at = `at minute ${sim.clock.timeMin}`;
  for (const marker of sim.snapshot.markers) expectInNyc(marker, `The marker of ${marker.employeeId} ${at}`);
  for (const [shipmentId, point] of Object.entries(sim.snapshot.packagePositions)) expectInNyc(point, `Package ${shipmentId} ${at}`);
  // A matched package is always somewhere: at a business or with its carrier.
  for (const plan of sim.plans) expect(Object.keys(sim.snapshot.packagePositions)).toContain(plan.shipmentId);
}

/** The business a place ID names. Fails for a home or an unknown ID: stops are only ever at businesses. */
export function businessAt(city: City, placeId: string): NetworkBusiness {
  const business = city.business.get(placeId);
  if (!business) throw new Error(`${placeId} is not a network business`);
  expect(business.name.trim()).not.toBe('');
  return business;
}
