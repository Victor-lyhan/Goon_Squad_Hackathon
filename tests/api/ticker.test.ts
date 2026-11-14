import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import { startClockTicker } from '../../server/api/ticker';
import type { Run } from '../../shared/types';

const mkRun = (speed: 30 | 120 | 600 = 30, playing = true, timeMin = 0): Run =>
  ({
    runId: 'r1',
    version: 0,
    scenario: { settings: { simStartMin: 0, simEndMin: 2160 } },
    clock: { phase: 'locked', playing, timeMin, speed },
  }) as unknown as Run;

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ticker-')), 'state.json');

let nowMs = 0;
const now = () => nowMs;

async function step(ms: number, ticks: number, store: ReturnType<typeof createStore>) {
  for (let i = 0; i < ticks; i++) {
    nowMs += ms;
    vi.advanceTimersByTime(ms);
    await store.flush();
    await new Promise<void>((r) => setImmediate(r)); // let pending clear
  }
}

describe('clock ticker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    nowMs = 1_000_000;
  });
  afterEach(() => vi.useRealTimers());

  it('does not mutate while paused', async () => {
    const file = tmpFile();
    const store = createStore({ filePath: file, initial: () => mkRun(30, false) });
    const t = startClockTicker(store, { intervalMs: 100, now });
    await step(100, 10, store);
    t.stop();
    expect(store.get().version).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each([
    [30, 30],
    [120, 120],
    [600, 600],
  ] as const)('speed %i advances exactly %i minutes per second', async (speed, expected) => {
    const store = createStore({ filePath: tmpFile(), initial: () => mkRun(speed) });
    const t = startClockTicker(store, { intervalMs: 100, now });
    await step(100, 10, store);
    t.stop();
    expect(store.get().clock.timeMin).toBe(expected);
  });

  it('carries sub-minute remainders at speed 30 with 250ms default ticks', async () => {
    const store = createStore({ filePath: tmpFile(), initial: () => mkRun(30) });
    const t = startClockTicker(store, { now }); // 7.5 min per tick
    await step(250, 40, store); // 10 s => 300 min
    t.stop();
    expect(store.get().clock.timeMin).toBe(300);
  });

  it('stops at simEndMin and further ticks are no-ops', async () => {
    const store = createStore({ filePath: tmpFile(), initial: () => mkRun(600, true, 2100) });
    const t = startClockTicker(store, { intervalMs: 100, now });
    await step(100, 3, store);
    expect(store.get().clock.timeMin).toBe(2160);
    expect(store.get().clock.playing).toBe(false);
    const v = store.get().version;
    await step(100, 5, store);
    t.stop();
    expect(store.get().version).toBe(v);
  });

  it('stop() clears the timer', async () => {
    const store = createStore({ filePath: tmpFile(), initial: () => mkRun(600) });
    const t = startClockTicker(store, { intervalMs: 100, now });
    await step(100, 2, store);
    t.stop();
    const v = store.get().version;
    await step(100, 5, store);
    expect(store.get().version).toBe(v);
    expect(vi.getTimerCount()).toBe(0);
  });
});
