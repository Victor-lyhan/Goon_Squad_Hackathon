import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STEP_MIN, JOURNEY_STEP_MS, journeyDurationMs, journeyStepCount, nextJourneyAction, startJourneyPlayback,
  type JourneyAction,
} from '../../client/src/components/sim/v2/motion/journeyPlayback';

// A relay journey: evening leg 17:15–18:00 on Day 1, morning leg 07:45–08:30 on Day 2.
const WINDOWS = [{ startMin: 1035, endMin: 1080 }, { startMin: 1905, endMin: 1950 }];

function playAll(windows: typeof WINDOWS, from: number): number[] {
  const seeks: number[] = [];
  let t = from;
  for (let guard = 0; guard < 1000; guard++) {
    const a: JourneyAction = nextJourneyAction(windows, t);
    if (a.kind === 'done') return seeks;
    seeks.push(a.toMin);
    t = a.toMin;
  }
  throw new Error('Play journey never finished');
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let t = from + step; t < to; t += step) out.push(t);
  return [...out, to];
};

describe('nextJourneyAction', () => {
  it('uses 2 simulated minutes every 500 ms (pass 46)', () => {
    expect(JOURNEY_STEP_MIN).toBe(2);
    expect(JOURNEY_STEP_MS).toBe(500);
  });

  it('from 930: seek to 1035, step to 1080, seek to 1905, step to 1950, done', () => {
    expect(nextJourneyAction(WINDOWS, 930)).toEqual({ kind: 'seek', toMin: 1035 });
    const seeks = playAll(WINDOWS, 930);
    expect(seeks).toEqual([1035, ...range(1035, 1080, 2), 1905, ...range(1905, 1950, 2)]);
    expect(nextJourneyAction(WINDOWS, 1950)).toEqual({ kind: 'done' });
  });

  it('a step never passes the end of its window', () => {
    expect(nextJourneyAction(WINDOWS, 1079)).toEqual({ kind: 'seek', toMin: 1080 });
    expect(nextJourneyAction(WINDOWS, 1080)).toEqual({ kind: 'seek', toMin: 1905 });
    for (const t of playAll(WINDOWS, 930)) {
      expect(WINDOWS.some((w) => t >= w.startMin && t <= w.endMin)).toBe(true);
    }
  });

  it('the whole relay journey plays in under 30 s', () => {
    const steps = playAll(WINDOWS, 930).length;
    expect(steps * JOURNEY_STEP_MS).toBeLessThan(30_000);
    expect(journeyStepCount(WINDOWS)).toBe(steps);
    expect(journeyDurationMs(WINDOWS)).toBe(steps * JOURNEY_STEP_MS);
  });

  it('a time after the last window is done', () => {
    expect(nextJourneyAction(WINDOWS, 2000)).toEqual({ kind: 'done' });
    expect(nextJourneyAction([], 930)).toEqual({ kind: 'done' });
    expect(journeyDurationMs([])).toBe(0);
  });

  it('accepts windows in any order and starts mid-window from where the clock is', () => {
    expect(nextJourneyAction([...WINDOWS].reverse(), 930)).toEqual({ kind: 'seek', toMin: 1035 });
    expect(nextJourneyAction(WINDOWS, 1050)).toEqual({ kind: 'seek', toMin: 1052 });
    expect(nextJourneyAction(WINDOWS, 1500)).toEqual({ kind: 'seek', toMin: 1905 });
  });
});

describe('startJourneyPlayback', () => {
  type Timer = { fn: () => void; ms: number };
  const setup = () => {
    const timers: Timer[] = [];
    const seeks: number[] = [];
    let done = 0;
    const deps = {
      windows: [{ startMin: 1035, endMin: 1040 }],
      fromMin: 930,
      seek: async (t: number) => { seeks.push(t); },
      setTimer: (fn: () => void, ms: number) => { const h = { fn, ms }; timers.push(h); return h; },
      clearTimer: (h: unknown) => { const i = timers.indexOf(h as Timer); if (i >= 0) timers.splice(i, 1); },
      onDone: () => { done += 1; },
    };
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    const fire = async () => { const t = timers.shift(); t?.fn(); await flush(); };
    return { deps, timers, seeks, flush, fire, done: () => done };
  };

  it('sends one seek per step, 500 ms apart, then reports done', async () => {
    const s = setup();
    startJourneyPlayback(s.deps);
    await s.flush();
    expect(s.seeks).toEqual([1035]);
    expect(s.timers.map((t) => t.ms)).toEqual([500]);
    for (let i = 0; i < 4; i++) await s.fire();
    expect(s.seeks).toEqual([1035, 1037, 1039, 1040]);
    expect(s.done()).toBe(1);
    expect(s.timers).toEqual([]);
  });

  it('stop cancels the next step', async () => {
    const s = setup();
    const stop = startJourneyPlayback(s.deps);
    await s.flush();
    stop();
    expect(s.timers).toEqual([]);
    expect(s.seeks).toEqual([1035]);
  });

  it('a failed seek stops and reports the error', async () => {
    const s = setup();
    const errors: unknown[] = [];
    startJourneyPlayback({ ...s.deps, seek: async () => { throw new Error('offline'); }, onError: (e) => errors.push(e) });
    await s.flush();
    expect(errors).toHaveLength(1);
    expect(s.timers).toEqual([]);
  });
});
