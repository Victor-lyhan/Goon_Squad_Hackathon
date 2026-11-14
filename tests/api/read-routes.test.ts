import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { BusinessesResponse, EmployeesResponse, MapResponse } from '../../shared/api';

let server: Server;
let base: string;
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../fixtures/relayFixture.json'), 'utf8'));

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-routes-'));
  const store = createStore({
    filePath: path.join(dir, 'state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const demo = loadDefaultScenario();
const get = async <T>(p: string) => (await fetch(base + p)).json() as Promise<T>;

describe('read routes', () => {
  it('createInitialRun is deterministic and paused', () => {
    const run = createInitialRun(loadDefaultScenario());
    expect(run).toMatchObject({ runId: 'run-1', version: 0 });
    expect(run.jobs.length).toBeGreaterThan(0);
    expect(run.events.length).toBeGreaterThan(0);
    expect(run.clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });
  });

  it('GET /api/businesses', async () => {
    const body = await get<BusinessesResponse>('/api/businesses');
    expect(body.businesses).toEqual(demo.businesses);
    expect(body.hubs).toEqual(demo.hubs);
  });

  it('GET /api/employees', async () => {
    const body = await get<EmployeesResponse>('/api/employees');
    expect(body.employees).toEqual(demo.employees);
  });

  it('GET /api/map', async () => {
    const body = await get<MapResponse>('/api/map');
    expect(body.runId).toBe('run-1');
    expect(body.graph).toEqual(demo.graph);
    expect(body.businesses).toEqual(demo.businesses);
    expect(body.hubs).toEqual(demo.hubs);
    expect(body.homes).toEqual(demo.employees.map((e) => ({ employeeId: e.id, nodeId: e.homeNodeId })));
  });

  it('unknown /api path is 404 JSON', async () => {
    const res = await fetch(base + '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
