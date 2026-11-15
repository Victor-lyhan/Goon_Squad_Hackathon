// Starts the real app (createApp: JSON parser, /api/v2 mount, JSON error handler) with the MVP II read
// routes registered through createV2Router's `extraRoutes`, on an in-memory v2 store and an injected
// snapshot function. No network beyond localhost, no key, no v2 state file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import type { Store } from '../../server/store';
import type { RunV2 } from '../../server/api/v2/router';
import { registerReadRoutes, type ReadDeps } from '../../server/api/v2/readRoutes';
import type { Snapshot, TravelProvider } from '../../shared/v2/types';
import { sampleRun, snapshotEnd, snapshotEvening, snapshotStart } from './v2-sample';

/** A v2 store that lives in memory. `mutations()` counts every `mutate` call; `set` replaces the run directly. */
export function memoryStore(initial: RunV2) {
  let run = initial;
  let mutations = 0;
  const store: Store<RunV2> = {
    get: () => run,
    mutate: async (fn) => {
      mutations += 1;
      const draft = structuredClone(run);
      const next = fn(draft) ?? draft;
      next.version = run.version + 1;
      run = next;
      return run;
    },
    flush: async () => {},
  };
  return { store, set: (next: RunV2) => { run = next; }, mutations: () => mutations };
}

/** The three hand-built sample snapshots, by the clock minute they belong to. */
export const SAMPLE_SNAPSHOTS: Record<number, Snapshot> = {
  [snapshotStart.timeMin]: snapshotStart,       // 930
  [snapshotEvening.timeMin]: snapshotEvening,   // 1110
  [snapshotEnd.timeMin]: snapshotEnd,           // 2160
};

/**
 * A snapshot function that answers only at the three sample minutes and records every call.
 * Any other minute throws, so a handler that asks for a time other than the run's clock fails loudly.
 */
export function recordingSnapshotAt() {
  const calls: { run: RunV2; timeMin: number }[] = [];
  const snapshotAt: ReadDeps['snapshotAt'] = (run, timeMin) => {
    calls.push({ run, timeMin });
    const snapshot = SAMPLE_SNAPSHOTS[timeMin];
    if (!snapshot) throw new Error(`The sample has no snapshot at minute ${timeMin}`);
    return snapshot;
  };
  return { snapshotAt, calls };
}

/** The sample run with its clock at another minute (the sample itself is frozen). */
export const sampleRunAt = (timeMin: number): RunV2 => ({ ...sampleRun, clock: { ...sampleRun.clock, timeMin } });

export type ReadApi = Awaited<ReturnType<typeof startReadApi>>;

export async function startReadApi(opts: {
  travel: TravelProvider;
  run?: RunV2;
  snapshotAt?: ReadDeps['snapshotAt'];
  /** Passed on as the optional dependency of GET /map (issue #536). Left out: the map fetches no route line. */
  ensureLegPolylines?: ReadDeps['ensureLegPolylines'];
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-read-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html>SPA</html>');

  const memory = memoryStore(opts.run ?? sampleRun);
  const recorder = recordingSnapshotAt();
  const deps: ReadDeps = {
    store: memory.store, travel: opts.travel, snapshotAt: opts.snapshotAt ?? recorder.snapshotAt,
    ...(opts.ensureLegPolylines ? { ensureLegPolylines: opts.ensureLegPolylines } : {}),
  };

  const app = createApp({
    clientDist: dist,
    v2: { travel: deps.travel, store: deps.store, extraRoutes: (router) => registerReadRoutes(router, deps) },
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v2`;

  /** `url` is relative to /api/v2. A string body is sent as it is (to send JSON that is not an object). */
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    const isJson = /json/.test(res.headers.get('content-type') ?? '');
    return { status: res.status, isJson, text, body: (isJson ? JSON.parse(text) : null) as Record<string, any> };
  };

  return {
    call,
    get: (url: string) => call('GET', url),
    store: memory.store,
    setRun: memory.set,
    mutations: memory.mutations,
    /** Calls made to the default recording snapshot function (empty when `opts.snapshotAt` was passed). */
    snapshotCalls: recorder.calls,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** What a JSON round trip does to a value: the form a response body has on the wire. */
export const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
