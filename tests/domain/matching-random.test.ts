import { beforeAll, describe, expect, it } from 'vitest';
import { GenerateScenarioRequest } from '../../shared/schemas';
import { generateScenario } from '../../server/domain/generator';
import { assignShipments, type MatchMode } from '../../server/domain/matching';
import { buildTrips, createRouter } from '../../server/domain/routing';

const seeds = Array.from({ length: 15 }, (_, index) => index + 1);
const modes = ['with_relay', 'direct_only'] as const;

function allocate(seed: number, mode: MatchMode) {
  const scenario = generateScenario(GenerateScenarioRequest.parse({ preset: 'random', seed }));
  const router = createRouter(scenario.graph);
  const trips = scenario.employees.flatMap(employee => buildTrips(employee, scenario.businesses, router));
  const result = assignShipments(scenario.shipments, { ...scenario, router, trips }, { mode });
  return { scenario, trips, result };
}

describe.each(seeds)('random city seed %i', seed => {
  let runs: Record<MatchMode, ReturnType<typeof allocate>>;

  beforeAll(() => {
    runs = {
      with_relay: allocate(seed, 'with_relay'),
      direct_only: allocate(seed, 'direct_only'),
    };
  });

  describe.each(modes)('%s', mode => {
    it('reproduces plans and unmatched lists with a fresh scenario and router (spec 7)', () => {
      const first = runs[mode].result;
      const second = allocate(seed, mode).result;
      expect(second.plans).toEqual(first.plans);
      expect(second.unmatched).toEqual(first.unmatched);
      expect(first.computeMs).toBe(0);
      expect(second.computeMs).toBe(0);
    });

    it('reserves each whole trip for at most one package', () => {
      const { result, trips } = runs[mode];
      const used = result.plans.flatMap(plan => plan.legs.map(leg => leg.tripId));
      expect(new Set(used).size).toBe(used.length);
      for (const id of used) expect(trips.some(trip => trip.id === id), id).toBe(true);
    });

    it('orders pickup, hub handoff, and delivery in time', () => {
      for (const plan of runs[mode].result.plans) {
        expect(plan.legs, plan.id).toHaveLength(plan.kind === 'relay' ? 2 : 1);
        if (mode === 'direct_only') expect(plan.kind, plan.id).toBe('direct');
        const stops = plan.legs.flatMap(leg => leg.stops);
        expect(stops.map(stop => stop.kind), plan.id).toEqual(plan.kind === 'relay'
          ? ['pickup', 'hub_drop', 'hub_pickup', 'delivery'] : ['pickup', 'delivery']);
        for (let index = 0; index < stops.length; index++) {
          const stop = stops[index];
          expect(stop.arrivalMin, plan.id).toBeLessThanOrEqual(stop.serviceStartMin);
          expect(stop.serviceStartMin, plan.id).toBeLessThanOrEqual(stop.serviceEndMin);
          if (index > 0) {
            // In particular, a hub pickup may not start until the deposit completes.
            expect(stops[index - 1].serviceEndMin, plan.id).toBeLessThanOrEqual(stop.serviceStartMin);
          }
        }
        if (plan.kind === 'relay') {
          expect(plan.legs[0].employeeId, plan.id).not.toBe(plan.legs[1].employeeId);
        }
      }
    });

    it('picks up after readiness and completes delivery by the deadline', () => {
      const { scenario, result } = runs[mode];
      for (const plan of result.plans) {
        const shipment = scenario.shipments.find(item => item.id === plan.shipmentId)!;
        const pickup = plan.legs[0].stops[0];
        const delivery = plan.legs[plan.legs.length - 1].stops[1];
        expect(pickup.serviceStartMin, plan.id).toBeGreaterThanOrEqual(shipment.readyMin);
        expect(delivery.serviceEndMin, plan.id).toBeLessThanOrEqual(shipment.deadlineMin);
        expect(plan.deliveryMin, plan.id).toBe(delivery.serviceEndMin);
      }
    });

    it('keeps every complete commute within its employee added-time limit', () => {
      const { scenario, trips, result } = runs[mode];
      for (const leg of result.plans.flatMap(plan => plan.legs)) {
        const employee = scenario.employees.find(item => item.id === leg.employeeId)!;
        const trip = trips.find(item => item.id === leg.tripId)!;
        expect(trip.employeeId, leg.tripId).toBe(employee.id);
        const addedMin = leg.finishMin - (trip.departureMin + trip.baselineDurationMin);
        expect(leg.extraMin, leg.tripId).toBe(addedMin);
        expect(addedMin, leg.tripId).toBeGreaterThanOrEqual(0);
        expect(addedMin, leg.tripId).toBeLessThanOrEqual(employee.maxExtraMin);
      }
    });

    it('accounts for every shipment exactly once and explains every unmatched shipment', () => {
      const { scenario, result } = runs[mode];
      // Sorted arrays retain duplicates, catching omissions, double assignments,
      // overlap between plans and unmatched, and unknown shipment IDs.
      expect([...result.plans, ...result.unmatched].map(item => item.shipmentId).sort())
        .toEqual(scenario.shipments.map(shipment => shipment.id).sort());
      for (const unmatched of result.unmatched) {
        expect(unmatched.reason.trim().length, unmatched.shipmentId).toBeGreaterThan(0);
      }
      expect(result.plans.length).toBeGreaterThan(0);
      const sequence = result.plans.map(plan =>
        scenario.shipments.find(shipment => shipment.id === plan.shipmentId)!.createdSeq);
      expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    });
  });

  it('matches at least as many packages with relay as with direct-only', () => {
    expect(runs.with_relay.result.plans.length)
      .toBeGreaterThanOrEqual(runs.direct_only.result.plans.length);
  });
});
