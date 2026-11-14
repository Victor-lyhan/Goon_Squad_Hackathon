// #653, docs/mvp3.md (goal, P1, P3): the 30-second demo over HTTP. A judge presses "Watch a package" and
// follows "Navy Yard grinder burrs" from one business to another on two employees' commutes.
// This file guards that journey on the default NYC run, so the removals and the story retune of MVP III
// cannot break it unnoticed: the package is a relay with two carriers and three businesses, and seeking
// through its legs (what "Play journey" does, DECISIONS pass 46) shows it picked up, held overnight at
// the relay business, out for delivery and delivered.
// The server is the one of v2-e2e-nyc-helper.ts: the real v2 runtime on the committed `fixtures/nyc`,
// no key, no network, with its state files in a temp folder.
// Only the package's label is pinned, because the homepage button opens that package (docs/mvp3.md P4).
// Its carriers, its relay business and every minute are read from the answers, so a retune that keeps
// the shape of the journey (P3) passes without an edit here.
// Every test starts its own server, so each one runs on a fresh default run and none depends on another.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../../shared/v2/api';
import type { DeliveryPlan, Shipment, ShipmentProgress } from '../../shared/v2/types';
import {
  businessAt, DAY_2_MIN, readCity, recordFetch, startNycApi, stopsOf,
  type City, type FetchRecorder, type NycApi,
} from './v2-e2e-nyc-helper';
import { moveClock } from './v2-nyc-consistency-helper';

/**
 * Timeout of every test and hook (DECISIONS pass 19 and 52): each boots a real HTTP server.
 * Measured while nine other workers ran their suites on the same machine (load average over 400): the
 * slowest test 1.6 s and the three tests together 3.3 s, against the issue's limit of 10 s for the file.
 * So this is more than 10x even of that loaded measurement.
 */
const T = 30_000;

/** The package the homepage's "Watch a package" button opens (docs/mvp3.md P3 and P4). */
const LABEL = 'Navy Yard grinder burrs';

let net: FetchRecorder;
let api: NycApi;
let city: City;

beforeEach(async () => {
  net = recordFetch();
  api = await startNycApi(net);
  expect(api.runtime.reason).toBeUndefined();
  expect(api.runtime.status).toBe('ready');
  city = await readCity(api);
}, T);
afterEach(async () => {
  try {
    net.expectNoOutgoing();
    api?.expectRepoFilesUntouched();
  } finally {
    await api?.close();
    net.restore();
  }
}, T);

/** The one delivery with the demo's label and its plan, from a simulator answer. */
function watched(sim: SimulatorResponse): { shipment: Shipment; plan: DeliveryPlan } {
  const labeled = sim.shipments.filter((s) => s.label === LABEL);
  expect(labeled.map((s) => s.id), `deliveries labeled "${LABEL}"`).toHaveLength(1);
  const [shipment] = labeled;
  const plans = sim.plans.filter((p) => p.shipmentId === shipment.id);
  expect(plans, `plans of "${LABEL}"`).toHaveLength(1);
  expect(sim.unmatched.map((u) => u.shipmentId)).not.toContain(shipment.id);
  return { shipment, plan: plans[0] };
}

/** A whole minute halfway between two minutes: `from` itself or later, and before `to`. */
function halfway(from: number, to: number, what: string): number {
  expect(to, `${what}: minutes ${from} to ${to}`).toBeGreaterThan(from);
  return Math.floor((from + to) / 2);
}

