import { describe, expect, it } from 'vitest';
import { PutCommuteRequest } from '../../shared/v2/schemas';
import type { CommuteResponse } from '../../shared/v2/api';
import type { Employee, Home } from '../../shared/v2/types';
import {
  INITIAL_SAVE_STATE, draftFromSaved, eveningFromTimeInput, isDirty, minToTimeInput, morningFromTimeInput,
  nextDraft, parseMinutes, saveMessage, saveReducer, toRequest, type Draft,
} from '../../client/src/components/employee/v2/commuteFormModel';

const employee: Employee = {
  id: 'emp-001', name: 'Ana', businessId: 'biz-a', homeId: 'home-007',
  eveningDepartureMin: 1050, morningDepartureMin: 1950, maxExtraMin: 8,
  availableEvening: true, availableMorning: false,
};
const home: Home = { id: 'home-007', neighborhood: 'Astoria', lat: 40.7642, lng: -73.9235 };
const saved = { employee, home };
const clone = () => ({ employee: { ...employee }, home: { ...home } });

const response = (n: number): CommuteResponse => ({
  employee, home, trips: [], rematchedShipmentIds: Array.from({ length: n }, (_, i) => `shp-${i}`),
});

describe('draft and the pass 43 poll rule', () => {
  it('builds a draft from the saved values', () => {
    expect(draftFromSaved(employee, home)).toEqual({
      businessId: 'biz-a', home: { kind: 'saved', homeId: 'home-007', neighborhood: 'Astoria' },
      eveningDepartureMin: 1050, morningDepartureMin: 1950,
      availableEvening: true, availableMorning: false, maxExtraMin: 8,
    });
    expect(isDirty(draftFromSaved(employee, home), clone())).toBe(false);
  });

  it('keeps typed values across a poll with equal saved values', () => {
    const typed: Draft = { ...draftFromSaved(employee, home), maxExtraMin: 12, eveningDepartureMin: 1080 };
    const next = nextDraft(typed, saved, clone());
    expect(next).toBe(typed);
    expect(isDirty(next, clone())).toBe(true);
  });

  it('resets when the employee ID changes', () => {
    const typed: Draft = { ...draftFromSaved(employee, home), maxExtraMin: 12 };
    const other = { employee: { ...employee, id: 'emp-002' }, home };
    expect(nextDraft(typed, saved, other)).toEqual(draftFromSaved(other.employee, home));
  });

  it('resets when the saved server values change', () => {
    const typed: Draft = { ...draftFromSaved(employee, home), maxExtraMin: 12 };
    const changed = { employee: { ...employee, morningDepartureMin: 2000 }, home };
    expect(nextDraft(typed, saved, changed).morningDepartureMin).toBe(2000);
    expect(nextDraft(typed, saved, changed).maxExtraMin).toBe(8);
    const moved = { employee, home: { ...home, id: 'home-008', neighborhood: 'Sunnyside' } };
    expect(nextDraft(typed, saved, moved).home).toEqual({ kind: 'saved', homeId: 'home-008', neighborhood: 'Sunnyside' });
  });

  it('starts fresh without a previous draft', () => {
    expect(nextDraft(null, null, saved)).toEqual(draftFromSaved(employee, home));
  });
});

describe('time helpers', () => {
  it('converts minutes to HH:MM', () => {
    expect(minToTimeInput(0)).toBe('00:00');
    expect(minToTimeInput(1439)).toBe('23:59');
    expect(minToTimeInput(1950)).toBe('08:30');
    expect(minToTimeInput(1440)).toBe('00:00');
    expect(minToTimeInput(null)).toBe('');
    expect(minToTimeInput(Number.NaN)).toBe('');
  });

  it('puts evening on Day 1 and morning on Day 2', () => {
    expect(eveningFromTimeInput('00:00')).toBe(0);
    expect(eveningFromTimeInput('23:59')).toBe(1439);
    expect(morningFromTimeInput('00:00')).toBe(1440);
    expect(morningFromTimeInput('08:30')).toBe(1950);
    expect(morningFromTimeInput('23:59')).toBe(2879);
    expect(eveningFromTimeInput('')).toBeNull();
    expect(morningFromTimeInput('25:00')).toBeNull();
  });

  it('parses the detour number input', () => {
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('abc')).toBeNull();
    expect(parseMinutes('12')).toBe(12);
  });
});

