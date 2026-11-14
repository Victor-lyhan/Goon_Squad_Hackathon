import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import { startClockTicker } from '../../server/api/ticker';
import { createInitialRun } from '../../server/api/initialRun';
import { generateScenario } from '../../server/domain/generator';
import type { Run } from '../../shared/types';

const TIMEOUT = 60_000;
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ticker-load-')), 'state.json');

let bigRun: Run;
const playingRun = (): Run => {
  const r = structuredClone(bigRun);
  r.clock = { phase: 'locked', playing: true, timeMin: 930, speed: 600 };
  return r;
};
const readDisk = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

let nowMs = 0;
const now = () => nowMs;

async function tick(ms: number, store: ReturnType<typeof createStore>) {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
  await store.flush();
  await new Promise<void>((r) => setImmediate(r));
}

describe('ticker under load (largest random city, 600x)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    nowMs = 1_000_000;
    bigRun ??= createInitialRun(generateScenario({ preset: 'random', seed: 1, employees: 200, packages: 60, hubs: 10, maxExtraMin: 8 }));
  }, TIMEOUT);
  afterEach(() => vi.useRealTimers());

  it('stays monotonic, ends at 2160 paused, and the file matches the last version', async () => {
    expect(bigRun.assignments.plans.length).toBeGreaterThan(0);
    const file = tmpFile();
    const store = createStore({ filePath: file, initial: playingRun });
    const t = startClockTicker(store, { intervalMs: 25, now });
    let prev = store.get().clock.timeMin;
    let prevVersion = store.get().version;
    const durations: number[] = [];
    for (let i = 0; i < 400 && store.get().clock.playing; i++) {
      const t0 = performance.now();
      await tick(25, store);
      durations.push(performance.now() - t0);
      const { timeMin } = store.get().clock;
      expect(timeMin).toBeGreaterThanOrEqual(prev);
      expect(timeMin).toBeLessThanOrEqual(2160);
      expect(store.get().version).toBeGreaterThanOrEqual(prevVersion);
      prev = timeMin;
      prevVersion = store.get().version;
    }
    t.stop();
    expect(store.get().clock.playing).toBe(false);
    expect(store.get().clock.timeMin).toBe(2160);
    const disk = readDisk(file);
    expect(disk.run.version).toBe(store.get().version);
    expect(disk.run.clock).toMatchObject({ playing: false, timeMin: 2160 });
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(`[ticker-load] ${durations.length} ticks, median mutate+write ${median.toFixed(1)} ms`);
    expect(median).toBeLessThan(50);
  }, TIMEOUT);

  it('does not lose carried milliseconds with tiny ticks', async () => {
    const store = createStore({ filePath: tmpFile(), initial: playingRun });
    const t = startClockTicker(store, { intervalMs: 7, now });
    // 7 ms * 600 = 4.2 sim minutes per tick; 100 ticks = 700 ms real = 420 sim minutes.
    for (let i = 0; i < 100; i++) await tick(7, store);
    t.stop();
    expect(store.get().clock.timeMin).toBe(930 + 420);
  }, TIMEOUT);

  it('never runs two writes at once with a slow disk, and the file ends at the latest version', async () => {
    const file = tmpFile();
    const realWrite = fs.promises.writeFile;
    let active = 0;
    let maxActive = 0;
    const spy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args: Parameters<typeof realWrite>) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await realWrite(...args);
      } finally {
        active--;
      }
    });
    try {
      const store = createStore({ filePath: file, initial: playingRun });
      const t = startClockTicker(store, { intervalMs: 25, now });
      for (let i = 0; i < 15; i++) {
        nowMs += 25;
        vi.advanceTimersByTime(25);
        await new Promise<void>((r) => setImmediate(r)); // writes are still in flight
        void store.mutate(() => {}); // control actions queue behind the ticker
      }
      t.stop();
      await store.flush();
      expect(maxActive).toBe(1);
      expect(readDisk(file).run.version).toBe(store.get().version);
    } finally {
      spy.mockRestore();
    }
  }, TIMEOUT);

  it('restores paused at 2160 after restart', async () => {
    const file = tmpFile();
    const store = createStore({ filePath: file, initial: playingRun });
    const t = startClockTicker(store, { intervalMs: 250, now });
    for (let i = 0; i < 20 && store.get().clock.playing; i++) await tick(250, store);
    t.stop();
    expect(store.get().clock.timeMin).toBe(2160);
    const again = createStore({ filePath: file, initial: () => { throw new Error('should load file'); } });
    expect(again.get().clock).toMatchObject({ playing: false, timeMin: 2160 });
    expect(again.get().version).toBe(store.get().version);
  }, TIMEOUT);
});
