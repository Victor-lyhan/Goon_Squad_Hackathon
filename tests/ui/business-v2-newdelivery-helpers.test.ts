import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW, dayTimeToMin, newClientRequestId, parseWeightKg,
} from '../../client/src/components/business/v2/newDeliveryModel';

// The four helpers the New delivery form kept from the MVP 1 form model (#670). Same names, same behaviour.

describe('newClientRequestId', () => {
  it('is "req-<origin>-<counter>-<time in base 36>"', () => {
    const before = Date.now();
    const id = newClientRequestId('biz-7');
    const after = Date.now();
    const m = /^req-biz-7-(\d+)-([0-9a-z]+)$/.exec(id);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    const at = parseInt(m![2]!, 36);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  it('two calls differ, also for the same sender in the same millisecond, and the counter goes up by one', () => {
    const a = newClientRequestId('biz-7');
    const b = newClientRequestId('biz-7');
    expect(b).not.toBe(a);
    const counter = (id: string) => Number(id.split('-').at(-2));
    expect(counter(b)).toBe(counter(a) + 1);
    // The counter is module-wide, not per sender.
    expect(counter(newClientRequestId('biz-8'))).toBe(counter(b) + 1);
  });

  it('keeps the sender ID as given (an empty one too)', () => {
    expect(newClientRequestId('')).toMatch(/^req--\d+-[0-9a-z]+$/);
  });
});

describe('DEFAULT_WINDOW', () => {
  it('is Day 1 15:30 to Day 2 12:00 in minutes since Day 1 00:00', () => {
    expect(DEFAULT_WINDOW).toEqual({ startMin: 930, endMin: 2160 });
    expect(DEFAULT_WINDOW.startMin).toBe(dayTimeToMin(1, '15:30'));
    expect(DEFAULT_WINDOW.endMin).toBe(dayTimeToMin(2, '12:00'));
  });
});

describe('dayTimeToMin', () => {
  it('turns a day and HH:MM into minutes since Day 1 00:00', () => {
    expect(dayTimeToMin(1, '00:00')).toBe(0);
    expect(dayTimeToMin(1, '16:00')).toBe(960);
    expect(dayTimeToMin(1, '23:59')).toBe(1439);
    expect(dayTimeToMin(2, '00:00')).toBe(1440);
    expect(dayTimeToMin(2, '08:30')).toBe(1950);
    expect(dayTimeToMin(2, '10:00')).toBe(2040);
  });

  it('accepts a one-digit hour and spaces around the time', () => {
    expect(dayTimeToMin(1, '9:05')).toBe(545);
    expect(dayTimeToMin(2, ' 09:05 ')).toBe(1985);
  });

  it('is NaN for a cleared or malformed time', () => {
    for (const bad of ['', '   ', '16', '16:0', '16:000', '24:00', '12:60', 'ab:cd', '16.00', '-1:00', '4:30 PM']) {
      expect(dayTimeToMin(1, bad), bad).toBeNaN();
      expect(dayTimeToMin(2, bad), bad).toBeNaN();
    }
  });
});

describe('parseWeightKg', () => {
  const error = (raw: string) => {
    const w = parseWeightKg(raw);
    return 'error' in w ? w.error : null;
  };

  it('a valid weight gives kg and whole grams', () => {
    expect(parseWeightKg('0.5')).toEqual({ kg: 0.5, grams: 500 });
    expect(parseWeightKg(' 1.25 ')).toEqual({ kg: 1.25, grams: 1250 });
    expect(parseWeightKg('2')).toEqual({ kg: 2, grams: 2000 });
    expect(parseWeightKg('0.001')).toEqual({ kg: 0.001, grams: 1 });
  });

  it('rounds to whole grams', () => {
    expect(parseWeightKg('1.2345')).toEqual({ kg: 1.235, grams: 1235 });
    expect(parseWeightKg('0.0006')).toEqual({ kg: 0.001, grams: 1 });
  });

  it('an empty input asks for a weight', () => {
    expect(error('')).toBe('Enter a weight in kg, for example 0.5');
    expect(error('   ')).toBe('Enter a weight in kg, for example 0.5');
  });

  it('a negative or zero weight must be above 0 kg', () => {
    expect(error('-1')).toBe('Weight must be above 0 kg');
    expect(error('-0.5')).toBe('Weight must be above 0 kg');
    expect(error('0')).toBe('Weight must be above 0 kg');
  });

  it('a non-number input must be a number', () => {
    expect(error('abc')).toBe('Weight must be a number in kg, for example 0.5');
    expect(error('1kg')).toBe('Weight must be a number in kg, for example 0.5');
    expect(error('Infinity')).toBe('Weight must be a number in kg, for example 0.5');
    expect(error('NaN')).toBe('Weight must be a number in kg, for example 0.5');
  });

  it('a comma decimal asks for a dot', () => {
    expect(error('1,5')).toBe('Use a dot for the decimal point, for example 1.5 kg');
  });

  it('above 2 kg is "Max 2 kg"; below half a gram is too small', () => {
    expect(error('2.01')).toBe('Max 2 kg');
    expect(error('2.5')).toBe('Max 2 kg');
    expect(error('0.0004')).toBe('Weight is too small: the minimum is 0.001 kg (1 g)');
  });
});