describe(`"${LABEL}" on a fresh default NYC run (GET /api/v2/simulator)`, () => {
  it('is one delivery, planned as a relay with 2 legs, 2 different carriers and 3 different network businesses, and no stop is a home', async () => {
    const sim = await api.simulator();
    // A fresh run: the planning phase, paused at the first minute, nothing moved yet.
    expect(sim.clock).toMatchObject({ phase: 'planning', playing: false, timeMin: city.settings.simStartMin });
    const { shipment, plan } = watched(sim);
    expect(sim.snapshot.shipmentStatus[shipment.id]).toBe('scheduled');

    expect(plan.kind).toBe('relay');
    expect(plan.legs).toHaveLength(2);

    // Two carriers, both employees of the city, each with one job for their own leg.
    const carriers = plan.legs.map((leg) => leg.employeeId);
    expect(new Set(carriers).size, `carriers ${carriers.join(', ')}`).toBe(2);
    for (const id of carriers) expect(city.employee.has(id), `${id} is an employee`).toBe(true);
    const jobs = sim.jobs.filter((job) => job.shipmentId === shipment.id).sort((a, b) => a.legIndex - b.legIndex);
    expect(jobs.map((job) => job.employeeId)).toStrictEqual(carriers);

    // Three businesses: sender, relay point and recipient. `businessAt` fails for anything else.
    expect(plan.relayBusinessId).toEqual(expect.any(String));
    const sender = businessAt(city, shipment.originBusinessId);
    const relay = businessAt(city, plan.relayBusinessId as string);
    const recipient = businessAt(city, shipment.destinationBusinessId);
    expect(new Set([sender.id, relay.id, recipient.id]).size, `${sender.id}, ${relay.id}, ${recipient.id}`).toBe(3);

    // Four stops, all at those businesses: picked up at the sender, left at and taken from the relay
    // point, delivered to the recipient.
    expect(plan.legs.map((leg) => leg.stops.map((stop) => `${stop.kind} ${stop.placeId}`))).toStrictEqual([
      [`pickup ${sender.id}`, `hub_drop ${relay.id}`],
      [`hub_pickup ${relay.id}`, `delivery ${recipient.id}`],
    ]);
    // No stop is a home (SPEC MVP II rule 5): not a carrier's, not anybody's.
    const homes = new Set(city.employees.map((e) => e.homeId));
    expect(homes.size).toBeGreaterThan(0);
    for (const stop of stopsOf(plan)) {
      expect(city.business.has(stop.placeId), `the ${stop.kind} stop ${stop.placeId} is a network business`).toBe(true);
      expect(homes.has(stop.placeId), `the ${stop.kind} stop ${stop.placeId} is a home`).toBe(false);
      expect(stop.placeId.startsWith('home-'), `the ${stop.kind} stop ${stop.placeId} is a home`).toBe(false);
    }
  }, T);

  it('shares the run with at least 2 matched direct packages, each with 1 carrier between 2 businesses', async () => {
    const sim = await api.simulator();
    watched(sim);
    const direct = sim.plans.filter((plan) => plan.kind === 'direct');
    expect(direct.length, 'matched direct packages').toBeGreaterThanOrEqual(2);
    expect(new Set(direct.map((plan) => plan.shipmentId)).size).toBe(direct.length);
    for (const plan of direct) {
      const shipment = sim.shipments.find((s) => s.id === plan.shipmentId);
      if (!shipment) throw new Error(`${plan.id} is for a delivery the simulator does not list`);
      expect(sim.snapshot.shipmentStatus[shipment.id], shipment.id).not.toBe('unmatched');
      expect(plan.relayBusinessId, plan.id).toBeUndefined();
      expect(plan.legs, plan.id).toHaveLength(1);
      expect(city.employee.has(plan.legs[0].employeeId), `${plan.id}: its carrier is an employee`).toBe(true);
      const sender = businessAt(city, shipment.originBusinessId);
      const recipient = businessAt(city, shipment.destinationBusinessId);
      expect(sender.id, plan.id).not.toBe(recipient.id);
      expect(plan.legs[0].stops.map((stop) => `${stop.kind} ${stop.placeId}`), plan.id)
        .toStrictEqual([`pickup ${sender.id}`, `delivery ${recipient.id}`]);
    }
    // The summary the simulator shows counts them the same way.
    expect(sim.snapshot.metrics.direct).toBe(direct.length);
  }, T);
});

