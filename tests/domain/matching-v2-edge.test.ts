import { describe, expect, it } from 'vitest';
import { pairKey, TravelDataMissingError, type AssignmentResult } from '../../shared/v2/types';
import { assignShipments, generateCandidates } from '../../server/domain/v2/matching';
import { buildTrips } from '../../server/domain/v2/trips';
import { context, employee, relayContext, shipment, TableTravel } from './matching-v2-helpers';

// All three relay businesses are feasible; direct routes exceed the 8-minute limit.
// The table deliberately decouples added driving from delivery time for tie tests.
function threeRelays(extraDriving: number[], deliveryDelay = [0, 0, 0]) {
  const ctx = context(relayContext().employees, {
    'biz-a': 0, 'biz-b': 30, 'biz-r1': 10, 'biz-r2': 10, 'biz-r3': 10,
    'home-emp-1': 15, 'home-emp-2': 5,
  });
  const travel = ctx.travel as TableTravel;
  extraDriving.forEach((extra, i) => {
    const relay = `biz-r${i + 1}`;
    travel.pairs[pairKey('biz-a', relay)].durationMin = 10 + extra - deliveryDelay[i];
    travel.pairs[pairKey(relay, 'biz-b')].durationMin = 20 + deliveryDelay[i];
  });
  return ctx;
}

