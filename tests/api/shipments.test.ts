import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { ShipmentResponse } from '../../shared/api';
import type { ApiError } from '../../shared/schemas';

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shipments-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

const send = (method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const payload = (over: object = {}) => {
  const { businesses, settings } = store.get().scenario;
  return {
    clientRequestId: 'req-1', originBusinessId: businesses[0].id, destinationBusinessId: businesses[1].id,
    label: 'Contracts', category: 'envelope', description: 'Signed papers', weightKg: 0.5,
    readyMin: settings.simStartMin, deadlineMin: settings.simEndMin,
    pickupInstructions: '', dropoffInstructions: '', ...over,
  };
};

/** Tries origin/destination pairs until one matches (matched) or none does (unmatched). */
async function postUntil(wantMatched: boolean) {
  const { businesses } = store.get().scenario;
  let n = 0;
  for (const o of businesses) for (const d of businesses) {
    if (o.id === d.id) continue;
    const r = await send('POST', '/api/shipments', payload({
      clientRequestId: `probe-${n++}`, originBusinessId: o.id, destinationBusinessId: d.id,
    }));
    const b = (await r.json()) as ShipmentResponse;
    if (b.matched === wantMatched) return b;
  }
  return null;
}

describe('POST /api/shipments', () => {
  it('201 matched with one job per leg, notifications and events written', async () => {
    const before = store.get();
    const b = await postUntil(true);
    expect(b).not.toBeNull();
    expect(b!.shipment.id).toMatch(/^shp-\d+$/);
    expect(b!.shipment.weightGrams).toBe(500);
    expect(b!.plan!.id).toBe(`plan-${b!.shipment.id}`);
    expect(b!.jobIds).toEqual(b!.plan!.legs.map((_, i) => `${b!.plan!.id}-L${i}`));
    const run = store.get();
    expect(run.jobs.length).toBeGreaterThan(before.jobs.length);
    expect(run.notifications.length).toBeGreaterThan(before.notifications.length);
    expect(run.events.length).toBeGreaterThan(before.events.length);
    expect(run.assignments.plans.length).toBe(before.assignments.plans.length + 1);
    // existing plans are never re-planned
    for (const p of before.assignments.plans) {
      expect(run.assignments.plans.find((x) => x.id === p.id)).toEqual(p);
    }
  });

  it('first POST is 201 and replaying the clientRequestId is 200 with nothing new', async () => {
    const r1 = await send('POST', '/api/shipments', payload());
    expect(r1.status).toBe(201);
    const b1 = (await r1.json()) as ShipmentResponse;
    const snap = (() => {
      const r = store.get();
      return [r.scenario.shipments.length, r.assignments.plans.length, r.jobs.length, r.notifications.length];
    })();
    const r2 = await send('POST', '/api/shipments', payload());
    expect(r2.status).toBe(200);
    expect(((await r2.json()) as ShipmentResponse).shipment.id).toBe(b1.shipment.id);
    const r = store.get();
    expect([r.scenario.shipments.length, r.assignments.plans.length, r.jobs.length, r.notifications.length]).toEqual(snap);
  });

  it('shipment ids follow creation order', async () => {
    const n = store.get().scenario.shipments.length;
    const b = (await (await send('POST', '/api/shipments', payload())).json()) as ShipmentResponse;
    expect(b.shipment.id).toBe(`shp-${n + 1}`);
    expect(b.shipment.createdSeq).toBe(n + 1);
  });

  it('400 with fieldErrors keyed by form field', async () => {
    const r = await send('POST', '/api/shipments', payload({
      label: ' ', weightKg: 5, destinationBusinessId: 'zzz', readyMin: 0,
    }));
    expect(r.status).toBe(400);
    const b = (await r.json()) as ApiError;
    expect(b.fieldErrors).toHaveProperty('label');
    expect(b.fieldErrors).toHaveProperty('weightKg');
    expect(b.fieldErrors).toHaveProperty('destinationBusinessId');
    expect(b.fieldErrors).toHaveProperty('readyMin');
  });

  it('409 while locked', async () => {
    await store.mutate((r) => { r.clock.phase = 'locked'; });
    const r = await send('POST', '/api/shipments', payload());
    expect(r.status).toBe(409);
    expect(((await r.json()) as ApiError).error).toBe('Start a new planning cycle to change deliveries');
  });
});

describe('unmatched shipments', () => {
  const unmatched = async () => {
    // A tiny window nobody can serve is always unmatched.
    const { simStartMin } = store.get().scenario.settings;
    const r = await send('POST', '/api/shipments', payload({
      clientRequestId: 'tight', readyMin: simStartMin, deadlineMin: simStartMin + 1,
    }));
    expect(r.status).toBe(201);
    return (await r.json()) as ShipmentResponse;
  };

  it('is stored with matched:false and a reason', async () => {
    const b = await unmatched();
    expect(b.matched).toBe(false);
    expect(b.plan).toBeNull();
    expect(b.unmatchedReason).toBeTruthy();
    expect(store.get().scenario.shipments.some((s) => s.id === b.shipment.id)).toBe(true);
  });

  it('PATCH edits and retries; POST match is idempotent for matched; 404 and 409 rules', async () => {
    const b = await unmatched();
    const id = b.shipment.id;
    const { simEndMin } = store.get().scenario.settings;
    expect((await send('PATCH', `/api/shipments/${id}`, { deadlineMin: 5 })).status).toBe(400);
    const r = await send('PATCH', `/api/shipments/${id}`, { deadlineMin: simEndMin, label: 'Edited' });
    expect(r.status).toBe(200);
    const p = (await r.json()) as ShipmentResponse;
    expect(p.shipment.label).toBe('Edited');
    expect(p.matched).toBe(p.plan !== null);
    if (p.matched) {
      expect((await send('PATCH', `/api/shipments/${id}`, { label: 'x' })).status).toBe(409);
      const m = (await (await send('POST', `/api/shipments/${id}/match`)).json()) as ShipmentResponse;
      expect(m.plan).toEqual(p.plan);
    }
    expect((await send('PATCH', '/api/shipments/nope', { label: 'x' })).status).toBe(404);
    expect((await send('POST', '/api/shipments/nope/match')).status).toBe(404);

    await store.mutate((run) => { run.clock.phase = 'locked'; });
    for (const [m, u] of [['PATCH', `/api/shipments/${id}`], ['POST', `/api/shipments/${id}/match`]]) {
      const l = await send(m, u, m === 'PATCH' ? { label: 'y' } : undefined);
      expect(l.status).toBe(409);
      expect(((await l.json()) as ApiError).error).toBe('Start a new planning cycle to change deliveries');
    }
  });

  it('POST match on an unmatched shipment retries and returns ShipmentResponse', async () => {
    const b = await unmatched();
    const r = await send('POST', `/api/shipments/${b.shipment.id}/match`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as ShipmentResponse).shipment.id).toBe(b.shipment.id);
  });
});
