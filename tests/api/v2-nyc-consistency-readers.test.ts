// #533, SPEC demo step 4 and must-have 10: two tabs stay in sync, with no reload.
// Two readers poll the real v2 server (committed NYC cache, no key): each has the simulator, the sender's
// and the recipient's Business page and the carriers' Employee pages open. A third client sends one live
// delivery request. On their next poll both readers must see the same `version` and the same new
// delivery, job and notification. Then a repeated request, a request with no match and a move of the
// clock: after each, both readers see the same answers again, and the three workspaces still agree.
//
// Which pages to open is read from the data: a second server (the scout) tries sender and recipient
// pairs until one matches, and the same request is then sent once to the server under test.
// Only rules are asserted. No story ID, name or count is pinned (DECISIONS pass 54).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ShipmentResponse, SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan } from '../../shared/v2/types';
import {
  deliveryRequest, findMatchingDelivery, readCity, recordFetch, startNycApi, type City, type NycApi,
} from './v2-e2e-nyc-helper';
import {
  expectBusinessTotalsAddUp, expectDashboardsOfOneRun, expectDeliveriesAgree, expectDeliveriesFollowPlans,
  expectEarningsAddUp, expectJobsAgree, expectMapFollowsStatus, expectNotificationsNameDeliveries,
  expectRelayRoleVisible, jobRows, moveClock, openReader, readWorkspaces, simulatorDelivery, sorted, sum, T, versionsOf, viewOf,
  type Poll, type Reader,
} from './v2-nyc-consistency-helper';

const net = recordFetch();
let api: NycApi;
let city: City;
/** The pair the scout found, and the plan it got there: the pages the readers open. */
let origin: string;
let destination: string;
let scouted: DeliveryPlan;
let readerA: Reader;
let readerB: Reader;
/** The answer to the one live request. */
let created: ShipmentResponse;

const REQUEST_ID = 'consistency-live-request';

