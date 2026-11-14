// The MVP II demo flow over HTTP on the bootstrapped server (server/api/v2/bootstrap.ts), the way
// server/index.ts starts it: createV2Runtime on a folder with the NYC files and a travel cache, then
// createApp(store, { v2: runtime.deps }). The cache is the made-up sample of v2-boot-sample.ts in a temp
// folder. No network (the injected fetch fails the test if it is called) and no key.
// The tests run in order on one server: each step continues from the state the step before left.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { buildDefaultRun } from '../../server/api/v2/bootRun';
import { KEY_MISSING_MESSAGE } from '../../server/api/geo';
import type { Run as RunV2 } from '../../shared/v2/types';
import { bootSample, runJson } from './v2-boot-sample';
import { noNetwork, startBootstrapApi, T, type BootstrapApi } from './v2-bootstrap-helper';

const network = noNetwork();
let api: BootstrapApi;
/** The exported run at the start: the scenario's settings are not part of GET /simulator. */
let first: RunV2;
/** The delivery created in the flow and the employee who carries its first leg. */
let shipmentId = '';
let carrierId = '';

beforeAll(async () => {
  api = await startBootstrapApi({ cache: 'sample', fetch: network.fetch });
  first = (await api.v2.get('/scenario/export')).body as RunV2;
}, T);
afterAll(async () => {
  await api?.close();
}, T);

const deliveryRequest = (clientRequestId: string, originBusinessId: string, destinationBusinessId: string) => ({
  clientRequestId,
  originBusinessId,
  destinationBusinessId,
  label: 'Late proofs',
  category: 'envelope',
  description: 'Printed proofs for tomorrow\'s review',
  weightKg: 0.3,
  readyMin: first.scenario.settings.simStartMin + 30,
  deadlineMin: first.scenario.settings.simEndMin - 120,
});

