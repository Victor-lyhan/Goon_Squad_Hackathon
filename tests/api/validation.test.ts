import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { ApiError } from '../../shared/schemas';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'validation-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

async function send(method: string, url: string, body: unknown) {
  const r = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await r.text();
  expect(text).not.toMatch(/NaN|undefined/);
  return { status: r.status, body: JSON.parse(text) as ApiError };
}

const shipmentForm = (over: object = {}) => {
  const { businesses, settings } = store.get().scenario;
  return {
    clientRequestId: `v-${Math.random()}`, originBusinessId: businesses[0].id, destinationBusinessId: businesses[1].id,
    label: 'Docs', category: 'envelope', description: 'Papers', weightKg: 0.5,
    readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
    pickupInstructions: '', dropoffInstructions: '', ...over,
  };
};

async function expectFieldError(over: object, field: string) {
  const before = store.get().scenario.shipments.length;
  const r = await send('POST', '/api/shipments', shipmentForm(over));
  expect(r.status).toBe(400);
  expect(r.body.fieldErrors?.[field]).toBeTruthy();
  expect(store.get().scenario.shipments.length).toBe(before);
}

describe('POST /api/shipments validation', () => {
  it('sender == recipient', async () => {
    const id = store.get().scenario.businesses[0].id;
    await expectFieldError({ originBusinessId: id, destinationBusinessId: id }, 'destinationBusinessId');
  });
  it('weight 0 and above 2 kg', async () => {
    await expectFieldError({ weightKg: 0 }, 'weightKg');
    await expectFieldError({ weightKg: 2.5 }, 'weightKg');
  });
  it('deadline not after ready', async () => {
    const { simStartMin } = store.get().scenario.settings;
    await expectFieldError({ readyMin: simStartMin + 60, deadlineMin: simStartMin + 60 }, 'deadlineMin');
    await expectFieldError({ readyMin: simStartMin + 60, deadlineMin: simStartMin + 30 }, 'deadlineMin');
  });
  it('times outside the simulated cycle', async () => {
    const { simStartMin, simEndMin } = store.get().scenario.settings;
    await expectFieldError({ readyMin: simStartMin - 10 }, 'readyMin');
    await expectFieldError({ readyMin: simEndMin + 5, deadlineMin: simEndMin + 60 }, 'readyMin');
    await expectFieldError({ deadlineMin: simEndMin + 1 }, 'deadlineMin');
  });
  it('unknown business ids', async () => {
    await expectFieldError({ originBusinessId: 'biz-nope' }, 'originBusinessId');
    await expectFieldError({ destinationBusinessId: 'biz-nope' }, 'destinationBusinessId');
  });
  it('unknown ids combined with other bad fields report every field', async () => {
    const r = await send('POST', '/api/shipments', shipmentForm({ originBusinessId: 'biz-nope', weightKg: 0 }));
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors?.originBusinessId).toBeTruthy();
    expect(r.body.fieldErrors?.weightKg).toBeTruthy();
  });
});

describe('PUT /api/employees/:id/commute validation', () => {
  const commute = (over: object = {}) => {
    const e = store.get().scenario.employees[0];
    return {
      businessId: e.businessId, homeNodeId: e.homeNodeId,
      eveningDepartureMin: e.eveningDepartureMin, morningDepartureMin: e.morningDepartureMin,
      availableEvening: true, availableMorning: true, maxExtraMin: 8,
      eveningViaNodeIds: [], morningViaNodeIds: [], ...over,
    };
  };
  const put = (over: object) =>
    send('PUT', `/api/employees/${store.get().scenario.employees[0].id}/commute`, commute(over));

  it('unknown home node', async () => {
    const r = await put({ homeNodeId: 'n-99-99' });
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors?.homeNodeId).toBeTruthy();
  });
  it('unknown business', async () => {
    const r = await put({ businessId: 'biz-nope' });
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors?.businessId).toBeTruthy();
  });
  it('unknown waypoint', async () => {
    const r = await put({ eveningViaNodeIds: ['n-99-99'] });
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors?.eveningViaNodeIds).toBeTruthy();
  });
  it('more than 3 waypoints per direction', async () => {
    const nodes = store.get().scenario.graph.nodes.slice(0, 4).map((n) => n.id);
    for (const key of ['eveningViaNodeIds', 'morningViaNodeIds']) {
      const r = await put({ [key]: nodes });
      expect(r.status).toBe(400);
      expect(r.body.fieldErrors?.[key]).toBeTruthy();
    }
  });
  it('unchanged state after a rejected commute', async () => {
    const before = JSON.stringify(store.get().trips);
    await put({ homeNodeId: 'n-99-99' });
    expect(JSON.stringify(store.get().trips)).toBe(before);
  });
});
