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
  it('never changes the phase: a locked run that reaches simEnd stays locked (#734)', () => {
    const locked: Clock = { phase: 'locked', playing: true, speed: 600, timeMin: 2100 };
    expect(advanceClock(locked, 250, settings)).toEqual({ ...locked, timeMin: 2160, playing: false });
    expect(advanceClock({ ...locked, timeMin: 930 }, 250, settings).phase).toBe('locked');
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
  it('reset_playback returns to start, paused, and unlocks: the phase is planning again (#734)', () => {
    const c = applyControl({ phase: 'locked', playing: true, timeMin: 1500, speed: 120 }, { action: 'reset_playback' }, [], settings);
    expect(c).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 120 });
    // In planning it only rewinds.
    const seeked = applyControl({ ...base, timeMin: 1500 }, { action: 'reset_playback' }, [], settings);
    expect(seeked).toEqual(base);
  });
  it('only reset_playback unlocks: every other control keeps a locked run locked', () => {
    const locked: Clock = { phase: 'locked', playing: false, timeMin: 1500, speed: 120 };
    const others = [
      { action: 'play' }, { action: 'pause' }, { action: 'speed', speed: 600 }, { action: 'seek', timeMin: 930 },
      { action: 'next_event' }, { action: 'jump_to_morning' }, { action: 'finish' },
    ] as const;
    for (const req of others) {
      expect(applyControl(locked, req, [ev(1600), ev(1950)], settings).phase, req.action).toBe('locked');
    }
  });
  it('only play locks: every other control keeps a run in planning in planning', () => {
    const others = [
      { action: 'pause' }, { action: 'speed', speed: 600 }, { action: 'seek', timeMin: 1500 },
      { action: 'next_event' }, { action: 'jump_to_morning' }, { action: 'finish' }, { action: 'reset_playback' },
    ] as const;
    for (const req of others) {
      expect(applyControl(base, req, [ev(1600), ev(1950)], settings).phase, req.action).toBe('planning');
    }
  });
});
