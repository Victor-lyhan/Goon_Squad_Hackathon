import { describe, expect, it } from 'vitest';
import { advanceClock, applyControl } from '../../server/clock';
import type { Clock, Settings, SimEvent } from '../../shared/types';

const settings = { simStartMin: 930, simEndMin: 2160 } as Settings;
const base: Clock = { phase: 'planning', playing: false, timeMin: 930, speed: 30 };
const ev = (timeMin: number, seq = 0): SimEvent =>
  ({ id: `e${timeMin}-${seq}`, timeMin, seq, kind: 'pickup' }) as SimEvent;

describe('advanceClock', () => {
  it('adds floor(speed*ms/1000) minutes when playing', () => {
    const c = advanceClock({ ...base, playing: true, speed: 120 }, 250, settings);
    expect(c.timeMin).toBe(930 + 30);
    expect(advanceClock({ ...base, playing: true }, 10, settings).timeMin).toBe(930);
  });
  it('returns paused clock unchanged', () => {
    expect(advanceClock(base, 5000, settings)).toBe(base);
  });
  it('clamps at simEnd and stops playing', () => {
    const c = advanceClock({ ...base, playing: true, speed: 600, timeMin: 2100 }, 5000, settings);
    expect(c.timeMin).toBe(2160);
    expect(c.playing).toBe(false);
  });
});

describe('applyControl', () => {
  it('play locks phase and plays', () => {
    expect(applyControl(base, { action: 'play' }, [], settings)).toMatchObject({ phase: 'locked', playing: true });
  });
  it('pause', () => {
    expect(applyControl({ ...base, playing: true }, { action: 'pause' }, [], settings).playing).toBe(false);
  });
  it('speed', () => {
    expect(applyControl(base, { action: 'speed', speed: 600 }, [], settings).speed).toBe(600);
  });
  it('seek clamps to the window', () => {
    expect(applyControl(base, { action: 'seek', timeMin: 1000 }, [], settings).timeMin).toBe(1000);
    expect(applyControl(base, { action: 'seek', timeMin: 100 }, [], settings).timeMin).toBe(930);
    expect(applyControl(base, { action: 'seek', timeMin: 5000 }, [], settings).timeMin).toBe(2160);
  });
  it('next_event goes to first later event, else unchanged', () => {
    const events = [ev(1000), ev(1100), ev(1100, 1)];
    const at = { ...base, timeMin: 1000 };
    expect(applyControl(at, { action: 'next_event' }, events, settings).timeMin).toBe(1100);
    const last = { ...base, timeMin: 1100 };
    expect(applyControl(last, { action: 'next_event' }, events, settings)).toBe(last);
    expect(applyControl(base, { action: 'next_event' }, [], settings)).toBe(base);
  });
  it('jump_to_morning targets 5 min before first Day 2 event', () => {
    const events = [ev(1000), ev(1950), ev(1500)];
    expect(applyControl(base, { action: 'jump_to_morning' }, events, settings).timeMin).toBe(1495);
  });
  it('jump_to_morning falls back to 1860 with no Day 2 events', () => {
    expect(applyControl(base, { action: 'jump_to_morning' }, [ev(1000)], settings).timeMin).toBe(1860);
    expect(applyControl(base, { action: 'jump_to_morning' }, [], settings).timeMin).toBe(1860);
  });
  it('jump_to_morning never goes backwards', () => {
    const late = { ...base, timeMin: 1900 };
    expect(applyControl(late, { action: 'jump_to_morning' }, [ev(1500)], settings).timeMin).toBe(1900);
    expect(applyControl(late, { action: 'jump_to_morning' }, [], settings).timeMin).toBe(1900);
  });
  it('finish jumps to end and pauses', () => {
    const c = applyControl({ ...base, playing: true }, { action: 'finish' }, [], settings);
    expect(c).toMatchObject({ timeMin: 2160, playing: false });
  });
  it('reset_playback returns to start, paused, phase unchanged', () => {
    const c = applyControl({ phase: 'locked', playing: true, timeMin: 1500, speed: 120 }, { action: 'reset_playback' }, [], settings);
    expect(c).toEqual({ phase: 'locked', playing: false, timeMin: 930, speed: 120 });
  });
});
