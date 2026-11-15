// planPatchShipment, planMatchRetry and withShipment: every result kind, as tables.
// `checked` (v2-shipment-ops-sample.ts) also proves, for every case: the run is untouched,
// the same request gives a deep-equal result, and a refusal's text is clean.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEADLINE_BEFORE_READY, DEADLINE_OUTSIDE_WINDOW, INVALID_SHIPMENT, READY_OUTSIDE_WINDOW, SAME_BUSINESS,
  SHIPMENTS_LOCKED, SHIPMENT_MATCHED, SHIPMENT_NOT_FOUND, UNKNOWN_BUSINESS,
  planCreateShipment, planMatchRetry, planPatchShipment, withShipment,
} from '../../server/api/v2/shipmentOps';
import { shipmentView } from '../../server/api/v2/views';
import { ApiError } from '../../shared/v2/schemas';
import type { Shipment } from '../../shared/v2/types';
import { shp1, shp2, shp3, snapshotStart } from './v2-sample';
import { checked, createBody, lockedRun, planningRun, runWithShipments } from './v2-shipment-ops-sample';

// shp-3 is the unmatched request: Studio -> Agency, ready 1100, deadline 1140.
const patch = (id: string, body: unknown, run = planningRun) => checked(run, (r) => planPatchShipment(r, id, body));
const retry = (id: string, run = planningRun) => checked(run, (r) => planMatchRetry(r, id));

const NOT_FOUND = { kind: 'not_found', status: 404, error: { error: SHIPMENT_NOT_FOUND } };
const LOCKED = { kind: 'locked', status: 409, error: { error: SHIPMENTS_LOCKED } };
const MATCHED = { kind: 'matched', status: 409, error: { error: SHIPMENT_MATCHED } };

describe('planPatchShipment: refusals', () => {
  const cases: [string, string, unknown, typeof planningRun, unknown][] = [
    ['unknown ID', 'shp-99', { label: 'x' }, planningRun, NOT_FOUND],
    ['unknown ID with a body that is not valid', 'nope', 'text', planningRun, NOT_FOUND],
    ['unknown ID while locked', 'shp-99', { label: 'x' }, lockedRun, NOT_FOUND],
    ['locked, unmatched shipment', 'shp-3', { label: 'x' }, lockedRun, LOCKED],
    ['locked, matched shipment', 'shp-1', { label: 'x' }, lockedRun, LOCKED],
    ['locked, with a body that is not valid', 'shp-3', { label: '' }, lockedRun, LOCKED],
    ['a relay-matched shipment', 'shp-1', { label: 'x' }, planningRun, MATCHED],
    ['a direct-matched shipment', 'shp-2', { deadlineMin: 1300 }, planningRun, MATCHED],
    ['a matched shipment with an empty patch', 'shp-2', {}, planningRun, MATCHED],
    ['a matched shipment with a body that is not valid', 'shp-1', { weightKg: 9 }, planningRun, MATCHED],
  ];
  for (const [name, id, body, run, expected] of cases) {
    it(name, () => expect(patch(id, body, run)).toEqual(expected));
  }
});

