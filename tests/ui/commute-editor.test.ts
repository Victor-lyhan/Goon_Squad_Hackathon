import { describe, expect, it } from 'vitest';
import type { Employee } from '../../shared/types';
import {
  emptyForm, minToTimeInput, timeInputToMin, toForm, toRequest, validate,
} from '../../client/src/components/employee/commuteModel';

const emp: Employee = {
  id: 'emp-1', name: 'Ana', businessId: 'biz-a', homeNodeId: 'n-1-1',
  eveningDepartureMin: 1050, morningDepartureMin: 1905,
  maxExtraMin: 12, availableEvening: true, availableMorning: false,
  eveningViaNodeIds: ['n-0-1'], morningViaNodeIds: ['n-2-2', 'n-2-3'],
};

describe('commute model', () => {
  it('round-trips an employee through toForm and toRequest', () => {
    const form = toForm(emp);
    expect(form.eveningTime).toBe('17:30');
    expect(form.morningTime).toBe('07:45');
    expect(toRequest(form)).toEqual({
      businessId: 'biz-a', homeNodeId: 'n-1-1',
      eveningDepartureMin: 1050, morningDepartureMin: 1905,
      availableEvening: true, availableMorning: false, maxExtraMin: 12,
      eveningViaNodeIds: ['n-0-1'], morningViaNodeIds: ['n-2-2', 'n-2-3'],
    });
  });

  it('maps morning times into [1440, 2879]', () => {
    for (const t of ['00:00', '12:00', '23:59']) {
      const f = { ...toForm(emp), morningTime: t };
      const m = toRequest(f).morningDepartureMin;
      expect(m).toBeGreaterThanOrEqual(1440);
      expect(m).toBeLessThanOrEqual(2879);
    }
  });

  it('converts time inputs both ways', () => {
    expect(minToTimeInput(1905)).toBe('07:45');
    expect(timeInputToMin('17:30')).toBe(1050);
    expect(timeInputToMin('25:00')).toBeNaN();
  });

  it('validates a good form and flags maxExtraMin 31', () => {
    expect(validate(toForm(emp))).toEqual({});
    const errs = validate({ ...toForm(emp), maxExtraMin: 31 });
    expect(Object.keys(errs)).toEqual(['maxExtraMin']);
  });

  it('flags an empty home and a malformed time', () => {
    const errs = validate({ ...emptyForm('biz-a'), eveningTime: '' });
    expect(errs.homeNodeId).toBeTruthy();
    expect(errs.eveningDepartureMin).toBeTruthy();
  });

  it('defaults a fresh form slider to 8', () => {
    expect(emptyForm().maxExtraMin).toBe(8);
  });
});
