import fs from 'node:fs';
import path from 'node:path';
import type { Run } from '../shared/types';

// The least a run needs for the store: a version to bump and a clock to pause on load.
// Both the MVP 1 Run and the MVP II Run (shared/v2/types) fit.
type StoreRun = { version: number; clock: { playing: boolean } };

export type Store<R = Run> = {
  get(): R;
  mutate(fn: (run: R) => R | void): Promise<R>;
  flush(): Promise<void>;
};

const SCHEMA_VERSION = 1;

// Keep a copy of an unusable state file as <file>.bad-<n> (first free n) so it is never lost.
function backupBad(filePath: string): string | null {
  for (let n = 1; n < 1000; n++) {
    const dest = `${filePath}.bad-${n}`;
    if (fs.existsSync(dest)) continue;
    try {
      fs.copyFileSync(filePath, dest);
      return dest;
    } catch {
      return null;
    }
  }
  return null;
}

function startFresh<R>(filePath: string, initial: () => R, reason: string): R {
  const copy = backupBad(filePath);
  console.warn(`[store] ${filePath} is unusable (${reason}); starting from the demo city${copy ? `, bad file kept at ${copy}` : ''}`);
  return initial();
}

function load<R extends StoreRun>(filePath: string, initial: () => R): R {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[store] cannot read ${filePath}, starting from the demo city:`, e);
    }
    return initial();
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.run?.clock) {
      throw new Error('unexpected schemaVersion or shape');
    }
    const run = parsed.run as R;
    run.clock.playing = false; // restart restores a paused state
    return run;
  } catch (e) {
    return startFresh(filePath, initial, (e as Error).message);
  }
}

async function writeAtomic(filePath: string, run: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, run }));
  await fs.promises.rename(tmp, filePath);
}

// Overloads rather than one generic signature with a default, so every MVP 1 caller compiles unchanged:
// - the first keeps `initial: () => { throw ... }` (returns `never`) typed as Store<Run>;
// - the second is the generic one: `createStore<RunV2>(...)`, or inferred from `initial`;
// - the last repeats the first because `ReturnType<typeof createStore>` reads the last overload.
export function createStore(opts: { filePath: string; initial: () => Run }): Store;
export function createStore<R extends StoreRun>(opts: { filePath: string; initial: () => R }): Store<R>;
export function createStore(opts: { filePath: string; initial: () => Run }): Store;
export function createStore<R extends StoreRun>(opts: { filePath: string; initial: () => R }): Store<R> {
  const { filePath } = opts;
  let run = load(filePath, opts.initial);
  let queue: Promise<unknown> = Promise.resolve();

  function mutate(fn: (run: R) => R | void): Promise<R> {
    const result = queue.then(async () => {
      const draft = structuredClone(run); // so a throwing mutator leaves state untouched
      const next = fn(draft) ?? draft;
      next.version = run.version + 1;
      await writeAtomic(filePath, next);
      run = next;
      return run;
    });
    queue = result.catch(() => undefined); // keep the chain alive after errors
    return result;
  }

  return {
    get: () => run,
    mutate,
    flush: async () => {
      await queue;
    },
  };
}
