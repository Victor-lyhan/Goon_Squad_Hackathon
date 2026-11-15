// Helpers for the v2 simulator-control tests (tests/api/v2-control-*.test.ts).
// The run is the hand-built one in v2-sample.ts (events at 1052, 1072, 1082, 1108, 1930, 1952; run 930..2160).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/index';
import { createStore, type Store } from '../../server/store';
import { registerControlRoutes } from '../../server/api/v2/controlRoutes';
import type { Clock, Run, SimEvent, Snapshot, TravelProvider } from '../../shared/v2/types';
import { events, sampleRun, snapshotStart } from './v2-sample';

/** An unfrozen copy of the sample run with another clock and (optionally) other events. */
export function runWith(clock: Partial<Clock> = {}, runEvents: SimEvent[] = events): Run {
  const run = structuredClone(sampleRun);
  run.clock = { ...run.clock, ...clock };
  run.events = structuredClone(runEvents);
  return run;
}

/** A copy of a sample event at another minute. */
export const eventAt = (timeMin: number, seq: number): SimEvent =>
  ({ ...events[0], id: `evt-test-${seq}`, timeMin, seq });

/**
 * Stands in for the real snapshotAt (not on main yet): it answers for the minute it is asked for
 * and lists the events up to that minute, so a test can tell which minute the route asked for.
 */
export function recordingSnapshotAt() {
  const calls: { version: number; timeMin: number }[] = [];
  const snapshotAt = (run: Run, timeMin: number): Snapshot => {
    calls.push({ version: run.version, timeMin });
    return {
      ...snapshotStart,
      runId: run.runId,
      version: run.version,
      timeMin,
      occurredEvents: run.events.filter((e) => e.timeMin <= timeMin),
    };
  };
  return { snapshotAt, calls };
}

const travel: TravelProvider = {
  durationMin: (a, b) => (a === b ? 0 : 10),
  distanceM: (a, b) => (a === b ? 0 : 3000),
  polyline: () => null,
};

export type ControlServer = {
  store: Store<Run>;
  stateFile: string;
  snapshotCalls: { version: number; timeMin: number }[];
  /** POST /api/v2/simulator/control. A string body is sent as it is (to send malformed JSON). */
  control(body?: unknown): Promise<{ status: number; body: Record<string, any> }>;
  /** The same path with another method and no body. */
  raw(method: string): Promise<Response>;
  close(): Promise<void>;
};

/**
 * The real app (createApp -> createV2Router) with the control routes registered through `extraRoutes`
 * and a real file store. `wrapStore` lets a test put its own store in front of the real one.
 */
export async function startControlServer(
  run: Run,
  wrapStore: (store: Store<Run>) => Store<Run> = (s) => s,
): Promise<ControlServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-control-'));
  const stateFile = path.join(dir, 'state-v2.json');
  const store = createStore<Run>({ filePath: stateFile, initial: () => run });
  const { snapshotAt, calls } = recordingSnapshotAt();
  const app = createApp({
    clientDist: path.join(dir, 'no-dist'),
    v2: {
      travel,
      store,
      extraRoutes: (router) => registerControlRoutes(router, { store: wrapStore(store), snapshotAt }),
    },
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    store,
    stateFile,
    snapshotCalls: calls,
    async control(body) {
      const res = await fetch(`${base}/api/v2/simulator/control`, {
        method: 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    },
    raw: (method) => fetch(`${base}/api/v2/simulator/control`, { method }),
    async close() {
      await new Promise((r) => server.close(r));
      await store.flush();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
