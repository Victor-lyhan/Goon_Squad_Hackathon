// planCreateShipment: every result kind of POST /api/v2/shipments, as a table.
// `checked` (v2-shipment-ops-sample.ts) also proves, for every case: the run is untouched,
// the same request gives a deep-equal result, and a refusal's text is clean.
import { describe, expect, it } from 'vitest';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, INVALID_SHIPMENT, READY_OUTSIDE_WINDOW, SAME_BUSINESS,
  SHIPMENTS_LOCKED, UNKNOWN_BUSINESS, planCreateShipment, withShipment,
} from '../../server/api/v2/shipmentOps';
import { ApiError } from '../../shared/v2/schemas';
import type { Shipment } from '../../shared/v2/types';
import { shp1, shp2, shp3 } from './v2-sample';
import {
  checked, createBody, createBodyWithout, demoRun, lockedRun, planningRun, runWithShipments,
} from './v2-shipment-ops-sample';

const create = (body: unknown, run = planningRun) => checked(run, (r) => planCreateShipment(r, body));

/** The field errors of a 400, after checking the rest of the refusal. */
function fieldErrorsOf(result: ReturnType<typeof planCreateShipment>): Record<string, string> {
  if (result.kind !== 'invalid') throw new Error(`expected an invalid result, got ${result.kind}`);
  expect(result.status).toBe(400);
  expect(result.error.error).toBe(INVALID_SHIPMENT);
  expect(ApiError.safeParse(result.error).success).toBe(true);
  expect(Object.keys(result.error).sort()).toEqual(['error', 'fieldErrors']);
  return result.error.fieldErrors ?? {};
}

