import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import type { Run } from '../../shared/v2/types';
import { sampleRun } from './v2-sample';

// CI-safe (DECISIONS pass 17/19): real file writes get headroom on a loaded runner.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// The small hand-built v2 run of v2-sample.ts (delivery requests, plans and jobs included). A fresh copy per call.
const initial = (): Run => structuredClone(sampleRun);
let dir: string;
let file: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-'));
  file = path.join(dir, 'state.json');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

const bads = () => fs.readdirSync(dir).filter((f) => f.startsWith('state.json.bad-'));

describe('store restart cases', () => {
  it('missing file loads the initial run without warning', () => {
    const run = createStore({ filePath: file, initial }).get();
    expect(run).toEqual(initial());
    expect(warn).not.toHaveBeenCalled();
    expect(bads()).toEqual([]);
  });

  const badCases: [string, string][] = [
    ['empty file', ''],
    ['truncated JSON', '{"schemaVersion":1,"run":{"runId":"run-1","clo'],
    ['wrong schemaVersion', JSON.stringify({ schemaVersion: 2, run: { runId: 'old', clock: {} } })],
  ];
  for (const [name, content] of badCases) {
    it(`${name}: loads the initial run, warns once, keeps a copy`, () => {
      fs.writeFileSync(file, content);
      const run = createStore({ filePath: file, initial }).get();
      expect(run).toEqual(initial());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(bads()).toEqual(['state.json.bad-1']);
      expect(fs.readFileSync(path.join(dir, 'state.json.bad-1'), 'utf8')).toBe(content);
      // a second bad start keeps both copies
      createStore({ filePath: file, initial });
      expect(bads()).toEqual(['state.json.bad-1', 'state.json.bad-2']);
    });
  }

  it('a valid file with a leftover .tmp file loads the valid file and later writes still work', async () => {
    const a = createStore({ filePath: file, initial });
    await a.mutate((r) => { r.clock.timeMin += 5; });
    fs.writeFileSync(`${file}.tmp`, '{garbage');
    const b = createStore({ filePath: file, initial });
    expect(b.get()).toEqual({ ...a.get(), clock: { ...a.get().clock, playing: false } });
    expect(warn).not.toHaveBeenCalled();
    expect(bads()).toEqual([]);
    await b.mutate((r) => { r.clock.timeMin += 1; });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).run.clock.timeMin).toBe(a.get().clock.timeMin + 1);
  });

  it('restart after play restores the same run paused at the same minute', async () => {
    const a = createStore({ filePath: file, initial });
    await a.mutate((r) => { r.clock.playing = true; r.clock.phase = 'locked'; r.clock.timeMin += 37; });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).run.clock.playing).toBe(true);
    const before = a.get();
    const after = createStore({ filePath: file, initial }).get();
    expect(after.runId).toBe(before.runId);
    expect(after.version).toBe(before.version);
    expect(after.clock.phase).toBe('locked');
    expect(after.clock.timeMin).toBe(before.clock.timeMin);
    expect(after.clock.playing).toBe(false);
    expect(after.scenario.shipments).toEqual(before.scenario.shipments);
    expect(after.assignments.plans).toEqual(before.assignments.plans);
    expect(after.jobs).toEqual(before.jobs);
    expect(warn).not.toHaveBeenCalled();
  });

  it('20 concurrent mutations apply in order and the file parses after each', async () => {
    const store = createStore({ filePath: file, initial });
    const start = store.get().clock.timeMin;
    const order: number[] = [];
    const parsedTimes: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store
          .mutate((r: Run) => { order.push(i); r.clock.timeMin += 1; })
          .then(() => {
            const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
            parsedTimes.push(disk.run.clock.timeMin);
          }),
      ),
    );
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(parsedTimes).toEqual(Array.from({ length: 20 }, (_, i) => start + i + 1));
    expect(store.get().version).toBe(initial().version + 20);
  });
});
