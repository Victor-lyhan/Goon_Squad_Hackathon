// The one server ticker of the v2 run: fake timers plus an injected `now`, so no test waits for real time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { startV2ClockTicker } from '../../server/api/v2/ticker';
import { planControl } from '../../server/api/v2/controlOps';
import type { Store } from '../../server/store';
import type { Run } from '../../shared/v2/types';
import { fakeNow, fileStore, gatedStore, runWith, step } from './v2-ticker-helpers';

const T = 10_000; // explicit timeout on every timing test (DECISIONS pass 19)

let clock: ReturnType<typeof fakeNow>;
const tickers: { stop(): void }[] = [];
const start = (store: Store<Run>, intervalMs?: number) => {
  const ticker = startV2ClockTicker(store, intervalMs === undefined ? { now: clock.now } : { intervalMs, now: clock.now });
  tickers.push(ticker);
  return ticker;
};
/** A control request applied the way the route does it. */
const control = (store: Store<Run>, body: unknown) =>
  store.mutate((run) => {
    const plan = planControl(run, body);
    if (plan.kind !== 'apply') throw new Error('bad control in test');
    run.clock = plan.clock;
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  clock = fakeNow();
});
afterEach(() => {
  for (const t of tickers.splice(0)) t.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('v2 clock ticker: playing', () => {
  it('at speed 30 one real second advances 30 minutes', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store, 100);
    await step(clock, store, 100, 10);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: true, timeMin: 960, speed: 30 });
  }, T);

  it.each([
    [30, 960],
    [120, 1050],
    [600, 1530],
  ] as const)('speed %i: one real second from 930 ends at %i', async (speed, expected) => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed }));
    start(store, 100);
    await step(clock, store, 100, 10);
    expect(store.get().clock.timeMin).toBe(expected);
  }, T);

  it('the default interval is 250 ms; half minutes are carried, never dropped or rounded up', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store); // 7.5 simulated minutes per tick
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      await step(clock, store, 250, 1);
      seen.push(store.get().clock.timeMin);
    }
    expect(seen).toEqual([937, 945, 952, 960]); // whole minutes only
    await step(clock, store, 250, 36); // 10 s in total
    expect(store.get().clock.timeMin).toBe(930 + 300);
  }, T);

  it('uneven ticks (a busy event loop) add up to the same time', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store, 100);
    for (const ms of [100, 130, 70, 420, 100, 33, 147]) {
      // the timer fires once per call; `now` says how long it really took
      clock.advance(ms);
      vi.advanceTimersByTime(100);
      await store.flush();
      await new Promise<void>((r) => setImmediate(r));
    }
    expect(store.get().clock.timeMin).toBe(930 + 30); // 1000 ms in total
  }, T);

  it('the version goes up once per tick that moves the clock, and the state file follows', async () => {
    const { store, stateFile } = fileStore(runWith({ playing: true, timeMin: 930, speed: 120 }));
    const before = store.get().version;
    start(store, 100); // 12 minutes per tick
    await step(clock, store, 100, 5);
    expect(store.get().version).toBe(before + 5);
    expect(store.get().clock.timeMin).toBe(990);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).run.clock.timeMin).toBe(990);
  }, T);

  it('a tick shorter than one simulated minute does not touch the run', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    const before = store.get().version;
    start(store, 10); // 0.3 minutes per tick
    await step(clock, store, 10, 3); // 0.9 minutes
    expect(store.get().version).toBe(before);
    await step(clock, store, 10, 1); // 1.2 minutes
    expect(store.get().clock.timeMin).toBe(931);
    expect(store.get().version).toBe(before + 1);
  }, T);

  it('a speed change applies from the next tick on', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store, 100);
    await step(clock, store, 100, 10); // 30 minutes
    await control(store, { action: 'speed', speed: 600 });
    await step(clock, store, 100, 10); // 600 minutes
    expect(store.get().clock).toEqual({ phase: 'locked', playing: true, timeMin: 930 + 30 + 600, speed: 600 });
  }, T);

  it('a seek while playing is kept: the next tick continues from the new minute', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store, 100);
    await step(clock, store, 100, 10);
    await control(store, { action: 'seek', timeMin: 1500 });
    await step(clock, store, 100, 10);
    expect(store.get().clock.timeMin).toBe(1530);
  }, T);
});