describe('planPatchShipment: invalid (400)', () => {
  const cases: [string, unknown, Record<string, string>][] = [
    ['a string body', 'rename it', { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['a null body', null, { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['no body', undefined, { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['an array body', [{ label: 'x' }], { body: 'The delivery details did not arrive, so reload the page and send again' }],
    ['a blank name', { label: '  ' }, { label: 'Package name is required' }],
    ['a null name', { label: null }, { label: 'Package name is required' }],
    ['a blank description', { description: '' }, { description: 'Describe the contents' }],
    ['an unknown category', { category: 'pallet' }, { category: 'Choose envelope or small box' }],
    ['weight of zero', { weightKg: 0 }, { weightKg: 'Weight must be above 0 kg' }],
    ['weight above 2 kg', { weightKg: 5 }, { weightKg: 'Max 2 kg' }],
    ['weight as text', { weightKg: 'heavy' }, { weightKg: 'Weight must be a number of kg' }],
    ['a deadline before the stored ready time', { deadlineMin: 1000 }, { deadlineMin: DEADLINE_BEFORE_READY }],
    ['a deadline equal to the stored ready time', { deadlineMin: 1100 }, { deadlineMin: DEADLINE_BEFORE_READY }],
    ['a ready time after the stored deadline', { readyMin: 1200 }, { deadlineMin: DEADLINE_BEFORE_READY }],
    ['a deadline after the planning window', { deadlineMin: 2161 }, { deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['a ready time before the planning window', { readyMin: 929 }, { readyMin: READY_OUTSIDE_WINDOW }],
    ['times the schema itself rejects', { readyMin: -1, deadlineMin: 5000 },
      { readyMin: READY_OUTSIDE_WINDOW, deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['a time that is not a whole minute', { deadlineMin: 1139.5 }, { deadlineMin: 'Deliver-by must be a whole minute' }],
    ['the sender as the new recipient', { destinationBusinessId: 'biz-studio' }, { destinationBusinessId: SAME_BUSINESS }],
    ['an unknown recipient', { destinationBusinessId: 'biz-nowhere' }, { destinationBusinessId: UNKNOWN_BUSINESS }],
    ['an empty recipient', { destinationBusinessId: '' }, { destinationBusinessId: 'Choose a recipient' }],
    ['instructions that are not text', { pickupInstructions: 3 }, { pickupInstructions: 'Pickup instructions must be text' }],
    // One response lists the body's problems and the run's problems together.
    ['a blank name, an unknown recipient and a deadline outside the window',
      { label: '', destinationBusinessId: 'biz-nowhere', deadlineMin: 2500 },
      { label: 'Package name is required', destinationBusinessId: UNKNOWN_BUSINESS, deadlineMin: DEADLINE_OUTSIDE_WINDOW }],
    ['too heavy, and ready after the new deadline', { weightKg: 3, readyMin: 1500, deadlineMin: 1400 },
      { weightKg: 'Max 2 kg', deadlineMin: DEADLINE_BEFORE_READY }],
  ];
  for (const [name, body, expected] of cases) {
    it(name, () => {
      const result = patch('shp-3', body);
      expect(result).toEqual({ kind: 'invalid', status: 400, error: { error: INVALID_SHIPMENT, fieldErrors: expected } });
      if (result.kind === 'invalid') expect(ApiError.safeParse(result.error).success).toBe(true);
    });
  }
});

describe('planPatchShipment: patch', () => {
  const cases: [string, unknown, Partial<Shipment>][] = [
    ['an empty patch keeps the shipment as stored (the route still retries the match)', {}, {}],
    ['name, trimmed', { label: '  Colour samples v2 ' }, { label: 'Colour samples v2' }],
    ['category and description', { category: 'small_box', description: 'Two swatch books' },
      { category: 'small_box', description: 'Two swatch books' }],
    ['weight in kg becomes grams', { weightKg: 1.5 }, { weightGrams: 1500 }],
    ['weight is rounded to whole grams', { weightKg: 0.3336 }, { weightGrams: 334 }],
    ['a later deadline', { deadlineMin: 2000 }, { deadlineMin: 2000 }],
    ['both times, on the edges of the window', { readyMin: 930, deadlineMin: 2160 }, { readyMin: 930, deadlineMin: 2160 }],
    ['a new recipient', { destinationBusinessId: 'biz-cafe' }, { destinationBusinessId: 'biz-cafe' }],
    ['instructions, also cleared to ""', { pickupInstructions: 'Side door', dropoffInstructions: '' },
      { pickupInstructions: 'Side door', dropoffInstructions: '' }],
    ['fields a patch may not change are ignored',
      { id: 'shp-77', createdSeq: 77, clientRequestId: 'req-other', originBusinessId: 'biz-agency', weightGrams: 1, label: 'Kept ID' },
      { label: 'Kept ID' }],
  ];
  for (const [name, body, changes] of cases) {
    it(name, () => {
      const result = patch('shp-3', body);
      expect(result).toEqual({ kind: 'patch', shipment: { ...shp3, ...changes } });
      if (result.kind !== 'patch') return;
      // Same ID, same createdSeq, same request ID, same sender; and a new object, not the stored one.
      expect(result.shipment).toMatchObject({ id: 'shp-3', createdSeq: 3, clientRequestId: 'req-3', originBusinessId: 'biz-studio' });
      expect(result.shipment).not.toBe(planningRun.scenario.shipments[2]);
      expect(Object.keys(result.shipment).sort()).toEqual(Object.keys(shp3).sort());
    });
  }
});

describe('planMatchRetry', () => {
  const cases: [string, string, typeof planningRun, unknown][] = [
    ['unknown ID', 'shp-99', planningRun, NOT_FOUND],
    ['unknown ID while locked', 'shp-99', lockedRun, NOT_FOUND],
    ['locked, unmatched shipment', 'shp-3', lockedRun, LOCKED],
    ['locked, matched shipment', 'shp-1', lockedRun, LOCKED],
    ['a relay-matched shipment', 'shp-1', planningRun, { kind: 'already_matched', shipmentId: 'shp-1' }],
    ['a direct-matched shipment', 'shp-2', planningRun, { kind: 'already_matched', shipmentId: 'shp-2' }],
    ['an unmatched shipment', 'shp-3', planningRun, { kind: 'match', shipmentId: 'shp-3' }],
  ];
  for (const [name, id, run, expected] of cases) {
    it(name, () => expect(retry(id, run)).toEqual(expected));
  }

  it('a shipment that was just stored is retried', () => {
    const created = planCreateShipment(planningRun, createBody());
    if (created.kind !== 'create') throw new Error(created.kind);
    expect(retry('shp-4', withShipment(planningRun, created.shipment))).toEqual({ kind: 'match', shipmentId: 'shp-4' });
  });
});

describe('withShipment', () => {
  const shp4: Shipment = { ...shp3, id: 'shp-4', clientRequestId: 'req-4', label: 'Fourth', createdSeq: 4 };
  const store = (shipment: Shipment, run = planningRun) => checked(run, (r) => withShipment(r, shipment));

  it('adds a new shipment at the end and raises the version by one', () => {
    const next = store(shp4);
    expect(next.scenario.shipments).toEqual([shp1, shp2, shp3, shp4]);
    expect(next.version).toBe(planningRun.version + 1);
    expect(planningRun.scenario.shipments).toEqual([shp1, shp2, shp3]);
    expect(planningRun.version).toBe(12);
  });

  it('replaces the stored shipment with the same ID, in the same place', () => {
    const edited = { ...shp2, label: 'Edited' };
    const next = store(edited);
    expect(next.scenario.shipments).toEqual([shp1, edited, shp3]);
    expect(next.version).toBe(planningRun.version + 1);
  });

  it('keeps createdSeq order whatever order the run had', () => {
    const run = runWithShipments([shp3, shp1]);
    expect(store(shp2, run).scenario.shipments.map((s) => s.id)).toEqual(['shp-1', 'shp-2', 'shp-3']);
    expect(store(shp4, run).scenario.shipments.map((s) => s.id)).toEqual(['shp-1', 'shp-3', 'shp-4']);
  });

  it('changes nothing else, and returns new objects only where something changed', () => {
    const next = withShipment(planningRun, shp4);
    const { version: _v, scenario: nextScenario, ...restOfNext } = next;
    const { version: _w, scenario, ...rest } = planningRun;
    expect(restOfNext).toEqual(rest);
    expect({ ...nextScenario, shipments: [] }).toEqual({ ...scenario, shipments: [] });
    expect(next).not.toBe(planningRun);
    expect(next.scenario).not.toBe(planningRun.scenario);
    expect(next.scenario.shipments).not.toBe(planningRun.scenario.shipments);
    expect(next.assignments).toBe(planningRun.assignments);
  });

  it('create -> store -> replay -> edit -> store, read back through the v2 view', () => {
    const created = planCreateShipment(planningRun, createBody({ readyMin: 2100, deadlineMin: 2101 }));
    if (created.kind !== 'create') throw new Error(created.kind);
    const stored = withShipment(planningRun, created.shipment);
    expect(planCreateShipment(stored, createBody())).toEqual({ kind: 'replay', shipmentId: 'shp-4' });

    const edit = planPatchShipment(stored, 'shp-4', { deadlineMin: 2160, label: 'Edited gift box' });
    if (edit.kind !== 'patch') throw new Error(edit.kind);
    const saved = withShipment(stored, edit.shipment);
    expect(saved.version).toBe(planningRun.version + 2);
    expect(saved.scenario.shipments.map((s) => s.id)).toEqual(['shp-1', 'shp-2', 'shp-3', 'shp-4']);

    const view = shipmentView(saved, snapshotStart, 'shp-4');
    expect(view).toMatchObject({
      shipment: { id: 'shp-4', label: 'Edited gift box', deadlineMin: 2160, createdSeq: 4 },
      plan: null, jobIds: [], status: 'unmatched',
    });
  });
});

describe('shipmentOps.ts stays pure', () => {
  const source = readFileSync(new URL('../../server/api/v2/shipmentOps.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports only the v2 contracts', () => {
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../../../shared/v2/schemas', '../../../shared/v2/types']);
    expect(code).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('has no clock, no randomness, no fs and no environment', () => {
    expect(code).not.toMatch(/\bDate\b|performance\.|Math\.random|randomUUID|process\.|\bfs\b/);
  });
});
