import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type {
  BusinessDashboard, CompareResponse, EmployeeDashboard, JobResponse, ShipmentResponse, SimulatorResponse,
} from '../../shared/api';
import type { Run } from '../../shared/types';

let server: Server;
let base: string;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'random-city-')), 'state.json');
  const store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

/** Every body must be JSON without NaN/undefined text; returns status + parsed body. */
async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  expect(text, `${method} ${url}`).not.toMatch(/NaN|undefined/);
  return { status: r.status, body: JSON.parse(text) as T };
}
const get = async <T>(url: string) => {
  const r = await call<T>('GET', url);
  expect(r.status, url).toBe(200);
  return r.body;
};
const control = (action: string) =>
  call<SimulatorResponse>('POST', '/api/simulator/control', { action }).then((r) => {
    expect(r.status, action).toBe(200);
    return r.body;
  });

const NODE_ID = /\bn-\d+-\d+\b/;
/** Text a person reads must never show a raw graph node id. */
const noRawIds = (strings: (string | undefined)[], where: string) => {
  for (const s of strings) expect(s ?? '', where).not.toMatch(NODE_ID);
};

const CASES = [
  { name: 'random seed 3', body: { preset: 'random', seed: 3 } },
  { name: 'random seed 7', body: { preset: 'random', seed: 7 } },
  { name: 'random seed 11', body: { preset: 'random', seed: 11 } },
  { name: 'random zero hubs', body: { preset: 'random', seed: 5, hubs: 0 } },
];

describe.each(CASES)('generated city: $name', ({ body }) => {
  it('serves every read route, accepts a shipment, and plays to the end', async () => {
    const gen = await call<SimulatorResponse>('POST', '/api/scenario/generate', body);
    expect(gen.status).toBe(200);
    const run = await get<Run>('/api/scenario/export');
    const { businesses, employees } = run.scenario;
    expect(businesses.length).toBeGreaterThanOrEqual(2);

    for (const b of businesses) {
      const d = await get<BusinessDashboard>(`/api/businesses/${b.id}/dashboard`);
      noRawIds([d.business.name, ...d.notifications.map((n) => n.message),
        ...[...d.outgoing, ...d.incoming].flatMap((v) => [v.shipment.label, v.unmatchedReason ?? ''])], b.id);
    }
    for (const e of employees) {
      const d = await get<EmployeeDashboard>(`/api/employees/${e.id}/dashboard`);
      noRawIds([d.employee.name, ...d.notifications.map((n) => n.message)], e.id);
    }
    const sim0 = await get<SimulatorResponse>('/api/simulator');
    noRawIds(sim0.unmatched.map((u) => u.reason), 'unmatched reasons');
    for (const j of sim0.jobs) {
      const jr = await get<JobResponse>(`/api/jobs/${j.id}`);
      expect(jr.job.id).toBe(j.id);
    }

    if (body.hubs === 0) {
      expect(sim0.plans.some((p) => p.kind === 'relay' || p.hubId)).toBe(false);
      for (const p of sim0.plans) expect(p.legs).toHaveLength(1);
      const cmp = await call<CompareResponse>('POST', '/api/matches/compare', {});
      expect(cmp.status).toBe(200);
      expect(cmp.body.withRelay.result.plans.filter((p) => p.kind === 'relay')).toHaveLength(0);
      expect(cmp.body.withRelay.metrics.relay).toBe(0);
      expect(cmp.body.directOnly.metrics.relay).toBe(0);
    }

    // Submit a shipment between two generated businesses.
    const { simStartMin, simEndMin } = run.scenario.settings;
    const [a, b] = businesses;
    const created = await call<ShipmentResponse>('POST', '/api/shipments', {
      clientRequestId: 'rc-1', originBusinessId: a.id, destinationBusinessId: b.id,
      label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
      readyMin: simStartMin, deadlineMin: simEndMin, pickupInstructions: '', dropoffInstructions: '',
    });
    expect(created.status).toBe(201);
    const ship = created.body;
    if (ship.matched) {
      expect(ship.plan).not.toBeNull();
      if (body.hubs === 0) expect(ship.plan!.kind).toBe('direct');
    } else {
      expect(ship.unmatchedReason ?? '').not.toBe('');
      expect(ship.unmatchedReason!.trim().length).toBeGreaterThan(0);
      noRawIds([ship.unmatchedReason!], 'new shipment reason');
    }

    // Play, then finish.
    await control('play');
    await control('jump_to_morning');
    await control('pause');
    const fin = await control('finish');
    const events = fin.snapshot.occurredEvents;
    for (const plan of fin.plans) {
      const status = fin.snapshot.shipmentStatus[plan.shipmentId];
      const planEvents = events.filter((e) => e.shipmentId === plan.shipmentId);
      const hasDelivered = planEvents.some((e) => e.kind === 'delivered');
      if (hasDelivered) expect(status, plan.shipmentId).toBe('delivered');
      expect(['scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered']).toContain(status);
    }
    expect(Object.values(fin.snapshot.shipmentStatus).filter((s) => s !== 'delivered' && s !== 'unmatched')).toEqual([]);
    for (const u of fin.unmatched) expect(u.reason.trim()).not.toBe('');
    const sh = await get<ShipmentResponse>(`/api/shipments/${ship.shipment.id}`);
    expect(sh.status).toBe(ship.matched ? 'delivered' : 'unmatched');
    await get<SimulatorResponse>('/api/simulator');
    // After finish, spot-check dashboards (full sweeps ran before play).
    await get<BusinessDashboard>(`/api/businesses/${a.id}/dashboard`);
    await get<EmployeeDashboard>(`/api/employees/${employees[0].id}/dashboard`);
  });
});

