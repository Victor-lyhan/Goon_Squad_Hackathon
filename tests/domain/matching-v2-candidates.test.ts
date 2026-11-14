import { expect, it } from 'vitest';
import { assignShipments, compareAssignments, generateCandidates } from '../../server/domain/v2/matching';
import { buildTrips } from '../../server/domain/v2/trips';
import { pairKey, TravelDataMissingError } from '../../shared/v2/types';
import { context, employee, relayContext, shipment, TableTravel } from './matching-v2-helpers';

it('builds enabled trips from directional provider values and propagates missing baselines', () => {
  const travel = new TableTravel({
    'biz-a|home-emp-1': { durationMin: 10, distanceM: 1234 },
    'home-emp-1|biz-a': { durationMin: 14, distanceM: 2345 },
  });
  const e = employee('emp-1', 'biz-a');
  expect(buildTrips(e, travel)).toEqual([
    { id: 'emp-1-eve', employeeId: e.id, direction: 'evening', originPlaceId: 'biz-a', destinationPlaceId: e.homeId,
      departureMin: 1020, baselineDurationMin: 10, baselineDistanceM: 1234 },
    { id: 'emp-1-morn', employeeId: e.id, direction: 'morning', originPlaceId: e.homeId, destinationPlaceId: 'biz-a',
      departureMin: 1935, baselineDurationMin: 14, baselineDistanceM: 2345 },
  ]);
  expect(buildTrips({ ...e, availableEvening: false, availableMorning: false }, new TableTravel())).toEqual([]);
  expect(() => buildTrips(e, new TableTravel())).toThrow(TravelDataMissingError);
});

it.each(['evening', 'morning'] as const)('schedules %s direct with endpoint handling and waiting', direction => {
  const evening = direction === 'evening';
  const e = employee('emp-1', evening ? 'biz-a' : 'biz-b', {
    availableEvening: evening, availableMorning: !evening,
  });
  const ctx = context([e], { 'biz-a': 10, 'biz-b': 20, 'home-emp-1': evening ? 30 : 0 });
  const readyMin = evening ? 1023 : 1948;
  const [plan] = generateCandidates(shipment({ readyMin }), ctx);
  expect(plan.kind).toBe('direct');
  expect(plan.legs[0].placeIds).toEqual(evening ? ['biz-a', 'biz-b', e.homeId] : [e.homeId, 'biz-a', 'biz-b']);
  expect(plan.legs[0].extraMin).toBe(7);
  expect(plan.legs[0].extraDistanceM).toBe(0);
  expect(plan.legs[0].stops[0].serviceStartMin).toBe(readyMin);
  expect(plan.deliveryMin).toBe(readyMin + 14);
  expect(plan.legs[0].finishMin).toBe(evening ? 1047 : 1962);
  expect(plan).toMatchObject({ customerPriceCents: 1000, platformContributionCents: 650 });
  expect(generateCandidates(shipment({ readyMin: readyMin + 2 }), ctx)).toEqual([]);
  expect(generateCandidates(shipment({ deadlineMin: (evening ? 1020 : 1945) + 13 }), ctx)).toEqual([]);
  expect(generateCandidates(shipment(), { ...ctx, employees: [{ ...e, maxExtraMin: 3 }] })).toEqual([]);
});

it('relays through any third business on both commutes; never through either endpoint', () => {
  const ctx = relayContext();
  const candidates = generateCandidates(shipment(), ctx);
  expect(candidates).toHaveLength(1);
  const plan = candidates[0];
  expect(plan).toMatchObject({ kind: 'relay', relayBusinessId: 'biz-r' });
  expect(plan.legs.map(l => l.extraMin)).toEqual([4, 4]);
  expect(plan.legs[0].employeeId).not.toBe(plan.legs[1].employeeId);
  expect(plan.legs[0].stops[1].serviceEndMin).toBeLessThanOrEqual(plan.legs[1].stops[0].serviceStartMin);
  expect(generateCandidates(shipment(), ctx, 'direct_only')).toEqual([]);
  expect(generateCandidates(shipment(), { ...ctx, settings: { ...ctx.settings, allowRelay: false } })).toEqual([]);
  expect(compareAssignments([shipment()], ctx).directOnly.plans).toEqual([]);
  expect(compareAssignments([shipment()], ctx).withRelay.plans).toHaveLength(1);
  expect(generateCandidates(shipment({ originBusinessId: 'biz-b' }), ctx)).toEqual([]);
});

it('removes relay candidates for excess detour, readiness and deadline constraints', () => {
  const ctx = relayContext();
  expect(generateCandidates(shipment({ readyMin: 1030 }), ctx)).toEqual([]);
  expect(generateCandidates(shipment({ deadlineMin: 1963 }), ctx)).toEqual([]);
  expect(generateCandidates(shipment(), { ...ctx, employees: ctx.employees.map(e => ({ ...e, maxExtraMin: 3 })) })).toEqual([]);
});

it('waits for deposit completion when collecting a relay', () => {
  const ctx = relayContext();
  ctx.trips[0] = { ...ctx.trips[0], departureMin: 1930 };
  const [plan] = generateCandidates(shipment(), ctx);
  expect(plan.legs[0].stops[1].serviceEndMin).toBe(1944);
  expect(plan.legs[1].stops[0]).toMatchObject({ arrivalMin: 1940, serviceStartMin: 1944, serviceEndMin: 1946 });
  expect(plan.legs[1].extraMin).toBe(8);
});

it('propagates missing candidate pairs without inventing a route or an unmatched reason', () => {
  const ctx = relayContext();
  delete (ctx.travel as TableTravel).pairs[pairKey('biz-b', 'home-emp-1')];
  expect(() => assignShipments([shipment()], ctx)).toThrow(TravelDataMissingError);
});

it('tries every third business and breaks equal relay choices by business ID', () => {
  const original = relayContext();
  const ctx = context(original.employees, {
    'biz-a': 0, 'biz-z': 10, 'biz-r': 10, 'biz-b': 30, 'home-emp-1': 15, 'home-emp-2': 5,
  });
  expect(generateCandidates(shipment(), ctx).map(p => p.relayBusinessId)).toEqual(['biz-r', 'biz-z']);
  expect(assignShipments([shipment()], ctx).plans[0].relayBusinessId).toBe('biz-r');
});
