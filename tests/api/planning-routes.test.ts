import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { CompareResponse, SimulatorResponse } from '../../shared/api';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'planning-routes-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const post = (url: string, body: unknown = {}) =>
  fetch(base + url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

describe('planning routes', () => {
  it('POST /api/matches/compare returns both sides and does not change the run', async () => {
    const before = store.get().version;
    const res = await post('/api/matches/compare');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompareResponse;
    expect(body.directOnly.result).toBeDefined();
    expect(body.withRelay.metrics).toBeDefined();
    expect(store.get().version).toBe(before);
  });

  it('POST /api/matches/recompute returns a SimulatorResponse, then 409 once locked', async () => {
    const res = await post('/api/matches/recompute');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimulatorResponse;
    expect(body.clock.phase).toBe('planning');
    expect(body.runId).toBe(store.get().runId);

    expect((await post('/api/simulator/control', { action: 'play' })).status).toBe(200);
    const locked = await post('/api/matches/recompute');
    expect(locked.status).toBe(409);
  });

  it('POST /api/planning/reset starts a new cycle that accepts shipments again', async () => {
    const run = store.get();
    const n = Number(/^run-(\d+)$/.exec(run.runId)![1]);
    const { simStartMin, simEndMin } = run.scenario.settings;
    await post('/api/simulator/control', { action: 'play' });

    const res = await post('/api/planning/reset');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimulatorResponse;
    expect(body.runId).toBe(`run-${n + 1}`);
    expect(body.clock.phase).toBe('planning');
    expect(body.clock.timeMin).toBe(simStartMin);

    const { businesses } = run.scenario;
    const created = await post('/api/shipments', {
      clientRequestId: 'after-reset', originBusinessId: businesses[0].id, destinationBusinessId: businesses[1].id,
      label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
      readyMin: simStartMin, deadlineMin: simEndMin, pickupInstructions: '', dropoffInstructions: '',
    });
    expect(created.status).not.toBe(409);
    expect(created.status).toBeLessThan(300);
  });
});
