import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { postCompare, postPlanningReset, postRecompute } from '../../server/api/planning';
import type { CompareResponse, SimulatorResponse } from '../../shared/api';

let server: Server;
let base: string;
let store: Store;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-'));
  store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => createInitialRun(loadDefaultScenario()) });
  const app = express();
  app.use(express.json());
  app.post('/api/matches/compare', postCompare(store));
  app.post('/api/matches/recompute', postRecompute(store));
  app.post('/api/planning/reset', postPlanningReset(store));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const post = (p: string) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const lock = () => store.mutate((r) => { r.clock.phase = 'locked'; });

describe('planning handlers', () => {
  it('compare returns both sides without mutating the live run', async () => {
    const before = store.get();
    const res = await post('/api/matches/compare');
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompareResponse;
    expect(body.withRelay.result.plans.length).toBeGreaterThanOrEqual(body.directOnly.result.plans.length);
    expect(body.withRelay.result.plans.some((p) => p.kind === 'relay')).toBe(true);
    expect(body.directOnly.result.plans.every((p) => p.kind === 'direct')).toBe(true);
    expect(body.withRelay.metrics.requested).toBe(before.scenario.shipments.length);
    expect(body.directOnly.metrics.delivered).toBe(0);
    expect(body.withRelay.result.computeMs).toBeGreaterThanOrEqual(0);
    const after = store.get();
    expect(after.version).toBe(before.version);
    expect(after.assignments).toEqual(before.assignments);
  });

  it('recompute replaces assignments and bumps version when unlocked', async () => {
    const v = store.get().version;
    const res = await post('/api/matches/recompute');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimulatorResponse;
    expect(body.version).toBe(v + 1);
    expect(body.plans.length).toBeGreaterThan(0);
    expect(store.get().jobs.length).toBe(store.get().assignments.plans.reduce((n, p) => n + p.legs.length, 0));
  });

  it('recompute is refused with 409 while locked', async () => {
    await lock();
    const v = store.get().version;
    const res = await post('/api/matches/recompute');
    expect(res.status).toBe(409);
    expect(store.get().version).toBe(v);
  });

  it('reset unlocks, changes runId, rewinds the clock and keeps inputs', async () => {
    await lock();
    const before = store.get();
    const res = await post('/api/planning/reset');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SimulatorResponse;
    expect(body.runId).toBe('run-2');
    expect(body.clock).toEqual({
      phase: 'planning', playing: false, timeMin: before.scenario.settings.simStartMin, speed: before.clock.speed,
    });
    expect(body.plans.length).toBeGreaterThan(0);
    const after = store.get();
    expect(after.scenario.shipments).toEqual(before.scenario.shipments);
    expect(after.trips).toEqual(before.trips);
    expect((await post('/api/matches/recompute')).status).toBe(200);
  });
});
