import { describe, expect, it } from 'vitest';
import type { ShipmentView } from '../../shared/api';
import type { DeliveryPlan, Shipment, ShipmentProgress, Stop, StopKind } from '../../shared/types';
import { legRows, progressSteps } from '../../client/src/components/business/trackingModel';

export const shipment: Shipment = {
  id: 'shp-1', clientRequestId: 'c1', label: 'Contracts', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  readyMin: 1000, deadlineMin: 1900, category: 'envelope', description: 'Signed contracts', weightGrams: 300,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
};
const stop = (nodeId: string, kind: StopKind, t: number): Stop =>
  ({ nodeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });
const leg = (emp: string, a: Stop, b: Stop) => ({
  tripId: `${emp}-eve`, employeeId: emp, routeNodeIds: [], stops: [a, b], finishMin: b.serviceEndMin,
  extraMin: 3, extraDistanceM: 0, rewardCents: 300,
});
export const relayPlan: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'relay', hubId: 'hub-h', deliveryMin: 1100,
  customerPriceCents: 1000, platformContributionCents: 100,
  legs: [
    leg('emp-1', stop('n-0-0', 'pickup', 1010), stop('n-3-3', 'hub_drop', 1040)),
    leg('emp-2', stop('n-3-3', 'hub_pickup', 1060), stop('n-5-5', 'delivery', 1095)),
  ],
};
export const directPlan: DeliveryPlan = {
  ...relayPlan, kind: 'direct', hubId: undefined,
  legs: [leg('emp-1', stop('n-0-0', 'pickup', 1010), stop('n-5-5', 'delivery', 1080))],
};
export const mk = (plan: DeliveryPlan | null, status: ShipmentProgress): ShipmentView => ({
  shipment, plan, jobIds: [], status, deliveredAtMin: status === 'delivered' ? 1097 : null, unmatchedReason: null,
});

const states = (v: ShipmentView) => progressSteps(v).map((s) => s.state).join(',');

describe('progressSteps', () => {
  it('relay has five steps', () => {
    expect(progressSteps(mk(relayPlan, 'scheduled')).map((s) => s.label)).toEqual(
      ['Scheduled', 'Picked up', 'At hub', 'Out for delivery', 'Delivered']);
  });
  it('relay states at each status', () => {
    expect(states(mk(relayPlan, 'scheduled'))).toBe('current,upcoming,upcoming,upcoming,upcoming');
    expect(states(mk(relayPlan, 'picked_up'))).toBe('done,current,upcoming,upcoming,upcoming');
    expect(states(mk(relayPlan, 'at_hub'))).toBe('done,done,current,upcoming,upcoming');
    expect(states(mk(relayPlan, 'out_for_delivery'))).toBe('done,done,done,current,upcoming');
    expect(states(mk(relayPlan, 'delivered'))).toBe('done,done,done,done,done');
  });
  it('direct skips hub steps', () => {
    expect(progressSteps(mk(directPlan, 'scheduled')).map((s) => s.label)).toEqual(['Scheduled', 'Picked up', 'Delivered']);
    expect(states(mk(directPlan, 'scheduled'))).toBe('current,upcoming,upcoming');
    expect(states(mk(directPlan, 'picked_up'))).toBe('done,current,upcoming');
    expect(states(mk(directPlan, 'delivered'))).toBe('done,done,done');
  });
  it('unmatched has nothing started', () => {
    expect(states(mk(null, 'unmatched'))).toBe('upcoming,upcoming,upcoming');
  });
});

describe('legRows', () => {
  const lookups = {
    businesses: [{ id: 'biz-a', name: 'Business A', nodeId: 'n-0-0', district: 'D' }, { id: 'biz-b', name: 'Business B', nodeId: 'n-5-5', district: 'N' }],
    hubs: [{ id: 'hub-h', name: 'Hub H', nodeId: 'n-3-3' }],
    employees: [
      { id: 'emp-1', name: 'Ann' }, { id: 'emp-2', name: 'Ben' },
    ] as never,
  };
  it('names carriers and places for a relay', () => {
    const rows = legRows(mk(relayPlan, 'scheduled'), lookups);
    expect(rows.map((r) => [r.employeeName, r.pickupPlace, r.dropoffPlace])).toEqual([
      ['Ann', 'Business A', 'Hub H'], ['Ben', 'Hub H', 'Business B'],
    ]);
    expect(rows[0].pickupTime).toBe('Day 1, 4:50 PM');
  });
  it('is empty without a plan', () => {
    expect(legRows(mk(null, 'unmatched'), lookups)).toEqual([]);
  });
});
