import { describe, expect, it } from 'vitest';
import type { Business, DeliveryPlan, Shipment, ShipmentProgress } from '../../shared/types';
import { countByStatus, filterRows, toQueueRows } from '../../client/src/components/sim/packageQueueModel';

const businesses: Business[] = [
  { id: 'biz-a', name: 'Alpha Bakery', nodeId: 'n-0-0', district: 'Downtown' },
  { id: 'biz-b', name: 'Beta Books', nodeId: 'n-0-1', district: 'Northside' },
];
const ship = (n: number, o: string, d: string): Shipment => ({
  id: `shp-${n}`, clientRequestId: `c${n}`, label: `Package ${n}`,
  originBusinessId: o, destinationBusinessId: d, readyMin: 1000, deadlineMin: 1900,
  category: 'envelope', description: '', weightGrams: 100,
  pickupInstructions: '', dropoffInstructions: '', createdSeq: n,
});
// given out of order to check sorting by createdSeq
const shipments = [ship(3, 'biz-a', 'biz-b'), ship(1, 'biz-a', 'biz-b'), ship(2, 'biz-b', 'biz-a')];
const plan = (shipmentId: string, kind: 'direct' | 'relay'): DeliveryPlan => ({
  id: `plan-${shipmentId}`, shipmentId, kind, legs: [], deliveryMin: 0,
  customerPriceCents: 1000, platformContributionCents: 0,
});
const plans = [plan('shp-1', 'relay'), plan('shp-2', 'direct')];
const status: Record<string, ShipmentProgress> = { 'shp-1': 'at_hub', 'shp-2': 'delivered' };

describe('package queue model', () => {
  const rows = toQueueRows(shipments, plans, status, businesses);

  it('sorts by createdSeq and uses business names', () => {
    expect(rows.map((r) => r.id)).toEqual(['shp-1', 'shp-2', 'shp-3']);
    expect(rows[0].sender).toBe('Alpha Bakery');
    expect(rows[0].recipient).toBe('Beta Books');
    expect(rows[1].sender).toBe('Beta Books');
    for (const r of rows) expect(`${r.sender}${r.recipient}`).not.toMatch(/biz-/);
  });

  it('tags from plan and defaults missing status to unmatched', () => {
    expect(rows.map((r) => r.tag)).toEqual(['Relay', 'Direct', undefined]);
    expect(rows.map((r) => r.status)).toEqual(['at_hub', 'delivered', 'unmatched']);
  });

  it('counts and filters', () => {
    const c = countByStatus(rows);
    expect(c.all).toBe(3);
    expect(c.at_hub).toBe(1);
    expect(c.delivered).toBe(1);
    expect(c.unmatched).toBe(1);
    expect(c.scheduled).toBe(0);
    expect(filterRows(rows, 'all')).toHaveLength(3);
    expect(filterRows(rows, 'delivered').map((r) => r.id)).toEqual(['shp-2']);
    expect(filterRows(rows, 'picked_up')).toEqual([]);
  });
});
