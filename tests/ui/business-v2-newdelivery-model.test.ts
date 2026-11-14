import { describe, expect, it } from 'vitest';
import { CreateShipmentRequest } from '../../shared/v2/schemas';
import type { ShipmentResponse } from '../../shared/v2/api';
import {
  draftAfterResult, emptyDraft, firstInvalidField, initialSubmitState, recipientOptions, submitReducer,
  toRequest, validate, type NewDeliveryDraft, type SubmitState,
} from '../../client/src/components/business/v2/newDeliveryModel';
import { BUSINESSES, ME, shipment } from './business-v2-table-sample';

const valid = (over: Partial<NewDeliveryDraft> = {}): NewDeliveryDraft => ({
  ...emptyDraft(), recipientId: 'biz-bakery', label: 'Contracts', description: 'Signed copies', ...over,
});

const response = (matched: boolean, unmatchedReason: string | null = null): ShipmentResponse => ({
  shipment: shipment('shp-9', {}), plan: null, jobIds: [], status: matched ? 'matched' : 'unmatched',
  deliveredAtMin: null, unmatchedReason, matched,
} as ShipmentResponse);

const httpError = (status: number, message: string, extra: object = {}) =>
  Object.assign(new Error(message), { status, ...extra });

describe('recipientOptions', () => {
  it('lists every other business as "name · neighborhood", sorted by name, without the sender', () => {
    const opts = recipientOptions(BUSINESSES, ME.id);
    expect(opts.map((o) => o.id)).not.toContain(ME.id);
    expect(opts).toHaveLength(BUSINESSES.length - 1);
    expect(opts.map((o) => o.label)).toEqual([
      'Atlas Books · Midtown', 'Bakery Row · Midtown', 'Corner Cafe · Midtown', 'Print Shop · Midtown',
    ]);
  });
});

describe('validate', () => {
  it('accepts the defaults with a recipient, name and contents', () => {
    expect(validate(valid(), ME.id)).toEqual({});
  });

  it('has one message per field', () => {
    const e = validate({ ...emptyDraft(), weightKg: '', readyTime: '', deadlineTime: '' }, ME.id);
    expect(e).toEqual({
      recipientId: 'Choose a recipient business',
      label: 'Package name is required',
      weightKg: 'Enter a weight in kg, for example 0.5',
      description: 'Describe the contents',
      readyTime: 'Enter a ready time as HH:MM',
      deadlineTime: 'Enter a deliver-by time as HH:MM',
    });
    expect(firstInvalidField(e)).toBe('recipientId');
  });

  it('rejects the sender as recipient, blank text and a bad category', () => {
    expect(validate(valid({ recipientId: ME.id }), ME.id).recipientId).toBe('Choose a different business');
    expect(validate(valid({ label: '   ' }), ME.id).label).toBe('Package name is required');
    expect(validate(valid({ category: 'crate' as never }), ME.id).category).toBe('Choose envelope or small box');
  });

  it('checks the weight like MVP 1', () => {
    expect(validate(valid({ weightKg: '0' }), ME.id).weightKg).toBe('Weight must be above 0 kg');
    expect(validate(valid({ weightKg: '2.5' }), ME.id).weightKg).toBe('Max 2 kg');
    expect(validate(valid({ weightKg: '1,5' }), ME.id).weightKg).toMatch(/dot/);
    expect(validate(valid({ weightKg: 'abc' }), ME.id).weightKg).toMatch(/number/);
    expect(validate(valid({ weightKg: '2' }), ME.id).weightKg).toBeUndefined();
  });

  it('keeps times inside the simulation window, ready on Day 1, deadline after ready', () => {
    expect(validate(valid({ readyTime: '09:00' }), ME.id).readyTime)
      .toBe('Ready time must be between Day 1 15:30 and Day 1 23:59');
    expect(validate(valid({ deadlineDay: 2, deadlineTime: '13:00' }), ME.id).deadlineTime)
      .toBe('Deliver-by time must be between Day 1 15:30 and Day 2 12:00');
    expect(validate(valid({ readyTime: '18:00', deadlineDay: 1, deadlineTime: '17:00' }), ME.id).deadlineTime)
      .toBe('Deliver-by must be after ready time');
    expect(validate(valid({ readyTime: '18:00', deadlineDay: 1, deadlineTime: '18:00' }), ME.id).deadlineTime)
      .toBe('Deliver-by must be after ready time');
    expect(validate(valid({ readyTime: '18:00', deadlineDay: 1, deadlineTime: '22:00' }), ME.id)).toEqual({});
    expect(validate(valid({ readyTime: '25:00' }), ME.id).readyTime).toBe('Enter a ready time as HH:MM');
    expect(validate(valid({ readyTime: '16:00' }), ME.id, { startMin: 1000, endMin: 2000 }).readyTime)
      .toBe('Ready time must be between Day 1 16:40 and Day 1 23:59');
  });
});

