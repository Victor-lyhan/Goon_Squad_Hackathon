import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { it, expect } from 'vitest';
import type { ShipmentProgress, SimEventKind } from '../../shared/v2/types.js';
import { snapshotAt } from '../../server/domain/v2/simulation.js';
import { buildDay, deepFreeze } from './sim-v2-day-helper.js';

const { run, travel, places } = buildDay();
deepFreeze(run);
deepFreeze(travel);
const rank: Record<ShipmentProgress, number> = {
  unmatched: 0, scheduled: 1, picked_up: 2, at_hub: 3, out_for_delivery: 4, delivered: 5,
};
const eventStatus: Record<SimEventKind, ShipmentProgress> = {
  pickup: 'picked_up', hub_drop: 'at_hub', hub_pickup: 'out_for_delivery', delivered: 'delivered',
};

it('keeps custody, progress, markers and money consistent for every minute of the NYC day', () => {
  expect(run.scenario.employees).toHaveLength(60);
  expect(run.scenario.shipments).toHaveLength(24);
  expect(run.scenario.businesses).toHaveLength(18);
  const previous: Record<string, number> = {};
  let previousDelivered = 0;
  let totalMs = 0;
  let slowestMs = 0;
  let slowestMinute = 930;
  const pollingBudgetMs = 50;
  const overBudget: { minute: number; elapsed: number }[] = [];
  let snapshots = 0;
  let encodedReads = 0;
  let fallbackReads = 0;
  let carryingMinutes = 0;
  const overnightMinutes = new Map<string, number>();
  const observedTravel = {
    polyline(from: string, to: string) {
      const line = travel.polyline(from, to);
      if (line === null) fallbackReads++;
      else encodedReads++;
      return line;
    },
  };
  const started = performance.now();
  for (let minute = 930; minute <= 2160; minute++) {
    const start = performance.now();
    const snapshot = snapshotAt(run, minute, observedTravel);
    const elapsed = performance.now() - start;
    totalMs += elapsed;
    snapshots++;
    if (elapsed > slowestMs) { slowestMs = elapsed; slowestMinute = minute; }
    if (elapsed >= pollingBudgetMs) overBudget.push({ minute, elapsed });
    const context = `minute ${minute}`;
    for (const shipment of run.scenario.shipments) {
      const status = snapshot.shipmentStatus[shipment.id];
      assert(rank[status] >= (previous[shipment.id] ?? 0), `${context}: ${shipment.id} status regressed`);
      previous[shipment.id] = rank[status];
      const events = run.events.filter(event => event.shipmentId === shipment.id && event.timeMin <= minute);
      const last = events.at(-1);
      const matched = run.assignments.plans.some(plan => plan.shipmentId === shipment.id);
      assert.equal(status, last ? eventStatus[last.kind] : matched ? 'scheduled' : 'unmatched', context);
    }
    assert(snapshot.metrics.delivered >= previousDelivered, `${context}: delivered count fell`);
    previousDelivered = snapshot.metrics.delivered;
    assert.equal(snapshot.metrics.delivered,
      run.events.filter(event => event.kind === 'delivered' && event.timeMin <= minute).length, context);
    for (const [key, value] of Object.entries(snapshot.metrics)) {
      if (value !== null) assert(Number.isFinite(value), `${context}: ${key} is not finite`);
      if (key.endsWith('Cents')) assert(Number.isInteger(value), `${context}: ${key} is not integer cents`);
    }
    for (const value of Object.values(snapshot.earningsCents)) assert(Number.isInteger(value), context);
    assert.equal(new Set(snapshot.markers.map(marker => marker.employeeId)).size, snapshot.markers.length, context);
    for (const marker of snapshot.markers) {
      assert(Number.isFinite(marker.lat) && Number.isFinite(marker.lng), context);
      assert(run.assignments.plans.some(plan => plan.legs.some(leg => {
        const trip = run.trips.find(candidate => candidate.id === leg.tripId)!;
        return leg.employeeId === marker.employeeId && minute >= trip.departureMin && minute <= leg.finishMin;
      })), `${context}: ${marker.employeeId} marker outside a planned trip`);
    }
    for (const plan of run.assignments.plans) {
      const shipment = run.scenario.shipments.find(candidate => candidate.id === plan.shipmentId)!;
      const events = run.events.filter(event => event.planId === plan.id);
      const position = snapshot.packagePositions[shipment.id];
      const message = `${context}: ${shipment.id} custody`;
      const pickup = events.find(event => event.kind === 'pickup')!;
      const delivered = events.find(event => event.kind === 'delivered')!;
      const hubDrop = events.find(event => event.kind === 'hub_drop');
      const hubPickup = events.find(event => event.kind === 'hub_pickup');
      if (minute < pickup.timeMin) {
        assert.deepEqual(position, places[shipment.originBusinessId], message);
      } else if (minute >= delivered.timeMin) {
        assert.deepEqual(position, places[shipment.destinationBusinessId], message);
      } else if (hubDrop && hubPickup && minute >= hubDrop.timeMin && minute < hubPickup.timeMin) {
        assert.deepEqual(position, places[plan.relayBusinessId!], message);
        overnightMinutes.set(plan.id, (overnightMinutes.get(plan.id) ?? 0) + 1);
      } else {
        const carrier = hubPickup && minute >= hubPickup.timeMin ? hubPickup.employeeId : pickup.employeeId;
        const marker = snapshot.markers.find(candidate => candidate.employeeId === carrier);
        assert(marker, `${message}: missing carrier ${carrier}`);
        assert.equal(marker.carryingShipmentId, shipment.id, message);
        assert.deepEqual(position, { lat: marker.lat, lng: marker.lng }, message);
        carryingMinutes++;
      }
    }
  }
  const wallMs = performance.now() - started;
  console.info(`NYC day: ${snapshots} snapshots, total ${totalMs.toFixed(1)} ms, slowest ${slowestMs.toFixed(2)} ms at ${slowestMinute}; sweep including assertions ${wallMs.toFixed(1)} ms`);
  expect(snapshots).toBe(1231);
  // Parallel suite workers can pause a single sample for GC or scheduling.
  // Keep the raw sweep report above; confirm each outlier on the same minute.
  for (const { minute, elapsed } of overBudget) {
    let bestMs = elapsed;
    for (let retry = 0; retry < 5 && bestMs >= pollingBudgetMs; retry++) {
      const start = performance.now();
      snapshotAt(run, minute, observedTravel);
      bestMs = Math.min(bestMs, performance.now() - start);
    }
    expect(bestMs, `snapshot at ${minute} exceeds polling budget after retries (raw ${elapsed.toFixed(2)} ms)`)
      .toBeLessThan(pollingBudgetMs);
  }
  expect(encodedReads).toBeGreaterThan(0);
  expect(fallbackReads, 'planned routes must exercise missing-line fallback').toBeGreaterThan(0);
  expect(carryingMinutes).toBeGreaterThan(0);
  for (const plan of run.assignments.plans.filter(plan => plan.kind === 'relay')) {
    const drop = run.events.find(event => event.planId === plan.id && event.kind === 'hub_drop')!;
    const pickup = run.events.find(event => event.planId === plan.id && event.kind === 'hub_pickup')!;
    expect(drop.timeMin).toBeLessThan(1440);
    expect(pickup.timeMin).toBeGreaterThan(1440);
    expect(overnightMinutes.get(plan.id)).toBe(pickup.timeMin - drop.timeMin);
  }
  const end = snapshotAt(run, 2160, travel);
  for (const plan of run.assignments.plans) expect(end.shipmentStatus[plan.shipmentId]).toBe('delivered');
  expect(end.metrics.delivered).toBe(run.assignments.plans.length);
  expect(end.metrics.delivered).toBe(run.events.filter(event => event.kind === 'delivered').length);
}, 30_000);
