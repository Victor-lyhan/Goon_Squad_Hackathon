import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { createInitialRun, loadDefaultScenario } from '../../server/api/initialRun';

// Demo step 7 saves a commute live. DECISIONS pass 19: the limit is never raised;
// a median above 50 ms (a third of the limit) is reported in the PR.
const LIMIT_MS = 150;

let server: Server;
let base: string;
let store: Store;

beforeEach(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'commute-latency-')), 'state.json');
  store = createStore({ filePath: file, initial: () => createInitialRun(loadDefaultScenario()) });
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise((r) => server.close(r)));

describe('commute PUT latency on the Demo city', () => {
  it('median of 5 saves after 1 warm-up is under 150 ms', async () => {
    const emps = store.get().scenario.employees;
    const put = async (i: number) => {
      const e = emps[i % emps.length];
      const body = {
        businessId: e.businessId, homeNodeId: e.homeNodeId,
        eveningDepartureMin: e.eveningDepartureMin, morningDepartureMin: e.morningDepartureMin,
        eveningViaNodeIds: e.eveningViaNodeIds, morningViaNodeIds: e.morningViaNodeIds,
        availableEvening: e.availableEvening, availableMorning: e.availableMorning, maxExtraMin: e.maxExtraMin,
      };
      const t = performance.now();
      const res = await fetch(`${base}/api/employees/${e.id}/commute`, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const ms = performance.now() - t;
      expect(res.status).toBe(200);
      return ms;
    };
    await put(0); // warm-up
    const times: number[] = [];
    for (let i = 1; i <= 5; i++) times.push(await put(i));
    const median = [...times].sort((a, b) => a - b)[2];
    console.log(`commute PUT ms: ${times.map((t) => t.toFixed(1)).join(', ')}; median ${median.toFixed(1)}`);
    expect(median).toBeLessThan(LIMIT_MS);
  }, 30_000);
});
