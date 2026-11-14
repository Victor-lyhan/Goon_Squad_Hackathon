import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const INDEX = '<!doctype html><html><body><div id="root">relay-shell</div></body></html>';
const JS = 'console.log("relay-asset");';

let server: Server | undefined;
let base = '';
let tmp = '';
let store: ReturnType<typeof createStore>;

async function start(clientDist: string) {
  server = createApp(store, { clientDist }).listen(0);
  await new Promise((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-serve-'));
  store = createStore({ filePath: path.join(tmp, 'state.json'), initial: () => createInitialRun(loadDefaultScenario()) });
});
afterEach(() => new Promise((r) => (server ? server.close(r) : r(undefined))));

function makeDist() {
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), INDEX);
  fs.writeFileSync(path.join(dist, 'assets/app.js'), JS);
  return dist;
}

describe('production serving with client/dist', () => {
  beforeEach(() => start(makeDist()));

  it('serves index.html for client routes and deep links', async () => {
    const run = store.get();
    const businessId = run.scenario.businesses[0].id;
    const employeeId = run.scenario.employees[0].id;
    const shipmentId = run.scenario.shipments[0].id;
    const jobId = run.jobs[0]?.id ?? "job-x";
    const paths = [
      '/',
      `/business/${businessId}?shipment=${shipmentId}`,
      `/employee/${employeeId}?job=${jobId}`,
      `/simulator?package=${shipmentId}`,
      '/nope',
    ];
    for (const p of paths) {
      const r = await fetch(`${base}${p}`);
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-type'), p).toContain('text/html');
      expect(await r.text(), p).toContain('relay-shell');
    }
  });

  it('serves static assets', async () => {
    const r = await fetch(`${base}/assets/app.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(JS);
  });

  it('keeps unknown API paths as JSON 404, never HTML', async () => {
    for (const p of ['/api/does-not-exist', '/api/shipments/nope']) {
      const r = await fetch(`${base}${p}`);
      expect(r.status, p).toBe(404);
      expect(r.headers.get('content-type'), p).toContain('application/json');
      const body = (await r.json()) as { error: string };
      expect(typeof body.error).toBe('string');
    }
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe('production serving without client/dist', () => {
  beforeEach(() => start(path.join(tmp, 'missing-dist')));

  it('does not crash on non-API paths', async () => {
    const r = await fetch(`${base}/business/x`);
    expect(r.status).toBe(404);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