describe('v2 clock ticker: paused', () => {
  it('paused, nothing changes: same clock, same version, no file write', async () => {
    const { store, stateFile } = fileStore(runWith({ playing: false, timeMin: 1110, speed: 600 }));
    const before = store.get();
    start(store, 100);
    await step(clock, store, 100, 20);
    expect(store.get()).toBe(before);
    expect(store.get().version).toBe(before.version);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 1110, speed: 600 });
    expect(fs.existsSync(stateFile)).toBe(false);
  }, T);

  it('a run still in planning does not move either', async () => {
    const { store } = fileStore(runWith({ phase: 'planning', playing: false, timeMin: 930, speed: 30 }));
    start(store, 100);
    await step(clock, store, 100, 20);
    expect(store.get().clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 30 });
  }, T);

  it('time spent paused is not played back after the next play', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(store, 100);
    await step(clock, store, 100, 10); // 30 minutes
    await control(store, { action: 'pause' });
    const paused = store.get().version;
    await step(clock, store, 100, 50); // 5 s paused
    expect(store.get().version).toBe(paused);
    await control(store, { action: 'play' });
    await step(clock, store, 100, 10); // 30 minutes
    expect(store.get().clock.timeMin).toBe(990);
  }, T);
});

describe('v2 clock ticker: the end of the run', () => {
  it('at speed 600 the clock stops exactly at simEndMin with playing: false', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 2000, speed: 600 }));
    start(store); // 150 minutes per tick: 2150, then past the end
    await step(clock, store, 250, 1);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: true, timeMin: 2150, speed: 600 });
    await step(clock, store, 250, 1);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 600 });

    const ended = store.get().version;
    await step(clock, store, 250, 8);
    expect(store.get().version).toBe(ended);
    expect(store.get().clock.timeMin).toBe(2160);
  }, T);

  it('landing exactly on simEndMin also pauses', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 2100, speed: 600 }));
    start(store, 100); // 60 minutes per tick
    await step(clock, store, 100, 1);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 600 });
  }, T);

  it('a whole run at speed 600 takes 2.05 real seconds and ends paused at 2160', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 600 }));
    start(store);
    await step(clock, store, 250, 8); // 2 s: 1200 minutes
    expect(store.get().clock).toEqual({ phase: 'locked', playing: true, timeMin: 2130, speed: 600 });
    await step(clock, store, 250, 1);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 600 });
  }, T);

  it('after the end, reset and play run again from simStartMin', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 2100, speed: 600 }));
    start(store, 100);
    await step(clock, store, 100, 3);
    // Reaching the end did not unlock; "Back to start" does (#734), and the ticker leaves the paused run alone.
    expect(store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 600 });
    await control(store, { action: 'reset_playback' });
    await step(clock, store, 100, 2);
    expect(store.get().clock).toEqual({ phase: 'planning', playing: false, timeMin: 930, speed: 600 });
    await control(store, { action: 'play' });
    await step(clock, store, 100, 1);
    expect(store.get().clock).toEqual({ phase: 'locked', playing: true, timeMin: 990, speed: 600 });
  }, T);
});

