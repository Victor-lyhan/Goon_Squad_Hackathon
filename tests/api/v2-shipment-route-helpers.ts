// Harness for the /api/v2 delivery-request route tests: the real app and the real v2 router, a real store
// on a temp file, the pipeline sample's hand-built city, a table-driven TravelProvider, a fake `snapshotAt`
// and a recording fake of `ensureLegPolylines`. No network, no fixtures/nyc matrix, no key.
//
// The sample street (minutes apart), from v2-pipeline-sample.ts:
//
//   home-003   Print Shop   home-002   Corner Cafe   home-001   Agency
//      -5          0            5           10           15        30
//
// The default city starts with
//   shp-1 Print Shop -> Agency       relay via the cafe (emp-1 evening, emp-2 morning)
//   shp-2 Agency -> Print Shop       direct (emp-3 evening)
//   shp-3 Corner Cafe -> Print Shop  unmatched
// and emp-2's evening trip (Agency -> Corner Cafe -> home-002) is free: Agency -> Corner Cafe matches on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';
import { expect } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun as createMvp1Run, loadDefaultScenario } from '../../server/api/initialRun';
import { createInitialRun } from '../../server/api/v2/initialRun';
import { registerShipmentRoutes, type ShipmentRouteDeps } from '../../server/api/v2/shipmentRoutes';
import { buildTrips } from '../../server/domain/v2/trips';
import type { ShipmentResponse } from '../../shared/v2/api';
import type {
  Leg, Metrics, Run, Scenario, ShipmentProgress, Snapshot, TravelProvider,
} from '../../shared/v2/types';
import {
  AGENCY, CAFE, PRINT, sampleScenario, sampleTable, stubEvents, tableTravel, type TravelTable,
} from './v2-pipeline-sample';

export { AGENCY, CAFE, PRINT };

export const NO_COMMUTE = 'No sender evening commute or recipient morning commute is available';
export const ALL_CARRYING = 'Every matching commute is already carrying a package';

export type Reply = { status: number; text: string; body: Record<string, unknown> };

/** How the fake `ensureLegPolylines` behaves. `hang` never settles; `throw` throws before returning a promise. */
export type LinesMode = 'resolve' | 'reject' | 'throw' | 'hang';
export type LinesCall = {
  legs: Pick<Leg, 'placeIds'>[];
  /** Whether the request's response had been handed to the socket when the route called the fake. */
  responseSent: boolean;
  /** The store's run at the call: the route calls only after the mutation is committed. */
  run: Run;
};

export type ShipmentApp = {
  base: string;
  store: Store<Run>;
  /** The travel table behind the provider. Deleting a pair makes its lookup throw TravelDataMissingError. */
  table: TravelTable;
  /** While set, every travel lookup throws it (a provider that needs Google and cannot reach it). */
  travelFailure: { error: unknown | null };
  /** Statuses the fake snapshot reports; a shipment without one gets the view's own fallback. */
  progress: Record<string, ShipmentProgress>;
  deliveredAtMin: Record<string, number>;
  /** Every `snapshotAt` call in order. */
  snapshots: { run: Run; timeMin: number }[];
  lines: { mode: LinesMode; calls: LinesCall[] };
  request(method: string, url: string, body?: unknown): Promise<Reply>;
  create(body: unknown): Promise<Reply>;
  patch(shipmentId: string, body: unknown): Promise<Reply>;
  retry(shipmentId: string): Promise<Reply>;
  close(): Promise<void>;
};

// createApp needs the MVP 1 store. No test here touches it, so its run is built once per test file.
let mvp1RunOnce: ReturnType<typeof createMvp1Run> | undefined;
const mvp1Run = () => (mvp1RunOnce ??= createMvp1Run(loadDefaultScenario()));

/**
 * Starts the app on a free port with the delivery-request routes registered through `createV2Router`'s
 * `extraRoutes`. `lines: false` leaves `ensureLegPolylines` out of the dependencies.
 */
