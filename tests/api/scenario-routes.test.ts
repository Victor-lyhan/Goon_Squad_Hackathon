import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { MapResponse, SimulatorResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let server: Server;
let base: string;
let tmp: string;

async function start(opts?: { clientDist?: string }) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-routes-'));
  const store = createStore({
    filePath: path.join(tmp, 'state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  server = createApp(store, opts).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
beforeEach(() => start());
afterEach(() => new Promise((r) => server.close(r)));

const post = (url: string, body: unknown = {}) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getJson = async <T>(url: string) => (await fetch(base + url)).json() as Promise<T>;

describe('scenario routes', () => {
  it('generates a random city with a new runId and serves its map', async () => {
    const before = await getJson<MapResponse>('/api/map');
    const res = await post('/api/scenario/generate', { preset: 'random', seed: 7, employees: 200, packages: 60 });
    expect(res.status).toBe(200);
    const sim = (await res.json()) as SimulatorResponse;
    expect(sim.runId).not.toBe(before.runId);
    expect(sim.shipments).toHaveLength(60);
    const map = await getJson<MapResponse>('/api/map');
    expect(map.runId).toBe(sim.runId);
    expect(map.graph).toEqual((await getJson<Run>('/api/scenario/export')).scenario.graph);
    expect(map.homes).toHaveLength(200);
  });

  it('generates a zero-hub city with no relay plans', async () => {
    const res = await post('/api/scenario/generate', { preset: 'random', seed: 3, hubs: 0 });
    expect(res.status).toBe(200);
    const sim = (await res.json()) as SimulatorResponse;
    expect(sim.plans.length).toBeGreaterThan(0);
    expect(sim.plans.filter((p) => p.kind === 'relay')).toHaveLength(0);
    expect((await getJson<MapResponse>('/api/map')).hubs).toHaveLength(0);
  });

  it('rejects an invalid generate request with 400', async () => {
    const res = await post('/api/scenario/generate', { preset: 'random', employees: 5 });
    expect(res.status).toBe(400);
  });

  it('round-trips export -> generate other -> import (spec test 8)', async () => {
    await post('/api/scenario/generate', { preset: 'random', seed: 11 });
    const before = await getJson<SimulatorResponse>('/api/simulator');
    const exported = await getJson<Run>('/api/scenario/export');

    const other = (await (await post('/api/scenario/generate', { preset: 'random', seed: 12 })).json()) as SimulatorResponse;
    expect(other.runId).not.toBe(before.runId);

    const res = await post('/api/scenario/import', exported);
    expect(res.status).toBe(200);
    const after = (await res.json()) as SimulatorResponse;
    expect(after.runId).not.toBe(other.runId);
    expect(after.runId).not.toBe(before.runId);
    expect(after.clock.playing).toBe(false);
    expect(after.plans.map((p) => p.id)).toEqual(before.plans.map((p) => p.id));
    expect(after.jobs.map((j) => j.id)).toEqual(before.jobs.map((j) => j.id));
    expect(after.snapshot.metrics).toEqual(before.snapshot.metrics);
    const again = await getJson<Run>('/api/scenario/export');
    expect(again.scenario).toEqual(exported.scenario);
  });

  it('rejects a malformed import with 400', async () => {
    expect((await post('/api/scenario/import', { nope: 1 })).status).toBe(400);
  });
});

describe('client dist serving', () => {
  it('serves index.html for deep links but JSON 404 for unknown /api paths', async () => {
    await new Promise((r) => server.close(r));
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>relay-spa</html>');
    await start({ clientDist: dist });
    const deep = await fetch(base + '/business/biz-1');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('relay-spa');
    const api = await fetch(base + '/api/x');
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'Not found' });
  });
});