describe('v2 matcher edge cases', () => {
  it.each([
    { rule: 'total extra minutes before delivery time', extras: [4, 0, 2], delivery: [0, 2, 0], winner: 'biz-r2' },
    { rule: 'delivery time before candidate index', extras: [0, 0, 0], delivery: [2, 1, 0], winner: 'biz-r3' },
  ])('chooses among three relay businesses by $rule', ({ extras, delivery, winner }) => {
    const ctx = threeRelays(extras, delivery);
    const candidates = generateCandidates(shipment(), ctx);
    expect(candidates).toHaveLength(3);
    expect(candidates.map(plan => plan.relayBusinessId)).toEqual(['biz-r1', 'biz-r2', 'biz-r3']);
    expect(candidates.map(plan => plan.legs.reduce((sum, leg) => sum + leg.extraMin, 0)))
      .toEqual(extras.map(extra => 8 + extra));
    expect(candidates.map(plan => plan.deliveryMin)).toEqual(delivery.map(delay => 1964 + delay));
    for (const plan of candidates) {
      expect(plan.kind).toBe('relay');
      expect(['biz-a', 'biz-b']).not.toContain(plan.relayBusinessId);
      expect(plan.legs).toHaveLength(2);
      expect(plan.legs[0].employeeId).not.toBe(plan.legs[1].employeeId);
      expect(plan.legs[1].stops[0].serviceStartMin).toBeGreaterThanOrEqual(plan.legs[0].stops[1].serviceEndMin);
    }
    const result = assignShipments([shipment()], ctx);
    expect(result.unmatched).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].relayBusinessId).toBe(winner);
  });

  it('uses stable candidate index when relay cost, extra minutes and delivery time tie', () => {
    const ctx = threeRelays([0, 0, 0]);
    ctx.businesses.reverse();
    const candidates = generateCandidates(shipment(), ctx);
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map(plan => plan.deliveryMin)).size).toBe(1);
    expect(assignShipments([shipment()], ctx).plans).toEqual([candidates[0]]);
    expect(candidates[0].relayBusinessId).toBe('biz-r1');
  });

  it('ranks carrier-plus-relay cost before extra minutes', () => {
    const ctx = relayContext();
    ctx.employees.forEach(carrier => { carrier.maxExtraMin = 40; });
    const candidates = generateCandidates(shipment(), ctx);
    const direct = candidates.filter(plan => plan.kind === 'direct');
    const relay = candidates.find(plan => plan.kind === 'relay')!;
    expect(direct).toHaveLength(2);
    expect(relay).toBeDefined();
    const relayExtra = relay.legs.reduce((sum, leg) => sum + leg.extraMin, 0);
    expect(direct.every(plan => plan.legs[0].extraMin > relayExtra)).toBe(true);
    expect(assignShipments([shipment()], ctx).plans).toEqual([direct[1]]);
  });

  it('waits for deposit completion and rejects a handoff that exceeds the pickup carrier limit', () => {
    const ctx = relayContext();
    ctx.employees[1].morningDepartureMin = 1025;
    ctx.trips = ctx.employees.flatMap(carrier => buildTrips(carrier, ctx.travel));
    const result = assignShipments([shipment()], ctx);
    expect(result.plans).toHaveLength(1);
    const [deposit, collection] = result.plans[0].legs;
    expect(deposit.stops[1].serviceEndMin).toBe(1034);
    expect(collection.stops[0]).toMatchObject({ arrivalMin: 1030, serviceStartMin: 1034, serviceEndMin: 1036 });
    expect(collection.extraMin).toBe(8); // Four handling minutes plus four waiting.
    // One minute earlier requires five minutes waiting: 9 > maxExtraMin 8.
    ctx.employees[1].morningDepartureMin = 1024;
    ctx.trips = ctx.employees.flatMap(carrier => buildTrips(carrier, ctx.travel));
    expect(generateCandidates(shipment(), ctx)).toEqual([]);
    const rejected = assignShipments([shipment()], ctx);
    expect(rejected.plans).toEqual([]);
    expect(rejected.unmatched.map(item => item.shipmentId)).toEqual(['shp-1']);
  });

  it.each([
    { index: 0, field: 'availableEvening', tripId: 'emp-1-eve', legIndex: 0 },
    { index: 1, field: 'availableMorning', tripId: 'emp-2-morn', legIndex: 1 },
  ] as const)('$field removes the direct plan and relay leg $legIndex', ({ index, field, tripId, legIndex }) => {
    const ctx = relayContext();
    ctx.employees.forEach(carrier => { carrier.maxExtraMin = 40; });
    const before = generateCandidates(shipment(), ctx);
    expect(before.filter(plan => plan.kind === 'direct').map(plan => plan.legs[0].tripId)).toContain(tripId);
    expect(before.find(plan => plan.kind === 'relay')?.legs[legIndex].tripId).toBe(tripId);
    ctx.employees[index][field] = false;
    ctx.trips = ctx.employees.flatMap(carrier => buildTrips(carrier, ctx.travel));
    const after = generateCandidates(shipment(), ctx);
    expect(after).toHaveLength(1);
    expect(after[0].kind).toBe('direct');
    expect(after.flatMap(plan => plan.legs).map(leg => leg.tripId)).not.toContain(tripId);
    expect(assignShipments([shipment()], ctx).plans).toEqual(after);
    ctx.employees[index][field] = true;
    ctx.trips = ctx.employees.flatMap(carrier => buildTrips(carrier, ctx.travel));
    expect(generateCandidates(shipment(), ctx)).toEqual(before);
  });

  it('maxExtraMin zero rejects handling time and admits only zero-extra legs', () => {
    const ctx = relayContext();
    expect(assignShipments([shipment()], ctx).plans).toHaveLength(1);
    ctx.employees.forEach(carrier => { carrier.maxExtraMin = 0; });
    expect(generateCandidates(shipment(), ctx)).toEqual([]);
    expect(assignShipments([shipment()], ctx).plans).toEqual([]);
    // Explicit zero-handling settings provide a nonempty boundary case:
    // both relay stops lie on baseline routes, while direct routes still detour.
    ctx.settings.handlingMin = 0;
    const candidates = generateCandidates(shipment(), ctx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].legs.map(leg => leg.extraMin)).toEqual([0, 0]);
    expect(assignShipments([shipment()], ctx).plans).toEqual(candidates);
  });

  it('throws the named missing pair instead of returning plans or unmatched entries', () => {
    const ctx = relayContext();
    expect(assignShipments([shipment()], ctx).plans).toHaveLength(1);
    delete (ctx.travel as TableTravel).pairs[pairKey('biz-a', 'biz-r')];
    let returned: AssignmentResult | undefined;
    let caught: unknown;
    try {
      returned = assignShipments([shipment()], ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TravelDataMissingError);
    expect(caught).toMatchObject({ from: 'biz-a', to: 'biz-r', what: 'matrix' });
    expect(returned).toBeUndefined();
  });

  it('preserves exact plans and unmatched order when employees, trips and shipments are shuffled', () => {
    const ctx = context([
      employee('emp-1', 'biz-a', { availableMorning: false }),
      employee('emp-2', 'biz-b', { availableEvening: false }),
      employee('emp-3', 'biz-a', { availableMorning: false }),
    ], { 'biz-a': 0, 'biz-b': 30, 'biz-r': 10, 'home-emp-1': 15, 'home-emp-2': 5, 'home-emp-3': 15 });
    const shipments = [1, 2, 3, 4].map(i => shipment({ id: `shp-${i}`, clientRequestId: `test-${i}`, createdSeq: i }));
    const expected = assignShipments(shipments, ctx);
    expect(expected.plans.map(plan => plan.shipmentId)).toEqual(['shp-1']);
    expect(expected.plans[0].legs.map(leg => leg.employeeId)).toEqual(['emp-1', 'emp-2']);
    expect(expected.unmatched.map(item => item.shipmentId)).toEqual(['shp-2', 'shp-3', 'shp-4']);
    const shuffled = assignShipments([shipments[2], shipments[0], shipments[3], shipments[1]], {
      ...ctx, employees: [ctx.employees[2], ctx.employees[0], ctx.employees[1]],
      trips: [ctx.trips[1], ctx.trips[2], ctx.trips[0]],
    });
    expect(shuffled.plans).toEqual(expected.plans);
    expect(shuffled.unmatched).toEqual(expected.unmatched);
  });
});
