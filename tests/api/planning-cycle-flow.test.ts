import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type {
  BusinessDashboard, CompareResponse, EmployeeDashboard, JobResponse, SimulatorResponse,
} from '../../shared/api';
import type { Employee } from '../../shared/types';

let server: Server;
let base: string;
let store: Store;
let file: string;

const makeStore = () => createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
async function serve(s: Store) {
  store = s;
  server = createApp(s).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(async () => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-flow-')), 'state.json');
  await serve(makeStore());
});
afterEach(() => new Promise((r) => server.close(r)));

const send = (method: string, url: string, body: unknown = {}) =>
  fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = async <T>(url: string) => (await (await fetch(base + url)).json()) as T;

const newShipment = (run = store.get()) => {
  const { businesses } = run.scenario;
  const { simStartMin, simEndMin } = run.scenario.settings;
  return {
    clientRequestId: 'flow-1', originBusinessId: businesses[0].id, destinationBusinessId: businesses[1].id,
    label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
    readyMin: simStartMin, deadlineMin: simEndMin, pickupInstructions: '', dropoffInstructions: '',
  };
};

const commuteBody = (emp: Employee, maxExtraMin = emp.maxExtraMin) => ({
  businessId: emp.businessId, homeNodeId: emp.homeNodeId,
  eveningDepartureMin: emp.eveningDepartureMin, morningDepartureMin: emp.morningDepartureMin,
  eveningViaNodeIds: emp.eveningViaNodeIds, morningViaNodeIds: emp.morningViaNodeIds,
  availableEvening: emp.availableEvening, availableMorning: emp.availableMorning, maxExtraMin,
});

async function expectAgreement() {
  const run = store.get();
  const { plans } = run.assignments;
  expect(plans.length).toBeGreaterThan(0);
  for (const plan of plans) {
    const jobIds = run.jobs.filter((j) => j.planId === plan.id).map((j) => j.id);
    expect(jobIds).toEqual(plan.legs.map((_, i) => `${plan.id}-L${i}`));
    const shipment = run.scenario.shipments.find((s) => s.id === plan.shipmentId)!;
    for (const [bizId, key] of [[shipment.originBusinessId, 'outgoing'], [shipment.destinationBusinessId, 'incoming']] as const) {
      const dash = await get<BusinessDashboard>(`/api/businesses/${bizId}/dashboard`);
      const view = dash[key].find((v) => v.shipment.id === shipment.id)!;
      expect(view.plan?.id).toBe(plan.id);
      expect(view.jobIds).toEqual(jobIds);
    }
    for (const [i, leg] of plan.legs.entries()) {
      const dash = await get<EmployeeDashboard>(`/api/employees/${leg.employeeId}/dashboard`);
      const view = [...dash.assigned, ...dash.completed].find((v) => v.job.id === jobIds[i])!;
      expect(view.plan.id).toBe(plan.id);
      const job = await get<JobResponse>(`/api/jobs/${jobIds[i]}`);
      expect(job.plan.id).toBe(plan.id);
      expect(job.job.id).toBe(jobIds[i]);
    }
  }
}

describe('planning-cycle flow (demo step 7)', () => {
  it('locks on play, refuses edits with readable 409s, unlocks on reset and re-matches', async () => {
    const run0 = store.get();
    const oldRunId = run0.runId;
    const shipmentId = run0.scenario.shipments[0].id;
    const emp = run0.scenario.employees[0];
    const commute = commuteBody(emp);

    expect((await send('POST', '/api/simulator/control', { action: 'play' })).status).toBe(200);
    const locked: [string, string, unknown][] = [
      ['POST', '/api/shipments', newShipment()],
      ['PATCH', `/api/shipments/${shipmentId}`, { label: 'x' }],
      ['POST', `/api/shipments/${shipmentId}/match`, {}],
      ['PUT', `/api/employees/${emp.id}/commute`, commute],
      ['POST', '/api/matches/recompute', {}],
    ];
    for (const [m, u, b] of locked) {
      const res = await send(m, u, b);
      expect(res.status, `${m} ${u}`).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error.length).toBeGreaterThan(8);
    }

    const res = await send('POST', '/api/planning/reset');
    expect(res.status).toBe(200);
    const sim = (await res.json()) as SimulatorResponse;
    const { simStartMin } = run0.scenario.settings;
    expect(sim.runId).not.toBe(oldRunId);
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: simStartMin });
    const run = store.get();
    expect(run.assignments.plans.length + run.assignments.unmatched.length).toBe(run.scenario.shipments.length);
    await expectAgreement();
  });

  it('lowering maxExtraMin to 0 then recompute removes that employee\'s extra-time legs; compare is read-only', async () => {
    await send('POST', '/api/simulator/control', { action: 'play' });
    await send('POST', '/api/planning/reset');

    const run = store.get();
    const carried = run.assignments.plans.flatMap((p) => p.legs.map((l) => ({ p, l }))).filter((x) => x.l.extraMin > 0);
    expect(carried.length).toBeGreaterThan(0);
    const { p: plan, l: leg } = carried[0];
    const emp = run.scenario.employees.find((e) => e.id === leg.employeeId)!;

    const put = await send('PUT', `/api/employees/${emp.id}/commute`, commuteBody(emp, 0));
    expect(put.status).toBe(200);
    // Existing plans stay reserved until an explicit recompute.
    expect(store.get().assignments.plans.find((p) => p.id === plan.id)).toEqual(plan);

    const before = store.get();
    const cmp = await send('POST', '/api/matches/compare');
    expect(cmp.status).toBe(200);
    expect(((await cmp.json()) as CompareResponse).withRelay.result).toBeDefined();
    expect(store.get()).toEqual(before);

    const rec = await send('POST', '/api/matches/recompute');
    expect(rec.status).toBe(200);
    const after = store.get();
    expect(after.scenario.employees.find((e) => e.id === emp.id)!.maxExtraMin).toBe(0);
    for (const p of after.assignments.plans) {
      for (const l of p.legs) if (l.employeeId === emp.id) expect(l.extraMin).toBeLessThanOrEqual(0);
    }
    const replanned = after.assignments.plans.find((p) => p.shipmentId === plan.shipmentId);
    if (replanned) {
      expect(replanned.legs.some((l) => l.employeeId === emp.id && l.extraMin > 0)).toBe(false);
    } else {
      const u = after.assignments.unmatched.find((x) => x.shipmentId === plan.shipmentId);
      expect(u?.reason.length).toBeGreaterThan(0);
    }
    await expectAgreement();
  });

  it('restart mid-flow preserves the new cycle and the lowered limit (spec test 13)', async () => {
    await send('POST', '/api/simulator/control', { action: 'play' });
    await send('POST', '/api/planning/reset');
    const emp = store.get().scenario.employees[0];
    await send('PUT', `/api/employees/${emp.id}/commute`, commuteBody(emp, 0));
    await send('POST', '/api/matches/recompute');
    const snapshot = structuredClone(store.get());
    await store.flush();
    await new Promise((r) => server.close(r));

    await serve(makeStore());
    const restored = store.get();
    expect(restored).toEqual(snapshot);
    expect(restored.clock.phase).toBe('planning');
    expect(restored.scenario.employees.find((e) => e.id === emp.id)!.maxExtraMin).toBe(0);
    await expectAgreement();
    // Still unlocked: edits accepted, then lockable again.
    expect((await send('POST', '/api/matches/recompute')).status).toBe(200);
    await send('POST', '/api/simulator/control', { action: 'play' });
    expect((await send('POST', '/api/matches/recompute')).status).toBe(409);
  });
});
