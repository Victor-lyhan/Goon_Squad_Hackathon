import { describe, expect, it } from 'vitest';
import type { Notification, Shipment } from '../../shared/types';
import { newestFirst, newMatchedNotifications, patchFromRequest } from '../../client/src/components/business/businessPortalModel';
import { formFromShipment, toRequest } from '../../client/src/components/business/shipmentFormModel';

const n = (id: string, seq: number, kind: Notification['kind'] = 'delivery_matched'): Notification => ({
  id, audience: 'business', audienceId: 'b1', kind, shipmentId: 's', planId: 'p', message: id, createdSeq: seq,
});

describe('notifications', () => {
  it('sorts newest first', () => {
    expect(newestFirst([n('a', 1), n('c', 3), n('b', 2)]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('first poll toasts nothing', () => {
    expect(newMatchedNotifications(null, [n('a', 1)])).toEqual([]);
  });
  it('returns only unseen delivery_matched since last poll', () => {
    const seen = new Set(['a']);
    const out = newMatchedNotifications(seen, [n('a', 1), n('b', 2), n('c', 3, 'job_assigned'), n('d', 4)]);
    expect(out.map((x) => x.id)).toEqual(['d', 'b']);
    expect(newMatchedNotifications(new Set(['a', 'b', 'd']), [n('a', 1), n('b', 2), n('d', 4)])).toEqual([]);
  });
});

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
  it('builds a patch without create-only fields', () => {
    const patch = patchFromRequest(toRequest(formFromShipment(s), 'x'));
    expect(patch).not.toHaveProperty('clientRequestId');
    expect(patch).not.toHaveProperty('originBusinessId');
    expect(patch.weightKg).toBe(1.25);
  });
});
