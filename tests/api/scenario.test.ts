import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { getExportScenario, postGenerateScenario, postImportScenario } from '../../server/api/scenario';
import type { SimulatorResponse } from '../../shared/api';
import type { Run } from '../../shared/types';

let server: Server;
let base: string;
const initial = () => createInitialRun(loadDefaultScenario());

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-'));
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.post('/api/scenario/generate', postGenerateScenario(store));
  app.get('/api/scenario/export', getExportScenario(store));
  app.post('/api/scenario/import', postImportScenario(store));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const post = (url: string, body: unknown) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const exportRun = async () => (await fetch(base + '/api/scenario/export')).json() as Promise<Run>;

describe('scenario routes', () => {
  it('rejects an invalid generate body with fieldErrors', async () => {
    const res = await post('/api/scenario/generate', { preset: 'random', employees: 5 });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.employees).toBeTruthy();
    expect((await post('/api/scenario/generate', { preset: 'nope' })).status).toBe(400);
  });

  it('generates deterministically and bumps runId', async () => {
    const body = { preset: 'random', seed: 7, employees: 30, packages: 10, hubs: 3 };
    const a = (await (await post('/api/scenario/generate', body)).json()) as SimulatorResponse;
    const b = (await (await post('/api/scenario/generate', body)).json()) as SimulatorResponse;
    expect(a.shipments).toHaveLength(10);
    expect(b.shipments.map((s) => s.id)).toEqual(a.shipments.map((s) => s.id));
    expect(b.plans.map((p) => p.id)).toEqual(a.plans.map((p) => p.id));
    const n = (id: string) => Number(id.slice(4));
    expect(n(b.runId)).toBe(n(a.runId) + 1);
    expect((await exportRun()).scenario.employees).toHaveLength(30);
  });

  it('demo preset loads the default scenario', async () => {
    const r = (await (await post('/api/scenario/generate', { preset: 'demo' })).json()) as SimulatorResponse;
    expect(r.shipments).toHaveLength(loadDefaultScenario().shipments.length);
    expect(r.clock.playing).toBe(false);
  });

  it('rejects imports missing required fields', async () => {
    const run = await exportRun();
    for (const bad of [{}, null, { ...run, trips: undefined }, { ...run, clock: undefined },
      { ...run, scenario: { ...run.scenario, graph: {} } },
      { ...run, scenario: { ...run.scenario, shipments: undefined } }]) {
      expect((await post('/api/scenario/import', bad)).status).toBe(400);
    }
  });

  it('round-trips export -> import, paused, with a new runId', async () => {
    const before = await exportRun();
    const withPlaying: Run = { ...before, clock: { ...before.clock, playing: true } };
    const res = await post('/api/scenario/import', withPlaying);
    expect(res.status).toBe(200);
    const sim = (await res.json()) as SimulatorResponse;
    const after = await exportRun();
    expect(after.clock.playing).toBe(false);
    expect(Number(sim.runId.slice(4))).toBe(Number(before.runId.slice(4)) + 1);
    expect(after.scenario.shipments).toEqual(before.scenario.shipments);
    expect(after.assignments.plans).toEqual(before.assignments.plans);
    expect(after.jobs).toEqual(before.jobs);
  });
});