describe(`seeking through "${LABEL}" (POST /api/v2/simulator/control)`, () => {
  it('shows picked_up in the middle of leg 1, at_hub at the relay business between the legs, out_for_delivery in the middle of leg 2 and delivered after it, and never locks the run', async () => {
    const start = await api.simulator();
    const { shipment, plan } = watched(start);
    expect(plan.kind).toBe('relay');
    expect(plan.legs).toHaveLength(2);
    const [pickup, relayDrop, relayPickup, delivery] = stopsOf(plan);
    const sender = businessAt(city, shipment.originBusinessId);
    const relay = businessAt(city, plan.relayBusinessId as string);
    const recipient = businessAt(city, shipment.destinationBusinessId);
    const [carrier1, carrier2] = plan.legs.map((leg) => leg.employeeId);

    // The night is between the legs: left at the relay point on Day 1, taken from it on Day 2.
    expect(relayDrop.serviceEndMin, 'left at the relay point on Day 1').toBeLessThan(DAY_2_MIN);
    expect(relayPickup.serviceStartMin, 'taken from the relay point on Day 2').toBeGreaterThanOrEqual(DAY_2_MIN);
    expect(plan.deliveryMin).toBe(delivery.serviceEndMin);

    // The four minutes, from the plan's own stop times. "The middle of a leg" is while its carrier
    // drives with the package: after the handling of the leg's first stop, before the arrival at its second.
    const minutes = {
      leg1: halfway(pickup.serviceEndMin, relayDrop.arrivalMin, 'the drive of leg 1'),
      night: halfway(relayDrop.serviceEndMin, relayPickup.arrivalMin, 'the night at the relay point'),
      leg2: halfway(relayPickup.serviceEndMin, delivery.arrivalMin, 'the drive of leg 2'),
      // Past the delivery, and still inside the run (a seek outside it is refused, pass 46).
      after: Math.min(plan.deliveryMin + 1, city.settings.simEndMin),
    };
    expect(minutes.night).toBeGreaterThan(minutes.leg1);
    expect(minutes.leg2).toBeGreaterThan(minutes.night);
    expect(minutes.after).toBeGreaterThan(minutes.leg2);
    expect(minutes.after).toBeGreaterThanOrEqual(plan.deliveryMin);

    const seen: ShipmentProgress[] = [];
    /** One seek, then what a polling page reads: the same status and position, and the run not locked. */
    const seek = async (timeMin: number, step: string): Promise<SimulatorResponse> => {
      const moved = await moveClock(api, timeMin);
      const polled = await api.simulator();
      for (const [who, sim] of [['the control answer', moved], ['GET /simulator', polled]] as const) {
        const what = `${step} (minute ${timeMin}), ${who}`;
        // DECISIONS pass 46 and 62: a seek moves the clock and does not lock the run.
        expect(sim.clock, what).toMatchObject({ phase: 'planning', playing: false, timeMin });
        expect(sim.runId, what).toBe(start.runId);
        // Only the clock moved: the same deliveries, plans and jobs.
        expect(sim.shipments, what).toStrictEqual(start.shipments);
        expect(sim.plans, what).toStrictEqual(start.plans);
        expect(sim.jobs, what).toStrictEqual(start.jobs);
        expect(sim.unmatched, what).toStrictEqual(start.unmatched);
      }
      expect(polled.snapshot.shipmentStatus[shipment.id], step).toBe(moved.snapshot.shipmentStatus[shipment.id]);
      expect(polled.snapshot.packagePositions[shipment.id], step).toStrictEqual(moved.snapshot.packagePositions[shipment.id]);
      seen.push(moved.snapshot.shipmentStatus[shipment.id]);
      return moved;
    };
    /** While a leg is under way the package is in exactly one vehicle, its carrier's, and moves with it. */
    const expectCarriedBy = (sim: SimulatorResponse, employeeId: string, step: string) => {
      const carrying = sim.snapshot.markers.filter((marker) => marker.carryingShipmentId === shipment.id);
      expect(carrying.map((marker) => marker.employeeId), `${step}: the vehicle with the package`).toStrictEqual([employeeId]);
      expect(sim.snapshot.packagePositions[shipment.id], `${step}: the package is with its carrier`)
        .toStrictEqual({ lat: carrying[0].lat, lng: carrying[0].lng });
    };
    /** At rest the package is in nobody's vehicle and exactly at a business. */
    const expectRestsAt = (sim: SimulatorResponse, business: { lat: number; lng: number }, step: string) => {
      expect(sim.snapshot.markers.filter((marker) => marker.carryingShipmentId === shipment.id), `${step}: in nobody's vehicle`).toStrictEqual([]);
      expect(sim.snapshot.packagePositions[shipment.id], step).toStrictEqual({ lat: business.lat, lng: business.lng });
    };

    // Before anything: scheduled, at the sender.
    expect(start.snapshot.shipmentStatus[shipment.id]).toBe('scheduled');
    expectRestsAt(start, sender, 'the start');

    const onLeg1 = await seek(minutes.leg1, 'the middle of leg 1');
    expect(onLeg1.snapshot.shipmentStatus[shipment.id]).toBe('picked_up');
    expectCarriedBy(onLeg1, carrier1, 'the middle of leg 1');
    expect(onLeg1.snapshot.deliveredAtMin[shipment.id]).toBeUndefined();

    const overnight = await seek(minutes.night, 'between the legs');
    expect(overnight.snapshot.shipmentStatus[shipment.id]).toBe('at_hub');
    // Held at the relay business: the package position is the business's own coordinates.
    expect(overnight.snapshot.packagePositions[shipment.id]).toStrictEqual({ lat: relay.lat, lng: relay.lng });
    expectRestsAt(overnight, relay, 'between the legs');
    expect(overnight.snapshot.deliveredAtMin[shipment.id]).toBeUndefined();

    const onLeg2 = await seek(minutes.leg2, 'the middle of leg 2');
    expect(onLeg2.snapshot.shipmentStatus[shipment.id]).toBe('out_for_delivery');
    expectCarriedBy(onLeg2, carrier2, 'the middle of leg 2');
    expect(onLeg2.snapshot.deliveredAtMin[shipment.id]).toBeUndefined();

    const done = await seek(minutes.after, 'past the delivery');
    expect(done.snapshot.shipmentStatus[shipment.id]).toBe('delivered');
    expect(done.snapshot.deliveredAtMin[shipment.id]).toBe(plan.deliveryMin);
    expectRestsAt(done, recipient, 'past the delivery');

    expect(seen).toStrictEqual(['picked_up', 'at_hub', 'out_for_delivery', 'delivered']);

    // Still not locked after the four seeks: the clock goes back to the start and the journey can be
    // watched again from "scheduled" (what a second press of the button does).
    const again = await seek(city.settings.simStartMin, 'back at the start');
    expect(again.snapshot.shipmentStatus[shipment.id]).toBe('scheduled');
    expectRestsAt(again, sender, 'back at the start');
    expect(again.version).toBe(start.version + 5); // one per seek, nothing else wrote
  }, T);
});
