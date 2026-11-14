import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { ApiRequestError, getBusinessDashboard, getEmployeeDashboard, getJob, getShipment, putCommute } from '../../client/src/api';

let server: Server;
let base: string;
let dist: string;
let employeeId: string;
let commute: object;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-found-'));
  dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html>SPA</html>');
  const run = createInitialRun(loadDefaultScenario());
  const store = createStore({ filePath: path.join(dir, 'state.json'), initial: () => run });
  const e = run.scenario.employees[0];
  employeeId = e.id;
  commute = {
    businessId: e.businessId, homeNodeId: e.homeNodeId, eveningDepartureMin: e.eveningDepartureMin,
    morningDepartureMin: e.morningDepartureMin, availableEvening: e.availableEvening,
    availableMorning: e.availableMorning, maxExtraMin: e.maxExtraMin,
    eveningViaNodeIds: e.eveningViaNodeIds, morningViaNodeIds: e.morningViaNodeIds,
  };
  server = createApp(store, { clientDist: dist }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => vi.unstubAllGlobals());

const call = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, body: (await res.json()) as { error?: unknown } };
};

describe('JSON 404s for unknown ids', () => {
  it.each([
    ['GET', '/api/businesses/nope/dashboard'],
    ['GET', '/api/employees/nope/dashboard'],
    ['GET', '/api/jobs/nope'],
    ['GET', '/api/shipments/nope'],
    ['PUT', '/api/employees/nope/commute'],
  ])('%s %s', async (method, url) => {
    const { res, body } = await call(method, url, method === 'PUT' ? commute : undefined);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(typeof body.error).toBe('string');
    expect((body.error as string).length).toBeGreaterThan(3);
  });

  it('unknown /api paths are JSON 404, never index.html', async () => {
    for (const [method, url] of [['GET', '/api/nope'], ['GET', '/api/jobs'], ['POST', '/api/nope/x'], ['DELETE', '/api/employees/x']]) {
      const { res, body } = await call(method, url);
      expect(res.status).toBe(404);
      expect(typeof body.error).toBe('string');
    }
    const spa = await fetch(base + '/employee/x');
    expect(await spa.text()).toContain('SPA');
  });
});

describe('error shapes', () => {
  it('400, 404 and 409 all carry { error: string }', async () => {
    const bad = await call('PUT', `/api/employees/${employeeId}/commute`, { maxExtraMin: 99 });
    expect(bad.res.status).toBe(400);
    expect(typeof bad.body.error).toBe('string');
    expect(bad.body).toHaveProperty('fieldErrors');

    const missing = await call('GET', '/api/jobs/nope');
    expect(typeof missing.body.error).toBe('string');

    await call('POST', '/api/simulator/control', { action: 'play' });
    const locked = await call('PUT', `/api/employees/${employeeId}/commute`, commute);
    expect(locked.res.status).toBe(409);
    expect(typeof locked.body.error).toBe('string');
  });
});

describe('client api errors', () => {
  it('expose status and the server error text', async () => {
    const stub = () => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })));
    const calls = [
      () => getBusinessDashboard('x'), () => getEmployeeDashboard('x'), () => getJob('x'),
      () => getShipment('x'), () => putCommute('x', commute as never),
    ];
    for (const c of calls) {
      stub();
      const err = await c().catch((e) => e);
      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err.status).toBe(404);
      expect(err.message).toBe('Job not found');
    }
  });
});
