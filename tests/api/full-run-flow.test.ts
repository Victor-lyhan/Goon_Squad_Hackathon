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
import type {
  BusinessDashboard, EmployeeDashboard, JobResponse, ShipmentResponse, SimulatorResponse,
} from '../../shared/api';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'full-run-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const NODE_ID = /\bn-\d+-\d+\b/;
const NULLABLE = new Set(['deliveredAtMin', 'nextEventMin', 'unmatchedReason', 'plan', 'avgExtraMinPerTrip', 'maxExtraMin']);
/** Routes carry node IDs as data (ids/arrays under these keys); everything else is display text. */
const isNodeKey = (k: string) => /NodeIds?$/i.test(k) || k === 'nodes';
const NODE_KEYS = { has: isNodeKey };

function scan(v: unknown, key: string, where: string) {
  if (v === null) {
    if (!NULLABLE.has(key)) throw new Error(`null at ${where}`);
  } else if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number at ${where}`);
  } else if (typeof v === 'string') {
    if (NODE_ID.test(v) && !NODE_KEYS.has(key)) throw new Error(`raw node id "${v}" at ${where}`);
  } else if (Array.isArray(v)) {
    if (!NODE_KEYS.has(key)) v.forEach((x, i) => scan(x, key, `${where}[${i}]`));
  } else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) scan(x, k, `${where}.${k}`);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  expect(text).not.toMatch(/NaN|undefined/);
  const json = JSON.parse(text) as T;
  scan(json, '', `${method} ${url}`);
  return { status: r.status, body: json };
}
const get = <T>(url: string) => call<T>('GET', url).then((r) => r.body);
const control = (action: string) => call<SimulatorResponse>('POST', '/api/simulator/control', { action }).then((r) => r.body);

function pickPair() {
  const run = store.get();
  const { scenario } = run;
  const ctx = {
    router: createRouter(scenario.graph), trips: run.trips, employees: scenario.employees,
    businesses: scenario.businesses, hubs: scenario.hubs, settings: scenario.settings,
  };
  for (const a of scenario.businesses) for (const b of scenario.businesses) {
    if (a.id === b.id) continue;
    const probe = {
      ...scenario.shipments[0], id: 'shp-probe', clientRequestId: 'probe', originBusinessId: a.id,
      destinationBusinessId: b.id, createdSeq: 10_000, readyMin: scenario.settings.simStartMin,
      deadlineMin: scenario.settings.simEndMin,
    };
    if (assignShipments([probe], ctx, { existing: run.assignments.plans }).plans[0]) return [a.id, b.id] as const;
  }
  throw new Error('no free pair');
}

/** Everything every portal reports at the current clock time. */
async function collect() {
  const sim = await get<SimulatorResponse>('/api/simulator');
  const businesses = await Promise.all(sim.snapshot ? store.get().scenario.businesses.map(
    (b) => get<BusinessDashboard>(`/api/businesses/${b.id}/dashboard`)) : []);
  const employees = await Promise.all(store.get().scenario.employees.map(
    (e) => get<EmployeeDashboard>(`/api/employees/${e.id}/dashboard`)));
  const shipments = await Promise.all(sim.plans.map((p) => get<ShipmentResponse>(`/api/shipments/${p.shipmentId}`)));
  return { sim, businesses, employees, shipments };
}

describe('full run over HTTP', () => {
  it('plays the demo city to the end, rewinds and replays identically', async () => {
    const { settings } = store.get().scenario;
    const [origin, dest] = pickPair();
    const created = await call<ShipmentResponse>('POST', '/api/shipments', {
      clientRequestId: 'full-1', originBusinessId: origin, destinationBusinessId: dest,
      label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
      readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
      pickupInstructions: '', dropoffInstructions: '',
    });
    expect(created.status).toBe(201);
    expect(created.body.matched).toBe(true);
    const liveId = created.body.shipment.id;

    await control('play');
    await control('finish');
    const first = await collect();
    const { sim } = first;

    // Every matched shipment is delivered; times agree across portals and the simulator.
    expect(sim.plans.length).toBeGreaterThan(1);
    expect(first.shipments.length).toBe(sim.plans.length);
    const deliveredEvents = new Map(
      sim.snapshot.occurredEvents.filter((e) => e.kind === 'delivered').map((e) => [e.shipmentId, e.timeMin]));
    const outgoing = new Map(first.businesses.flatMap((b) => b.outgoing).map((v) => [v.shipment.id, v]));
    const incoming = new Map(first.businesses.flatMap((b) => b.incoming).map((v) => [v.shipment.id, v]));
    for (const s of first.shipments) {
      const id = s.shipment.id;
      expect(s.status).toBe('delivered');
      expect(sim.snapshot.shipmentStatus[id]).toBe('delivered');
      expect(s.deliveredAtMin).toBe(deliveredEvents.get(id));
      expect(outgoing.get(id)!.deliveredAtMin).toBe(s.deliveredAtMin);
      expect(incoming.get(id)!.deliveredAtMin).toBe(s.deliveredAtMin);
      expect(outgoing.get(id)!.status).toBe('delivered');
      expect(incoming.get(id)!.status).toBe('delivered');
    }
    expect(outgoing.has(liveId)).toBe(true);

    // Earnings: per employee = sum of completed job rewards; total = metrics.
    let total = 0;
    for (const d of first.employees) {
      const sum = d.completed.reduce((n, j) => {
        const idx = Number(j.job.id.slice(j.job.id.lastIndexOf('-L') + 2));
        return n + j.plan.legs[idx].rewardCents;
      }, 0);
      expect(d.earnedCents).toBe(sum);
      expect(d.assigned).toEqual([]);
      total += d.earnedCents;
    }
    expect(total).toBe(sim.snapshot.metrics.earnedRewardsCents);
    expect(total).toBeGreaterThan(0);

    // Metrics agree with the shipment views.
    const m = sim.snapshot.metrics;
    const matched = first.shipments.filter((s) => s.plan).length;
    expect(m.matched).toBe(matched);
    expect(m.delivered).toBe(first.shipments.filter((s) => s.status === 'delivered').length);
    expect(m.delivered).toBe(m.matched);
    for (const b of first.businesses) {
      expect(b.totals.delivered).toBe(b.outgoing.filter((v) => v.status === 'delivered').length);
    }

    // Shared IDs: same plan and job IDs everywhere for the same package.
    for (const s of first.shipments) {
      const plan = s.plan!;
      expect(plan.id).toBe(`plan-${s.shipment.id}`);
      expect(sim.plans.find((p) => p.shipmentId === s.shipment.id)!.id).toBe(plan.id);
      expect(outgoing.get(s.shipment.id)!.plan!.id).toBe(plan.id);
      expect(outgoing.get(s.shipment.id)!.jobIds).toEqual(s.jobIds);
      expect(incoming.get(s.shipment.id)!.jobIds).toEqual(s.jobIds);
      expect(s.jobIds).toEqual(plan.legs.map((_, i) => `${plan.id}-L${i}`));
      for (const [i, jobId] of s.jobIds.entries()) {
        const simJob = sim.jobs.find((j) => j.id === jobId)!;
        expect(simJob.planId).toBe(plan.id);
        const job = await get<JobResponse>(`/api/jobs/${jobId}`);
        expect(job.job.id).toBe(jobId);
        expect(job.plan.id).toBe(plan.id);
        expect(job.shipment.id).toBe(s.shipment.id);
        expect(job.status).toBe('completed');
        const carrier = first.employees.find((e) => e.employee.id === plan.legs[i].employeeId)!;
        expect(carrier.completed.map((j) => j.job.id)).toContain(jobId);
        expect(carrier.completed.find((j) => j.job.id === jobId)!.plan.id).toBe(plan.id);
      }
    }

    // Rewind and replay: identical results, no double payment.
    const rewound = await control('reset_playback');
    expect(rewound.clock.phase).toBe('locked');
    expect(rewound.clock.timeMin).toBe(settings.simStartMin);
    expect(rewound.snapshot.metrics.earnedRewardsCents).toBe(0);
    expect(rewound.snapshot.metrics.delivered).toBe(0);
    await control('play');
    await control('finish');
    const second = await collect();

    expect(second.shipments.map((s) => [s.shipment.id, s.status, s.deliveredAtMin]))
      .toEqual(first.shipments.map((s) => [s.shipment.id, s.status, s.deliveredAtMin]));
    expect(second.sim.snapshot.jobStatus).toEqual(sim.snapshot.jobStatus);
    expect(second.sim.snapshot.earningsCents).toEqual(sim.snapshot.earningsCents);
    expect(second.sim.snapshot.metrics).toEqual(sim.snapshot.metrics);
    expect(second.employees.map((e) => [e.employee.id, e.earnedCents, e.completed.map((j) => j.job.id)]))
      .toEqual(first.employees.map((e) => [e.employee.id, e.earnedCents, e.completed.map((j) => j.job.id)]));
    expect(second.sim.plans.map((p) => p.id)).toEqual(sim.plans.map((p) => p.id));
    expect(second.sim.jobs.map((j) => j.id)).toEqual(sim.jobs.map((j) => j.id));
  });
});
