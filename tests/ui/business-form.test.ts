import { describe, expect, it } from 'vitest';
import type { Shipment } from '../../shared/types';
import { defaultForm, fromShipment, toRequest, validate } from '../../client/src/components/business/shipmentFormModel';

const valid = () => ({
  ...defaultForm(), originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
  label: 'Contracts', description: 'Signed contracts',
});

describe('shipment form model', () => {
  it('defaults to ready Day 1 16:00 and deliver-by Day 2 10:00', () => {
    const req = toRequest(valid(), 'req-1');
    expect(req.readyMin).toBe(960);
    expect(req.deadlineMin).toBe(2040);
    expect(req.weightKg).toBe(0.5);
    expect(req.clientRequestId).toBe('req-1');
    expect(validate(valid())).toEqual({});
  });

  it('round-trips a shipment through fromShipment and toRequest', () => {
    const s: Shipment = {
      id: 'shp-1', clientRequestId: 'c1', label: 'Box', originBusinessId: 'biz-a', destinationBusinessId: 'biz-b',
      readyMin: 1010, deadlineMin: 1985, category: 'small_box', description: 'Parts', weightGrams: 1250,
      pickupInstructions: 'Front desk', dropoffInstructions: '', createdSeq: 1,
    };
    const form = fromShipment(s);
    expect(form.weightKg).toBe('1.25');
    expect(form).toMatchObject({ readyDay: 1, readyTime: '16:50', deadlineDay: 2, deadlineTime: '09:05' });
    const req = toRequest(form, 'c2');
    expect(req).toMatchObject({
      originBusinessId: 'biz-a', destinationBusinessId: 'biz-b', label: 'Box', category: 'small_box',
      description: 'Parts', weightKg: 1.25, readyMin: 1010, deadlineMin: 1985, pickupInstructions: 'Front desk',
    });
  });

  it('flags weight 2.5 kg and a same-origin destination', () => {
    const errs = validate({ ...valid(), weightKg: '2.5', destinationBusinessId: 'biz-a' });
    expect(errs.weightKg).toMatch(/2 kg/);
    expect(errs.destinationBusinessId).toBeTruthy();
  });

  it('flags empty fields and deadline before ready', () => {
    const errs = validate({ ...defaultForm(), originBusinessId: 'biz-a', deadlineDay: 1, deadlineTime: '09:00' });
    expect(errs.label).toBeTruthy();
    expect(errs.description).toBeTruthy();
    expect(errs.destinationBusinessId).toBeTruthy();
    expect(errs.deadlineMin).toMatch(/after/);
  });
});
