import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createRng } from '../../server/domain/v2/rng';
import { assignShipments } from '../../server/domain/v2/matching';
import { context, employee, shipment } from './matching-v2-helpers';

function city(seed: number) {
  const rng = createRng(seed);
  const positions: Record<string, number> = {};
  const businesses = Array.from({ length: 18 }, (_, i) => `biz-${i}`);
  businesses.forEach(id => { positions[id] = rng.int(0, 60); });
  const employees = Array.from({ length: 60 }, (_, i) => employee(`emp-${i}`, businesses[i % 18], {
    eveningDepartureMin: rng.int(990, 1080), morningDepartureMin: rng.int(1890, 1980),
    maxExtraMin: rng.int(4, 16), availableEvening: rng.next() > 0.1, availableMorning: rng.next() > 0.1,
  }));
  employees.forEach(e => { positions[e.homeId] = rng.int(0, 60); });
  const shipments = Array.from({ length: 24 }, (_, i) => {
    const from = rng.int(0, 17);
    return shipment({ id: `shp-${i}`, createdSeq: i, originBusinessId: businesses[from],
      destinationBusinessId: businesses[(from + rng.int(1, 17)) % 18], readyMin: rng.int(960, 1050), deadlineMin: rng.int(1950, 2100) });
  });
  return { ctx: context(employees, positions), shipments };
}

// Build each seeded city once; use the project's sole PRNG for all randomized data.
const cities = Array.from({ length: 20 }, (_, seed) => city(seed));
for (const [seed, { ctx, shipments }] of cities.entries()) {
  it(`seed ${seed}: deterministic, permutation invariant, feasible and exclusively reserved`, () => {
    const before = JSON.stringify({ employees: ctx.employees, trips: ctx.trips, businesses: ctx.businesses, shipments });
    const result = assignShipments(shipments, ctx);
    expect(assignShipments(shipments, ctx)).toEqual(result);
    const rng = createRng(seed);
    expect(assignShipments(rng.shuffle(shipments), { ...ctx, employees: rng.shuffle(ctx.employees),
      trips: rng.shuffle(ctx.trips), businesses: rng.shuffle(ctx.businesses) })).toEqual(result);
    expect(JSON.stringify({ employees: ctx.employees, trips: ctx.trips, businesses: ctx.businesses, shipments })).toBe(before);
    expect(result.plans.length).toBeGreaterThan(0);
    expect(result.plans.length + result.unmatched.length).toBe(shipments.length);
    const used = new Set<string>();
    for (const plan of result.plans) {
      const request = shipments.find(s => s.id === plan.shipmentId)!;
      expect(plan.deliveryMin).toBeLessThanOrEqual(request.deadlineMin);
      expect(plan.deliveryMin).toBe(plan.legs.at(-1)!.stops[1].serviceEndMin);
      if (plan.kind === 'relay') {
        expect(plan.legs).toHaveLength(2);
        expect(ctx.businesses.some(b => b.id === plan.relayBusinessId)).toBe(true);
        expect([request.originBusinessId, request.destinationBusinessId]).not.toContain(plan.relayBusinessId);
        expect(plan.legs[0].employeeId).not.toBe(plan.legs[1].employeeId);
        expect(plan.legs[0].stops[1].serviceEndMin).toBeLessThanOrEqual(plan.legs[1].stops[0].serviceStartMin);
        expect(plan.legs[0].stops[1].placeId).toBe(plan.relayBusinessId);
        expect(plan.legs[1].stops[0].placeId).toBe(plan.relayBusinessId);
      }
      for (const [i, leg] of plan.legs.entries()) {
        expect(used.has(leg.tripId)).toBe(false);
        used.add(leg.tripId);
        const trip = ctx.trips.find(t => t.id === leg.tripId)!;
        const carrier = ctx.employees.find(e => e.id === leg.employeeId)!;
        expect(carrier.businessId).toBe(trip.direction === 'evening' ? request.originBusinessId : request.destinationBusinessId);
        expect(leg.extraMin).toBeLessThanOrEqual(carrier.maxExtraMin);
        expect(leg.extraMin).toBe(leg.finishMin - trip.departureMin - trip.baselineDurationMin);
        expect(leg.stops[0].serviceStartMin).toBeGreaterThanOrEqual(request.readyMin);
        let time = trip.departureMin;
        let distance = 0;
        expect(leg.placeIds[0]).toBe(trip.originPlaceId);
        expect(leg.placeIds.at(-1)).toBe(trip.destinationPlaceId);
        for (const [j, place] of leg.placeIds.entries()) {
          if (j > 0) {
            const previous = leg.placeIds[j - 1];
            expect(place).not.toBe(previous);
            time += ctx.travel.durationMin(previous, place);
            distance += ctx.travel.distanceM(previous, place);
          }
          for (const stop of leg.stops.filter(s => s.placeId === place)) {
            expect(stop.arrivalMin).toBe(time);
            expect(stop.serviceStartMin).toBeGreaterThanOrEqual(time);
            expect(stop.serviceEndMin).toBe(stop.serviceStartMin + ctx.settings.handlingMin);
            expect(ctx.businesses.some(b => b.id === stop.placeId)).toBe(true);
            time = stop.serviceEndMin;
          }
        }
        expect(time).toBe(leg.finishMin);
        expect(leg.extraDistanceM).toBe(distance - trip.baselineDistanceM);
        if (i === 0) expect(leg.stops[0].placeId).toBe(request.originBusinessId);
      }
      expect(plan.legs.at(-1)!.stops[1].placeId).toBe(request.destinationBusinessId);
    }
  }, 10_000);
}

it('matches 18 businesses, 60 employees and 24 packages within 500 ms', () => {
  const { ctx, shipments } = cities[0];
  const start = performance.now();
  const result = assignShipments(shipments, ctx);
  const elapsed = performance.now() - start;
  expect(result.plans.length).toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(500);
  console.info(`v2 matcher default workload: ${elapsed.toFixed(1)} ms (500 ms budget)`);
}, 10_000);