describe('MVP II demo flow on the bootstrapped server', () => {
  it('starts ready from the cache folder, without writing the state file', () => {
    expect(api.runtime.status).toBe('ready');
    expect(api.runtime.reason).toBeUndefined();
    expect(api.runtime.deps.travel).not.toBeNull();
    expect(api.runtime.deps.store).not.toBeNull();
    expect(fs.existsSync(api.repo.statePath)).toBe(false);
  }, T);

  it('GET /simulator shows the default NYC run with its packages matched', async () => {
    const res = await api.v2.get('/simulator');
    expect(res.status).toBe(200);
    const sim = res.body;
    expect(sim.runId).toBe('run-1');
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: first.scenario.settings.simStartMin });
    expect(sim.shipments).toHaveLength(24);
    expect(sim.plans.length + sim.unmatched.length).toBe(24);
    expect(sim.plans.length).toBeGreaterThan(12); // most of the 24 find a carrier on the sample cache
    expect(sim.jobs.length).toBeGreaterThanOrEqual(sim.plans.length);
    for (const plan of sim.plans) expect(sim.snapshot.shipmentStatus[plan.shipmentId]).toBe('scheduled');

    // It is exactly the run bootV2Run builds from the same cache and fixture files.
    expect(runJson(api.store!.get())).toBe(runJson(buildDefaultRun(bootSample())));
  }, T);

  it('two requests in the same state see the same version', async () => {
    const [a, b] = await Promise.all([api.v2.get('/simulator'), api.v2.get('/simulator')]);
    expect(a.body.version).toBe(b.body.version);
    expect(a.body).toStrictEqual(b.body);
    const employeeId = a.body.jobs[0].employeeId;
    const dashboard = await api.v2.get(`/employees/${employeeId}/dashboard`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.version).toBe(a.body.version);
  }, T);

  it('POST /shipments returns a matched delivery and saves the v2 state file', async () => {
    const before = (await api.v2.get('/simulator')).body;
    const { businesses } = (await api.v2.get('/businesses')).body;
    expect(businesses).toHaveLength(18);

    // The first business pair with a free commute. On the sample cache that is the very first one.
    let created: Record<string, any> | null = null;
    let tries = 0;
    for (const origin of businesses.slice(0, 3)) {
      for (const destination of businesses.slice(0, 3)) {
        if (created || origin.id === destination.id) continue;
        tries += 1;
        const res = await api.v2.post('/shipments', deliveryRequest(`bootstrap-flow-${tries}`, origin.id, destination.id));
        expect(res.status).toBe(201);
        if (res.body.matched) created = res.body;
      }
    }
    expect(created).not.toBeNull();
    expect(created!.plan.legs.length).toBeGreaterThanOrEqual(1);
    expect(created!.status).toBe('scheduled');
    expect(created!.jobIds.length).toBe(created!.plan.legs.length);
    shipmentId = created!.shipment.id;
    carrierId = created!.plan.legs[0].employeeId;

    const after = (await api.v2.get('/simulator')).body;
    expect(after.version).toBe(before.version + tries);
    expect(after.shipments.map((s: { id: string }) => s.id)).toContain(shipmentId);
    expect((await api.savedRun())?.scenario.shipments.map((s) => s.id)).toContain(shipmentId);
  }, T);

  it('the carrier\'s dashboard lists the job', async () => {
    const dashboard = await api.v2.get(`/employees/${carrierId}/dashboard`);
    expect(dashboard.status).toBe(200);
    const mine = dashboard.body.assigned.filter((view: any) => view.shipment.id === shipmentId);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe('assigned');
    expect(dashboard.body.projectedCents).toBeGreaterThan(0);

    const job = await api.v2.get(`/jobs/${mine[0].job.id}`);
    expect(job.status).toBe(200);
  }, T);

  it('a seek to the end of the run shows the delivery delivered', async () => {
    const end = first.scenario.settings.simEndMin;
    const seek = await api.v2.post('/simulator/control', { action: 'seek', timeMin: end });
    expect(seek.status).toBe(200);
    expect(seek.body.clock.timeMin).toBe(end);
    expect(seek.body.snapshot.shipmentStatus[shipmentId]).toBe('delivered');

    const shipment = await api.v2.get(`/shipments/${shipmentId}`);
    expect(shipment.status).toBe(200);
    expect(shipment.body).toMatchObject({ matched: true, status: 'delivered' });
    expect(shipment.body.deliveredAtMin).toBeLessThanOrEqual(shipment.body.shipment.deadlineMin);

    const dashboard = (await api.v2.get(`/employees/${carrierId}/dashboard`)).body;
    expect(dashboard.completed.map((view: any) => view.shipment.id)).toContain(shipmentId);
    expect(dashboard.earnedCents).toBeGreaterThan(0);
  }, T);

  it('a new planning cycle, a commute save with the same home, the comparison and the map answer 200', async () => {
    const reset = await api.v2.post('/planning/reset');
    expect(reset.status).toBe(200);
    expect(reset.body.runId).toBe('run-2');
    expect(reset.body.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: first.scenario.settings.simStartMin });
    expect(reset.body.shipments.map((s: { id: string }) => s.id)).toContain(shipmentId);

    const employee = first.scenario.employees[0];
    const commute = await api.v2.put(`/employees/${employee.id}/commute`, {
      businessId: employee.businessId,
      home: { homeId: employee.homeId },
      eveningDepartureMin: employee.eveningDepartureMin,
      morningDepartureMin: employee.morningDepartureMin,
      availableEvening: employee.availableEvening,
      availableMorning: employee.availableMorning,
      maxExtraMin: employee.maxExtraMin,
    });
    expect(commute.status).toBe(200);
    expect(commute.body.home.id).toBe(employee.homeId);
    expect(commute.body.trips).toHaveLength(2);

    const versionBefore = (await api.v2.get('/simulator')).body.version;
    const compare = await api.v2.post('/matches/compare', {});
    expect(compare.status).toBe(200);
    expect(compare.body.withRelay.result.plans.length).toBeGreaterThanOrEqual(compare.body.directOnly.result.plans.length);
    expect((await api.v2.get('/simulator')).body.version).toBe(versionBefore); // the comparison stores nothing

    const map = await api.v2.get('/map');
    expect(map.status).toBe(200);
    expect(map.body.runId).toBe('run-2');
    expect(map.body.businesses).toHaveLength(18);
    expect(map.body.employees).toHaveLength(first.scenario.employees.length);
    expect(map.body.polylines.length).toBeGreaterThan(0);

    expect((await api.v2.post('/matches/recompute')).status).toBe(200);
  }, T);

  it('GET /geocode without a key answers the documented 503', async () => {
    const res = await api.v2.get(`/geocode?q=${encodeURIComponent('350 Fifth Avenue')}`);
    expect(res.status).toBe(503);
    expect(res.body).toStrictEqual({ error: KEY_MISSING_MESSAGE, code: 'google_key_missing' });
    expect((await api.v2.get('/geocode?q=ab')).status).toBe(400); // registered with its own validation
  }, T);

  it('an unknown /api/v2 path is a JSON 404, and so is a deleted MVP 1 path; the MVP 1 state is untouched', async () => {
    const unknown = await api.v2.get('/no-such-route');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toStrictEqual({ error: 'Not found' });

    const mvp1 = await api.call('GET', '/api/simulator'); // an MVP 1 route until #628
    expect(mvp1.status).toBe(404);
    expect(mvp1.body).toStrictEqual({ error: 'Not found' });
    expect(api.mvp1Store.get().version).toBe(0); // nothing in the v2 flow touched the MVP 1 run
    expect(fs.existsSync(api.repo.mvp1StatePath)).toBe(false);
  }, T);

  it('the whole flow made no Google request', () => {
    expect(network.calls).toStrictEqual([]);
  }, T);
});
