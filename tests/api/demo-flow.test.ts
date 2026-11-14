import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { assignShipments } from '../../server/domain/matching';
import { createRouter } from '../../server/domain/routing';
import type { BusinessDashboard, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/api';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-flow-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

/** Every body is checked for NaN / undefined text. */
async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  expect(text).not.toMatch(/NaN|undefined/);
  const json = JSON.parse(text) as T;
  expect(JSON.stringify(json)).not.toMatch(/NaN|undefined/);
  return { status: r.status, body: json };
}
const get = <T>(url: string) => call<T>('GET', url).then((r) => r.body);
const control = (action: string) => call<SimulatorResponse>('POST', '/api/simulator/control', { action }).then((r) => r.body);

/** Picks an ordered business pair the matcher can serve with the trips still free; prefers a relay plan. */
function pickPair() {
  const run = store.get();
  const { scenario } = run;
  const ctx = {
    router: createRouter(scenario.graph), trips: run.trips, employees: scenario.employees,
    businesses: scenario.businesses, hubs: scenario.hubs, settings: scenario.settings,
  };
  let direct: [string, string] | null = null;
  for (const a of scenario.businesses) for (const b of scenario.businesses) {
    if (a.id === b.id) continue;
    const probe = {
      ...scenario.shipments[0], id: 'shp-probe', clientRequestId: 'probe', originBusinessId: a.id,
      destinationBusinessId: b.id, createdSeq: 10_000, readyMin: scenario.settings.simStartMin,
      deadlineMin: scenario.settings.simEndMin,
    };
    const plan = assignShipments([probe], ctx, { existing: run.assignments.plans }).plans[0];
    if (!plan) continue;
    if (plan.kind === 'relay') return [a.id, b.id] as const;
    direct ??= [a.id, b.id];
  }
  if (!direct) throw new Error('no free pair');
  return direct;
}

describe('demo steps 1–6 over HTTP', () => {
  it('walks the whole demo', async () => {
    const { settings } = store.get().scenario;

    // 1. A saved employee dashboard shows trips.
    const firstEmp = store.get().scenario.employees[0];
    const dash0 = await get<EmployeeDashboard>(`/api/employees/${firstEmp.id}/dashboard`);
    expect(dash0.trips.length).toBeGreaterThan(0);

    // 2-3. Business submits a package.
    const [origin, dest] = pickPair();
    const form = {
      clientRequestId: 'demo-1', originBusinessId: origin, destinationBusinessId: dest,
      label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
      readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
      pickupInstructions: '', dropoffInstructions: '',
    };
    const created = await call<ShipmentResponse>('POST', '/api/shipments', form);
    expect(created.status).toBe(201);
    const ship = created.body;
    expect(ship.matched).toBe(true);
    expect(ship.plan).not.toBeNull();
    const plan = ship.plan!;
    expect(plan.deliveryMin).toBeGreaterThan(settings.simStartMin);
    expect(plan.customerPriceCents).toBeGreaterThan(0);
    expect(ship.jobIds.length).toBe(plan.legs.length);
    expect(ship.jobIds.length).toBeGreaterThan(0);

    const retry = await call<ShipmentResponse>('POST', '/api/shipments', form);
    expect(retry.status).toBe(200);
    expect(retry.body.shipment.id).toBe(ship.shipment.id);
    expect(retry.body.jobIds).toEqual(ship.jobIds);

    // 4. Every carrier sees the new job as assigned.
    const carriers = [...new Set(plan.legs.map((l) => l.employeeId))];
    const before = new Map<string, number>();
    for (const [i, leg] of plan.legs.entries()) {
      const d = await get<EmployeeDashboard>(`/api/employees/${leg.employeeId}/dashboard`);
      expect(d.assigned.map((j) => j.job.id)).toContain(ship.jobIds[i]);
      before.set(leg.employeeId, d.earnedCents);
    }

    // 5. Play, jump to morning: relay shows at_hub overnight.
    await control('play');
    const morning = await control('jump_to_morning');
    expect(morning.clock.timeMin).toBeGreaterThanOrEqual(1440);
    const sim = await control('pause');
    const midNight = await get<ShipmentResponse>(`/api/shipments/${ship.shipment.id}`);
    if (plan.kind === 'relay') expect(midNight.status).toBe('at_hub');
    // An existing relay shipment is at the hub overnight in any case.
    const relays = sim.plans.filter((p) => p.kind === 'relay');
    expect(relays.length).toBeGreaterThan(0);
    const atHub = await Promise.all(relays.map((p) => get<ShipmentResponse>(`/api/shipments/${p.shipmentId}`)));
    expect(atHub.some((s) => s.status === 'at_hub')).toBe(true);

    // 6. Finish: delivered, dashboards agree, carriers earned their rewards.
    await control('finish');
    const done = await get<ShipmentResponse>(`/api/shipments/${ship.shipment.id}`);
    expect(done.status).toBe('delivered');
    expect(done.deliveredAtMin).not.toBeNull();
    const sender = await get<BusinessDashboard>(`/api/businesses/${origin}/dashboard`);
    const recipient = await get<BusinessDashboard>(`/api/businesses/${dest}/dashboard`);
    const s = sender.outgoing.find((v) => v.shipment.id === ship.shipment.id)!;
    const r = recipient.incoming.find((v) => v.shipment.id === ship.shipment.id)!;
    expect(s.deliveredAtMin).toBe(done.deliveredAtMin);
    expect(r.deliveredAtMin).toBe(done.deliveredAtMin);
    for (const id of carriers) {
      const d = await get<EmployeeDashboard>(`/api/employees/${id}/dashboard`);
      const reward = plan.legs.filter((l) => l.employeeId === id).reduce((n, l) => n + l.rewardCents, 0);
      expect(d.earnedCents).toBeGreaterThanOrEqual(before.get(id)! + reward);
      expect(d.completed.map((j) => j.job.id)).toEqual(expect.arrayContaining(
        ship.jobIds.filter((_, i) => plan.legs[i].employeeId === id)));
    }
  });
});
