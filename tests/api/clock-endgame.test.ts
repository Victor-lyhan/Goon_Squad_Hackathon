import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore } from '../../server/store';
import { startClockTicker } from '../../server/api/ticker';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import type { SimulatorResponse } from '../../shared/api';

// CI-safe (DECISIONS pass 17/19): generated cities and real servers get 3x+ headroom over local time.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let server: Server;
let base: string;
let store: ReturnType<typeof createStore>;
let nowMs = 1_000_000;
const now = () => nowMs;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endgame-'));
  store = createStore({
    filePath: path.join(dir, 'state.json'),
    initial: () => createInitialRun(loadDefaultScenario()),
  });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const control = async (body: unknown) => {
  const res = await fetch(base + '/api/simulator/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as SimulatorResponse & { error?: string } };
};
const get = async () => (await fetch(base + '/api/simulator')).json() as Promise<SimulatorResponse>;

let ticker: { stop(): void };
async function tick(count: number, ms = 250) {
  for (let i = 0; i < count; i++) {
    nowMs += ms;
    vi.advanceTimersByTime(ms);
    await store.flush();
    await new Promise<void>((r) => setImmediate(r));
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  ticker = startClockTicker(store, { now });
});
afterEach(() => {
  ticker.stop();
  vi.useRealTimers();
});

const keyOf = (b: SimulatorResponse) => JSON.stringify(b.snapshot.occurredEvents.map((e) => e.id));

describe('playback endgame', () => {
  it('plays at 600x from 930 to exactly 2160 and delivers every matched package', async () => {
    await control({ action: 'reset_playback' });
    await control({ action: 'speed', speed: 600 });
    await control({ action: 'play' });
    for (let i = 0; i < 20; i++) await tick(1, 250);
    const b = await get();
    expect(b.clock.timeMin).toBe(2160);
    expect(b.clock.playing).toBe(false);
    const m = b.snapshot.metrics;
    expect(m.matched).toBeGreaterThan(0);
    expect(m.delivered).toBe(m.matched);
    // extra ticks change nothing
    const v = b.version;
    await tick(5);
    expect((await get()).version).toBe(v);
  });

  it('controls at the end of the window are safe', async () => {
    const end = await get();
    expect(end.clock.timeMin).toBe(2160);
    const p = await control({ action: 'play' });
    expect(p.status).toBe(200);
    await tick(8);
    expect((await get()).clock.timeMin).toBe(2160);
    expect((await get()).clock.playing).toBe(false);
    await control({ action: 'pause' });
    expect((await control({ action: 'next_event' })).body.clock.timeMin).toBe(2160);
    expect((await control({ action: 'jump_to_morning' })).body.clock.timeMin).toBe(2160);
  });

  it('reset_playback returns to 930 paused, keeps phase, and replay is identical', async () => {
    const first = await get();
    const r = await control({ action: 'reset_playback' });
    expect(r.body.clock).toMatchObject({ timeMin: 930, playing: false, phase: 'locked' });
    await control({ action: 'play' });
    await tick(20);
    const second = await get();
    expect(second.clock.timeMin).toBe(2160);
    expect(keyOf(second)).toBe(keyOf(first));
    expect(second.snapshot.metrics).toEqual(first.snapshot.metrics);
  });

  it('changing speed while playing never leaves the window or alters the event list', async () => {
    await control({ action: 'reset_playback' });
    const events = JSON.stringify(store.get().events);
    await control({ action: 'speed', speed: 30 });
    await control({ action: 'play' });
    const seen: number[] = [];
    const speeds = [30, 600, 120] as const;
    for (let i = 0; i < 400 && store.get().clock.playing; i++) {
      if (i % 40 === 0) await control({ action: 'speed', speed: speeds[(i / 40) % 3] });
      await tick(1);
      seen.push(store.get().clock.timeMin);
    }
    for (let i = 0; i < seen.length; i++) {
      expect(Number.isInteger(seen[i])).toBe(true);
      expect(seen[i]).toBeGreaterThanOrEqual(930);
      expect(seen[i]).toBeLessThanOrEqual(2160);
      if (i > 0) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
    expect(JSON.stringify(store.get().events)).toBe(events);
    expect(store.get().clock.timeMin).toBe(2160);
    const end = await get();
    expect(end.snapshot.metrics.delivered).toBe(end.snapshot.metrics.matched);
  });

  it('invalid control bodies get JSON 400 and leave the clock unchanged', async () => {
    await control({ action: 'reset_playback' });
    const before = JSON.stringify((await get()).clock);
    const version = (await get()).version;
    for (const bad of [
      { action: 'explode' },
      { action: 'speed', speed: 45 },
      { action: 'speed' },
      { action: 'seek', timeMin: 100 },
      { action: 'seek', timeMin: 5000 },
      { action: 'seek', timeMin: 1000.5 },
      {},
    ]) {
      const r = await control(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(typeof r.body.error).toBe('string');
    }
    expect(JSON.stringify((await get()).clock)).toBe(before);
    expect((await get()).version).toBe(version);
  });
});
