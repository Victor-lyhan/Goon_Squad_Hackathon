// Helper for the 30-second demo path test (#704, docs/mvp3.md): the real app on the REAL default NYC run.
// - `demoRun()` builds the default run once per test file from the committed fixtures/nyc, with no key and no
//   network, the way tests/ui/sim-v2-real-helper.ts does: readNycFixtures + buildDefaultRun
//   (server/api/v2/bootRun.ts) and travel from createCachedProvider over the committed cache.
// - `DemoServer` is the fake `fetch` the app talks to through client/src/api/v2.ts. It holds that run in
//   memory and answers with the server's own pure steps: the views of server/api/v2/views.ts, the real
//   `snapshotAt`, and `planControl` (server/api/v2/controlOps.ts) for POST /simulator/control, with the
//   version raised on each applied control as server/store.ts does. Every body is JSON text, like the wire.
//   Answers need no timer, so the app runs under `vi.useFakeTimers()`. Nothing is written anywhere.
// - `mountApp(path)` mounts the real `AppShell` (header, routes, pages) in a MemoryRouter, with a probe that
//   reports the URL on screen.
// Story IDs, names and counts are never written here (DECISIONS pass 54): the test reads them from the run.
import { act, createElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { Run, TravelProvider } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures } from '../../server/api/v2/bootRun';
import { controlError, planControl } from '../../server/api/v2/controlOps';
import { mapResponse, simulatorResponse } from '../../server/api/v2/views';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { AppShell } from '../../client/src/App';
import { mount, type Mounted } from './kitDom';

// ---------- The real run ----------

export type DemoRun = { run: Run; travel: TravelProvider };

let cached: DemoRun | null = null;

/** The default NYC run, built once per test file (module state lives per file in vitest). */
export function demoRun(): DemoRun {
  if (cached) return cached;
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache');
  const travel = createCachedProvider(files);
  const run = buildDefaultRun({ travel, places: files.matrix.places, fixtures: readNycFixtures(NYC_FIXTURES_DIR) });
  cached = { run, travel };
  return cached;
}

// ---------- The fake fetch ----------

export type DemoRequest = { method: string; path: string; body: unknown };

const json = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

/** One server per test: the real run with its own clock. Install `server.fetch` with `vi.stubGlobal('fetch', ...)`. */
export class DemoServer {
  /** Every request the app sent, in order. */
  readonly requests: DemoRequest[] = [];
  /** Requests for a path this server does not know (answered 404): the demo path must not send one. */
  readonly unknown: DemoRequest[] = [];
  private run: Run;
  private readonly travel: TravelProvider;
  private mapBody: string | null = null;
  /** GET /simulator bodies by run version: the run changes only with an applied control. */
  private simBody: { version: number; body: string } | null = null;

  constructor({ run, travel }: DemoRun = demoRun()) {
    this.run = run;
    this.travel = travel;
  }

  /** The simulator answer at the server's clock now, as the app would read it off the wire. */
  simulator(): SimulatorResponse {
    return JSON.parse(this.simulatorBody()) as SimulatorResponse;
  }

  /** The map answer, as the app would read it off the wire. */
  map(): MapResponse {
    return JSON.parse(this.mapText()) as MapResponse;
  }

  /** The server clock's minute now. */
  timeMin(): number {
    return this.run.clock.timeMin;
  }

  /** The control requests received, in order. */
  controls(): SimControlRequest[] {
    return this.requests.flatMap((r) =>
      (r.method === 'POST' && r.path === '/api/v2/simulator/control' ? [r.body as SimControlRequest] : []));
  }

  /** The minutes of the seek requests received, in order. */
  seeks(): number[] {
    return this.controls().flatMap((c) => (c.action === 'seek' ? [c.timeMin] : []));
  }

  private simulatorBody(): string {
    if (this.simBody?.version !== this.run.version) {
      const body = JSON.stringify(simulatorResponse(this.run, snapshotAt(this.run, this.run.clock.timeMin, this.travel)));
      this.simBody = { version: this.run.version, body };
    }
    return this.simBody.body;
  }

  private mapText(): string {
    this.mapBody ??= JSON.stringify(mapResponse(this.run, this.travel));
    return this.mapBody;
  }

  private answer({ method, path, body }: DemoRequest): Response | null {
    const route = `${method} ${path}`;
    switch (route) {
      case 'GET /api/health': return json('{"ok":true}');
      case 'GET /api/v2/businesses': return json(JSON.stringify({ businesses: this.run.scenario.businesses }));
      case 'GET /api/v2/employees': return json(JSON.stringify({ employees: this.run.scenario.employees }));
      case 'GET /api/v2/simulator': return json(this.simulatorBody());
      case 'GET /api/v2/map': return json(this.mapText());
      case 'POST /api/v2/simulator/control': {
        const plan = planControl(this.run, body);
        if (plan.kind === 'invalid') return json(JSON.stringify(controlError(plan)), plan.status);
        this.run = { ...this.run, clock: plan.clock, version: this.run.version + 1 };
        return json(this.simulatorBody());
      }
      default: return null;
    }
  }

  /** The `fetch` of the app: same-origin paths only, answered at once (no timer, no socket). */
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const path = String(input).split('?')[0];
    const req: DemoRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    this.requests.push(req);
    const res = this.answer(req);
    if (res) return res;
    this.unknown.push(req);
    return json('{"error":"Not found"}', 404);
  };
}

// ---------- The app ----------

export type MountedApp = Mounted & {
  /** The path and query string on screen now, e.g. "/simulator?package=...". */
  url: () => string;
};

/** The real `AppShell` (header, route table, pages) in a MemoryRouter that starts at `path`. */
export function mountApp(path = '/'): MountedApp {
  let shown = path;
  function UrlProbe() {
    const { pathname, search } = useLocation();
    shown = pathname + search;
    return null;
  }
  const m = mount(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(AppShell), createElement(UrlProbe)));
  return { ...m, url: () => shown };
}

// ---------- Fake time ----------

/** Advances fake timers by `ms`, settling the requests' promises and React's updates on the way. */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Settles pending promises and React's updates without moving the clock. */
export const settle = () => advance(0);

/** Settles until `ok()` holds, without moving the clock (a load is a few promise turns, never a timer). */
export async function settleUntil(ok: () => boolean, what: string) {
  for (let i = 0; i < 50 && !ok(); i++) await settle();
  if (!ok()) throw new Error(`settleUntil(): ${what} did not happen`);
}
