import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessDashboard, CommuteResponse, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/api';
import { gridGraph } from '../../server/domain/generator';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing';
import type { Scenario } from '../../shared/types';

let server: Server;
let base: string;
let store: Store;

async function boot(initial: () => ReturnType<typeof createInitialRun>) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'two-tab-')), 'state.json');
  store = createStore({ filePath: file, initial });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(() => new Promise((r) => server.close(r)));

const call = (method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const getJson = async <T>(url: string) => (await call('GET', url)).json() as Promise<T>;

/** One poll of tab B: the three reads the portals make every second. */
async function poll(run: { employeeIds: string[]; businessIds: string[] }) {
  const [sim, emps, biz] = await Promise.all([
    getJson<SimulatorResponse>('/api/simulator'),
    Promise.all(run.employeeIds.map((id) => getJson<EmployeeDashboard>(`/api/employees/${id}/dashboard`))),
    Promise.all(run.businessIds.map((id) => getJson<BusinessDashboard>(`/api/businesses/${id}/dashboard`))),
  ]);
  return { sim, emps, biz };
}

const ids = () => ({
  employeeIds: store.get().scenario.employees.map((e) => e.id),
  businessIds: store.get().scenario.businesses.map((b) => b.id),
});

const body = (o: string, d: string, over: object = {}) => {
  const { settings } = store.get().scenario;
  return {
    clientRequestId: 'tab-a-1', originBusinessId: o, destinationBusinessId: d, label: 'Contracts',
    category: 'envelope', description: 'Signed papers', weightKg: 0.5,
    readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
    pickupInstructions: '', dropoffInstructions: '', ...over,
  };
};

describe('two-tab sync (demo step 4)', () => {
  beforeEach(() => boot(() => createInitialRun(loadDefaultScenario())));

  /** Finds a pair of businesses the Demo city can match, using a throwaway probe store. */
  const matchablePair = async () => {
    const { businesses } = store.get().scenario;
    for (const o of businesses) for (const d of businesses) {
      if (o.id === d.id) continue;
      const r = await call('POST', '/api/shipments', body(o.id, d.id, { clientRequestId: `probe-${o.id}-${d.id}` }));
      if (((await r.json()) as ShipmentResponse).matched) return { o: o.id, d: d.id };
    }
    throw new Error('no matchable pair');
  };

  it('tab B sees tab A\'s shipment on its very next poll, with identical id, ETA and status', async () => {
    const { o, d } = await matchablePair();
    const before = await poll(ids());
    const r = await call('POST', '/api/shipments', body(o, d, { clientRequestId: 'tab-a-1' }));
    expect(r.status).toBe(201);
    const created = (await r.json()) as ShipmentResponse;
    expect(created.matched).toBe(true);
    const id = created.shipment.id;
    const eta = created.plan!.legs[created.plan!.legs.length - 1].stops.at(-1)!.arrivalMin;
    expect(typeof eta).toBe("number");

    const after = await poll(ids());
    expect(after.sim.version).toBeGreaterThan(before.sim.version);

    // simulator
    expect(after.sim.shipments.map((s) => s.id)).toContain(id);
    const simPlan = after.sim.plans.find((p) => p.shipmentId === id)!;
    expect(simPlan.id).toBe(created.plan!.id);
    expect(simPlan.legs.at(-1)!.stops.at(-1)!.arrivalMin).toBe(eta);
    expect(after.sim.snapshot.shipmentStatus[id] ?? 'scheduled').toBe(created.status);

    // business: recipient lists it as incoming, sender as outgoing
    const dest = after.biz.find((b) => b.business.id === d)!;
    const inc = dest.incoming.find((v) => v.shipment.id === id)!;
    expect(inc.status).toBe(created.status);
    expect(inc.plan!.legs.at(-1)!.stops.at(-1)!.arrivalMin).toBe(eta);
    expect(after.biz.find((b) => b.business.id === o)!.outgoing.map((v) => v.shipment.id)).toContain(id);

    // every carrier on the plan lists the job
    const carriers = new Set(created.plan!.legs.map((l) => l.employeeId));
    expect(carriers.size).toBeGreaterThan(0);
    for (const c of carriers) {
      const dash = after.emps.find((e) => e.employee.id === c)!;
      const view = [...dash.assigned, ...dash.completed].find((v) => v.shipment.id === id)!;
      expect(view).toBeTruthy();
      expect(view.plan.id).toBe(created.plan!.id);
      expect(view.plan.legs.at(-1)!.stops.at(-1)!.arrivalMin).toBe(eta);
      expect(created.jobIds).toContain(view.job.id);
    }
  });

  it('concurrent double-submit of one clientRequestId creates exactly one shipment', async () => {
    const { o, d } = await matchablePair();
    const base0 = store.get();
    const payload = body(o, d, { clientRequestId: 'double-click' });
    const rs = await Promise.all([call('POST', '/api/shipments', payload), call('POST', '/api/shipments', payload)]);
    const bs = (await Promise.all(rs.map((r) => r.json()))) as ShipmentResponse[];
    expect(bs[0].shipment.id).toBe(bs[1].shipment.id);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    const id = bs[0].shipment.id;
    const run = store.get();
    expect(run.scenario.shipments.filter((s) => s.clientRequestId === 'double-click')).toHaveLength(1);
    expect(run.scenario.shipments).toHaveLength(base0.scenario.shipments.length + 1);
    expect(run.assignments.plans.filter((p) => p.shipmentId === id)).toHaveLength(1);
    const jobs = run.jobs.filter((j) => j.shipmentId === id);
    expect(jobs).toHaveLength(bs[0].jobIds.length);
    expect(new Set(run.jobs.map((j) => j.id)).size).toBe(run.jobs.length);
    const notes = run.notifications.filter((n) => n.shipmentId === id);
    expect(notes).toHaveLength(2 + jobs.length);
    expect(new Set(run.notifications.map((n) => n.id)).size).toBe(run.notifications.length);
    expect(run.version).toBe(base0.version + 1); // one state update for the one create
  });

  it('run.version never goes backwards across polls', async () => {
    const { o, d } = await matchablePair();
    const seen: number[] = [];
    const sample = async () => {
      const p = await poll(ids());
      seen.push(p.sim.version, ...p.emps.map((e) => e.version), ...p.biz.map((b) => b.version));
      return p.sim.version;
    };
    const versions: number[] = [await sample()];
    const writers = Promise.all([
      call('POST', '/api/shipments', body(o, d, { clientRequestId: 'v-1' })),
      call('POST', '/api/shipments', body(o, d, { clientRequestId: 'v-2' })),
      call('POST', '/api/simulator/control', { action: 'play' }),
    ]);
    for (let i = 0; i < 5; i++) versions.push(await sample());
    await writers;
    versions.push(await sample());
    for (let i = 1; i < versions.length; i++) expect(versions[i]).toBeGreaterThanOrEqual(versions[i - 1]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(store.get().version);
  });
});

describe('two-tab sync after PUT /commute rematch', () => {
  it('sender dashboard and simulator show the package matched on the next poll', async () => {
    const sc: Scenario = {
      schemaVersion: 1, name: 't', preset: 'fixture', seed: 0, graph: gridGraph(),
      businesses: [
        { id: 'biz-1', name: 'B1', nodeId: 'n-0-0', district: 'D' },
        { id: 'biz-2', name: 'B2', nodeId: 'n-5-4', district: 'D' },
      ],
      hubs: [{ id: 'hub-1', name: 'H', nodeId: 'n-6-6' }],
      employees: [{
        id: 'emp-1', name: 'E', businessId: 'biz-1', homeNodeId: 'n-5-5', eveningDepartureMin: 1020,
        morningDepartureMin: 1935, maxExtraMin: 8, availableEvening: false, availableMorning: false,
        eveningViaNodeIds: [], morningViaNodeIds: [],
      }],
      shipments: [{
        id: 'shp-1', clientRequestId: 'c1', label: 'Box', originBusinessId: 'biz-1', destinationBusinessId: 'biz-2',
        readyMin: 960, deadlineMin: 2100, category: 'envelope', description: 'd', weightGrams: 500,
        pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
      }],
      settings: { ...DEFAULT_SETTINGS },
    };
    await boot(() => createInitialRun(sc));
    const before = await poll(ids());
    const out0 = before.biz.find((b) => b.business.id === 'biz-1')!.outgoing[0];
    expect(out0.plan).toBeNull();
    expect(out0.status).toBe('unmatched');
    expect(before.sim.unmatched.map((u) => u.shipmentId)).toEqual(['shp-1']);

    const e = store.get().scenario.employees[0];
    const r = await call('PUT', `/api/employees/${e.id}/commute`, {
      businessId: e.businessId, homeNodeId: e.homeNodeId, eveningDepartureMin: e.eveningDepartureMin,
      morningDepartureMin: e.morningDepartureMin, availableEvening: true, availableMorning: false,
      maxExtraMin: 8, eveningViaNodeIds: [], morningViaNodeIds: [],
    });
    expect(((await r.json()) as CommuteResponse).rematchedShipmentIds).toEqual(['shp-1']);

    const after = await poll(ids());
    expect(after.sim.version).toBeGreaterThan(before.sim.version);
    const out = after.biz.find((b) => b.business.id === 'biz-1')!.outgoing[0];
    expect(out.plan).not.toBeNull();
    expect(out.status).not.toBe('unmatched');
    expect(after.biz.find((b) => b.business.id === 'biz-1')!.totals.matched).toBe(1);
    expect(after.sim.unmatched).toEqual([]);
    expect(after.sim.plans.map((p) => p.shipmentId)).toEqual(['shp-1']);
    expect(after.sim.plans[0].id).toBe(out.plan!.id);
    expect(after.sim.snapshot.shipmentStatus['shp-1'] ?? 'scheduled').toBe(out.status);
    expect(after.biz.find((b) => b.business.id === 'biz-2')!.incoming[0].status).toBe(out.status);
  });
});
