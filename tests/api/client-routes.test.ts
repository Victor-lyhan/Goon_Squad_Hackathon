// Every exported client/src/api function is called against the real server (createApp on an
// ephemeral port, temp-file store). Fetch is pointed at that server since the client uses relative paths.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import * as api from '../../client/src/api';

let server: Server;
let employee: ReturnType<typeof loadDefaultScenario>['employees'][number];
let businessIds: string[];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-routes-'));
  const run = createInitialRun(loadDefaultScenario());
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  employee = run.scenario.employees[0];
  businessIds = run.scenario.businesses.map((b) => b.id);
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(base + input, init));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

const has = (obj: unknown, keys: string[]) => {
  expect(obj).toBeTruthy();
  for (const k of keys) expect((obj as Record<string, unknown>)[k], `key ${k}`).not.toBeUndefined();
};
const SIM_KEYS = ['runId', 'version', 'clock', 'snapshot', 'plans', 'jobs', 'shipments', 'unmatched', 'computeMs', 'nextEventMin'];
const SHIPMENT_KEYS = ['shipment', 'plan', 'jobIds', 'status', 'deliveredAtMin', 'unmatchedReason', 'matched'];

const commuteBody = () => ({
  businessId: employee.businessId, homeNodeId: employee.homeNodeId,
  eveningDepartureMin: employee.eveningDepartureMin, morningDepartureMin: employee.morningDepartureMin,
  availableEvening: employee.availableEvening, availableMorning: employee.availableMorning,
  maxExtraMin: employee.maxExtraMin, eveningViaNodeIds: employee.eveningViaNodeIds,
  morningViaNodeIds: employee.morningViaNodeIds,
});

let shipmentId = '';
let unmatchedId = '';
let jobId = '';
let exported: Awaited<ReturnType<typeof api.exportScenario>>;

// One case per exported function. Order matters (state-changing calls last).
const cases: Record<string, () => Promise<void>> = {
  getBusinesses: async () => has(await api.getBusinesses(), ['businesses', 'hubs']),
  getEmployees: async () => has(await api.getEmployees(), ['employees']),
  getMap: async () => has(await api.getMap(), ['runId', 'graph', 'businesses', 'hubs', 'homes']),
  getSimulator: async () => has(await api.getSimulator(), SIM_KEYS),
  getBusinessDashboard: async () => has(await api.getBusinessDashboard(businessIds[0]),
    ['business', 'outgoing', 'incoming', 'notifications', 'totals', 'phase', 'version']),
  getEmployeeDashboard: async () => {
    const d = await api.getEmployeeDashboard(employee.id);
    has(d, ['employee', 'trips', 'assigned', 'completed', 'earnedCents', 'projectedCents', 'notifications', 'phase', 'version']);
    const first = d.assigned[0] ?? d.completed[0];
    if (first) jobId = first.job.id;
  },
  getJob: async () => {
    if (!jobId) jobId = (await api.getSimulator()).jobs[0].id;
    has(await api.getJob(jobId), ['job', 'status', 'shipment', 'plan', 'trip']);
  },
  createShipment: async () => {
    const res = await api.createShipment({
      clientRequestId: 'client-routes-1', originBusinessId: businessIds[0], destinationBusinessId: businessIds[1],
      label: 'Routes test', category: 'envelope', description: 'doc', weightKg: 0.5, readyMin: 930, deadlineMin: 2160,
    });
    has(res, SHIPMENT_KEYS);
    shipmentId = res.shipment.id;
  },
  getShipment: async () => has(await api.getShipment(shipmentId), SHIPMENT_KEYS),
  // Matched shipments can't be edited, so patch/match use a request with a 1-minute window (stays unmatched).
  patchShipment: async () => {
    const res = await api.createShipment({
      clientRequestId: 'client-routes-2', originBusinessId: businessIds[0], destinationBusinessId: businessIds[1],
      label: 'Tight', category: 'envelope', description: 'doc', weightKg: 0.5, readyMin: 930, deadlineMin: 931,
    });
    expect(res.matched).toBe(false);
    unmatchedId = res.shipment.id;
    const patched = await api.patchShipment(unmatchedId, { label: 'Renamed' });
    has(patched, SHIPMENT_KEYS);
    expect(patched.shipment.label).toBe('Renamed');
  },
  matchShipment: async () => has(await api.matchShipment(unmatchedId), SHIPMENT_KEYS),
  putCommute: async () => has(await api.putCommute(employee.id, commuteBody()), ['employee', 'trips', 'rematchedShipmentIds']),
  compareMatches: async () => {
    const r = await api.compareMatches();
    has(r, ['directOnly', 'withRelay']);
    has(r.directOnly, ['result', 'metrics']);
    has(r.withRelay, ['result', 'metrics']);
  },
  exportScenario: async () => {
    exported = await api.exportScenario();
    has(exported, ['runId', 'scenario']);
  },
  simulatorControl: async () => has(await api.simulatorControl({ action: 'pause' }), SIM_KEYS),
  recomputeMatches: async () => has(await api.recomputeMatches(), SIM_KEYS),
  resetPlanning: async () => has(await api.resetPlanning(), SIM_KEYS),
  importScenario: async () => has(await api.importScenario(exported), SIM_KEYS),
  generateScenario: async () => has(await api.generateScenario({ preset: 'demo' }), SIM_KEYS),
};

describe('client api against the real server', () => {
  it('has a case for every exported function', () => {
    const exportedFns = Object.entries(api).filter(([, v]) => typeof v === 'function' && !/^[A-Z]/.test(v.name || '')).map(([k]) => k);
    expect(Object.keys(cases).sort()).toEqual(exportedFns.sort());
  });

  for (const [name, fn] of Object.entries(cases)) it(name, fn);
});

describe('unknown ids reject with status 404', () => {
  const cases404: [string, () => Promise<unknown>][] = [
    ['getBusinessDashboard', () => api.getBusinessDashboard('nope')],
    ['getEmployeeDashboard', () => api.getEmployeeDashboard('nope')],
    ['getJob', () => api.getJob('nope')],
    ['getShipment', () => api.getShipment('nope')],
    ['putCommute', () => api.putCommute('nope', commuteBody())],
  ];
  for (const [name, fn] of cases404) {
    it(name, async () => {
      const err = await fn().then(() => null, (e) => e);
      expect(err).toBeInstanceOf(api.ApiRequestError);
      expect(err.status).toBe(404);
    });
  }
  // Gaps in server/api/shipments.ts (open PR #206) are recorded here if they exist.
  it('patchShipment', async () => {
    const err = await api.patchShipment('nope', { label: 'x' }).then(() => null, (e) => e);
    expect(err?.status).toBe(404);
  });
  it('matchShipment', async () => {
    const err = await api.matchShipment('nope').then(() => null, (e) => e);
    expect(err?.status).toBe(404);
  });
});
