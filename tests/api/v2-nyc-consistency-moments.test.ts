// #533, SPEC demo step 6: the three workspaces tell the same story of every delivery and of every job.
// The real v2 server runs on the committed NYC cache with no key (v2-e2e-nyc-helper.ts). The clock is
// moved with POST /simulator/control to five moments of the day; at each one every answer a workspace
// shows is read over HTTP and compared with the others (v2-nyc-consistency-helper.ts).
// The run stays in the planning phase here (a seek does not lock it); the totals file locks it first.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ShipmentProgress } from '../../shared/v2/types';
import { DAY_2_MIN, readCity, recordFetch, startNycApi, stopsOf, type City, type NycApi } from './v2-e2e-nyc-helper';
import {
  expectDashboardsOfOneRun, expectDeliveriesAgree, expectDeliveriesFollowPlans, expectJobsAgree, expectMapFollowsStatus,
  MOMENT_TITLE, momentMinutes, MOMENTS, moveClock, readWorkspaces, T,
  type MomentKey, type Workspaces,
} from './v2-nyc-consistency-helper';

const net = recordFetch();
let api: NycApi;
let city: City;
let minutes: Record<MomentKey, number>;
/** What was read at each moment, kept for the tests that compare moments. */
const seen = new Map<MomentKey, Workspaces>();

beforeAll(async () => {
  api = await startNycApi(net);
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
  minutes = momentMinutes(await api.simulator(), city.settings);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

describe('the five moments of the day, on the default NYC run', () => {
  it('are the start (930), a minute inside the Day 1 evening, 1440, a minute inside the Day 2 morning and the end (2160)', async () => {
    const sim = await api.simulator();
    // SPEC M3: the clock runs 930 -> 2160. These two are the clock's limits, not story data.
    expect(minutes.start).toBe(930);
    expect(minutes.end).toBe(2160);
    expect(minutes.day2).toBe(DAY_2_MIN);
    expect(minutes.evening).toBeGreaterThan(minutes.start);
    expect(minutes.evening).toBeLessThan(minutes.day2);
    expect(minutes.morning).toBeGreaterThan(minutes.day2);
    expect(minutes.morning).toBeLessThan(minutes.end);
    for (const t of Object.values(minutes)) expect(Number.isInteger(t)).toBe(true);

    // The two middles are inside the day's work: the run has stops on both days, at least one of each
    // half is over at its middle, and the last one of each half is not.
    const stopEnds = sim.plans.flatMap((plan) => stopsOf(plan).map((stop) => stop.serviceEndMin));
    const day1 = stopEnds.filter((t) => t < DAY_2_MIN);
    const day2 = stopEnds.filter((t) => t >= DAY_2_MIN);
    expect(day1.length).toBeGreaterThan(0);
    expect(day2.length).toBeGreaterThan(0);
    expect(Math.min(...day1)).toBeLessThanOrEqual(minutes.evening);
    expect(Math.max(...day1)).toBeGreaterThan(minutes.evening);
    expect(Math.min(...day2)).toBeLessThanOrEqual(minutes.morning);
    expect(Math.max(...day2)).toBeGreaterThan(minutes.morning);
  }, T);
});

describe.each(MOMENTS.map((key) => [MOMENT_TITLE[key], key] as const))('deliveries and jobs in the three workspaces at %s', (_title, moment) => {
  let ws: Workspaces;

  beforeAll(async () => {
    const before = await api.simulator();
    const moved = await moveClock(api, minutes[moment]);
    // Moving the clock changes the time and nothing else: the same run, plans, jobs and deliveries.
    expect(moved.runId).toBe(before.runId);
    expect(moved.plans).toStrictEqual(before.plans);
    expect(moved.jobs).toStrictEqual(before.jobs);
    expect(moved.shipments).toStrictEqual(before.shipments);
    expect(moved.unmatched).toStrictEqual(before.unmatched);
    ws = await readWorkspaces(api, city);
    seen.set(moment, ws);
  }, T);

  it('every dashboard answers 200 at the simulator\'s version and phase', () => {
    expect(ws.timeMin).toBe(minutes[moment]);
    expectDashboardsOfOneRun(ws, city);
  }, T);

  it('every delivery is the same in the simulator, the sender\'s dashboard, the recipient\'s dashboard and GET /shipments/:id', () => {
    expectDeliveriesAgree(ws);
  }, T);

  it('every delivery\'s status, delivery time, carriers and relay business follow from its own plan', () => {
    expectDeliveriesFollowPlans(ws, city);
  }, T);

  it('the simulator\'s map shows every package where its status says: at a business, or with the carrier of its leg', () => {
    expectMapFollowsStatus(ws, city);
  }, T);

  it('every job is the same in the simulator, the employee\'s dashboard and GET /jobs/:id: stops, times and reward', () => {
    expect(ws.sim.jobs.length).toBeGreaterThan(0);
    expectJobsAgree(ws);
  }, T);
});

describe('across the five moments', () => {
  const statusesAt = (moment: MomentKey): ShipmentProgress[] => {
    const ws = seen.get(moment)!;
    return ws.sim.plans.map((plan) => ws.shipment.get(plan.shipmentId)!.status);
  };

  it('every matched delivery is scheduled at the start and delivered at the end, in every workspace', () => {
    expect(seen.size).toBe(MOMENTS.length);
    expect(seen.get('start')!.sim.plans.length).toBeGreaterThan(0);
    expect(new Set(statusesAt('start'))).toStrictEqual(new Set(['scheduled']));
    expect(new Set(statusesAt('end'))).toStrictEqual(new Set(['delivered']));
    for (const dashboard of seen.get('end')!.employee.values()) expect(dashboard.assigned).toStrictEqual([]);
    for (const dashboard of seen.get('start')!.employee.values()) expect(dashboard.completed).toStrictEqual([]);
  }, T);

  it('the two middles are real work in progress: some delivery has moved and some is still to be delivered', () => {
    for (const moment of ['evening', 'morning'] as const) {
      const statuses = statusesAt(moment);
      expect(statuses.some((status) => status !== 'scheduled'), `${moment}: something has moved`).toBe(true);
      expect(statuses.some((status) => status !== 'delivered'), `${moment}: something is still open`).toBe(true);
    }
  }, T);

  it('a delivery never goes backwards from one moment to the next', () => {
    const order: ShipmentProgress[] = ['scheduled', 'picked_up', 'at_hub', 'out_for_delivery', 'delivered'];
    for (const plan of seen.get('start')!.sim.plans) {
      const steps = MOMENTS.map((moment) => order.indexOf(seen.get(moment)!.shipment.get(plan.shipmentId)!.status));
      expect(steps.every((step) => step >= 0), `${plan.shipmentId}: ${steps.join(' ')}`).toBe(true);
      expect(steps, plan.shipmentId).toStrictEqual([...steps].sort((a, b) => a - b));
    }
  }, T);

  it('the run, its plans, jobs and deliveries are the same at all five: only the clock moved', () => {
    const first = seen.get('start')!;
    for (const moment of MOMENTS) {
      const ws = seen.get(moment)!;
      expect(ws.sim.runId).toBe(first.sim.runId);
      expect(ws.sim.plans).toStrictEqual(first.sim.plans);
      expect(ws.sim.jobs).toStrictEqual(first.sim.jobs);
      expect(ws.sim.shipments).toStrictEqual(first.sim.shipments);
    }
  }, T);

  it('nothing left localhost and the repo\'s fixtures/nyc and data/ are untouched', () => {
    net.expectNoOutgoing();
    api.expectRepoFilesUntouched();
  }, T);
});
