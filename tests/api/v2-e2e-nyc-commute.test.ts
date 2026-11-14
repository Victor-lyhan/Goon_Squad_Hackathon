// SPEC M8: the commute save over HTTP on the committed NYC cache, with no Google key.
// - A save that keeps the home needs nothing from Google: 200, no outgoing call, and the unmatched
//   packages are retried (DECISIONS pass 46).
// - A save with a new address needs Google: with no key it is the 503 the route defines, and the run is
//   exactly as before (pass 50).
// The server is the real one on fixtures/nyc (v2-e2e-nyc-helper.ts). `globalThis.fetch` is a recorder for
// the whole file. Only rules are asserted; no story ID or count is pinned (pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommuteResponse, EmployeeDashboard, ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Employee } from '../../shared/v2/types';
import { travelErrorBody } from '../../server/api/v2/errors';
import { GoogleKeyMissingError } from '../../server/geo/googleClient';
import {
  commuteOf, deliveryRequest, expectInNyc, findMatchingDelivery, readCity, recordFetch, startNycApi, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';

const net = recordFetch();
let api: NycApi;
/** The city as it was at boot: every employee with the original detour limit. */
let city: City;
/** A sender and recipient pair that matches on a fresh default run, found from the data. */
let pair: { origin: string; destination: string };

beforeAll(async () => {
  // A second server on its own state file finds the pair, so the server under test starts untouched.
  const probe = await startNycApi(net);
  try {
    const found = await findMatchingDelivery(probe, await readCity(probe), 'e2e-nyc-commute-probe');
    pair = { origin: found.origin, destination: found.destination };
  } finally {
    await probe.close();
  }
  api = await startNycApi(net);
  city = await readCity(api);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

const sorted = (values: string[]) => [...values].sort();
const byId = <V extends { id: string }>(values: V[]) => [...values].sort((a, b) => (a.id < b.id ? -1 : 1));
const round5 = (value: number) => Math.round(value * 1e5) / 1e5;

const dashboardOf = async (employeeId: string): Promise<EmployeeDashboard> => {
  const res = await api.get<EmployeeDashboard>(`/employees/${employeeId}/dashboard`);
  expect(res.status).toBe(200);
  return res.body;
};

/**
 * What a commute save must leave behind (DECISIONS pass 46): one more version, every earlier plan as it
 * was, and every package that was unmatched either matched now (and listed in `rematched`) or still
 * unmatched with a reason. No package is lost and none is matched without being listed.
 */
function expectRetried(before: SimulatorResponse, after: SimulatorResponse, rematched: string[]): void {
  const wasUnmatched = before.unmatched.map((u) => u.shipmentId);
  expect(after.version).toBe(before.version + 1);
  expect(after.runId).toBe(before.runId);
  expect(after.clock).toStrictEqual(before.clock);
  expect(after.shipments).toStrictEqual(before.shipments);

  expect(new Set(rematched).size).toBe(rematched.length);
  for (const shipmentId of rematched) expect(wasUnmatched).toContain(shipmentId);
  expect(sorted(after.unmatched.map((u) => u.shipmentId))).toStrictEqual(sorted(wasUnmatched.filter((id) => !rematched.includes(id))));
  for (const u of after.unmatched) expect(u.reason.trim()).not.toBe('');

  for (const plan of before.plans) expect(after.plans).toContainEqual(plan);
  expect(sorted(after.plans.map((plan) => plan.shipmentId)))
    .toStrictEqual(sorted([...before.plans.map((plan) => plan.shipmentId), ...rematched]));
}

/** Saves `employee`'s commute with only the detour limit changed, and checks the save against the rules above. */
async function saveLimit(employee: Employee, maxExtraMin: number): Promise<CommuteResponse> {
  const before = await api.simulator();
  const mine = await dashboardOf(employee.id);
  const res = await api.put<CommuteResponse>(`/employees/${employee.id}/commute`, commuteOf(employee, { maxExtraMin }));
  expect(res.status).toBe(200);
  net.expectNoOutgoing(); // the home is cached, so the save asked Google for nothing

  expect(res.body.employee).toStrictEqual({ ...employee, maxExtraMin });
  // Same home, so the same two trips with the same Google numbers.
  expect(res.body.home).toStrictEqual(mine.home);
  expect(res.body.trips).toHaveLength(2);
  expect(byId(res.body.trips)).toStrictEqual(byId(mine.trips));

  expectRetried(before, await api.simulator(), res.body.rematchedShipmentIds);
  expect((await dashboardOf(employee.id)).employee.maxExtraMin).toBe(maxExtraMin);
  return res.body;
}

describe('MVP II commute save on the committed NYC cache, no key', () => {
  it('boot: the runtime is loaded and GET /simulator answers 200', async () => {
    expect(api.runtime.reason).toBeUndefined();
    expect(api.runtime.status).toBe('ready');
    const res = await api.get<SimulatorResponse>('/simulator');
    expect(res.status).toBe(200);
    expect(res.body.clock).toMatchObject({ phase: 'planning', playing: false });
    expect(net.installed()).toBe(true);
  }, T);

  it('a PUT that only lowers the detour limit (same home) answers 200 with no Google call and retries the unmatched packages', async () => {
    // Something to retry, whatever the story holds: a package that is ready in the run's last minute
    // can be carried by nobody.
    const late = await api.post<ShipmentResponse>('/shipments', {
      ...deliveryRequest('e2e-nyc-commute-late', pair.origin, pair.destination, city.settings),
      readyMin: city.settings.simEndMin - 1,
    });
    expect(late.status).toBe(201);
    expect(late.body).toMatchObject({ matched: false, plan: null, status: 'unmatched' });
    expect(late.body.unmatchedReason).toEqual(expect.any(String));

    const before = await api.simulator();
    expect(before.unmatched.map((u) => u.shipmentId)).toContain(late.body.shipment.id);

    // An employee who already carries a package, if there is one: the plan must survive the lower limit.
    const carriers = new Set(before.jobs.map((job) => job.employeeId));
    const lowerable = city.employees.filter((e) => e.maxExtraMin > 0);
    const employee = lowerable.find((e) => carriers.has(e.id)) ?? lowerable[0];
    expect(employee).toBeDefined();

    const saved = await saveLimit(employee, employee.maxExtraMin - 1);

    // The late package was retried and is still unmatched, with a reason. Its tracking view says the same.
    expect(saved.rematchedShipmentIds).not.toContain(late.body.shipment.id);
    const after = await api.simulator();
    const reason = after.unmatched.find((u) => u.shipmentId === late.body.shipment.id)?.reason;
    expect(reason).toEqual(expect.any(String));
    expect((await api.get<ShipmentResponse>(`/shipments/${late.body.shipment.id}`)).body)
      .toMatchObject({ matched: false, status: 'unmatched', unmatchedReason: reason });

    // The employee's jobs are the ones from before the save (existing plans are not re-planned).
    expect(after.jobs.filter((job) => job.employeeId === employee.id))
      .toStrictEqual(before.jobs.filter((job) => job.employeeId === employee.id));
    expect((await api.savedRun())?.scenario.employees.find((e) => e.id === employee.id)?.maxExtraMin).toBe(employee.maxExtraMin - 1);
  }, T);

  it('the lowered limit is the one the matcher uses, and a later save retries the request it kept out', async () => {
    // Every carrier of a request works at the sender (evening) or at the recipient (morning).
    // With all of them at a limit of 0 the pair that matched on the fresh run cannot match: the two
    // minutes of handling at each stop alone are more than 0.
    const staff = city.employees.filter((e) => e.businessId === pair.origin || e.businessId === pair.destination);
    expect(staff.some((e) => e.businessId === pair.origin) || staff.some((e) => e.businessId === pair.destination)).toBe(true);
    for (const employee of staff) await saveLimit(employee, 0);

    const request = deliveryRequest('e2e-nyc-commute-held', pair.origin, pair.destination, city.settings);
    const held = await api.post<ShipmentResponse>('/shipments', request);
    expect(held.status).toBe(201);
    expect(held.body).toMatchObject({ matched: false, plan: null, status: 'unmatched', jobIds: [] });
    expect(held.body.unmatchedReason).toEqual(expect.any(String));
    const heldId = held.body.shipment.id;

    // Back to the limits of the boot, one save at a time (same homes: still no Google call).
    // Each save retries what is unmatched, so one of them finds the plan.
    const rematched: string[] = [];
    for (const employee of staff) rematched.push(...(await saveLimit(employee, employee.maxExtraMin)).rematchedShipmentIds);
    expect(rematched.filter((id) => id === heldId)).toStrictEqual([heldId]);

    const tracking = await api.get<ShipmentResponse>(`/shipments/${heldId}`);
    expect(tracking.body).toMatchObject({ matched: true, status: 'scheduled', unmatchedReason: null });
    const plan = tracking.body.plan!;
    expect(tracking.body.jobIds).toHaveLength(plan.legs.length);
    for (const leg of plan.legs) {
      const carrier = staff.find((e) => e.id === leg.employeeId);
      expect(carrier).toBeDefined();
      expect(leg.extraMin).toBeLessThanOrEqual(carrier!.maxExtraMin);
      // The carrier sees the job without doing anything.
      expect((await dashboardOf(leg.employeeId)).assigned.map((view) => view.shipment.id)).toContain(heldId);
    }

    // The same request sent again now answers the arranged delivery.
    const replay = await api.post<ShipmentResponse>('/shipments', request);
    expect(replay.status).toBe(200);
    expect(replay.body).toStrictEqual(tracking.body);
  }, T);

  it('a PUT with a new address and no key answers the 503 the route defines, and the run is unchanged', async () => {
    const employee = city.employees[0];
    const mine = await dashboardOf(employee.id);
    // A made-up point about 250 m from the saved home. It is in no run and in no cache.
    const point = { lat: round5(mine.home.lat + 0.002), lng: round5(mine.home.lng + 0.002) };
    expectInNyc(point, 'The new home');

    const runBefore = await api.exportRun();
    const simBefore = await api.simulator();
    const fileBefore = await api.savedRun();
    expect(runBefore.scenario.homes.some((home) => home.lat === point.lat && home.lng === point.lng)).toBe(false);

    const res = await api.put<Record<string, unknown>>(
      `/employees/${employee.id}/commute`,
      commuteOf(mine.employee, { home: { ...point, neighborhood: mine.home.neighborhood } }),
    );
    expect(res.status).toBe(503);
    expect(res.body).toStrictEqual(travelErrorBody(new GoogleKeyMissingError()));
    expect(res.body.code).toBe('google_key_missing');
    net.expectNoOutgoing(); // refused before any request to Google

    // Same version, same everything: in memory, over HTTP and in the state file.
    const simAfter = await api.simulator();
    expect(simAfter.version).toBe(simBefore.version);
    expect(simAfter).toStrictEqual(simBefore);
    expect(await api.exportRun()).toStrictEqual(runBefore);
    expect(await api.savedRun()).toStrictEqual(fileBefore);
    expect(await dashboardOf(employee.id)).toStrictEqual(mine);

    // The refused point left nothing behind: the saved home still works, and so does the limit.
    const again = await api.put<CommuteResponse>(`/employees/${employee.id}/commute`, commuteOf(mine.employee));
    expect(again.status).toBe(200);
    expect(again.body.home).toStrictEqual(mine.home);
    expect((await api.simulator()).version).toBe(simBefore.version + 1);
  }, T);

  it('the repo\'s data/ folder and fixtures/nyc are untouched, and no call left the test server', async () => {
    expect((await api.savedRun())?.runId).toBe((await api.simulator()).runId); // saved, in the temp folder
    api.expectRepoFilesUntouched();
    expect(net.installed()).toBe(true);
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  }, T);
});
