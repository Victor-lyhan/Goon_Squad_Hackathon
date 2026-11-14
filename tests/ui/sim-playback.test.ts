import { describe, expect, it } from 'vitest';
import type { Clock } from '../../shared/types';
import { toPlaybackModel } from '../../client/src/components/sim/playbackModel';
import { formatMin } from '../../client/src/components/sim/simFormat';

const settings = { simStartMin: 930, simEndMin: 2160 };
const clock = (o: Partial<Clock> = {}): Clock => ({ phase: 'locked', playing: false, timeMin: 930, speed: 120, ...o });

describe('formatMin', () => {
  it('formats day and 12-hour time', () => {
    expect(formatMin(1950)).toBe('Day 2, 8:30 AM');
    expect(formatMin(930)).toBe('Day 1, 3:30 PM');
    expect(formatMin(0)).toBe('Day 1, 12:00 AM');
    expect(formatMin(720)).toBe('Day 1, 12:00 PM');
  });
});

describe('toPlaybackModel', () => {
  it('start of window, paused', () => {
    const m = toPlaybackModel(clock(), 960, settings);
    expect(m.timeLabel).toBe('Day 1, 3:30 PM');
    expect(m.playLabel).toBe('Play');
    expect(m.speed).toBe(120);
    expect(Object.values(m.disabled).some(Boolean)).toBe(false);
  });
  it('playing mid-run', () => {
    const m = toPlaybackModel(clock({ playing: true, timeMin: 1200, speed: 600 }), 1210, settings);
    expect(m.playLabel).toBe('Pause');
    expect(m.speed).toBe(600);
    expect(m.disabled.play).toBe(false);
    expect(m.disabled.finish).toBe(false);
  });
  it('end of window', () => {
    const m = toPlaybackModel(clock({ timeMin: 2160 }), null, settings);
    expect(m.disabled.play).toBe(true);
    expect(m.disabled.finish).toBe(true);
    expect(m.disabled.nextEvent).toBe(true);
    expect(m.disabled.reset).toBe(false);
  });
  it('null next event only disables next event', () => {
    const m = toPlaybackModel(clock(), null, settings);
    expect(m.disabled.nextEvent).toBe(true);
    expect(m.disabled.play).toBe(false);
    expect(m.disabled.finish).toBe(false);
  });
  it('busy disables everything', () => {
    const m = toPlaybackModel(clock({ playing: true }), 1000, settings, true);
    expect(Object.values(m.disabled).every(Boolean)).toBe(true);
  });
});
