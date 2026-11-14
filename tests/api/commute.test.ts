import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun } from '../../server/api/initialRun';
import type { CommuteResponse } from '../../shared/api';
import type { ApiError } from '../../shared/schemas';
import { gridGraph } from '../../server/domain/generator';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { Scenario } from '../../shared/types';

const scenario = (): Scenario => ({
  schemaVersion: 1, name: 't', preset: 'fixture', seed: 0, graph: gridGraph(),
  businesses: [{ id: 'biz-1', name: 'B1', nodeId: 'n-0-0', district: 'D' }],
  hubs: [{ id: 'hub-1', name: 'H', nodeId: 'n-6-6' }],
  employees: [{
    id: 'emp-1', name: 'E', businessId: 'biz-1', homeNodeId: 'n-5-5', eveningDepartureMin: 1020,
    morningDepartureMin: 1935, maxExtraMin: 8, availableEvening: true, availableMorning: true,
    eveningViaNodeIds: [], morningViaNodeIds: [],
  }],
  shipments: [], settings: { ...DEFAULT_SETTINGS },
});

let server: Server;
let base: string;
let file: string;
const mk = () => createStore({ filePath: file, initial: () => createInitialRun(scenario()) });
const put = (id: string, body: unknown) =>
  fetch(`${base}/api/employees/${id}/commute`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

let store: ReturnType<typeof mk>;
beforeAll(async () => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commute-')), 'state.json');
  store = mk();
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const current = () => store.get().scenario.employees[0];
const payload = (over: object = {}) => {
  const e = current();
  return {
    businessId: e.businessId, homeNodeId: e.homeNodeId, eveningDepartureMin: e.eveningDepartureMin,
    morningDepartureMin: e.morningDepartureMin, availableEvening: e.availableEvening,
    availableMorning: e.availableMorning, maxExtraMin: e.maxExtraMin,
    eveningViaNodeIds: e.eveningViaNodeIds, morningViaNodeIds: e.morningViaNodeIds, ...over,
  };
};

describe('PUT /api/employees/:id/commute', () => {
  it('computes baseline trips on load', () => {
    const run = createInitialRun(scenario());
    expect(run.trips.length).toBeGreaterThan(0);
    expect(run.trips.map((t) => t.employeeId)).toContain(run.scenario.employees[0].id);
  });

  it('400 with fieldErrors on invalid body', async () => {
    const r = await put(current().id, payload({ maxExtraMin: 99 }));
    expect(r.status).toBe(400);
    const b = (await r.json()) as ApiError;
    expect(b.fieldErrors?.maxExtraMin).toBeTruthy();
  });

  it('404 for unknown employee', async () => {
    expect((await put('nope', payload())).status).toBe(404);
  });

  it('400 for unknown business, home and via nodes', async () => {
    for (const [field, over] of [
      ['businessId', { businessId: 'zzz' }],
      ['homeNodeId', { homeNodeId: 'zzz' }],
      ['eveningViaNodeIds', { eveningViaNodeIds: ['zzz'] }],
    ] as const) {
      const r = await put(current().id, payload(over));
      expect(r.status).toBe(400);
      expect(((await r.json()) as ApiError).fieldErrors).toHaveProperty(field);
    }
  });

  it('a saved via node changes the trip and persists; availability removes the trip', async () => {
    const e = current();
    const before = store.get().trips.find((t) => t.id === `${e.id}-eve`)!;
    const other = store.get().trips.filter((t) => t.employeeId !== e.id);
    const via = store.get().scenario.graph.nodes.map((n) => n.id)
      .find((id) => !before.baselineNodeIds.includes(id))!;
    const r = await put(e.id, payload({ eveningViaNodeIds: [via] }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as CommuteResponse;
    const eve = body.trips.find((t) => t.id === `${e.id}-eve`)!;
    expect(eve.baselineNodeIds).toContain(via);
    expect(eve.baselineNodeIds).not.toEqual(before.baselineNodeIds);
    expect(body.rematchedShipmentIds).toEqual([]);
    expect(store.get().trips.filter((t) => t.employeeId !== e.id)).toEqual(other);

    const r2 = await put(e.id, payload({ eveningViaNodeIds: [via], availableEvening: false }));
    const b2 = (await r2.json()) as CommuteResponse;
    expect(b2.trips.some((t) => t.id.endsWith('-eve'))).toBe(false);
    expect(store.get().trips.some((t) => t.id === `${e.id}-eve`)).toBe(false);

    await store.flush();
    const reloaded = mk();
    expect(reloaded.get().scenario.employees[0].availableEvening).toBe(false);
    expect(reloaded.get().scenario.employees[0].eveningViaNodeIds).toEqual([via]);
    expect(reloaded.get().trips.some((t) => t.id === `${e.id}-eve`)).toBe(false);
  });

  it('409 when locked', async () => {
    await store.mutate((r) => { r.clock.phase = 'locked'; });
    const r = await put(current().id, payload());
    expect(r.status).toBe(409);
    expect(((await r.json()) as ApiError).error).toBe('Start a new planning cycle to edit commutes');
  });
});

describe('PUT commute retries unmatched shipments', () => {
  it('rematches a waiting shipment and lists the job on the employee dashboard', async () => {
    const sc = scenario();
    sc.businesses.push({ id: 'biz-2', name: 'B2', nodeId: 'n-5-4', district: 'D' });
    sc.employees[0].availableEvening = false;
    sc.employees[0].availableMorning = false;
    sc.shipments = [{
      id: 'shp-1', clientRequestId: 'c1', label: 'Box', originBusinessId: 'biz-1', destinationBusinessId: 'biz-2',
      readyMin: 960, deadlineMin: 2100, category: 'envelope', description: 'd', weightGrams: 500,
      pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
    }];
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rematch-')), 'state.json');
    const st = createStore({ filePath: f, initial: () => createInitialRun(sc) });
    const srv = createApp(st).listen(0);
    await new Promise((r) => srv.once('listening', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect(st.get().assignments.unmatched.map((u) => u.shipmentId)).toEqual(['shp-1']);
      const e = st.get().scenario.employees[0];
      const body = {
        businessId: e.businessId, homeNodeId: e.homeNodeId, eveningDepartureMin: e.eveningDepartureMin,
        morningDepartureMin: e.morningDepartureMin, availableEvening: true, availableMorning: false,
        maxExtraMin: 8, eveningViaNodeIds: [], morningViaNodeIds: [],
      };
      const r = await fetch(`${url}/api/employees/${e.id}/commute`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(r.status).toBe(200);
      expect(((await r.json()) as CommuteResponse).rematchedShipmentIds).toEqual(['shp-1']);
      expect(st.get().assignments.unmatched).toEqual([]);
      const dash = (await (await fetch(`${url}/api/employees/${e.id}/dashboard`)).json()) as
        { assigned: { shipment: { id: string } }[] };
      expect(dash.assigned.map((j) => j.shipment.id)).toEqual(['shp-1']);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});
