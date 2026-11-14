import { describe, expect, it } from 'vitest';
import type { Shipment } from '../../shared/types';
import { formFromShipment } from '../../client/src/components/business/shipmentFormModel';

describe('formFromShipment', () => {
  const s: Shipment = {
    id: 'shp-1', clientRequestId: 'c1', label: 'Contracts', originBusinessId: 'b1', destinationBusinessId: 'b2',
    readyMin: 1440 + 5, deadlineMin: 1440 + 9 * 60 + 30, category: 'small_box', description: 'Docs',
    weightGrams: 1250, pickupInstructions: 'Front desk', dropoffInstructions: 'Ring bell', createdSeq: 1,
  };
  it('converts grams to kg, minutes to day/time and keeps instructions', () => {
    const f = formFromShipment(s);
    expect(f).toMatchObject({
      weightKg: '1.25', readyDay: 2, readyTime: '00:05', deadlineDay: 2, deadlineTime: '09:30',
      pickupInstructions: 'Front desk', dropoffInstructions: 'Ring bell', category: 'small_box', destinationBusinessId: 'b2',
    });
  });
});
