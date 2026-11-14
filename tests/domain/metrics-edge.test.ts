import { describe, expect, it } from 'vitest';
import type { Metrics, Shipment } from '../../shared/types.js';
import { computeMetrics } from '../../server/domain/metrics.js';
import { DEFAULT_SETTINGS } from '../../server/domain/pricing.js';

function expectFiniteMetrics(metrics: Metrics) {
  for (const value of Object.values(metrics)) {
    expect(value === null || (typeof value === 'number' && Number.isFinite(value))).toBe(true);
  }
}

const unmatchedShipments: Shipment[] = [
  {
    id: 'shp-1', clientRequestId: 'request-1', label: 'Sample one',
    originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
    readyMin: 960, deadlineMin: 2040, category: 'envelope', description: 'Documents',
    weightGrams: 100, pickupInstructions: '', dropoffInstructions: '', createdSeq: 1,
  },
  {
    id: 'shp-2', clientRequestId: 'request-2', label: 'Sample two',
    originBusinessId: 'biz-b', destinationBusinessId: 'biz-a',
    readyMin: 960, deadlineMin: 2040, category: 'small_box', description: 'Samples',
    weightGrams: 200, pickupInstructions: '', dropoffInstructions: '', createdSeq: 2,
  },
];

describe('computeMetrics edge cases', () => {
  it('returns only finite values or null for an empty run', () => {
    const metrics = computeMetrics({
      shipments: [], plans: [], unmatched: [], occurredEvents: [], settings: DEFAULT_SETTINGS,
    });

    expectFiniteMetrics(metrics);
    expect(metrics.avgExtraMinPerTrip).toBeNull();
    expect(metrics.maxExtraMin).toBeNull();
  });

  it('returns only finite values or null when every shipment is unmatched', () => {
    const metrics = computeMetrics({
      shipments: unmatchedShipments,
      plans: [],
      unmatched: unmatchedShipments.map(shipment => ({ shipmentId: shipment.id, reason: 'No commute' })),
      occurredEvents: [],
      settings: DEFAULT_SETTINGS,
    });

    expectFiniteMetrics(metrics);
    expect(metrics).toMatchObject({
      requested: 2, matched: 0, delivered: 0, unmatched: 2,
      avgExtraMinPerTrip: null, maxExtraMin: null,
      projectedCustomerSpendCents: 2 * DEFAULT_SETTINGS.courierPriceCents,
    });
  });
});
