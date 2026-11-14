import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';
import { portInUseMessage, shutdown } from '../../server/index';

const initial = () => createInitialRun(loadDefaultScenario());

/** A small stand-in for a clock ticker (the MVP 1 one is deleted): one simulated minute per interval while playing. */
function startTestTicker(store: Store, intervalMs: number): { stop(): void } {
  const timer = setInterval(() => {
    if (!store.get().clock.playing) return;
    void store.mutate((r) => { r.clock.timeMin += 1; });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-'));
  file = path.join(dir, 'state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('shutdown', () => {
  it('stops the ticker, pauses, and persists the final state (spec test 13)', async () => {
    const store = createStore({ filePath: file, initial });
    const ticker = startTestTicker(store, 5);
    await store.mutate((r) => {
      r.clock.playing = true;
      r.clock.phase = 'locked';
    });
    await new Promise((r) => setTimeout(r, 60));
    await shutdown(store, ticker);

    const before = store.get();
    expect(before.clock.playing).toBe(false);
    expect(before.clock.timeMin).toBeGreaterThan(initial().clock.timeMin);
    await new Promise((r) => setTimeout(r, 30)); // ticker is really stopped
    expect(store.get().version).toBe(before.version);

    const again = createStore({ filePath: file, initial: () => { throw new Error('should load file'); } }).get();
    expect(again.runId).toBe(before.runId);
    expect(again.clock.timeMin).toBe(before.clock.timeMin);
    expect(again.clock.playing).toBe(false);
    expect(again.assignments).toEqual(before.assignments);
  });

  it('ticker.stop halts ticking and store.flush waits for pending writes', async () => {
    const store = createStore({ filePath: file, initial });
    const p = store.mutate((r) => { r.clock.speed = 600; });
    await store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).run.clock.speed).toBe(600);
    await p;
  });

  it('port-busy message names the port and a suggestion', () => {
    expect(portInUseMessage(3001)).toBe('Port 3001 is already in use. Stop the other Relay server or set PORT=3002.');
  });
});
