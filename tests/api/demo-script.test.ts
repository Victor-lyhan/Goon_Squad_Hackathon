import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessDashboard, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/api';

/** The README's `demo-request` block is the single source of truth for the live demo request. */
const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');
const block = /```demo-request\n([\s\S]*?)```/.exec(readme)?.[1];
if (!block) throw new Error('README.md has no ```demo-request block');
const demo = Object.fromEntries(
  block.trim().split('\n').map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
) as Record<string, string>;

/** "Day 2, 8:30 AM" -> minutes since Day 1 00:00. */
function parseTime(text: string): number {
  const m = /^Day (\d+), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(text);
  if (!m) throw new Error(`bad time in README: ${text}`);
  const h = (Number(m[2]) % 12) + (m[4] === 'PM' ? 12 : 0);
  return (Number(m[1]) - 1) * 1440 + h * 60 + Number(m[3]);
}

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'demo-script-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  expect(text).not.toMatch(/NaN|undefined/);
  return { status: r.status, body: JSON.parse(text) as T };
}
const get = <T>(url: string) => call<T>('GET', url).then((r) => r.body);
const control = (action: string) => call<SimulatorResponse>('POST', '/api/simulator/control', { action }).then((r) => r.body);

const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);

describe('README demo request on a fresh Demo city', () => {
  it('matches as a relay and plays out to delivered', async () => {
    const { scenario } = store.get();
    const byName = <T extends { name: string }>(list: T[], name: string) => {
      const found = list.find((x) => x.name === name);
      if (!found) throw new Error(`README names "${name}" but the Demo city has no such entry`);
      return found;
    };
    const sender = byName(scenario.businesses, demo.sender);
    const recipient = byName(scenario.businesses, demo.recipient);
    const hub = byName(scenario.hubs, demo.hub);
    const employee = byName(scenario.employees, demo.employee);
    expect(demo.employee_url).toBe(`/employee/${employee.id}`);

    // README names the request exactly; POST it.
    const created = await call<ShipmentResponse>('POST', '/api/shipments', {
      clientRequestId: 'readme-demo', originBusinessId: sender.id, destinationBusinessId: recipient.id,
      label: demo.package, category: demo.category, description: demo.package,
      weightKg: Number(demo.weight_kg), readyMin: parseTime(demo.ready), deadlineMin: parseTime(demo.deadline),
      pickupInstructions: '', dropoffInstructions: '',
    });
    expect(created.status).toBe(201);
    const ship = created.body;
    expect(ship.matched).toBe(true);
    const plan = ship.plan!;
    expect(plan.kind).toBe('relay');
    if (plan.kind !== 'relay') return;
    expect(plan.hubId).toBe(hub.id);
    expect(plan.customerPriceCents).toBe(cents(demo.price));
    expect(plan.legs.length).toBe(2);
    expect(ship.jobIds.length).toBe(plan.legs.length);

    // The employee shown in steps 1 and 4 carries one of the new jobs.
    const empDash = await get<EmployeeDashboard>(`/api/employees/${employee.id}/dashboard`);
    expect(empDash.assigned.map((j) => j.job.id).some((id) => ship.jobIds.includes(id))).toBe(true);
    expect(plan.legs.some((l) => l.employeeId === employee.id)).toBe(true);

    const carriers = [...new Set(plan.legs.map((l) => l.employeeId))];
    const earnedBefore = new Map<string, number>();
    for (const id of carriers) earnedBefore.set(id, (await get<EmployeeDashboard>(`/api/employees/${id}/dashboard`)).earnedCents);

    // Seek past the hub drop: shipment is at the hub, the first-leg job is completed.
    await call('POST', '/api/simulator/control', { action: 'seek', timeMin: plan.legs[0].finishMin });
    const atHub = await get<ShipmentResponse>(`/api/shipments/${ship.shipment.id}`);
    expect(atHub.status).toBe('at_hub');
    const leg1Carrier = await get<EmployeeDashboard>(`/api/employees/${plan.legs[0].employeeId}/dashboard`);
    expect(leg1Carrier.completed.map((j) => j.job.id)).toContain(ship.jobIds[0]);

    // Jump to morning + Finish: delivered everywhere, carriers paid for their legs.
    await control('jump_to_morning');
    await control('finish');
    const done = await get<ShipmentResponse>(`/api/shipments/${ship.shipment.id}`);
    expect(done.status).toBe('delivered');
    const out = (await get<BusinessDashboard>(`/api/businesses/${sender.id}/dashboard`))
      .outgoing.find((v) => v.shipment.id === ship.shipment.id);
    const inc = (await get<BusinessDashboard>(`/api/businesses/${recipient.id}/dashboard`))
      .incoming.find((v) => v.shipment.id === ship.shipment.id);
    expect(out?.status).toBe('delivered');
    expect(inc?.status).toBe('delivered');
    for (const id of carriers) {
      const d = await get<EmployeeDashboard>(`/api/employees/${id}/dashboard`);
      const reward = plan.legs.filter((l) => l.employeeId === id).reduce((n, l) => n + l.rewardCents, 0);
      expect(d.earnedCents).toBeGreaterThanOrEqual(earnedBefore.get(id)! + reward);
    }
  });
});
