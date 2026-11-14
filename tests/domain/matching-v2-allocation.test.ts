import { expect, it } from 'vitest';
import { assignShipments, generateCandidates } from '../../server/domain/v2/matching';
import { context, employee, relayContext, shipment } from './matching-v2-helpers';

it('prioritizes fewest candidates, then deadline, then ID, while returning createdSeq order', () => {
  const ctx = context([
    employee('emp-1', 'biz-a', { availableMorning: false }),
    employee('emp-2', 'biz-a', { availableMorning: false, eveningDepartureMin: 1040 }),
  ], { 'biz-a': 0, 'biz-b': 10, 'home-emp-1': 20, 'home-emp-2': 20 });
  const flexible = shipment({ id: 'shp-a', createdSeq: 1 });
  const constrained = shipment({ id: 'shp-z', deadlineMin: 1040, createdSeq: 2 });
  const result = assignShipments([flexible, constrained], ctx);
  expect(result.plans.map(p => [p.shipmentId, p.legs[0].employeeId])).toEqual([
    ['shp-a', 'emp-2'], ['shp-z', 'emp-1'],
  ]);
  const oneTrip = { ...ctx, trips: ctx.trips.slice(0, 1) };
  expect(assignShipments([flexible, constrained], oneTrip).plans[0].shipmentId).toBe('shp-z');
  expect(assignShipments([shipment({ id: 'shp-z' }), flexible], oneTrip).plans[0].shipmentId).toBe('shp-a');
});

it('ranks by extra minutes, delivery time, then stable generation order', () => {
  const ctx = context([
    employee('emp-1', 'biz-a', { availableMorning: false }),
    employee('emp-2', 'biz-a', { availableMorning: false }),
  ], { 'biz-a': 0, 'biz-b': 10, 'home-emp-1': 8, 'home-emp-2': 20 });
  expect(assignShipments([shipment()], ctx).plans[0].legs[0].employeeId).toBe('emp-2');
  const tied = context(ctx.employees, { 'biz-a': 0, 'biz-b': 10, 'home-emp-1': 20, 'home-emp-2': 20 });
  expect(assignShipments([shipment()], tied).plans[0].legs[0].employeeId).toBe('emp-1');
  tied.trips[1] = { ...tied.trips[1], departureMin: 1010 };
  expect(assignShipments([shipment()], tied).plans[0].legs[0].employeeId).toBe('emp-2');
});

it('prefers the cheaper direct candidate even when relay has fewer total extra minutes', () => {
  const ctx = relayContext();
  ctx.employees = ctx.employees.map(e => ({ ...e, maxExtraMin: 100 }));
  const candidates = generateCandidates(shipment(), ctx);
  expect(candidates.some(p => p.kind === 'relay')).toBe(true);
  const plan = assignShipments([shipment()], ctx).plans[0];
  expect(plan.kind).toBe('direct');
  expect(plan.legs[0].extraMin).toBeGreaterThan(8);
});

it('preserves existing plans and reserves their trips, even outside the batch', () => {
  const ctx = relayContext();
  const existing = assignShipments([shipment()], ctx).plans;
  const next = shipment({ id: 'shp-2', createdSeq: 2 });
  const result = assignShipments([next], ctx, { existing });
  expect(result.plans).toEqual(existing);
  expect(result.plans[0]).toBe(existing[0]);
  expect(result.unmatched).toEqual([{ shipmentId: next.id, reason: 'Every matching commute is already carrying a package' }]);
  expect(assignShipments([shipment()], ctx, { existing }).plans).toEqual(existing);
});

it('keeps applicable unmatched explanations', () => {
  const ctx = relayContext();
  const reason = (s = shipment(), c = ctx) => assignShipments([s], c).unmatched[0].reason;
  expect(reason(shipment({ destinationBusinessId: 'biz-a' }))).toBe('Sender and recipient must be different businesses');
  expect(reason(shipment({ destinationBusinessId: 'missing' }))).toBe('Sender or recipient business is missing');
  expect(reason(shipment(), { ...ctx, employees: [] })).toBe('No employees are available to carry packages');
  expect(reason(shipment(), { ...ctx, trips: [] })).toBe('No commute is available after the package is ready');
  expect(reason(shipment({ deadlineMin: 1963 }))).toBe('No commute can arrive before the deadline');
  expect(reason(shipment({ readyMin: 1030 }))).toBe('No commute is available after the package is ready');
  expect(reason(shipment(), { ...ctx, employees: ctx.employees.map(e => ({ ...e, maxExtraMin: 3 })) }))
    .toBe("Every route would exceed the employees' added-time limit");
});
