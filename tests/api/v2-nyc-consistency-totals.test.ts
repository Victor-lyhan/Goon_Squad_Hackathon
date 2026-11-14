// #533, SPEC demo step 6: the money and the notifications of the three workspaces come from the same run.
// The real v2 server runs on the committed NYC cache with no key (v2-e2e-nyc-helper.ts). Playback is
// started and paused first, so the run is locked the way it is in the demo, and the clock is then moved
// with POST /simulator/control to the five moments of the day (v2-nyc-consistency-helper.ts).
// Totals are added up from the answers' own rows, in whole cents.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readCity, recordFetch, startNycApi, type City, type NycApi } from './v2-e2e-nyc-helper';
import {
  allNotifications, expectBusinessTotalsAddUp, expectDashboardsOfOneRun, expectEarningsAddUp,
  expectNotificationsNameDeliveries, expectRelayRoleVisible, jobRows, MOMENT_TITLE, momentMinutes, MOMENTS,
  moveClock, readWorkspaces, sorted, sum, T,
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
  // Demo step 5: Play locks the run. Paused at once; the clock is only moved by the seeks below.
  await api.control({ action: 'play' });
  const paused = await api.control({ action: 'pause' });
  expect(paused.clock).toMatchObject({ phase: 'locked', playing: false });
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

describe.each(MOMENTS.map((key) => [MOMENT_TITLE[key], key] as const))('totals and notifications in the three workspaces at %s', (_title, moment) => {
  let ws: Workspaces;

  beforeAll(async () => {
    await moveClock(api, minutes[moment]);
    ws = await readWorkspaces(api, city);
    seen.set(moment, ws);
  }, T);

  it('every business and every employee dashboard answers 200, for the locked run of the simulator', () => {
    expect(ws.timeMin).toBe(minutes[moment]);
    expect(ws.sim.clock.phase).toBe('locked');
    expectDashboardsOfOneRun(ws, city);
  }, T);

  it('each business dashboard\'s totals are a count of the rows it lists, and together they are the simulator\'s summary', () => {
    expectBusinessTotalsAddUp(ws, city.settings);
  }, T);

  it('each employee\'s earnings are the rewards of its own completed jobs, and together they are the simulator\'s earned rewards', () => {
    expectEarningsAddUp(ws);
  }, T);

  it('every notification names a delivery that exists, and everyone with a part in a plan has one', () => {
    expect(allNotifications(ws).length).toBeGreaterThan(0);
    expectNotificationsNameDeliveries(ws);
  }, T);

  it('a business that is the relay point of a plan can see that role in its dashboard', () => {
    // Not an empty rule: the default run has relay plans (the demo's second match kind).
    expect(expectRelayRoleVisible(ws)).toBeGreaterThan(0);
  }, T);
});

describe('money across the five moments', () => {
  const earned = (moment: MomentKey) => sum([...seen.get(moment)!.employee.values()].map((d) => d.earnedCents));
  const delivered = (moment: MomentKey) => sum([...seen.get(moment)!.business.values()].map((d) => d.totals.delivered));

  it('nothing is earned or delivered at the start, and everything projected is earned at the end', () => {
    expect(seen.size).toBe(MOMENTS.length);
    const start = seen.get('start')!;
    const end = seen.get('end')!;
    expect(earned('start')).toBe(0);
    expect(delivered('start')).toBe(0);
    for (const [id, dashboard] of end.employee) expect(dashboard.earnedCents, id).toBe(dashboard.projectedCents);
    for (const [id, dashboard] of end.business) expect(dashboard.totals.delivered, id).toBe(dashboard.totals.matched);
    expect(earned('end')).toBe(sum(start.sim.jobs.map((job) => job.rewardCents)));
    expect(earned('end')).toBeGreaterThan(0);
  }, T);

  it('earnings and delivered counts only ever grow with the clock, and both middles are part-way', () => {
    for (const id of city.employees.map((e) => e.id)) {
      const steps = MOMENTS.map((moment) => seen.get(moment)!.employee.get(id)!.earnedCents);
      expect(steps, `earned by ${id}`).toStrictEqual([...steps].sort((a, b) => a - b));
    }
    for (const id of city.businesses.map((b) => b.id)) {
      const steps = MOMENTS.map((moment) => seen.get(moment)!.business.get(id)!.totals.delivered);
      expect(steps, `delivered for ${id}`).toStrictEqual([...steps].sort((a, b) => a - b));
    }
    // The middles are chosen inside the day's work (momentMinutes), so some reward is paid and some is not.
    for (const moment of ['evening', 'morning'] as const) {
      expect(earned(moment), moment).toBeGreaterThan(0);
      expect(earned(moment), moment).toBeLessThan(earned('end'));
    }
  }, T);

  it('what does not depend on the clock is the same at all five: projected earnings, sent, matched, spend and the notifications', () => {
    const first = seen.get('start')!;
    for (const moment of MOMENTS) {
      const ws = seen.get(moment)!;
      for (const [id, dashboard] of ws.employee) {
        expect(dashboard.projectedCents, `${id} at ${moment}`).toBe(first.employee.get(id)!.projectedCents);
        expect(sorted(jobRows(dashboard).map((row) => row.job.id)), `${id} at ${moment}`)
          .toStrictEqual(sorted(jobRows(first.employee.get(id)!).map((row) => row.job.id)));
        expect(dashboard.notifications, `${id} at ${moment}`).toStrictEqual(first.employee.get(id)!.notifications);
      }
      for (const [id, dashboard] of ws.business) {
        const { delivered: _now, ...fixed } = dashboard.totals;
        const { delivered: _then, ...fixedFirst } = first.business.get(id)!.totals;
        expect(fixed, `${id} at ${moment}`).toStrictEqual(fixedFirst);
        expect(dashboard.notifications, `${id} at ${moment}`).toStrictEqual(first.business.get(id)!.notifications);
      }
    }
  }, T);

  // docs/relay-spec.md, test 6: "Rewinding and replaying produce the same statuses and earnings."
  it('rewinding from the end to the middle of the evening gives every workspace the answers it had then', async () => {
    const then = seen.get('evening')!;
    expect(seen.get('end')!.timeMin).toBeGreaterThan(then.timeMin);
    await moveClock(api, minutes.evening);
    const again = await readWorkspaces(api, city);

    // Only the version differs: a move of the clock is a state change (shared/v2/types.ts).
    const sameBut = <B extends { version: number }>(now: B, before: B, what: string) => {
      expect(now.version, what).toBeGreaterThan(before.version);
      expect({ ...now, version: 0 }, what).toStrictEqual({ ...before, version: 0 });
    };
    for (const [id, dashboard] of again.business) sameBut(dashboard, then.business.get(id)!, `business ${id}`);
    for (const [id, dashboard] of again.employee) sameBut(dashboard, then.employee.get(id)!, `employee ${id}`);
    for (const [id, view] of again.shipment) expect(view, `delivery ${id}`).toStrictEqual(then.shipment.get(id));
    for (const [id, view] of again.job) expect(view, `job ${id}`).toStrictEqual(then.job.get(id));
    const { snapshot, ...sim } = again.sim;
    const { snapshot: snapshotThen, ...simThen } = then.sim;
    sameBut(sim, simThen, 'simulator');
    sameBut(snapshot, snapshotThen, 'snapshot');

    expectEarningsAddUp(again);
    expectBusinessTotalsAddUp(again, city.settings);
  }, T);

  it('nothing left localhost and the repo\'s fixtures/nyc and data/ are untouched', () => {
    net.expectNoOutgoing();
    api.expectRepoFilesUntouched();
  }, T);
});
