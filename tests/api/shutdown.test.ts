import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../server/store';
import { portInUseMessage } from '../../server/index';
import type { Run } from '../../shared/v2/types';
import { sampleRun } from './v2-sample';

// The small hand-built v2 run of v2-sample.ts. A fresh copy per call.
const initial = (): Run => structuredClone(sampleRun);

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-'));
  file = path.join(dir, 'state.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// "Stop the ticker, pause, save, resume paused" (spec test 13) is the runtime's `shutdown()` now:
// tests/api/v2-bootstrap-runtime.test.ts and tests/api/server-entry.test.ts cover it.
describe('shutdown', () => {
  it('store.flush waits for pending writes', async () => {
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
