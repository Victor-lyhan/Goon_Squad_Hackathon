import fs from 'node:fs';
import path from 'node:path';
import type { Run } from '../shared/types';

export type Store = {
  get(): Run;
  mutate(fn: (run: Run) => Run | void): Promise<Run>;
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

function startFresh(filePath: string, initial: () => Run, reason: string): Run {
  const copy = backupBad(filePath);
  console.warn(`[store] ${filePath} is unusable (${reason}); starting from the demo city${copy ? `, bad file kept at ${copy}` : ''}`);
  return initial();
}

function load(filePath: string, initial: () => Run): Run {
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
    const run = parsed.run as Run;
    run.clock.playing = false; // restart restores a paused state
    return run;
  } catch (e) {
    return startFresh(filePath, initial, (e as Error).message);
  }
}

async function writeAtomic(filePath: string, run: Run): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify({ schemaVersion: SCHEMA_VERSION, run }));
  await fs.promises.rename(tmp, filePath);
}

export function createStore(opts: { filePath: string; initial: () => Run }): Store {
  const { filePath } = opts;
  let run = load(filePath, opts.initial);
  let queue: Promise<unknown> = Promise.resolve();

  function mutate(fn: (run: Run) => Run | void): Promise<Run> {
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
