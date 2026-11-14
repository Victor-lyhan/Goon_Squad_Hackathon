// Helpers for the v2 clock-ticker tests (tests/api/v2-ticker-*.test.ts): an injected clock, a real file
// store on the hand-built sample run (930..2160), and an in-memory store whose mutations finish only
// when the test says so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { createStore, type Store } from '../../server/store';
import type { Clock, Run } from '../../shared/v2/types';
import { sampleRun } from './v2-sample';

/** An unfrozen copy of the sample run with another clock. */
export function runWith(clock: Partial<Clock>): Run {
  const run = structuredClone(sampleRun);
  run.clock = { ...run.clock, ...clock };
  return run;
}

/** The real store on a fresh temp file. The file does not exist until the first mutation. */
export function fileStore(run: Run): { store: Store<Run>; stateFile: string } {
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ticker-')), 'state-v2.json');
  return { store: createStore<Run>({ filePath: stateFile, initial: () => run }), stateFile };
}

/** The `now` given to the ticker. Real time never passes in these tests; only `advance` moves it. */
export function fakeNow(startMs = 1_000_000) {
  let ms = startMs;
  return { now: () => ms, advance: (by: number) => void (ms += by) };
}

/** Lets promise callbacks and the store's file write finish. */
export const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** `ticks` timer ticks of `ms` real milliseconds each; after each one the store's queue is drained. */
export async function step(
  clock: ReturnType<typeof fakeNow>, store: Store<Run>, ms: number, ticks: number,
): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    clock.advance(ms);
    vi.advanceTimersByTime(ms);
    await store.flush();
    await settle(); // let the ticker see that its mutation is done
  }
}

/**
 * An in-memory store with the real store's rules (clone, apply, version + 1, one at a time), where every
 * mutation waits until the test calls `release()`. `failNext()` makes the next released mutation reject
 * like a failed file write: the run stays as it was.
 */
export function gatedStore(initial: Run) {
  let run = initial;
  let queue: Promise<unknown> = Promise.resolve();
  const gates: { open(): void; done: Promise<unknown> }[] = [];
  let failNext = false;
  const stats = { started: 0, finished: 0, inFlight: 0, maxInFlight: 0 };

  const store: Store<Run> = {
    get: () => run,
    mutate(fn) {
      stats.started++;
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      let open = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      const result = queue.then(async () => {
        await gate;
        try {
          if (failNext) {
            failNext = false;
            throw new Error('disk full');
          }
          const draft = structuredClone(run);
          const next = fn(draft) ?? draft;
          next.version = run.version + 1;
          run = next;
          return run;
        } finally {
          stats.inFlight--;
          stats.finished++;
        }
      });
      queue = result.catch(() => undefined);
      gates.push({ open, done: queue });
      return result;
    },
    flush: async () => {
      await queue;
    },
  };

  return {
    store,
    stats,
    /** Number of mutations waiting for `release()`. */
    waiting: () => gates.length,
    /** Lets the oldest waiting mutation finish, and waits until the ticker has seen it. */
    async release() {
      const gate = gates.shift();
      if (!gate) throw new Error('no mutation is waiting');
      gate.open();
      await gate.done; // this mutation only: later ones may still be waiting
      await settle();
    },
    failNext: () => void (failNext = true),
  };
}