beforeAll(async () => {
  // The scout: its own server and state, closed before the server under test starts.
  const scout = await startNycApi(net);
  try {
    expect(scout.runtime.status).toBe('ready');
    const found = await findMatchingDelivery(scout, await readCity(scout), 'consistency-scout');
    ({ origin, destination } = found);
    scouted = found.delivery.plan as DeliveryPlan;
  } finally {
    await scout.close();
  }

  api = await startNycApi(net);
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
  const pages = {
    businessIds: [origin, destination, ...(scouted.relayBusinessId === undefined ? [] : [scouted.relayBusinessId])],
    employeeIds: scouted.legs.map((leg) => leg.employeeId),
  };
  readerA = openReader(api, pages);
  readerB = openReader(api, pages);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

/** Both readers poll at the same time, like two tabs on their 1 s timer. */
const pollBoth = (): Promise<[Poll, Poll]> => Promise.all([readerA.poll(), readerB.poll()]);

/** The two polls are the same answers, and every answer in them is of one version. */
function expectSamePoll(a: Poll, b: Poll): void {
  expect(new Set(versionsOf(a)).size, `reader A saw versions ${versionsOf(a).join(' ')}`).toBe(1);
  expect(new Set(versionsOf(b)).size, `reader B saw versions ${versionsOf(b).join(' ')}`).toBe(1);
  expect(b.sim.version).toBe(a.sim.version);
  expect(b).toStrictEqual(a);
}

/** Every rule of the other two files, on everything the workspaces show now. */
async function expectWorkspacesAgree(): Promise<void> {
  const ws = await readWorkspaces(api, city);
  expectDashboardsOfOneRun(ws, city);
  expectDeliveriesAgree(ws);
  expectDeliveriesFollowPlans(ws, city);
  expectMapFollowsStatus(ws, city);
  expectJobsAgree(ws);
  expectBusinessTotalsAddUp(ws, city.settings);
  expectEarningsAddUp(ws);
  expectNotificationsNameDeliveries(ws);
  expectRelayRoleVisible(ws);
}

const noteIds = (dashboard: { notifications: { id: string }[] }) => dashboard.notifications.map((note) => note.id);

/**
 * The `createdSeq` of the delivery of each plan and of each job, in the order the simulator lists them.
 * DECISIONS pass 4: "Result plans are ordered by shipment `createdSeq`", and jobs are made plan by plan.
 */
function creationOrder(sim: SimulatorResponse): { plans: number[]; jobs: number[] } {
  const seq = new Map(sim.shipments.map((s) => [s.id, s.createdSeq]));
  return {
    plans: sim.plans.map((plan) => seq.get(plan.shipmentId) ?? NaN),
    jobs: sim.jobs.map((job) => seq.get(job.shipmentId) ?? NaN),
  };
}
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

describe('two readers and one live delivery request, on the default NYC run', () => {
  it('before the request both readers see the same run', async () => {
    const [a, b] = await pollBoth();
    expectSamePoll(a, b);
    expect(a.sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    // The default run lists its plans and jobs in the order the deliveries were created.
    const order = creationOrder(a.sim);
    expect(order.plans).toStrictEqual(ascending(order.plans));
    expect(order.jobs).toStrictEqual(ascending(order.jobs));
  }, T);

  it('the one live request is stored and matched, with the carriers the scout was given', async () => {
    const res = await api.post<ShipmentResponse>('/shipments', deliveryRequest(REQUEST_ID, origin, destination, city.settings));
    expect(res.status).toBe(201);
    created = res.body;
    expect(created.matched).toBe(true);
    // Same inputs, same assignment (AGENTS.md): the pages the readers have open are the right ones.
    const plan = created.plan as DeliveryPlan;
    expect(plan.legs.map((leg) => leg.employeeId)).toStrictEqual(scouted.legs.map((leg) => leg.employeeId));
    expect(plan.relayBusinessId).toBe(scouted.relayBusinessId);
    expect(created.jobIds).toHaveLength(plan.legs.length);
  }, T);

  it('on their next poll both readers see the same new version, with no reload', async () => {
    const [a, b] = await pollBoth();
    expectSamePoll(a, b);
    const before = readerA.previous();
    expect(a.sim.version).toBeGreaterThan(before.sim.version);
    // The same run: nothing tells a page to load anything again (the map is refetched per runId only).
    expect(a.sim.runId).toBe(before.sim.runId);
    expect(a.sim.clock).toStrictEqual(before.sim.clock);
    // The pages opened before the request already hold everyone the new delivery names.
    const plan = created.plan as DeliveryPlan;
    for (const leg of plan.legs) expect(Object.keys(a.employee)).toContain(leg.employeeId);
    for (const id of [created.shipment.originBusinessId, created.shipment.destinationBusinessId]) expect(Object.keys(a.business)).toContain(id);
    for (const leg of plan.legs) expect(city.employee.has(leg.employeeId)).toBe(true);
  }, T);

  it('both readers see the same new delivery: in the simulator, the sender\'s outgoing list and the recipient\'s incoming list', () => {
    const id = created.shipment.id;
    const expected = viewOf(created);
    for (const reader of [readerA, readerB]) {
      const now = reader.polls.at(-1)!;
      const before = reader.previous();
      // New: not in the poll before the request, and the only delivery that was added.
      expect(before.sim.shipments.map((s) => s.id)).not.toContain(id);
      expect(sorted(now.sim.shipments.map((s) => s.id))).toStrictEqual(sorted([...before.sim.shipments.map((s) => s.id), id]));
      // Every delivery that was there keeps its plan (DECISIONS pass 4: existing plans are never re-planned).
      for (const plan of before.sim.plans) expect(now.sim.plans).toContainEqual(plan);

      expect(simulatorDelivery(now.sim, id)).toStrictEqual(expected);
      const outgoing = now.business[origin].outgoing.filter((row) => row.shipment.id === id);
      const incoming = now.business[destination].incoming.filter((row) => row.shipment.id === id);
      expect(outgoing).toStrictEqual([expected]);
      expect(incoming).toStrictEqual([expected]);
      expect(expected.status).toBe('scheduled');

      // The sender's totals moved by this one delivery, in whole cents.
      const totals = now.business[origin].totals;
      const totalsBefore = before.business[origin].totals;
      expect(totals).toStrictEqual({
        sent: totalsBefore.sent + 1,
        matched: totalsBefore.matched + 1,
        delivered: totalsBefore.delivered,
        spendCents: totalsBefore.spendCents + (created.plan as DeliveryPlan).customerPriceCents,
      });
    }
  }, T);

  it('both readers see the same new job in each carrier\'s dashboard, with its reward in the projected earnings', () => {
    const plan = created.plan as DeliveryPlan;
    for (const reader of [readerA, readerB]) {
      const now = reader.polls.at(-1)!;
      const before = reader.previous();
      expect(sorted(now.sim.jobs.map((j) => j.id))).toStrictEqual(sorted([...before.sim.jobs.map((j) => j.id), ...created.jobIds]));

      plan.legs.forEach((leg, legIndex) => {
        const jobId = created.jobIds[legIndex];
        expect(before.sim.jobs.map((j) => j.id)).not.toContain(jobId);
        const job = now.sim.jobs.find((j) => j.id === jobId);
        expect(job).toMatchObject({ employeeId: leg.employeeId, shipmentId: created.shipment.id, legIndex, rewardCents: leg.rewardCents });

        const dashboard = now.employee[leg.employeeId];
        const dashboardBefore = before.employee[leg.employeeId];
        expect(jobRows(dashboardBefore).map((row) => row.job.id)).not.toContain(jobId);
        const rows = dashboard.assigned.filter((row) => row.job.id === jobId);
        // `stopsDone: 0` (#781): the new job's commute has not handled a stop yet.
        // `departed: false` (#791): the clock stands at the start of the run, before any commute leaves.
        // `arrived: false` (#836): and so before any commute arrives.
        expect(rows).toStrictEqual([{ job, status: 'assigned', shipment: created.shipment, plan, stopsDone: 0, departed: false, arrived: false }]);
        // One carrier can hold both legs' worth of new jobs only if it is on both legs; count all of them.
        const newRewards = sum(plan.legs.filter((l) => l.employeeId === leg.employeeId).map((l) => l.rewardCents));
        expect(dashboard.projectedCents).toBe(dashboardBefore.projectedCents + newRewards);
        expect(dashboard.earnedCents).toBe(dashboardBefore.earnedCents);
      });
    }
  }, T);

  it('both readers see the same new notification: the sender, the recipient, each carrier and the relay business', () => {
    const plan = created.plan as DeliveryPlan;
    for (const reader of [readerA, readerB]) {
      const now = reader.polls.at(-1)!;
      const before = reader.previous();

      const businesses = [origin, destination, ...(plan.relayBusinessId === undefined ? [] : [plan.relayBusinessId])];
      for (const id of businesses) {
        const old = new Set(noteIds(before.business[id]));
        const added = now.business[id].notifications.filter((note) => !old.has(note.id));
        expect(added, `new notifications of ${id}`).toHaveLength(1);
        expect(added[0]).toMatchObject({ audience: 'business', audienceId: id, shipmentId: created.shipment.id, planId: plan.id });
        expect(added[0].message).toContain(created.shipment.label);
        // Newest first: the page shows it at the top with no sorting of its own.
        expect(now.business[id].notifications[0]).toStrictEqual(added[0]);
        // Nothing that was there is gone or changed.
        expect(now.business[id].notifications.filter((note) => old.has(note.id))).toStrictEqual(before.business[id].notifications);
      }

      for (const employeeId of new Set(plan.legs.map((leg) => leg.employeeId))) {
        const old = new Set(noteIds(before.employee[employeeId]));
        const added = now.employee[employeeId].notifications.filter((note) => !old.has(note.id));
        const jobIds = created.jobIds.filter((_, legIndex) => plan.legs[legIndex].employeeId === employeeId);
        expect(sorted(added.map((note) => note.jobId ?? '')), `new notifications of ${employeeId}`).toStrictEqual(sorted(jobIds));
        for (const note of added) {
          expect(note).toMatchObject({ audience: 'employee', audienceId: employeeId, shipmentId: created.shipment.id, planId: plan.id });
          expect(note.message).toContain(created.shipment.label);
        }
        expect(now.employee[employeeId].notifications.filter((note) => old.has(note.id))).toStrictEqual(before.employee[employeeId].notifications);
      }
    }
  }, T);

  // DECISIONS pass 4, "Result plans are ordered by shipment `createdSeq`": the new plan goes last and every
  // older plan stays where it was. Jobs are made plan by plan, and the export is the same run.
  it('after a live request the simulator still lists plans and jobs in the order their deliveries were created', async () => {
    const sim = await api.simulator();
    const order = creationOrder(sim);
    expect(order.plans).toStrictEqual(ascending(order.plans));
    expect(order.jobs).toStrictEqual(ascending(order.jobs));
    // The new delivery is in the lists that were just checked.
    expect(sim.plans.map((plan) => plan.shipmentId)).toContain(created.shipment.id);
    expect(sim.jobs.map((job) => job.id)).toStrictEqual(expect.arrayContaining(created.jobIds));

    // GET /scenario/export: the same plans and jobs, in the same order.
    const exported = await api.exportRun();
    expect(exported.assignments.plans.map((plan) => plan.id)).toStrictEqual(sim.plans.map((plan) => plan.id));
    expect(exported.jobs.map((job) => job.id)).toStrictEqual(sim.jobs.map((job) => job.id));
  }, T);

  it('after the live request the three workspaces agree on every delivery, job, total and notification', async () => {
    await expectWorkspacesAgree();
  }, T);

  it('the same request sent again changes nothing: both readers poll the answers they already had', async () => {
    const res = await api.post<ShipmentResponse>('/shipments', deliveryRequest(REQUEST_ID, origin, destination, city.settings));
    expect(res.status).toBe(200);
    expect(res.body).toStrictEqual(created);
    const [a, b] = await pollBoth();
    expectSamePoll(a, b);
    expect(a).toStrictEqual(readerA.previous());
    expect(b).toStrictEqual(readerB.previous());
  }, T);

  it('a request that cannot match shows as unmatched to both readers, with no job, no notification and no spend', async () => {
    // Ready one minute before the run ends: no pickup and drop-off (2 minutes of handling each) fits.
    const { simEndMin } = city.settings;
    const res = await api.post<ShipmentResponse>('/shipments', {
      ...deliveryRequest('consistency-no-match', origin, destination, city.settings), readyMin: simEndMin - 1, deadlineMin: simEndMin,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ matched: false, plan: null, jobIds: [], status: 'unmatched', deliveredAtMin: null });
    expect(res.body.unmatchedReason?.trim()).toBeTruthy();
    const id = res.body.shipment.id;

    const [a, b] = await pollBoth();
    expectSamePoll(a, b);
    const before = readerA.previous();
    expect(a.sim.version).toBeGreaterThan(before.sim.version);
    expect(a.sim.runId).toBe(before.sim.runId);

    const expected = viewOf(res.body);
    expect(simulatorDelivery(a.sim, id)).toStrictEqual(expected);
    expect(a.sim.unmatched.filter((u) => u.shipmentId === id)).toStrictEqual([{ shipmentId: id, reason: res.body.unmatchedReason }]);
    expect(a.business[origin].outgoing.filter((row) => row.shipment.id === id)).toStrictEqual([expected]);
    expect(a.business[destination].incoming.filter((row) => row.shipment.id === id)).toStrictEqual([expected]);

    // Sent, not matched, nothing to pay; no job and no notification for anyone.
    const totalsBefore = before.business[origin].totals;
    expect(a.business[origin].totals).toStrictEqual({ ...totalsBefore, sent: totalsBefore.sent + 1 });
    // The same plans and jobs in the same order: a request with no match moves nothing.
    expect(a.sim.jobs).toStrictEqual(before.sim.jobs);
    expect(a.sim.plans).toStrictEqual(before.sim.plans);
    const order = creationOrder(a.sim);
    expect(order.plans).toStrictEqual(ascending(order.plans));
    expect(order.jobs).toStrictEqual(ascending(order.jobs));
    const exported = await api.exportRun();
    expect(exported.assignments.plans).toStrictEqual(a.sim.plans);
    expect(exported.jobs).toStrictEqual(a.sim.jobs);
    for (const businessId of Object.keys(a.business)) expect(a.business[businessId].notifications).toStrictEqual(before.business[businessId].notifications);
    for (const employeeId of Object.keys(a.employee)) {
      expect({ ...a.employee[employeeId], version: 0 }).toStrictEqual({ ...before.employee[employeeId], version: 0 });
    }

    await expectWorkspacesAgree();
  }, T);

  it('when the clock reaches the new delivery\'s last stop, both readers see it delivered and its rewards earned', async () => {
    const plan = created.plan as DeliveryPlan;
    await moveClock(api, plan.deliveryMin);
    const [a, b] = await pollBoth();
    expectSamePoll(a, b);
    const before = readerA.previous();
    expect(a.sim.version).toBeGreaterThan(before.sim.version);
    expect(a.sim.runId).toBe(before.sim.runId);

    const id = created.shipment.id;
    const expected = { ...viewOf(created), status: 'delivered', deliveredAtMin: plan.deliveryMin };
    expect(simulatorDelivery(a.sim, id)).toStrictEqual(expected);
    expect(a.business[origin].outgoing.filter((row) => row.shipment.id === id)).toStrictEqual([expected]);
    expect(a.business[destination].incoming.filter((row) => row.shipment.id === id)).toStrictEqual([expected]);
    expect(a.business[origin].totals.delivered).toBeGreaterThan(before.business[origin].totals.delivered);

    for (const employeeId of new Set(plan.legs.map((leg) => leg.employeeId))) {
      const dashboard = a.employee[employeeId];
      const jobIds = created.jobIds.filter((_, legIndex) => plan.legs[legIndex].employeeId === employeeId);
      for (const jobId of jobIds) {
        expect(dashboard.completed.map((row) => row.job.id), `${jobId} is completed`).toContain(jobId);
        expect(dashboard.assigned.map((row) => row.job.id)).not.toContain(jobId);
      }
      // Earned: the rewards of the completed rows, and so at least this delivery's.
      expect(dashboard.earnedCents).toBe(sum(dashboard.completed.map((row) => row.job.rewardCents)));
      expect(dashboard.earnedCents).toBeGreaterThanOrEqual(sum(plan.legs.filter((leg) => leg.employeeId === employeeId).map((leg) => leg.rewardCents)));
      expect(dashboard.earnedCents).toBeGreaterThan(before.employee[employeeId].earnedCents);
      // The notifications did not change with the clock.
      expect(dashboard.notifications).toStrictEqual(before.employee[employeeId].notifications);
    }

    await expectWorkspacesAgree();
  }, T);

  it('nothing left localhost and the repo\'s fixtures/nyc and data/ are untouched', () => {
    net.expectNoOutgoing();
    api.expectRepoFilesUntouched();
  }, T);
});