describe('toRequest', () => {
  it('sends { homeId } for a saved home and parses with the schema', () => {
    const r = toRequest(draftFromSaved(employee, home));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.home).toEqual({ homeId: 'home-007' });
    expect(PutCommuteRequest.safeParse(r.request).success).toBe(true);
  });

  it('sends { lat, lng, neighborhood } for a new home and parses with the schema', () => {
    const draft: Draft = {
      ...draftFromSaved(employee, home),
      home: { kind: 'new', neighborhood: 'Park Slope', lat: 40.6721, lng: -73.9772 },
    };
    const r = toRequest(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.home).toEqual({ lat: 40.6721, lng: -73.9772, neighborhood: 'Park Slope' });
    expect(PutCommuteRequest.safeParse(r.request).success).toBe(true);
  });

  it('rejects maxExtraMin 31 with a field error', () => {
    const r = toRequest({ ...draftFromSaved(employee, home), maxExtraMin: 31 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.maxExtraMin).toMatch(/0 to 30/);
    expect(Object.keys(r.errors)).toEqual(['maxExtraMin']);
  });

  it('reports empty times and an empty workplace per field', () => {
    const r = toRequest({
      ...draftFromSaved(employee, home), businessId: '', eveningDepartureMin: null, morningDepartureMin: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.businessId).toBeTruthy();
    expect(r.errors.eveningDepartureMin).toBeTruthy();
    expect(r.errors.morningDepartureMin).toBeTruthy();
    expect(r.errors.maxExtraMin).toBeUndefined();
  });
});

describe('saveReducer', () => {
  it('goes saving → saved with the rematch count', () => {
    const s = saveReducer(INITIAL_SAVE_STATE, { type: 'start' });
    expect(s).toEqual({ status: 'saving' });
    expect(saveReducer(s, { type: 'success', response: response(3) })).toEqual({ status: 'saved', matched: 3 });
    expect(saveReducer(s, { type: 'success', response: response(0) })).toEqual({ status: 'saved', matched: 0 });
  });

  it('maps 409 to locked', () => {
    expect(saveReducer({ status: 'saving' }, { type: 'failure', error: { status: 409, message: 'Locked' } }))
      .toEqual({ status: 'locked' });
  });

  it('maps 503 codes to unavailable, from the error or its body', () => {
    for (const code of ['google_key_missing', 'travel_data_missing', 'google_unavailable'] as const) {
      expect(saveReducer({ status: 'saving' }, { type: 'failure', error: { status: 503, code } }))
        .toEqual({ status: 'unavailable', code });
      expect(saveReducer({ status: 'saving' }, { type: 'failure', error: { status: 503, body: { error: 'x', code } } }))
        .toEqual({ status: 'unavailable', code });
    }
  });

  it('maps other failures to error with the server message and field errors', () => {
    const s = saveReducer({ status: 'saving' }, {
      type: 'failure',
      error: { status: 400, message: 'Unknown business', fieldErrors: { businessId: 'Unknown business', junk: 'x' } },
    });
    expect(s).toEqual({ status: 'error', message: 'Unknown business', fieldErrors: { businessId: 'Unknown business' } });
    const e = saveReducer({ status: 'saving' }, { type: 'failure', error: { status: 503 } });
    expect(e.status).toBe('error');
    const thrown = saveReducer({ status: 'saving' }, { type: 'failure', error: new Error('Network down') });
    expect(thrown).toEqual({ status: 'error', message: 'Network down', fieldErrors: {} });
  });

  it('resets to idle', () => {
    expect(saveReducer({ status: 'saved', matched: 2 }, { type: 'reset' })).toEqual({ status: 'idle' });
  });
});

describe('messages', () => {
  it('words saved, locked and unavailable', () => {
    expect(saveMessage({ status: 'saved', matched: 0 }, 'planning')?.text).toBe('Commute saved.');
    expect(saveMessage({ status: 'saved', matched: 2 }, 'planning')?.text).toBe('Commute saved. 2 waiting packages matched.');
    // The locked sentence names the simulator's "Back to start" (#734, DECISIONS pass 74), for the phase and for a 409.
    for (const locked of [saveMessage({ status: 'idle' }, 'locked'), saveMessage({ status: 'locked' }, 'planning')]) {
      expect(locked).toEqual({
        role: 'alert', text: 'The run is playing, so the commute is read-only until you press Back to start in the simulator.',
      });
      expect(locked?.text).not.toMatch(/planning cycle/i);
    }
    expect(saveMessage({ status: 'idle' }, 'planning')).toBeNull();
  });
});
