import { describe, expect, it } from 'vitest';
import {
  JOURNEY_STEP_MIN, JOURNEY_STEP_MS, OVERNIGHT_CARD_MS, journeyEndMin, nextJourneyAction, startJourneyPlayback,
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
    expect(nextJourneyAction(WINDOWS, 1080)).toEqual({ kind: 'seek', toMin: 1905, overnight: true });
    for (const t of playAll(WINDOWS, 930)) {
      expect(WINDOWS.some((w) => t >= w.startMin && t <= w.endMin)).toBe(true);
    }
  });

  it('the whole relay journey plays in under 30 s, the overnight card included', () => {
    const steps = playAll(WINDOWS, 930).length;
    expect(OVERNIGHT_CARD_MS).toBe(1000);
    expect(steps * JOURNEY_STEP_MS + OVERNIGHT_CARD_MS).toBeLessThan(30_000);
  });

  it('only the jump between two windows is the overnight one (#648)', () => {
    // Before the pickup: a plain jump, also for a direct journey (one window).
    expect(nextJourneyAction(WINDOWS, 930)).not.toHaveProperty('overnight');
    expect(nextJourneyAction([WINDOWS[0]], -Infinity)).toEqual({ kind: 'seek', toMin: 1035 });
    // Inside a window: a step.
    expect(nextJourneyAction(WINDOWS, 1050)).not.toHaveProperty('overnight');
    expect(nextJourneyAction(WINDOWS, 1910)).not.toHaveProperty('overnight');
    // Exactly one overnight jump in the whole journey.
    let t = -Infinity;
    let overnight = 0;
    for (;;) {
      const a = nextJourneyAction(WINDOWS, t);
      if (a.kind === 'done') break;
      if (a.overnight) overnight += 1;
      t = a.toMin;
    }
    expect(overnight).toBe(1);
  });

  it('journeyEndMin is the end of the last window', () => {
    expect(journeyEndMin(WINDOWS)).toBe(1950);
    expect(journeyEndMin([...WINDOWS].reverse())).toBe(1950);
    expect(journeyEndMin([])).toBe(-Infinity);
  });

  it('a time after the last window is done', () => {
    expect(nextJourneyAction(WINDOWS, 2000)).toEqual({ kind: 'done' });
    expect(nextJourneyAction([], 930)).toEqual({ kind: 'done' });
  });

  it('accepts windows in any order and starts mid-window from where the clock is', () => {
    expect(nextJourneyAction([...WINDOWS].reverse(), 930)).toEqual({ kind: 'seek', toMin: 1035 });
    expect(nextJourneyAction(WINDOWS, 1050)).toEqual({ kind: 'seek', toMin: 1052 });
    expect(nextJourneyAction(WINDOWS, 1500)).toEqual({ kind: 'seek', toMin: 1905, overnight: true });
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

  // ---- #648: the overnight card and resume ----
  const RELAY = [{ startMin: 1035, endMin: 1037 }, { startMin: 1905, endMin: 1907 }];

  it('between two windows: the card goes up for 1 s, comes down, then the morning seek', async () => {
    const s = setup();
    const log: string[] = [];
    startJourneyPlayback({
      ...s.deps, windows: RELAY, fromMin: -Infinity,
      seek: async (t) => { log.push(`seek ${t}`); },
      onOvernight: (shown) => log.push(shown ? 'card up' : 'card down'),
    });
    await s.flush();
    await s.fire(); // 1037: the end of the evening leg
    expect(log).toEqual(['seek 1035', 'seek 1037']);
    await s.fire(); // the step after the evening leg: no seek, the card
    expect(log).toEqual(['seek 1035', 'seek 1037', 'card up']);
    expect(s.timers.map((t) => t.ms)).toEqual([OVERNIGHT_CARD_MS]);
    await s.fire(); // 1 s later
    expect(log).toEqual(['seek 1035', 'seek 1037', 'card up', 'card down', 'seek 1905']);
    expect(s.timers.map((t) => t.ms)).toEqual([JOURNEY_STEP_MS]);
    await s.fire();
    await s.fire();
    expect(log.slice(5)).toEqual(['seek 1907']);
    expect(s.done()).toBe(1);
    expect(log.filter((l) => l === 'card up')).toHaveLength(1);
  });

  it('a direct journey (one window) never shows the card', async () => {
    const s = setup();
    const card: boolean[] = [];
    startJourneyPlayback({ ...s.deps, fromMin: -Infinity, onOvernight: (shown) => card.push(shown) });
    await s.flush();
    for (let i = 0; i < 6; i++) await s.fire();
    expect(s.done()).toBe(1);
    expect(card).toEqual([]);
  });

  it('stop while the card is up: no morning seek, and the driver does not report the card down', async () => {
    const s = setup();
    const card: boolean[] = [];
    const stop = startJourneyPlayback({ ...s.deps, windows: RELAY, fromMin: 1037, onOvernight: (shown) => card.push(shown) });
    await s.flush();
    expect(card).toEqual([true]);
    expect(s.seeks).toEqual([]);
    stop();
    expect(s.timers).toEqual([]);
    expect(card).toEqual([true]);
    expect(s.seeks).toEqual([]);
  });

  it('without onOvernight the gap is one plain jump, as before', async () => {
    const s = setup();
    startJourneyPlayback({ ...s.deps, windows: RELAY, fromMin: 1037 });
    await s.flush();
    expect(s.seeks).toEqual([1905]);
    expect(s.timers.map((t) => t.ms)).toEqual([JOURNEY_STEP_MS]);
  });

  it('resumes from the minute it is given: mid-window, or in the night (the card again)', async () => {
    const mid = setup();
    startJourneyPlayback({ ...mid.deps, windows: RELAY, fromMin: 1036 });
    await mid.flush();
    expect(mid.seeks).toEqual([1037]);

    const night = setup();
    const card: boolean[] = [];
    startJourneyPlayback({ ...night.deps, windows: RELAY, fromMin: 1500, onOvernight: (shown) => card.push(shown) });
    await night.flush();
    expect(card).toEqual([true]);
    await night.fire();
    expect(card).toEqual([true, false]);
    expect(night.seeks).toEqual([1905]);
  });
});
