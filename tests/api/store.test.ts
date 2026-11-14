import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import type { Run } from '../../shared/types';

const mkRun = (): Run =>
  ({
    runId: 'r1',
    version: 0,
    scenario: {},
    trips: [],
    assignments: {},
    jobs: [],
    notifications: [],
    events: [],
    clock: { phase: 'planning', playing: true, timeMin: 0, speed: 30 },
    counter: 0,
  }) as unknown as Run;

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'nested', 'state.json');
const counter = (r: Run) => (r as unknown as { counter: number }).counter;

describe('store', () => {
  it('serializes 20 concurrent mutations with no lost updates', async () => {
    const store = createStore({ filePath: tmpFile(), initial: mkRun });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.mutate((r) => {
          (r as unknown as { counter: number }).counter += 1;
        }),
      ),
    );
    await store.flush();
    expect(store.get().version).toBe(20);
    expect(counter(store.get())).toBe(20);
  });

  it('writes {schemaVersion, run} and reloads paused', async () => {
    const filePath = tmpFile();
    const a = createStore({ filePath, initial: mkRun });
    await a.mutate((r) => {
      r.clock.timeMin = 99;
    });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).schemaVersion).toBe(1);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    const b = createStore({ filePath, initial: () => { throw new Error('no'); } });
    expect(b.get().clock.timeMin).toBe(99);
    expect(b.get().clock.playing).toBe(false);
    expect(b.get().version).toBe(1);
  });

  it('uses initial when the file is missing, or invalid', () => {
    const missing = createStore({ filePath: tmpFile(), initial: mkRun });
    expect(missing.get().runId).toBe('r1');
    const bad = tmpFile();
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, JSON.stringify({ schemaVersion: 2, run: { runId: 'old' } }));
    expect(createStore({ filePath: bad, initial: mkRun }).get().runId).toBe('r1');
    fs.writeFileSync(bad, '{not json');
    expect(createStore({ filePath: bad, initial: mkRun }).get().runId).toBe('r1');
  });

  it('a throwing mutator rejects, leaves state unchanged, and later mutations run', async () => {
    const store = createStore({ filePath: tmpFile(), initial: mkRun });
    await expect(
      store.mutate((r) => {
        r.clock.timeMin = 500;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.get().clock.timeMin).toBe(0);
    expect(store.get().version).toBe(0);
    await store.mutate((r) => {
      r.clock.timeMin = 5;
    });
    expect(store.get().clock.timeMin).toBe(5);
    expect(store.get().version).toBe(1);
  });
});