describe('v2 clock ticker: one mutation at a time', () => {
  it('a slow mutate never overlaps the next tick, and no time is lost', async () => {
    const gated = gatedStore(runWith({ playing: true, timeMin: 930, speed: 30 }));
    start(gated.store); // 250 ms = 7.5 minutes per tick

    // tick 1 starts a mutation (7 minutes) that does not finish
    clock.advance(250);
    vi.advanceTimersByTime(250);
    expect(gated.stats.started).toBe(1);
    // ticks 2-4 arrive while it is still in flight: no second mutation, the run has not moved
    for (let i = 0; i < 3; i++) {
      clock.advance(250);
      vi.advanceTimersByTime(250);
    }
    expect(gated.stats.started).toBe(1);
    expect(gated.waiting()).toBe(1);
    expect(gated.store.get().clock.timeMin).toBe(930);

    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(937);

    // tick 5 pays back everything the slow mutation held up: 1250 ms = 37.5 minutes so far
    clock.advance(250);
    vi.advanceTimersByTime(250);
    expect(gated.stats.started).toBe(2);
    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(967);

    // tick 6: 1500 ms = 45 minutes, to the minute
    clock.advance(250);
    vi.advanceTimersByTime(250);
    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(975);

    expect(gated.stats.maxInFlight).toBe(1);
    expect(gated.stats.started).toBe(3);
    expect(gated.store.get().version).toBe(12 + 3);
  }, T);

  it('a mutation slower than the rest of the run still ends exactly at simEndMin', async () => {
    const gated = gatedStore(runWith({ playing: true, timeMin: 2000, speed: 600 }));
    start(gated.store);
    for (let i = 0; i < 6; i++) {
      clock.advance(250);
      vi.advanceTimersByTime(250);
    }
    expect(gated.stats.started).toBe(1);
    await gated.release(); // 150 minutes
    expect(gated.store.get().clock).toMatchObject({ timeMin: 2150, playing: true });
    clock.advance(250);
    vi.advanceTimersByTime(250);
    await gated.release(); // the 900 minutes held up, cut at the end
    expect(gated.store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 2160, speed: 600 });
    expect(gated.stats.maxInFlight).toBe(1);
  }, T);

  it('a failed state write loses no time: the minutes are applied by a later tick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gated = gatedStore(runWith({ playing: true, timeMin: 930, speed: 120 }));
    start(gated.store, 100); // 12 minutes per tick

    clock.advance(100);
    vi.advanceTimersByTime(100);
    gated.failNext();
    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(930); // the write failed, the run did not move
    expect(gated.store.get().version).toBe(12);
    expect(warn).toHaveBeenCalledTimes(1);

    clock.advance(100);
    vi.advanceTimersByTime(100);
    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(954); // both ticks
    expect(gated.stats.maxInFlight).toBe(1);
  }, T);

  it('a pause that lands before a queued tick wins: neither the clock nor the version moves after it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gated = gatedStore(runWith({ playing: true, timeMin: 930, speed: 600 }));
    start(gated.store, 100);
    const paused = control(gated.store, { action: 'pause' }); // queued first
    clock.advance(100);
    vi.advanceTimersByTime(100); // the tick still saw playing: true and queued 60 minutes
    await gated.release();
    const answered = await paused;
    await gated.release();
    expect(gated.store.get().clock).toEqual({ phase: 'locked', playing: false, timeMin: 930, speed: 600 });
    // #747: the queued step is dropped whole. The run is the one the pause answered with, version included,
    // and a dropped step is not reported as a failed write.
    expect(gated.store.get()).toBe(answered);
    expect(answered.version).toBe(12 + 1);
    expect(warn).not.toHaveBeenCalled();

    // Later ticks see the paused clock and queue nothing; the next Play owes none of the dropped minutes.
    for (let i = 0; i < 3; i++) {
      clock.advance(100);
      vi.advanceTimersByTime(100);
    }
    expect(gated.waiting()).toBe(0);
    const playing = control(gated.store, { action: 'play' });
    await gated.release();
    await playing;
    clock.advance(100);
    vi.advanceTimersByTime(100);
    await gated.release();
    expect(gated.store.get().clock.timeMin).toBe(930 + 60); // this tick only
    expect(gated.store.get().version).toBe(12 + 3); // pause, play, one step
  }, T);
});

describe('v2 clock ticker: stop()', () => {
  it('stop() clears the timer: no tick after it', async () => {
    const { store } = fileStore(runWith({ playing: true, timeMin: 930, speed: 600 }));
    const ticker = start(store, 100);
    await step(clock, store, 100, 2);
    expect(vi.getTimerCount()).toBe(1);
    ticker.stop();
    expect(vi.getTimerCount()).toBe(0);
    const stopped = store.get();
    await step(clock, store, 100, 10);
    expect(store.get()).toBe(stopped);
    expect(store.get().clock.timeMin).toBe(1050);
  }, T);

  it('stop() twice is harmless', () => {
    const { store } = fileStore(runWith({ playing: true }));
    const ticker = start(store, 100);
    ticker.stop();
    expect(() => ticker.stop()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  }, T);
});
