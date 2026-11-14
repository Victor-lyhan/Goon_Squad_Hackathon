import { describe, expect, it } from 'vitest';
import type { SimulatorResponse } from '../../shared/api';
import type { Business, DeliveryPlan, Employee, Hub, Leg, Shipment } from '../../shared/types';
import { toPackageDetail } from '../../client/src/components/sim/packageDetailModel';

const businesses: Business[] = [
  { id: 'biz-a', name: 'Alpha Bakery', nodeId: 'n-0-0', district: 'D' },
  { id: 'biz-b', name: 'Beta Books', nodeId: 'n-5-5', district: 'N' },
];
const hubs: Hub[] = [{ id: 'hub-x', name: 'Central Hub', nodeId: 'n-3-3' }];
const employees = [
  { id: 'emp-1', name: 'Ana' }, { id: 'emp-2', name: 'Ben' },
] as Employee[];
const ship = (n: number): Shipment => ({
  id: `shp-${n}`, clientRequestId: `c${n}`, label: `Package ${n}`,
  originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', readyMin: 1000, deadlineMin: 1900,
  category: 'envelope', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});
const stop = (nodeId: string, kind: 'pickup' | 'hub_drop' | 'hub_pickup' | 'delivery', t: number) =>
  ({ nodeId, kind, arrivalMin: t - 1, serviceStartMin: t, serviceEndMin: t + 2 });
const leg = (emp: string, a: ReturnType<typeof stop>, b: ReturnType<typeof stop>, extra: number): Leg => ({
  tripId: `${emp}-eve`, employeeId: emp, routeNodeIds: [], stops: [a, b],
  finishMin: b.serviceEndMin, extraMin: extra, extraDistanceM: 0, rewardCents: 300,
});
const direct: DeliveryPlan = {
  id: 'plan-shp-1', shipmentId: 'shp-1', kind: 'direct', deliveryMin: 1100,
  customerPriceCents: 1000, platformContributionCents: 0,
  legs: [leg('emp-1', stop('n-0-0', 'pickup', 1000), stop('n-5-5', 'delivery', 1100), 5)],
};
const relay: DeliveryPlan = {
  id: 'plan-shp-2', shipmentId: 'shp-2', kind: 'relay', hubId: 'hub-x', deliveryMin: 2000,
  customerPriceCents: 1000, platformContributionCents: 0,
  legs: [
    leg('emp-1', stop('n-0-0', 'pickup', 1000), stop('n-3-3', 'hub_drop', 1050), 3),
    leg('emp-2', stop('n-3-3', 'hub_pickup', 1900), stop('n-5-5', 'delivery', 2000), 4),
  ],
};
const sim = {
  shipments: [ship(1), ship(2), ship(3)],
  plans: [direct, relay],
  unmatched: [{ shipmentId: 'shp-3', reason: 'No commute fits the deadline' }],
  snapshot: {
    shipmentStatus: { 'shp-1': 'delivered', 'shp-2': 'at_hub', 'shp-3': 'unmatched' },
    deliveredAtMin: { 'shp-1': 1102 },
  },
} as unknown as SimulatorResponse;
const get = (id: string) => toPackageDetail({ sim, businesses, hubs, employees, shipmentId: id });

describe('package detail model', () => {
  it('returns null for unknown shipment', () => expect(get('shp-99')).toBeNull());

  it('direct + delivered', () => {
    const d = get('shp-1')!;
    expect(d.route).toBe('Alpha Bakery → Beta Books');
    expect(d.statusLabel).toBe('Delivered');
    expect(d.planKind).toBe('Direct');
    expect(d.legs).toHaveLength(1);
    expect(d.legs[0]).toMatchObject({
      employeeName: 'Ana', pickupPlace: 'Alpha Bakery', dropoffPlace: 'Beta Books',
      extraLabel: '+5 min added', rewardCents: 300,
    });
    expect(d.timeLabel).toBe('Delivered');
    expect(d.timeValue).toBe('Day 1, 6:22 PM');
    expect(d.priceCents).toBe(1000);
    expect(d.unmatchedReason).toBeUndefined();
  });

  it('relay uses hub name and planned ETA', () => {
    const d = get('shp-2')!;
    expect(d.statusLabel).toBe('At hub');
    expect(d.planKind).toBe('Relay via Central Hub');
    expect(d.legs.map((l) => l.employeeName)).toEqual(['Ana', 'Ben']);
    expect(d.legs[0].dropoffPlace).toBe('Central Hub');
    expect(d.legs[1].pickupPlace).toBe('Central Hub');
    expect(d.timeLabel).toBe('Planned ETA');
    expect(d.timeValue).toBe('Day 2, 9:20 AM');
  });

  it('unmatched shows reason and no plan', () => {
    const d = get('shp-3')!;
    expect(d.statusLabel).toBe('Unmatched');
    expect(d.unmatchedReason).toBe('No commute fits the deadline');
    expect(d.legs).toEqual([]);
    expect(d.planKind).toBeUndefined();
  });

  it('builds tracking and job links', () => {
    const d = get('shp-2')!;
    expect(d.senderHref).toBe('/business/biz-a?shipment=shp-2');
    expect(d.recipientHref).toBe('/business/biz-b?shipment=shp-2');
    expect(d.legs.map((l) => l.href)).toEqual([
      '/employee/emp-1?job=plan-shp-2-L0', '/employee/emp-2?job=plan-shp-2-L1',
    ]);
  });
});
