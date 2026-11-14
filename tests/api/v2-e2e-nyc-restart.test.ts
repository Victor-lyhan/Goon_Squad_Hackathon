// SPEC M8: a restart on the committed NYC cache. A second runtime on the same state file restores the
// same run, paused, at the same minute (DECISIONS pass 13, 49), after a clean shutdown and after a kill.
// The servers are the real one on fixtures/nyc with no key (v2-e2e-nyc-helper.ts), one after the other
// on one temp state file. `globalThis.fetch` is a recorder for the whole file. Only rules are asserted;
// no story ID or count is pinned (pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ShipmentResponse } from '../../shared/v2/api';
import type { Run as RunV2 } from '../../shared/v2/types';
import {
  businessAt, DAY_2_MIN, deliveryRequest, expectPositionsInNyc, expectStatusesFromPlans, findMatchingDelivery, readCity,
  recordFetch, startNycApi, stopsOf, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';

const net = recordFetch();
let stateDir = '';
/** The server that is running now. Each test that restarts replaces it. */
let api: NycApi;
let city: City;
/** The delivery created on the first server. */
let created: ShipmentResponse;
/** The whole run as the server before the restart last reported it. */
let before: RunV2;

beforeAll(async () => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-e2e-nyc-restart-'));
  api = await startNycApi(net, { stateDir });
  city = await readCity(api);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
  if (stateDir) fs.rmSync(stateDir, { recursive: true, force: true });
}, T);

/** The restored file was used as it is: no copy was set aside as unusable (DECISIONS pass 10, 49). */
const expectNoBadCopy = () => expect(fs.readdirSync(stateDir).filter((name) => name.includes('.bad-'))).toStrictEqual([]);

describe('MVP II restart on the committed NYC cache, no key', () => {
  it('the first server changes the run: a delivery, Play, and a seek into the night', async () => {
    expect(api.runtime.status).toBe('ready');
    expect(fs.existsSync(api.statePath)).toBe(false);

    created = (await findMatchingDelivery(api, city, 'e2e-nyc-restart')).delivery;
    // No ticker here: the clock moves only by the seek, so the minute to restore is known.
    expect((await api.control({ action: 'play' })).clock).toMatchObject({ phase: 'locked', playing: true });
    const night = await api.control({ action: 'seek', timeMin: DAY_2_MIN });
    expect(night.clock).toMatchObject({ phase: 'locked', playing: true, timeMin: DAY_2_MIN });

    before = await api.exportRun();
    expect(before.clock).toStrictEqual(night.clock);
    expect(before.scenario.shipments.map((s) => s.id)).toContain(created.shipment.id);
    expect(await api.savedRun()).toStrictEqual(before);
  }, T);

  it('after a shutdown, a second runtime on the same state file restores the same run, paused, at the same minute', async () => {
    await api.close(); // stops, pauses and saves once more (one more version)
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'state-v2.json'), 'utf8')).run as RunV2;
    expect(saved.clock).toStrictEqual({ ...before.clock, playing: false });

    api = await startNycApi(net, { stateDir });
    expect(api.runtime.reason).toBeUndefined();
    expect(api.runtime.status).toBe('ready');
    expectNoBadCopy();

    // The same run: only the pause and the version of the shutdown's save differ.
    const restored = await api.exportRun();
    expect(restored).toStrictEqual({ ...before, version: before.version + 1, clock: { ...before.clock, playing: false } });
    expect(restored.clock).toMatchObject({ phase: 'locked', playing: false, timeMin: DAY_2_MIN });

    const sim = await api.simulator(); // 200, not 503
    expect(sim.runId).toBe(before.runId);
    expect(sim.clock).toStrictEqual(restored.clock);
    expect(sim.plans).toStrictEqual(before.assignments.plans);
    expectStatusesFromPlans(sim);
    expectPositionsInNyc(sim);

    // The delivery of the first server is there with its plan, and a relay package still waits at its relay business.
    const tracking = await api.get<ShipmentResponse>(`/shipments/${created.shipment.id}`);
    expect(tracking.status).toBe(200);
    expect(tracking.body).toMatchObject({ matched: true, shipment: created.shipment, plan: created.plan, jobIds: created.jobIds });
    for (const plan of sim.plans.filter((p) => p.kind === 'relay')) {
      const relay = businessAt(city, plan.relayBusinessId as string);
      expect(sim.snapshot.shipmentStatus[plan.shipmentId]).toBe('at_hub');
      expect(sim.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: relay.lat, lng: relay.lng });
    }

    // Reading changed nothing, and the restored run stays locked: a new request is refused.
    expect((await api.simulator()).version).toBe(restored.version);
    const refused = await api.post('/shipments', deliveryRequest('e2e-nyc-restart-late', created.shipment.originBusinessId, created.shipment.destinationBusinessId, city.settings));
    expect(refused.status).toBe(409);
  }, T);

  it('the restored run goes on: Jump to morning, then a kill while playing', async () => {
    const day2 = before.assignments.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin).filter((minute) => minute >= DAY_2_MIN);
    expect(day2.length).toBeGreaterThan(0);
    const morning = await api.control({ action: 'jump_to_morning' });
    expect(morning.clock.timeMin).toBe(Math.max(DAY_2_MIN, Math.min(...day2) - 5));
    expect((await api.control({ action: 'play' })).clock).toMatchObject({ phase: 'locked', playing: true, timeMin: morning.clock.timeMin });

    before = await api.exportRun();
    expect(before.clock.playing).toBe(true);
    await api.close({ crash: true }); // no shutdown: the state file still says "playing"
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'state-v2.json'), 'utf8')).run as RunV2;
    expect(saved).toStrictEqual(before);
  }, T);

  it('after a kill, a third runtime restores the same run, paused, at the same minute, and it finishes delivered', async () => {
    api = await startNycApi(net, { stateDir });
    expect(api.runtime.status).toBe('ready');
    expectNoBadCopy();

    const restored = await api.exportRun();
    expect(restored).toStrictEqual({ ...before, clock: { ...before.clock, playing: false } });
    const sim = await api.simulator();
    expect(sim.clock).toStrictEqual({ ...before.clock, playing: false });
    expect(sim.version).toBe(before.version); // the restore itself is not a change
    expectStatusesFromPlans(sim);

    const end = await api.control({ action: 'finish' });
    expect(end.clock).toMatchObject({ timeMin: city.settings.simEndMin, playing: false, phase: 'locked' });
    expect(end.plans.length).toBeGreaterThan(0);
    for (const plan of end.plans) expect(`${plan.shipmentId} ${end.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} delivered`);
    expect(end.snapshot.shipmentStatus[created.shipment.id]).toBe('delivered');
  }, T);

  it('the repo\'s data/ folder and fixtures/nyc are untouched, and no call left the test servers', () => {
    api.expectRepoFilesUntouched();
    expect(fs.readdirSync(stateDir).filter((name) => name.startsWith('state-v2.json')).sort()).toStrictEqual(['state-v2.json']);
    expect(net.installed()).toBe(true);
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  }, T);
});
