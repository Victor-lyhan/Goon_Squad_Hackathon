// SPEC M8: the full demo flow ("The 2-minute demo", steps 1 to 6) over HTTP on the committed NYC cache.
// The server is started the way server/index.ts starts it, on the real fixtures/nyc with no Google key
// (v2-e2e-nyc-helper.ts). `globalThis.fetch` is a recorder for the whole file: a call that is not to the
// test server fails the test that made it.
// The tests run in order on one server; each continues from the state the one before left.
// Only rules are asserted. No story ID or count is pinned (DECISIONS pass 54), except the one line the
// issue asks for: the default run has at least one direct and one relay plan.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type {
  BusinessDashboard, EmployeeDashboard, JobResponse, ShipmentResponse, SimulatorResponse,
} from '../../shared/v2/api';
import type { DeliveryPlan, Leg } from '../../shared/v2/types';
import {
  businessAt, DAY_2_MIN, deliveryRequest, expectInNyc, expectPositionsInNyc, expectStatusesFromPlans,
  findMatchingDelivery, readCity, recordFetch, startNycApi, stopsOf, T,
  type City, type NycApi,
} from './v2-e2e-nyc-helper';

const net = recordFetch();
let api: NycApi;
let city: City;
/** The delivery created in steps 2 and 3. */
let created: ShipmentResponse;
/** The run after the delivery was created: the plans every later step follows. */
let planned: SimulatorResponse;

beforeAll(async () => {
  api = await startNycApi(net);
  if (api.runtime.status === 'ready') city = await readCity(api);
}, T);
afterEach(() => net.expectNoOutgoing());
afterAll(async () => {
  await api?.close();
  net.restore();
}, T);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const sorted = (values: string[]) => [...values].sort();
const relayPlans = (sim: SimulatorResponse) => sim.plans.filter((plan) => plan.kind === 'relay');

/**
 * Step 3's card for a matched delivery: shipment ID, ETA, price, carriers and, for a relay, the relay
 * business. Every stop is at a network business with a name, in the order the plan kind defines.
 */
function expectArranged(view: ShipmentResponse): void {
  const { shipment } = view;
  const plan = view.plan as DeliveryPlan;
  expect(view.matched).toBe(true);
  expect(plan).not.toBeNull();
  expect(shipment.id).toEqual(expect.any(String));
  expect(shipment.id).not.toBe('');
  expect(plan.shipmentId).toBe(shipment.id);
  expect(view.unmatchedReason).toBeNull();

  // ETA: after the package is ready, by the deadline, and the moment the last stop ends.
  expect(Number.isInteger(plan.deliveryMin)).toBe(true);
  expect(plan.deliveryMin).toBeGreaterThan(shipment.readyMin);
  expect(plan.deliveryMin).toBeLessThanOrEqual(shipment.deadlineMin);
  expect(plan.deliveryMin).toBe(stopsOf(plan).at(-1)!.serviceEndMin);

  // Price: whole cents, and the price list's amount.
  expect(Number.isInteger(plan.customerPriceCents)).toBe(true);
  expect(plan.customerPriceCents).toBe(city.settings.priceCents);

  // Carriers: one known employee per leg, one job per leg, each with a reward.
  expect(plan.legs).toHaveLength(plan.kind === 'relay' ? 2 : 1);
  expect(view.jobIds).toHaveLength(plan.legs.length);
  for (const leg of plan.legs) {
    expect(city.employee.get(leg.employeeId)?.name.trim()).toBeTruthy();
    expect(leg.rewardCents).toBeGreaterThan(0);
    expect(leg.extraMin).toBeLessThanOrEqual(city.employee.get(leg.employeeId)!.maxExtraMin);
  }

  const origin = businessAt(city, shipment.originBusinessId);
  const destination = businessAt(city, shipment.destinationBusinessId);
  const stopPlaces = plan.legs.map((leg) => leg.stops.map((stop) => `${stop.kind} ${businessAt(city, stop.placeId).id}`));
  if (plan.kind === 'relay') {
    // The relay point is a third network business, known by name.
    const relay = businessAt(city, plan.relayBusinessId as string);
    expect([origin.id, destination.id]).not.toContain(relay.id);
    expect(plan.legs[0].employeeId).not.toBe(plan.legs[1].employeeId);
    expect(stopPlaces).toStrictEqual([
      [`pickup ${origin.id}`, `hub_drop ${relay.id}`],
      [`hub_pickup ${relay.id}`, `delivery ${destination.id}`],
    ]);
  } else {
    expect(plan.relayBusinessId).toBeUndefined();
    expect(stopPlaces).toStrictEqual([[`pickup ${origin.id}`, `delivery ${destination.id}`]]);
  }
}