describe('toRequest', () => {
  it('produces a body that parses with CreateShipmentRequest (grams rounded, minutes)', () => {
    const req = toRequest(valid({ weightKg: '1.2346', readyTime: '16:30', deadlineDay: 2, deadlineTime: '09:15',
      pickupInstructions: ' Front desk ' }), ME.id, 'req-1');
    expect(CreateShipmentRequest.safeParse(req).success).toBe(true);
    expect(req).toMatchObject({
      clientRequestId: 'req-1', originBusinessId: ME.id, destinationBusinessId: 'biz-bakery',
      weightKg: 1.235, readyMin: 990, deadlineMin: 1440 + 555, pickupInstructions: 'Front desk',
    });
    expect(Math.round(req.weightKg * 1000)).toBe(1235);
  });
});

describe('submitReducer', () => {
  const start: SubmitState = initialSubmitState('req-a');

  it('201 matched: shipment ID and a new request ID', () => {
    const s = submitReducer(submitReducer(start, { type: 'submit' }), { type: 'success', response: response(true), nextRequestId: 'req-b' });
    expect(s).toEqual({ status: { kind: 'matched', shipmentId: 'shp-9' }, clientRequestId: 'req-b' });
  });

  it('201 unmatched: shipment ID + reason, and a new request ID', () => {
    const s = submitReducer(start, { type: 'success', response: response(false, 'No commute passes near Bakery Row in time.'), nextRequestId: 'req-b' });
    expect(s.status).toEqual({ kind: 'unmatched', shipmentId: 'shp-9', reason: 'No commute passes near Bakery Row in time.' });
    expect(s.clientRequestId).toBe('req-b');
    expect(submitReducer(start, { type: 'success', response: response(false, '  '), nextRequestId: 'x' }).status)
      .toEqual({ kind: 'unmatched', shipmentId: 'shp-9', reason: null });
  });

  it('409 is locked', () => {
    expect(submitReducer(start, { type: 'failure', error: httpError(409, 'Locked') }).status).toEqual({ kind: 'locked', message: 'Locked' });
  });

  it.each(['google_key_missing', 'travel_data_missing', 'google_unavailable'] as const)('503 %s is unavailable', (code) => {
    expect(submitReducer(start, { type: 'failure', error: httpError(503, 'x', { code }) }).status).toEqual({ kind: 'unavailable', code });
  });

  it('a 503 without a travel code is a plain error with the server message', () => {
    expect(submitReducer(start, { type: 'failure', error: httpError(503, 'NYC data not loaded') }).status)
      .toEqual({ kind: 'error', message: 'NYC data not loaded', fieldErrors: {} });
  });

  it('400 with field errors maps them onto the form fields', () => {
    const s = submitReducer(start, { type: 'failure', error: httpError(400, 'Invalid shipment', {
      fieldErrors: { destinationBusinessId: 'Unknown business', deadlineMin: 'Too late', other: 'ignored' },
    }) });
    expect(s.status).toEqual({
      kind: 'error', message: 'Invalid shipment',
      fieldErrors: { recipientId: 'Unknown business', deadlineTime: 'Too late' },
    });
  });

  it('a failure without a message falls back to a readable one', () => {
    expect(submitReducer(start, { type: 'failure', error: null }).status)
      .toEqual({ kind: 'error', message: 'The request failed. Please try again.', fieldErrors: {} });
  });

  it('keeps the request ID across failed retries and replaces it only after a success', () => {
    let s = start;
    for (const error of [httpError(0, 'Network error'), httpError(503, 'x', { code: 'google_unavailable' }), httpError(409, 'L')]) {
      s = submitReducer(submitReducer(s, { type: 'submit' }), { type: 'failure', error });
      expect(s.clientRequestId).toBe('req-a');
    }
    s = submitReducer(submitReducer(s, { type: 'submit' }), { type: 'success', response: response(true), nextRequestId: 'req-b' });
    expect(s.clientRequestId).toBe('req-b');
    expect(submitReducer(s, { type: 'dismiss' })).toEqual({ status: { kind: 'idle' }, clientRequestId: 'req-b' });
  });
});

describe('draftAfterResult', () => {
  it('starts a fresh package (recipient kept) after a match, keeps the draft otherwise', () => {
    const d = valid({ label: 'X' });
    expect(draftAfterResult(d, { kind: 'matched', shipmentId: 's' })).toEqual({ ...emptyDraft(), recipientId: 'biz-bakery' });
    expect(draftAfterResult(d, { kind: 'unmatched', shipmentId: 's', reason: null })).toBe(d);
  });
});
