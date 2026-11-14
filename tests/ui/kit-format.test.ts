import { describe, expect, it } from 'vitest';
import { formatCents, formatClock, formatDuration, formatKg, formatMin } from '../../client/src/ui/format';

describe('formatMin', () => {
  it('formats days and clock', () => {
    expect(formatMin(1950)).toBe('Day 2, 8:30 AM');
    expect(formatMin(1020)).toBe('Day 1, 5:00 PM');
  });
  it('handles midnight/noon edges', () => {
    expect(formatMin(0)).toBe('Day 1, 12:00 AM');
    expect(formatMin(720)).toBe('Day 1, 12:00 PM');
    expect(formatMin(1439)).toBe('Day 1, 11:59 PM');
    expect(formatMin(1440)).toBe('Day 2, 12:00 AM');
    expect(formatMin(1440 + 720)).toBe('Day 2, 12:00 PM');
  });
});

describe('formatClock', () => {
  it('formats time of day only', () => {
    expect(formatClock(1950)).toBe('8:30 AM');
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(720)).toBe('12:00 PM');
    expect(formatClock(725)).toBe('12:05 PM');
    expect(formatClock(1020)).toBe('5:00 PM');
  });
});

describe('formatCents', () => {
  it('formats dollars', () => {
    expect(formatCents(1000)).toBe('$10.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-150)).toBe('-$1.50');
  });
});

describe('formatKg', () => {
  it('converts grams', () => {
    expect(formatKg(300)).toBe('0.3 kg');
    expect(formatKg(1000)).toBe('1 kg');
    expect(formatKg(2500)).toBe('2.5 kg');
    expect(formatKg(0)).toBe('0 kg');
  });
});

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(6)).toBe('6 min');
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(65)).toBe('1 h 5 min');
  });
});