describe('planCreateShipment: invalid (400)', () => {
  const notObjects: [string, unknown][] = [
    ['a string', 'send a package'], ['a number', 42], ['true', true], ['null', null],
    ['no body at all', undefined], ['an array', [createBody()]],
  ];
  for (const [name, body] of notObjects) {
    it(`a body that is not an object: ${name}`, () => {
      expect(fieldErrorsOf(create(body))).toEqual({ body: 'Send the delivery details as a JSON object' });
    });
  }

  it('an empty object names every required field, and only those', () => {
    const errors = fieldErrorsOf(create({}));
    expect(Object.keys(errors).sort()).toEqual([
      'category', 'clientRequestId', 'deadlineMin', 'description', 'destinationBusinessId',
      'label', 'originBusinessId', 'readyMin', 'weightKg',
    ]);
    expect(errors).toMatchObject({
      originBusinessId: 'Choose a sender', destinationBusinessId: 'Choose a recipient',
      label: 'Package name is required', description: 'Describe the contents',
      readyMin: 'Choose a ready time', deadlineMin: 'Choose a deliver-by time',
    });
  });

  // One response lists every problem: what the schema rejects AND what the run rejects.
  const cases: [string, unknown, Record<string, string>][] = [
    ['missing fields and an unknown sender in one response',
      createBodyWithout(['label', 'weightKg'], { originBusinessId: 'biz-nowhere' }),
      { label: 'Package name is required', weightKg: 'Enter the weight in kg', originBusinessId: UNKNOWN_BUSINESS }],
    ['missing fields and an unknown recipient in one response',
      createBodyWithout(['description'], { destinationBusinessId: 'biz-nowhere' }),
      { description: 'Describe the contents', destinationBusinessId: UNKNOWN_BUSINESS }],
    ['a missing field, sender = recipient and both times outside the window',
      createBodyWithout(['category'], { destinationBusinessId: 'biz-studio', readyMin: 100, deadlineMin: 2500 }),
      { category: 'Choose a package type', destinationBusinessId: SAME_BUSINESS,
        readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['a missing field and a deadline before the ready time',
      createBodyWithout(['label'], { readyMin: 1200, deadlineMin: 1100 }),
      { label: 'Package name is required', deadlineMin: DEADLINE_BEFORE_READY }],
    ['sender = recipient', createBody({ destinationBusinessId: 'biz-studio' }), { destinationBusinessId: SAME_BUSINESS }],
    ['deadline equal to the ready time', createBody({ readyMin: 1000, deadlineMin: 1000 }), { deadlineMin: DEADLINE_BEFORE_READY }],
    ['deadline before the ready time', createBody({ readyMin: 1500, deadlineMin: 1000 }), { deadlineMin: DEADLINE_BEFORE_READY }],
    ['an unknown sender', createBody({ originBusinessId: 'biz-nowhere' }), { originBusinessId: UNKNOWN_BUSINESS }],
    ['an unknown recipient', createBody({ destinationBusinessId: 'biz-nowhere' }), { destinationBusinessId: UNKNOWN_BUSINESS }],
    ['unknown sender and recipient, ready and deadline outside the window',
      createBody({ originBusinessId: 'biz-x', destinationBusinessId: 'biz-y', readyMin: 929, deadlineMin: 2161 }),
      { originBusinessId: UNKNOWN_BUSINESS, destinationBusinessId: UNKNOWN_BUSINESS,
        readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['ready one minute before the window', createBody({ readyMin: 929 }), { readyMin: READY_OUTSIDE_WINDOW }],
    ['deadline one minute after the window', createBody({ deadlineMin: 2161 }), { deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['times the schema itself rejects', createBody({ readyMin: -5, deadlineMin: 99999 }),
      { readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['a time that is not a whole minute', createBody({ readyMin: 1000.5 }), { readyMin: 'Ready time must be a whole minute' }],
    ['a time sent as text', createBody({ deadlineMin: '2000' }), { deadlineMin: 'Deliver-by must be a whole minute' }],
    ['weight of zero', createBody({ weightKg: 0 }), { weightKg: 'Weight must be above 0 kg' }],
    ['weight above 2 kg', createBody({ weightKg: 2.5 }), { weightKg: 'Max 2 kg' }],
    ['weight sent as text', createBody({ weightKg: '1' }), { weightKg: 'Weight must be a number of kg' }],
    ['a blank package name', createBody({ label: '   ' }), { label: 'Package name is required' }],
    ['a blank description', createBody({ description: '' }), { description: 'Describe the contents' }],
    ['an unknown category', createBody({ category: 'crate' }), { category: 'Choose envelope or small box' }],
    ['an empty request ID', createBody({ clientRequestId: '' }), { clientRequestId: 'A request ID is required' }],
    ['an empty sender', createBody({ originBusinessId: '' }), { originBusinessId: 'Choose a sender' }],
    ['a sender that is not text', createBody({ originBusinessId: 7 }), { originBusinessId: 'Choose a sender' }],
    ['instructions that are not text', createBody({ pickupInstructions: 5, dropoffInstructions: null }),
      { pickupInstructions: 'Pickup instructions must be text', dropoffInstructions: 'Drop-off instructions must be text' }],
  ];
  for (const [name, body, expected] of cases) {
    it(name, () => expect(fieldErrorsOf(create(body))).toEqual(expected));
  }

  it('a body the schema rejects is a 400 even while locked (MVP 1 order)', () => {
    expect(fieldErrorsOf(create(createBodyWithout(['label']), lockedRun))).toEqual({ label: 'Package name is required' });
  });
});

describe('planCreateShipment: locked (409)', () => {
  it('refuses a valid request while the run is locked', () => {
    expect(create(createBody(), lockedRun)).toEqual({ kind: 'locked', status: 409, error: { error: SHIPMENTS_LOCKED } });
    expect(SHIPMENTS_LOCKED).toBe('The simulation is playing. Press Back to start in the simulator to change deliveries.');
  });

  it('the lock comes before the business checks', () => {
    expect(create(createBody({ originBusinessId: 'biz-nowhere' }), lockedRun).kind).toBe('locked');
    expect(create(createBody({ destinationBusinessId: 'biz-nowhere' }), lockedRun).kind).toBe('locked');
  });
});

describe('planCreateShipment: replay', () => {
  it('returns the first ID for a stored clientRequestId', () => {
    const body = { ...createBody(), clientRequestId: 'req-3' };
    expect(create(body)).toEqual({ kind: 'replay', shipmentId: 'shp-3' });
  });

  it('returns the first ID even if the rest of the body differs', () => {
    const body = createBody({
      clientRequestId: 'req-1', label: 'Something else', category: 'envelope', weightKg: 0.1,
      originBusinessId: 'biz-cafe', destinationBusinessId: 'biz-studio', readyMin: 1500, deadlineMin: 1600,
    });
    expect(create(body)).toEqual({ kind: 'replay', shipmentId: 'shp-1' });
  });

  it('is checked before the business and time checks', () => {
    const body = createBody({
      clientRequestId: 'req-2', originBusinessId: 'biz-gone', destinationBusinessId: 'biz-also-gone',
      readyMin: 10, deadlineMin: 20,
    });
    expect(create(body)).toEqual({ kind: 'replay', shipmentId: 'shp-2' });
  });

  // DECISIONS pass 62: the delivery exists, so a repeated request is answered also after Play.
  it('comes before the lock: a stored clientRequestId is a replay while the run is locked', () => {
    expect(create(createBody({ clientRequestId: 'req-3' }), lockedRun)).toEqual({ kind: 'replay', shipmentId: 'shp-3' });
    expect(create(createBody({ clientRequestId: 'req-1', originBusinessId: 'biz-gone' }), lockedRun))
      .toEqual({ kind: 'replay', shipmentId: 'shp-1' });
  });

  it('a second POST after the first was stored is a replay of the new ID', () => {
    const first = create(createBody());
    if (first.kind !== 'create') throw new Error(first.kind);
    const stored = withShipment(planningRun, first.shipment);
    expect(create(createBody({ label: 'Clicked twice' }), stored)).toEqual({ kind: 'replay', shipmentId: first.shipment.id });
  });
});

describe('planCreateShipment: create', () => {
  it('builds the stored shipment: next ID, next createdSeq, grams from kg', () => {
    const expected: Shipment = {
      id: 'shp-4', clientRequestId: 'req-new', label: 'Gift box',
      originBusinessId: 'biz-studio', destinationBusinessId: 'biz-agency',
      readyMin: 1000, deadlineMin: 2000,
      category: 'small_box', description: 'Pastries for the team', weightGrams: 1200,
      pickupInstructions: 'Ask at the counter', dropoffInstructions: 'Leave at reception',
      createdSeq: 4,
    };
    expect(create(createBody())).toEqual({ kind: 'create', shipment: expected });
  });

  it('trims the texts, defaults the instructions to "" and drops fields that are not in the contract', () => {
    const body = createBodyWithout(['pickupInstructions', 'dropoffInstructions'], {
      label: '  Gift box  ', description: ' Pastries ', id: 'shp-999', createdSeq: 999, weightGrams: 5, status: 'delivered',
    });
    const result = create(body);
    if (result.kind !== 'create') throw new Error(result.kind);
    expect(result.shipment).toMatchObject({
      id: 'shp-4', createdSeq: 4, label: 'Gift box', description: 'Pastries',
      pickupInstructions: '', dropoffInstructions: '', weightGrams: 1200,
    });
    expect(Object.keys(result.shipment).sort()).toEqual(Object.keys(shp1).sort());
  });

  const weights: [number, number][] = [[0.25, 250], [2, 2000], [0.0004, 0], [0.0006, 1], [1.9996, 2000], [0.3333, 333]];
  for (const [kg, grams] of weights) {
    it(`weightGrams = round(${kg} kg * 1000) = ${grams}`, () => {
      const result = create(createBody({ weightKg: kg }));
      expect(result).toMatchObject({ kind: 'create', shipment: { weightGrams: grams } });
    });
  }

  it('accepts times on the edges of the planning window', () => {
    const result = create(createBody({ readyMin: 930, deadlineMin: 2160 }));
    expect(result).toMatchObject({ kind: 'create', shipment: { readyMin: 930, deadlineMin: 2160 } });
  });

  it('IDs continue after the demo city\'s 24 packages: shp-25, then shp-26', () => {
    const run = demoRun();
    expect(run.scenario.shipments.map((s) => s.id)).toEqual(Array.from({ length: 24 }, (_, i) => `shp-${i + 1}`));
    const [sender, recipient] = run.scenario.businesses;
    const body = createBody({ originBusinessId: sender.id, destinationBusinessId: recipient.id });

    const first = create(body, run);
    expect(first).toMatchObject({ kind: 'create', shipment: { id: 'shp-25', createdSeq: 25 } });
    if (first.kind !== 'create') throw new Error(first.kind);

    const second = create({ ...body, clientRequestId: 'req-next' }, withShipment(run, first.shipment));
    expect(second).toMatchObject({ kind: 'create', shipment: { id: 'shp-26', createdSeq: 26 } });
  });

  it('starts at shp-1 in a city without packages', () => {
    expect(create(createBody(), runWithShipments([]))).toMatchObject({ kind: 'create', shipment: { id: 'shp-1', createdSeq: 1 } });
  });

  it('createdSeq = highest existing + 1, whatever the order or the gaps', () => {
    const run = runWithShipments([{ ...shp3, createdSeq: 9 }, shp1, { ...shp2, createdSeq: 5 }]);
    expect(create(createBody(), run)).toMatchObject({ kind: 'create', shipment: { id: 'shp-10', createdSeq: 10 } });
  });

  it('never reuses a stored ID, even if an imported run numbers its IDs ahead of createdSeq', () => {
    const run = runWithShipments([shp1, { ...shp2, id: 'shp-40' }]);
    const result = create(createBody(), run);
    expect(result).toMatchObject({ kind: 'create', shipment: { id: 'shp-41', createdSeq: 41 } });
  });
});
