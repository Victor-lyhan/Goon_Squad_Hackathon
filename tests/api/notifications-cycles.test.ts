import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessDashboard, EmployeeDashboard } from '../../shared/api';
import type { Employee, Notification } from '../../shared/types';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let server: Server;
let base: string;
let store: Store;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ntf-cycles-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const send = (method: string, url: string, body: unknown = {}) =>
  fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = async <T>(url: string) => (await (await fetch(base + url)).json()) as T;
const commute = (e: Employee, maxExtraMin: number) => ({
  businessId: e.businessId, homeNodeId: e.homeNodeId,
  eveningDepartureMin: e.eveningDepartureMin, morningDepartureMin: e.morningDepartureMin,
  eveningViaNodeIds: e.eveningViaNodeIds, morningViaNodeIds: e.morningViaNodeIds,
  availableEvening: e.availableEvening, availableMorning: e.availableMorning, maxExtraMin,
});

// Cheap store-level invariants: run after every mutation.
function checkStore(label: string) {
  const run = store.get();
  const ids = run.notifications.map((n) => n.id);
  expect(new Set(ids).size, `${label}: unique ids`).toBe(ids.length);
  const planIds = new Set(run.assignments.plans.map((p) => p.id));
  const jobIds = new Set(run.jobs.map((j) => j.id));
  const nodeIds = run.scenario.graph.nodes.map((n) => n.id);
  for (const n of run.notifications) {
    expect(planIds.has(n.planId), `${label}: ${n.id} plan`).toBe(true);
    if (n.jobId) expect(jobIds.has(n.jobId), `${label}: ${n.id} job`).toBe(true);
    expect(n.message).not.toMatch(/undefined|NaN/);
    for (const id of nodeIds) expect(n.message.includes(id), `${label}: raw node id`).toBe(false);
  }
  const count = (f: (n: Notification) => boolean) => run.notifications.filter(f).length;
  for (const plan of run.assignments.plans) {
    const s = run.scenario.shipments.find((x) => x.id === plan.shipmentId)!;
    for (const biz of new Set([s.originBusinessId, s.destinationBusinessId])) {
      const mine = count((n) => n.kind === 'delivery_matched' && n.planId === plan.id && n.audienceId === biz);
      expect(mine, `${label}: ${plan.id} ${biz}`).toBe(1);
    }
  }
  for (const job of run.jobs) {
    expect(count((n) => n.kind === 'job_assigned' && n.jobId === job.id && n.audienceId === job.employeeId)).toBe(1);
  }
  expect(count((n) => n.kind === 'job_assigned')).toBe(run.jobs.length);
}

// Portal ordering: one request per dashboard, so run it at checkpoints only.
async function checkDashboards() {
  const run = store.get();
  for (const b of run.scenario.businesses) {
    const d = await get<BusinessDashboard>(`/api/businesses/${b.id}/dashboard`);
    const seqs = d.notifications.map((n) => n.createdSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => y - x));
  }
  for (const e of run.scenario.employees) {
    const d = await get<EmployeeDashboard>(`/api/employees/${e.id}/dashboard`);
    const seqs = d.notifications.map((n) => n.createdSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => y - x));
  }
}

async function check(label: string) {
  checkStore(label);
  await checkDashboards();
}

describe('notifications across planning cycles', () => {
  it('stay unique, current and newest-first through recompute, reset, new shipment and commute retry', async () => {
    await check('initial');
    await send('POST', '/api/matches/recompute');
    await check('recompute 1');
    await send('POST', '/api/matches/recompute');
    await check('recompute 2');
    await send('POST', '/api/planning/reset');
    await check('reset');

    const run0 = store.get();
    const { businesses } = run0.scenario;
    const { simStartMin, simEndMin } = run0.scenario.settings;
    const res = await send('POST', '/api/shipments', {
      clientRequestId: 'ntf-1', originBusinessId: businesses[0].id, destinationBusinessId: businesses[1].id,
      label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
      readyMin: simStartMin, deadlineMin: simEndMin, pickupInstructions: '', dropoffInstructions: '',
    });
    expect(res.status).toBeLessThan(300);
    await check('new shipment');

    // Make packages unmatched: nobody accepts extra time, then recompute.
    const emps = store.get().scenario.employees;
    const original = new Map(emps.map((e) => [e.id, e.maxExtraMin]));
    // Set directly in the store: 60 PUTs here would only time the matcher, not add coverage.
    await store.mutate((r) => { for (const e of r.scenario.employees) e.maxExtraMin = 0; });
    await send('POST', '/api/matches/recompute');
    await check('all strict');
    const before = store.get();
    expect(before.assignments.unmatched.length).toBeGreaterThan(0);

    // Rescue: restore extra time, each PUT retries the unmatched packages.
    // Stop at the first PUT that rescues a package: each PUT re-runs the matcher (~25-80 ms),
    // so all 60 would cost ~5 s without covering anything new.
    for (const e of store.get().scenario.employees) {
      await send('PUT', `/api/employees/${e.id}/commute`, commute(e, original.get(e.id)!));
      checkStore(`commute ${e.id}`);
      if (store.get().assignments.plans.length > before.assignments.plans.length) break;
    }
    await checkDashboards();
    expect(store.get().assignments.plans.length).toBeGreaterThan(before.assignments.plans.length);
  }, 60_000);

  it('refreshes text in place when a plan keeps its ID but changes', async () => {
    const run = store.get();
    const target = run.notifications.find((n) => n.kind === 'delivery_matched')!;
    const old = run.notifications.find((n) => n.id === target.id)!;
    await store.mutate((r) => {
      r.notifications = r.notifications.map((n) => (n.id === target.id ? { ...n, message: 'stale text' } : n));
    });
    await send('POST', '/api/matches/recompute');
    const now = store.get().notifications.find((n) => n.id === target.id)!;
    expect(now.message).not.toBe('stale text');
    expect(now.message).toBe(old.message);
    expect(now.createdSeq).toBe(old.createdSeq);
  });
});
