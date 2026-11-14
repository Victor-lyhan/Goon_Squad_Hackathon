import { expect, it } from 'vitest';
import { assignShipments, compareAssignments } from '../../server/domain/v2/matching';
import { comparisonCase } from './matching-v2-cases';
import { relayContext, shipment } from './matching-v2-helpers';

it('compares independent allocations with a direct job and a relay-only job without mutation', () => {
  const { ctx, shipments } = comparisonCase();
  const before = structuredClone({ ctx, shipments });
  const travel = ctx.travel;
  const result = compareAssignments(shipments, ctx);
  expect(result.directOnly.plans.map(p => [p.shipmentId, p.kind])).toEqual([['shp-2', 'direct']]);
  expect(result.withRelay.plans.map(p => [p.shipmentId, p.kind])).toEqual([['shp-1', 'relay'], ['shp-2', 'direct']]);
  expect(result.withRelay.plans.length).toBeGreaterThanOrEqual(result.directOnly.plans.length);
  expect(result.directOnly).toEqual(assignShipments(shipments, ctx, { mode: 'direct_only' }));
  expect(result.withRelay).toEqual(assignShipments(shipments, ctx, { mode: 'with_relay' }));
  expect(compareAssignments(shipments, ctx)).toEqual(result);
  expect(structuredClone({ ctx, shipments })).toEqual(before);
  expect(ctx.travel).toBe(travel);
});

it('respects allowRelay false on both comparison sides', () => {
  const { ctx, shipments } = comparisonCase();
  ctx.settings.allowRelay = false;
  const result = compareAssignments(shipments, ctx);
  expect(result.withRelay).toEqual(result.directOnly);
  expect(result.withRelay.plans.map(p => p.kind)).toEqual(['direct']);
});

it.each(['direct_only', 'with_relay'] as const)('keeps existing plans untouched and reserves both trips in %s', mode => {
  const ctx = relayContext();
  const existing = assignShipments([shipment()], ctx).plans;
  expect(existing).toHaveLength(1);
  const before = structuredClone(existing);
  const next = shipment({ id: 'shp-2', createdSeq: 2 });
  // Existing relay is retained even in direct-only mode, even outside this batch.
  const result = assignShipments([next], ctx, { existing, mode });
  expect(result.plans).toEqual(before);
  expect(result.plans[0]).toBe(existing[0]);
  expect(existing).toEqual(before);
  expect(result.unmatched.map(u => u.shipmentId)).toEqual([next.id]);
  expect(assignShipments([shipment(), next], ctx, { existing, mode }).plans).toEqual(before);
  // Each reserved leg also blocks a direct job that would otherwise use it.
  for (const [originBusinessId, destinationBusinessId] of [['biz-a', 'biz-r'], ['biz-r', 'biz-b']]) {
    const request = { ...next, originBusinessId, destinationBusinessId };
    expect(assignShipments([request], ctx, { mode }).plans).toHaveLength(1);
    expect(assignShipments([request], ctx, { existing, mode }).unmatched).toEqual([{
      shipmentId: next.id, reason: 'Every matching commute is already carrying a package',
    }]);
  }
});