describe('MVP II demo flow on the committed NYC cache, no key', () => {
  it('boot: the runtime is loaded from fixtures/nyc and writes no state file', () => {
    expect(api.runtime.reason).toBeUndefined();
    expect(api.runtime.status).toBe('ready');
    expect(api.runtime.deps.travel).not.toBeNull();
    expect(api.runtime.deps.store).not.toBeNull();
    expect(fs.existsSync(api.statePath)).toBe(false);
    expect(net.installed()).toBe(true);
  }, T);

  it('boot: GET /simulator answers 200, not 503, with the default run paused in planning', async () => {
    const res = await api.get<SimulatorResponse>('/simulator');
    expect(res.status).toBe(200);
    const sim = res.body;
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    expect(sim.shipments.length).toBeGreaterThan(0);
    expect(sim.plans.length + sim.unmatched.length).toBe(sim.shipments.length);
    for (const u of sim.unmatched) expect(u.reason.trim()).not.toBe('');
    expectStatusesFromPlans(sim);
    expectPositionsInNyc(sim);
    for (const business of city.businesses) expectInNyc(business, business.name);
  }, T);

  // The one count the issue asks for. If this fails, the demo has nothing to show for one of its two
  // match kinds: say so in the PR, it blocks the demo.
  it('boot: the default run has at least one direct and one relay plan', async () => {
    const sim = await api.simulator();
    expect(sim.plans.filter((plan) => plan.kind === 'direct').length).toBeGreaterThanOrEqual(1);
    expect(relayPlans(sim).length).toBeGreaterThanOrEqual(1);
  }, T);

  it('boot: every matched package of the default run is a complete arranged delivery', async () => {
    const sim = await api.simulator();
    for (const plan of sim.plans) {
      const res = await api.get<ShipmentResponse>(`/shipments/${plan.shipmentId}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduled');
      expectArranged(res.body);
    }
  }, T);

  it('step 1: an employee shows a saved commute with its two trips', async () => {
    expect(city.employees.length).toBeGreaterThan(0);
    const version = (await api.simulator()).version;
    for (const employee of city.employees) {
      const res = await api.get<EmployeeDashboard>(`/employees/${employee.id}/dashboard`);
      expect(res.status).toBe(200);
      const { home, trips } = res.body;
      expect(res.body.employee).toStrictEqual(employee);
      expect(res.body.version).toBe(version);
      expect(employee.name.trim()).not.toBe('');
      const work = businessAt(city, employee.businessId);

      // The home is a point in a named neighborhood, never the workplace.
      expect(home.id).toBe(employee.homeId);
      expect(home.neighborhood.trim()).not.toBe('');
      expectInNyc(home, `The home of ${employee.id}`);
      expect(city.business.has(home.id)).toBe(false);

      // Evening: work to home on Day 1. Morning: home to work on Day 2. Times and distances are Google's.
      expect(trips).toHaveLength(2);
      const evening = trips.find((trip) => trip.direction === 'evening')!;
      const morning = trips.find((trip) => trip.direction === 'morning')!;
      expect(evening).toMatchObject({
        employeeId: employee.id, originPlaceId: work.id, destinationPlaceId: home.id, departureMin: employee.eveningDepartureMin,
      });
      expect(morning).toMatchObject({
        employeeId: employee.id, originPlaceId: home.id, destinationPlaceId: work.id, departureMin: employee.morningDepartureMin,
      });
      expect(evening.departureMin).toBeLessThan(DAY_2_MIN);
      expect(morning.departureMin).toBeGreaterThanOrEqual(DAY_2_MIN);
      for (const trip of trips) {
        expect(Number.isInteger(trip.baselineDurationMin)).toBe(true);
        expect(trip.baselineDurationMin).toBeGreaterThan(0);
        expect(trip.baselineDistanceM).toBeGreaterThan(0);
      }
      expect(Number.isInteger(employee.maxExtraMin)).toBe(true);
    }
  }, T);

  it('steps 2 and 3: a delivery request found from the data answers a Delivery arranged card', async () => {
    const before = await api.simulator();
    const found = await findMatchingDelivery(api, city, 'e2e-nyc-flow');
    created = found.delivery;

    expect(created.status).toBe('scheduled');
    expect(created.deliveredAtMin).toBeNull();
    expect(created.shipment.originBusinessId).toBe(found.origin);
    expect(created.shipment.destinationBusinessId).toBe(found.destination);
    expect(before.shipments.map((s) => s.id)).not.toContain(created.shipment.id);
    expectArranged(created);

    // Every try stored one request, so `version` went up once per try. Earlier plans are as they were.
    planned = await api.simulator();
    expect(planned.version).toBe(before.version + found.tries);
    expect(planned.shipments).toHaveLength(before.shipments.length + found.tries);
    expect(planned.plans).toHaveLength(before.plans.length + 1);
    for (const plan of before.plans) expect(planned.plans).toContainEqual(plan);
    expect(planned.plans).toContainEqual(created.plan);
    expect(planned.clock).toStrictEqual(before.clock);

    // The sender sees it arranged, the recipient sees it coming, both told with business names.
    const sender = (await api.get<BusinessDashboard>(`/businesses/${found.origin}/dashboard`)).body;
    const recipient = (await api.get<BusinessDashboard>(`/businesses/${found.destination}/dashboard`)).body;
    expect(sender.outgoing.find((view) => view.shipment.id === created.shipment.id)).toMatchObject({ status: 'scheduled', plan: created.plan });
    expect(recipient.incoming.find((view) => view.shipment.id === created.shipment.id)).toMatchObject({ status: 'scheduled', plan: created.plan });
    const toSender = sender.notifications.filter((n) => n.shipmentId === created.shipment.id);
    const toRecipient = recipient.notifications.filter((n) => n.shipmentId === created.shipment.id);
    expect(toSender).toHaveLength(1);
    expect(toRecipient).toHaveLength(1);
    expect(toSender[0].message).toContain(businessAt(city, found.destination).name);
    expect(toRecipient[0].message).toContain(businessAt(city, found.origin).name);
    if (created.plan!.kind === 'relay') {
      const relayName = businessAt(city, created.plan!.relayBusinessId as string).name;
      expect(toSender[0].message).toContain(relayName);
      expect(toRecipient[0].message).toContain(relayName);
    }

    // The same request again is the same delivery, and stores nothing (DECISIONS pass 50).
    const replay = await api.post<ShipmentResponse>('/shipments', deliveryRequest(created.shipment.clientRequestId, found.origin, found.destination, city.settings));
    expect(replay.status).toBe(200);
    expect(replay.body).toStrictEqual(created);
    expect((await api.simulator()).version).toBe(planned.version);

    // The state file is the temp one, and it holds the delivery.
    expect((await api.savedRun())?.scenario.shipments.map((s) => s.id)).toContain(created.shipment.id);
  }, T);

  it('step 4: each carrier\'s dashboard lists the new job with its stops as business names', async () => {
    const plan = created.plan as DeliveryPlan;
    for (const [legIndex, leg] of plan.legs.entries()) {
      const res = await api.get<EmployeeDashboard>(`/employees/${leg.employeeId}/dashboard`);
      expect(res.status).toBe(200);
      const dashboard = res.body;
      expect(dashboard.version).toBe(planned.version);

      const mine = dashboard.assigned.filter((view) => view.shipment.id === created.shipment.id);
      expect(mine).toHaveLength(1);
      const { job, status } = mine[0];
      expect(status).toBe('assigned');
      expect(job.id).toBe(created.jobIds[legIndex]);
      expect(job).toMatchObject({ employeeId: leg.employeeId, legIndex, rewardCents: leg.rewardCents });
      expect(mine[0].plan).toStrictEqual(plan);

      // The stops are the leg's, and both are network businesses with a name (never a home or a raw ID).
      expect([job.pickup, job.dropoff]).toStrictEqual([leg.stops[0], leg.stops.at(-1)]);
      const pickupAt = businessAt(city, job.pickup.placeId);
      const dropoffAt = businessAt(city, job.dropoff.placeId);
      expect(pickupAt.id).not.toBe(dropoffAt.id);
      expect(job.pickup.serviceStartMin).toBeLessThan(job.dropoff.serviceStartMin);

      // The reward is part of what the employee will earn, and nothing is earned yet.
      expect(dashboard.projectedCents).toBe(sum([...dashboard.assigned, ...dashboard.completed].map((view) => view.job.rewardCents)));
      expect(dashboard.projectedCents).toBeGreaterThanOrEqual(leg.rewardCents);
      expect(dashboard.earnedCents).toBe(0);

      // The notification that makes the job appear without a refresh names the drop-off business.
      const notes = dashboard.notifications.filter((n) => n.jobId === job.id);
      expect(notes).toHaveLength(1);
      expect(notes[0].message).toContain(dropoffAt.name);
      expect(notes[0].message).not.toMatch(/\b(biz|home)-/);

      const detail = await api.get<JobResponse>(`/jobs/${job.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.job).toStrictEqual(job);
      expect(detail.body.trip).toMatchObject({ id: leg.tripId, employeeId: leg.employeeId });
    }
  }, T);

  it('step 5: Play locks the run and the clock moves; a new delivery request is then refused', async () => {
    api.runtime.startTicker(); // as server/index.ts does
    const play = await api.control({ action: 'play' });
    expect(play.clock).toMatchObject({ phase: 'locked', playing: true });

    let moved = await api.simulator();
    const deadline = Date.now() + T / 2;
    while (moved.clock.timeMin <= planned.clock.timeMin && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      moved = await api.simulator();
    }
    expect(moved.clock.timeMin).toBeGreaterThan(planned.clock.timeMin);
    expectStatusesFromPlans(moved);

    const paused = await api.control({ action: 'pause' });
    expect(paused.clock).toMatchObject({ phase: 'locked', playing: false });
    expect(paused.clock.timeMin).toBeGreaterThanOrEqual(moved.clock.timeMin);

    // DECISIONS pass 6: once Play has locked the run, a write is a 409 and stores nothing.
    const refused = await api.post<{ error: string }>('/shipments', deliveryRequest('e2e-nyc-flow-after-play', created.shipment.originBusinessId, created.shipment.destinationBusinessId, city.settings));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toEqual(expect.any(String));
    const after = await api.simulator();
    expect(after.version).toBe(paused.version);
    expect(after.shipments).toStrictEqual(planned.shipments);
    expect(after.plans).toStrictEqual(planned.plans);
  }, T);

  it('step 5: a seek through the evening shows every package where its plan says', async () => {
    const start = city.settings.simStartMin;
    const eveningEnds = [...new Set(planned.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin))]
      .filter((minute) => minute < DAY_2_MIN)
      .sort((a, b) => a - b);
    expect(eveningEnds.length).toBeGreaterThan(0); // a relay's first leg is driven on Day 1

    let occurred = 0;
    for (const minute of [start, ...eveningEnds]) {
      const sim = await api.control({ action: 'seek', timeMin: minute });
      expect(sim.clock).toMatchObject({ timeMin: minute, phase: 'locked', playing: false });
      expectStatusesFromPlans(sim);
      expectPositionsInNyc(sim);
      // Time only adds events, and each of these minutes has one.
      if (minute === start) expect(sim.snapshot.occurredEvents).toHaveLength(0);
      else expect(sim.snapshot.occurredEvents.length).toBeGreaterThan(occurred);
      occurred = sim.snapshot.occurredEvents.length;
      for (const event of sim.snapshot.occurredEvents) expect(event.timeMin).toBeLessThanOrEqual(minute);
    }
  }, T);

  it('step 5: overnight every relay package is at_hub at the coordinates of its relay business', async () => {
    // Midnight, or the last drop at a relay point if a first leg ever ends later than that.
    const drops = relayPlans(planned).map((plan) => plan.legs[0].stops.at(-1)!.serviceEndMin);
    const night = await api.control({ action: 'seek', timeMin: Math.max(DAY_2_MIN, ...drops) });
    expectStatusesFromPlans(night);
    expectPositionsInNyc(night);

    const relays = relayPlans(night);
    expect(relays.length).toBeGreaterThanOrEqual(1);
    for (const plan of relays) {
      const relay = businessAt(city, plan.relayBusinessId as string);
      expect(`${plan.shipmentId} ${night.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} at_hub`);
      expect(night.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: relay.lat, lng: relay.lng });
      // The first carrier has finished and earned the leg's reward; the second has not started.
      expect(night.snapshot.jobStatus[`${plan.id}-L0`]).toBe('completed');
      expect(night.snapshot.jobStatus[`${plan.id}-L1`]).toBe('assigned');

      const tracking = await api.get<ShipmentResponse>(`/shipments/${plan.shipmentId}`);
      expect(tracking.body).toMatchObject({ status: 'at_hub', deliveredAtMin: null, matched: true });
    }
    // A direct package never waits at a relay point: it is either still at the sender or already delivered.
    for (const plan of night.plans.filter((p) => p.kind === 'direct')) {
      expect(['scheduled', 'delivered']).toContain(night.snapshot.shipmentStatus[plan.shipmentId]);
    }
  }, T);

  it('step 5: Jump to morning stops 5 minutes before the first Day 2 event, then Finish delivers every matched package', async () => {
    const day2 = planned.plans.flatMap(stopsOf).map((stop) => stop.serviceEndMin).filter((minute) => minute >= DAY_2_MIN);
    expect(day2.length).toBeGreaterThan(0);
    const morning = await api.control({ action: 'jump_to_morning' });
    expect(morning.clock.timeMin).toBe(Math.max(DAY_2_MIN, Math.min(...day2) - 5));
    expect(morning.nextEventMin).toBe(Math.min(...day2));
    expectStatusesFromPlans(morning);
    expectPositionsInNyc(morning);
    for (const plan of relayPlans(morning)) expect(morning.snapshot.shipmentStatus[plan.shipmentId]).toBe('at_hub');

    const end = await api.control({ action: 'finish' });
    expect(end.clock).toMatchObject({ timeMin: city.settings.simEndMin, playing: false, phase: 'locked' });
    expect(end.nextEventMin).toBeNull();
    expectStatusesFromPlans(end);
    expectPositionsInNyc(end);
    expect(end.plans).toStrictEqual(planned.plans);
    expect(end.plans.length).toBeGreaterThan(0);
    for (const plan of end.plans) {
      const shipment = end.shipments.find((s) => s.id === plan.shipmentId)!;
      const destination = businessAt(city, shipment.destinationBusinessId);
      expect(`${plan.shipmentId} ${end.snapshot.shipmentStatus[plan.shipmentId]}`).toBe(`${plan.shipmentId} delivered`);
      // Delivered when the card said, by the deadline, and the package is at the recipient.
      expect(end.snapshot.deliveredAtMin[plan.shipmentId]).toBe(plan.deliveryMin);
      expect(plan.deliveryMin).toBeLessThanOrEqual(shipment.deadlineMin);
      expect(end.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: destination.lat, lng: destination.lng });
    }
    for (const job of end.jobs) expect(end.snapshot.jobStatus[job.id]).toBe('completed');
    expect(end.snapshot.shipmentStatus[created.shipment.id]).toBe('delivered');
    expect(end.snapshot.occurredEvents).toHaveLength(end.jobs.length * 2); // one event per stop
  }, T);

  it('step 6: the sender and recipient tracking views agree with the simulator', async () => {
    const end = await api.simulator();
    for (const plan of end.plans) {
      const res = await api.get<ShipmentResponse>(`/shipments/${plan.shipmentId}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ matched: true, status: 'delivered', deliveredAtMin: plan.deliveryMin });
      expect(res.body.plan).toStrictEqual(plan);
    }
    for (const { shipmentId, reason } of end.unmatched) {
      const res = await api.get<ShipmentResponse>(`/shipments/${shipmentId}`);
      expect(res.body).toMatchObject({ matched: false, status: 'unmatched', plan: null, deliveredAtMin: null, unmatchedReason: reason });
    }

    const planOf = new Map(end.plans.map((plan) => [plan.shipmentId, plan]));
    for (const business of city.businesses) {
      const res = await api.get<BusinessDashboard>(`/businesses/${business.id}/dashboard`);
      expect(res.status).toBe(200);
      const dashboard = res.body;
      expect(dashboard).toMatchObject({ phase: 'locked', version: end.version });
      expect(sorted(dashboard.outgoing.map((view) => view.shipment.id)))
        .toStrictEqual(sorted(end.shipments.filter((s) => s.originBusinessId === business.id).map((s) => s.id)));
      expect(sorted(dashboard.incoming.map((view) => view.shipment.id)))
        .toStrictEqual(sorted(end.shipments.filter((s) => s.destinationBusinessId === business.id).map((s) => s.id)));
      for (const view of [...dashboard.outgoing, ...dashboard.incoming]) {
        const plan = planOf.get(view.shipment.id);
        expect(view.status).toBe(plan ? 'delivered' : 'unmatched');
        expect(view.deliveredAtMin).toBe(plan ? plan.deliveryMin : null);
      }
      const matchedOut = dashboard.outgoing.filter((view) => view.plan !== null);
      expect(dashboard.totals).toStrictEqual({
        sent: dashboard.outgoing.length,
        matched: matchedOut.length,
        delivered: matchedOut.length,
        spendCents: sum(matchedOut.map((view) => view.plan!.customerPriceCents)),
      });
    }
  }, T);

  it('step 6: each carrier\'s earnings equal the sum of their completed leg rewards', async () => {
    const end = await api.simulator();
    const legsOf = new Map<string, Leg[]>();
    for (const leg of end.plans.flatMap((plan) => plan.legs)) legsOf.set(leg.employeeId, [...(legsOf.get(leg.employeeId) ?? []), leg]);
    expect(legsOf.has((created.plan as DeliveryPlan).legs[0].employeeId)).toBe(true);

    for (const employee of city.employees) {
      const res = await api.get<EmployeeDashboard>(`/employees/${employee.id}/dashboard`);
      expect(res.status).toBe(200);
      const dashboard = res.body;
      const rewards = sum((legsOf.get(employee.id) ?? []).map((leg) => leg.rewardCents));

      expect(dashboard.assigned).toStrictEqual([]);
      expect(dashboard.completed).toHaveLength(legsOf.get(employee.id)?.length ?? 0);
      for (const view of dashboard.completed) expect(view.status).toBe('completed');
      expect(dashboard.earnedCents).toBe(sum(dashboard.completed.map((view) => view.job.rewardCents)));
      expect(dashboard.earnedCents).toBe(rewards);
      expect(dashboard.projectedCents).toBe(rewards);
      expect(end.snapshot.earningsCents[employee.id] ?? 0).toBe(rewards);
      if (legsOf.has(employee.id)) expect(rewards).toBeGreaterThan(0);
    }
    // Nobody outside the city earned anything.
    for (const employeeId of Object.keys(end.snapshot.earningsCents)) expect(city.employee.has(employeeId)).toBe(true);
  }, T);

  it('step 6: the metrics have no NaN, and projected equals actual at the end', async () => {
    const res = await api.get<SimulatorResponse>('/simulator');
    const end = res.body;
    const { metrics } = end.snapshot;

    // Over HTTP a NaN arrives as null, so every metric must be a finite number (there are plans).
    for (const [name, value] of Object.entries(metrics)) {
      expect(`${name} ${typeof value} ${Number.isFinite(value)}`).toBe(`${name} number true`);
    }
    expect(JSON.stringify(end)).not.toMatch(/NaN|undefined|Infinity/);

    expect(metrics.requested).toBe(end.shipments.length);
    expect(metrics.matched).toBe(end.plans.length);
    expect(metrics.unmatched).toBe(end.unmatched.length);
    expect(metrics.matched + metrics.unmatched).toBe(metrics.requested);
    expect(metrics.direct + metrics.relay).toBe(metrics.matched);
    expect(metrics.relay).toBe(relayPlans(end).length);

    // Projected = actual once everything is delivered.
    expect(metrics.delivered).toBe(metrics.matched);
    expect(metrics.earnedPlatformContributionCents).toBe(metrics.projectedPlatformContributionCents);
    expect(metrics.projectedPlatformContributionCents).toBe(sum(end.plans.map((plan) => plan.platformContributionCents)));
    expect(metrics.earnedRewardsCents).toBe(sum(end.jobs.map((job) => job.rewardCents)));
    expect(metrics.earnedRewardsCents).toBe(sum(Object.values(end.snapshot.earningsCents)));
    expect(metrics.projectedCustomerSpendCents).toBe(
      end.plans.length * city.settings.priceCents + end.unmatched.length * city.settings.courierPriceCents,
    );
    expect(metrics.maxExtraMin).toBe(Math.max(...end.plans.flatMap((plan) => plan.legs).map((leg) => leg.extraMin)));
    expect(metrics.avgExtraMinPerTrip).toBeLessThanOrEqual(metrics.maxExtraMin as number);
  }, T);

  it('at 20 sampled minutes every marker and package position is inside the NYC box, and a carried package is with its carrier', async () => {
    // Half of the samples are spread evenly over the run. The other half are minutes at which a carrier
    // is on the road with a package (half-way between pickup and drop-off), so markers are really checked.
    const { simStartMin, simEndMin } = city.settings;
    const even = Array.from({ length: 10 }, (_unused, i) => Math.round(simStartMin + ((simEndMin - simStartMin) * i) / 9));
    const onTheRoad = planned.plans.flatMap((plan) => plan.legs.map((leg) => ({
      plan, leg, minute: Math.floor((leg.stops[0].serviceEndMin + leg.stops.at(-1)!.arrivalMin) / 2),
    }))).sort((a, b) => a.minute - b.minute || (a.plan.id < b.plan.id ? -1 : 1));
    expect(onTheRoad.length).toBeGreaterThan(0);
    const driving = Array.from({ length: 10 }, (_unused, i) => onTheRoad[Math.floor((onTheRoad.length * i) / 10)]);
    expect(new Set([...even, ...driving.map((d) => d.minute)]).size).toBeGreaterThanOrEqual(11);

    let markersSeen = 0;
    for (const minute of even) {
      const sim = await api.control({ action: 'seek', timeMin: minute });
      expectStatusesFromPlans(sim);
      expectPositionsInNyc(sim);
      markersSeen += sim.snapshot.markers.length;
    }
    for (const { plan, leg, minute } of driving) {
      const sim = await api.control({ action: 'seek', timeMin: minute });
      expectStatusesFromPlans(sim);
      expectPositionsInNyc(sim);
      markersSeen += sim.snapshot.markers.length;

      const marker = sim.snapshot.markers.find((m) => m.employeeId === leg.employeeId);
      expect(marker).toBeDefined();
      expect(marker).toMatchObject({ carryingShipmentId: plan.shipmentId, servicing: false });
      expect(sim.snapshot.packagePositions[plan.shipmentId]).toStrictEqual({ lat: marker!.lat, lng: marker!.lng });
      // Each driver is on the map once, and only people with a job are on it.
      const drivers = sim.snapshot.markers.map((m) => m.employeeId);
      expect(new Set(drivers).size).toBe(drivers.length);
      for (const employeeId of drivers) expect(sim.jobs.some((job) => job.employeeId === employeeId)).toBe(true);
    }
    expect(markersSeen).toBeGreaterThanOrEqual(10);

    // Back to the end of the run: the same delivered state as before the samples.
    const end = await api.control({ action: 'finish' });
    for (const plan of end.plans) expect(end.snapshot.shipmentStatus[plan.shipmentId]).toBe('delivered');
  }, T);

  it('the repo\'s data/ folder and fixtures/nyc are untouched, and no call left the test server', async () => {
    expect((await api.savedRun())?.runId).toBe(planned.runId); // the run was saved, in the temp folder
    expect(fs.existsSync(api.statePath)).toBe(true);
    api.expectRepoFilesUntouched();
    expect(net.installed()).toBe(true);
    expect(net.localCalls()).toBeGreaterThan(0);
    net.expectNoOutgoing();
  }, T);
});
