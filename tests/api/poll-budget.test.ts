import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessesResponse, EmployeesResponse, SimulatorResponse } from '../../shared/api';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// Budgets for the 1 s polls. Relax these (with a comment) only if the machine needs it.
const SIM_MEDIAN_MS = 40;
const SIM_MAX_BYTES = 150 * 1024;
const DASH_MEDIAN_MS = 20;
const MID_EVENING_MIN = 18 * 60;

let server: Server;
let base: string;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poll-')), 'state.json');
  const store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const post = (url: string, body: unknown) =>
  fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function timed(url: string, n = 20) {
  const times: number[] = [];
  let bytes = 0;
  // Warm-up (JIT, keep-alive socket) so a cold slow runner does not skew the median.
  for (let i = 0; i < 3; i++) await (await fetch(`${base}${url}`)).text();
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fetch(`${base}${url}`);
    const text = await r.text();
    times.push(performance.now() - t0);
    expect(r.status).toBe(200);
    bytes = Buffer.byteLength(text);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(n / 2)], bytes };
}

describe('poll budgets', () => {
  it('largest random city: GET /api/simulator is fast and small, without static map data', async () => {
    const gen = await post('/api/scenario/generate', {
      preset: 'random', seed: 7, employees: 200, packages: 60, hubs: 10, maxExtraMin: 30,
    });
    expect(gen.status).toBe(200);
    expect((await post('/api/simulator/control', { action: 'seek', timeMin: MID_EVENING_MIN })).status).toBe(200);

    const { median, bytes } = await timed('/api/simulator');
    console.log(`random max city: simulator median ${median.toFixed(1)} ms, ${bytes} bytes`);
    expect(median).toBeLessThan(SIM_MEDIAN_MS);
    expect(bytes).toBeLessThan(SIM_MAX_BYTES);

    const body = (await (await fetch(`${base}/api/simulator`)).json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('graph');
    expect(JSON.stringify(body)).not.toContain('"edges"');
  }, 30_000);

  it('Demo city: business and employee dashboards are fast', async () => {
    await post('/api/simulator/control', { action: 'seek', timeMin: MID_EVENING_MIN });
    const biz = (await (await fetch(`${base}/api/businesses`)).json()) as BusinessesResponse;
    const emp = (await (await fetch(`${base}/api/employees`)).json()) as EmployeesResponse;
    const bizId = biz.businesses[0].id;
    const empId = emp.employees[0].id;

    const b = await timed(`/api/businesses/${bizId}/dashboard`);
    const e = await timed(`/api/employees/${empId}/dashboard`);
    console.log(`demo: business ${b.median.toFixed(1)} ms, employee ${e.median.toFixed(1)} ms`);
    expect(b.median).toBeLessThan(DASH_MEDIAN_MS);
    expect(e.median).toBeLessThan(DASH_MEDIAN_MS);
  }, 30_000);
});