export async function startShipmentApp(opts: { scenario?: Scenario; lines?: boolean } = {}): Promise<ShipmentApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-shipment-route-'));
  const table = sampleTable();
  const tableLookups = tableTravel(table);
  const travelFailure: ShipmentApp['travelFailure'] = { error: null };
  const guarded = <A extends unknown[], R>(lookup: (...args: A) => R) => (...args: A): R => {
    if (travelFailure.error) throw travelFailure.error;
    return lookup(...args);
  };
  const travel: TravelProvider = {
    durationMin: guarded(tableLookups.durationMin),
    distanceM: guarded(tableLookups.distanceM),
    polyline: tableLookups.polyline,
  };

  const store = createStore<Run>({
    filePath: path.join(dir, 'v2-state.json'),
    initial: () => createInitialRun(opts.scenario ?? sampleScenario(), { travel, buildEvents: stubEvents }),
  });

  const progress: ShipmentApp['progress'] = {};
  const deliveredAtMin: ShipmentApp['deliveredAtMin'] = {};
  const snapshots: ShipmentApp['snapshots'] = [];
  // The views read only `shipmentStatus` and `deliveredAtMin` for a ShipmentView.
  const snapshotAt: ShipmentRouteDeps['snapshotAt'] = (run, timeMin): Snapshot => {
    snapshots.push({ run, timeMin });
    return {
      runId: run.runId, version: run.version, timeMin,
      shipmentStatus: { ...progress }, deliveredAtMin: { ...deliveredAtMin },
      jobStatus: {}, earningsCents: {}, markers: [], packagePositions: {}, occurredEvents: [],
      metrics: {} as Metrics,
    };
  };

  // The response of the request being handled. These tests send one request at a time where it matters.
  let currentResponse: express.Response | null = null;
  const lines: ShipmentApp['lines'] = { mode: 'resolve', calls: [] };
  const ensureLegPolylines: NonNullable<ShipmentRouteDeps['ensureLegPolylines']> = (legs) => {
    lines.calls.push({
      legs: structuredClone(legs), responseSent: currentResponse?.headersSent ?? false, run: store.get(),
    });
    if (lines.mode === 'throw') throw new Error('route lines: thrown before a promise existed');
    if (lines.mode === 'reject') return Promise.reject(new Error('route lines: Google said no'));
    if (lines.mode === 'hang') return new Promise(() => {});
    return Promise.resolve({ fetched: legs.length, failed: 0 });
  };

  const mvp1Store = createStore({ filePath: path.join(dir, 'state.json'), initial: mvp1Run });
  const app = createApp(mvp1Store, {
    clientDist: path.join(dir, 'no-client'),
    v2: {
      travel, store,
      extraRoutes: (router) => {
        router.use((_req, res, next) => {
          currentResponse = res;
          next();
        });
        registerShipmentRoutes(router, {
          store, travel, buildEvents: stubEvents, snapshotAt,
          ...(opts.lines === false ? {} : { ensureLegPolylines }),
        });
      },
    },
  });
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request: ShipmentApp['request'] = async (method, url, body) => {
    const res = await fetch(`${base}/api/v2${url}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    expect(res.headers.get('content-type')).toMatch(/json/);
    return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
  };

  return {
    base, store, table, travelFailure, progress, deliveredAtMin, snapshots, lines, request,
    create: (body) => request('POST', '/shipments', body),
    patch: (shipmentId, body) => request('PATCH', `/shipments/${shipmentId}`, body),
    retry: (shipmentId) => request('POST', `/shipments/${shipmentId}/match`),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.flush();
      await mvp1Store.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The sample city with no delivery requests yet, so every commute is free and IDs start at shp-1. */
export function emptyCity(): Scenario {
  return { ...sampleScenario(), shipments: [] };
}

/** A valid create body on the sample city: Agency -> Corner Cafe, which emp-2's free evening trip can carry. */
export function deliveryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientRequestId: 'req-new',
    originBusinessId: AGENCY,
    destinationBusinessId: CAFE,
    label: 'Catering order',
    category: 'small_box',
    description: 'Lunch for twelve',
    weightKg: 1.5,
    readyMin: 960,
    deadlineMin: 1980,
    pickupInstructions: 'Ask at the front desk',
    dropoffInstructions: 'Hand to the barista',
    ...overrides,
  };
}

/** What a commute save does: emp-1 now also drives to work in the morning (home-001 -> Corner Cafe -> Print Shop). */
export async function openMorningCommute(app: ShipmentApp): Promise<void> {
  await app.store.mutate((run) => {
    run.scenario.employees[0].availableMorning = true;
    run.trips = run.scenario.employees.flatMap((e) => buildTrips(e, tableTravel(sampleTable())));
  });
}

/** After Play: the scenario is frozen. */
export async function lock(app: ShipmentApp): Promise<void> {
  await app.store.mutate((run) => {
    run.clock.phase = 'locked';
  });
}

/** The store's run right now and a deep copy of it, to prove later that a request changed nothing. */
export function remember(app: ShipmentApp): { run: Run; copy: Run } {
  const run = app.store.get();
  return { run, copy: structuredClone(run) };
}

/** No mutation was committed: the very same run object, with the same content and version. */
export function expectUntouched(app: ShipmentApp, before: { run: Run; copy: Run }): void {
  expect(app.store.get()).toBe(before.run);
  expect(app.store.get()).toEqual(before.copy);
}

// shared/v2 has no response schema (responses are types), so the tests check every success body against
// this strict copy of `ShipmentResponse`: a key the contract does not have fails the parse.
const minute = z.number().int();
const StopSchema = z.strictObject({
  placeId: z.string(), kind: z.enum(['pickup', 'hub_drop', 'hub_pickup', 'delivery']),
  arrivalMin: minute, serviceStartMin: minute, serviceEndMin: minute,
});
const LegSchema = z.strictObject({
  tripId: z.string(), employeeId: z.string(), placeIds: z.array(z.string()), stops: z.array(StopSchema),
  finishMin: minute, extraMin: minute, extraDistanceM: z.number(), rewardCents: z.number().int(),
});
const PlanSchema = z.strictObject({
  id: z.string(), shipmentId: z.string(), kind: z.enum(['direct', 'relay']), legs: z.array(LegSchema),
  relayBusinessId: z.string().optional(), deliveryMin: minute,
  customerPriceCents: z.number().int(), platformContributionCents: z.number().int(),
});
export const ShipmentResponseSchema = z.strictObject({
  shipment: z.strictObject({
    id: z.string(), clientRequestId: z.string(), label: z.string(),
    originBusinessId: z.string(), destinationBusinessId: z.string(),
    readyMin: minute, deadlineMin: minute,
    category: z.enum(['envelope', 'small_box']), description: z.string(), weightGrams: z.number().int(),
    pickupInstructions: z.string(), dropoffInstructions: z.string(), createdSeq: z.number().int(),
  }),
  plan: PlanSchema.nullable(),
  jobIds: z.array(z.string()),
  status: z.enum(['unmatched', 'scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered']),
  deliveredAtMin: minute.nullable(),
  unmatchedReason: z.string().nullable(),
  matched: z.boolean(),
});
// Compile-time: the schema and the contract type describe the same object, in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const schemaMatchesContract: Same<z.infer<typeof ShipmentResponseSchema>, ShipmentResponse> = true;

/**
 * Parses a success body as `ShipmentResponse` and checks that it agrees with itself and with the stored run:
 * `matched` says whether there is a plan, a plan has one job per leg, an unmatched delivery has a reason.
 */
export function expectShipmentResponse(app: ShipmentApp, reply: Reply): ShipmentResponse {
  const body: ShipmentResponse = ShipmentResponseSchema.parse(reply.body);
  const run = app.store.get();
  const { id } = body.shipment;

  expect(body.shipment).toEqual(run.scenario.shipments.find((s) => s.id === id));
  expect(body.matched).toBe(body.plan !== null);
  if (body.plan) {
    expect(body.plan).toEqual(run.assignments.plans.find((p) => p.shipmentId === id));
    expect(body.plan.id).toBe(`plan-${id}`);
    expect(body.jobIds).toEqual(body.plan.legs.map((_leg, i) => `plan-${id}-L${i}`));
    expect(run.jobs.filter((j) => j.shipmentId === id).map((j) => j.id).sort()).toEqual(body.jobIds);
    expect(body.unmatchedReason).toBeNull();
    expect(body.status).not.toBe('unmatched');
    expect(run.assignments.unmatched.some((u) => u.shipmentId === id)).toBe(false);
  } else {
    expect(body.jobIds).toEqual([]);
    expect(run.jobs.some((j) => j.shipmentId === id)).toBe(false);
    expect(body.status).toBe('unmatched');
    expect(body.deliveredAtMin).toBeNull();
    expect(body.unmatchedReason).toBe(run.assignments.unmatched.find((u) => u.shipmentId === id)?.reason);
    expect(body.unmatchedReason).toMatch(/\S/);
    expect(body.unmatchedReason).not.toMatch(/hub|undefined|\b(biz|home|emp|shp|plan)-/i);
  }
  return body;
}

/** The run's notifications for one delivery, oldest first, as `[audience ID, message]`. */
export function notesFor(app: ShipmentApp, shipmentId: string): [string, string][] {
  return app.store.get().notifications
    .filter((n) => n.shipmentId === shipmentId)
    .sort((a, b) => a.createdSeq - b.createdSeq)
    .map((n) => [n.audienceId, n.message]);
}