describe('no-match shipment in a random city', () => {
  it('stores an unmatched shipment with a reason and survives play/finish', async () => {
    await call('POST', '/api/scenario/generate', { preset: 'random', seed: 7 });
    const run = await get<Run>('/api/scenario/export');
    const { simEndMin } = run.scenario.settings;
    const [a, b] = run.scenario.businesses;
    // Ready at the very end of the window: no commute can carry it in time.
    const created = await call<ShipmentResponse>('POST', '/api/shipments', {
      clientRequestId: 'late-1', originBusinessId: a.id, destinationBusinessId: b.id,
      label: 'Late', category: 'envelope', description: 'Too late', weightKg: 0.5,
      readyMin: simEndMin - 1, deadlineMin: simEndMin, pickupInstructions: '', dropoffInstructions: '',
    });
    expect(created.status).toBe(201);
    expect(created.body.matched).toBe(false);
    expect(created.body.unmatchedReason ?? '').not.toBe('');
    const fin = await control('finish');
    expect(fin.snapshot.shipmentStatus[created.body.shipment.id]).toBe('unmatched');
    const d = await get<BusinessDashboard>(`/api/businesses/${a.id}/dashboard`);
    expect(d.outgoing.find((v) => v.shipment.id === created.body.shipment.id)?.unmatchedReason).toBeTruthy();
  });
});

describe('export / import and demo restore', () => {
  it('round-trips a random city with the same ids and a new runId', async () => {
    await call('POST', '/api/scenario/generate', { preset: 'random', seed: 7 });
    const before = await get<SimulatorResponse>('/api/simulator');
    const exported = await get<Run>('/api/scenario/export');
    await call('POST', '/api/scenario/generate', { preset: 'random', seed: 3 });
    const imp = await call<SimulatorResponse>('POST', '/api/scenario/import', exported);
    expect(imp.status).toBe(200);
    expect(imp.body.runId).not.toBe(before.runId);
    const again = await get<Run>('/api/scenario/export');
    expect(again.runId).toBe(imp.body.runId);
    const ids = (r: Run) => ({
      biz: r.scenario.businesses.map((b) => b.id), emp: r.scenario.employees.map((e) => e.id),
      shp: r.scenario.shipments.map((s) => s.id), plans: r.assignments.plans.map((p) => p.id),
    });
    expect(ids(again)).toEqual(ids(exported));
    expect(imp.body.plans.map((p) => p.id)).toEqual(before.plans.map((p) => p.id));
  });

  it('generating demo afterwards restores the Demo city', async () => {
    const fresh = await get<Run>('/api/scenario/export');
    const freshSim = await get<SimulatorResponse>('/api/simulator');
    await call('POST', '/api/scenario/generate', { preset: 'random', seed: 11 });
    await control('finish');
    const demo = await call<SimulatorResponse>('POST', '/api/scenario/generate', { preset: 'demo' });
    expect(demo.status).toBe(200);
    expect(demo.body.runId).not.toBe(freshSim.runId);
    expect(demo.body.clock.phase).toBe('planning');
    const after = await get<Run>('/api/scenario/export');
    expect(after.scenario.businesses.map((b) => b.id)).toEqual(fresh.scenario.businesses.map((b) => b.id));
    expect(demo.body.plans.map((p) => p.id)).toEqual(freshSim.plans.map((p) => p.id));
  });
});
