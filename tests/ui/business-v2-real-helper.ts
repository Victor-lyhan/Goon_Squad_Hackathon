// Helper for the MVP II Business workspace on the REAL default NYC run (#514).
// - `realRun()` builds the default run once per test file from the committed fixtures/nyc, with no key and no
//   network: readNycFixtures + buildDefaultRun (server/api/v2/bootRun.ts), travel from createCachedProvider
//   over the committed cache, the real `snapshotAt`, then businessDashboard / shipmentView (server/api/v2/views.ts).
//   Nothing is written anywhere.
// - `at(t)` moves the clock the way POST /api/v2/simulator/control `seek` does (planControl) and answers the
//   API's views at that minute.
// - `startRealApi()` boots createV2Runtime on a COPY of fixtures/nyc in a temp folder (like
//   tests/api/v2-bootstrap-helper.ts) and points the global `fetch` at it, so client/src/api/v2.ts talks to it.
// Story IDs, names and counts are never pinned here (DECISIONS pass 54): every expectation is read from the run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BusinessDashboard, ShipmentResponse, ShipmentView } from '../../shared/v2/api';
import type { Employee, NetworkBusiness, Run, Snapshot, TravelProvider } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures } from '../../server/api/v2/bootRun';
import { createV2Runtime } from '../../server/api/v2/bootstrap';
import { planControl } from '../../server/api/v2/controlOps';
import { businessDashboard, shipmentView } from '../../server/api/v2/views';
import { readTravelFiles } from '../../server/geo/cache';
import { createCachedProvider } from '../../server/geo/providers';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { createApp } from '../../server/index';
import {
  businessWorkspaceReducer, initialBusinessWorkspaceState, toDirectoryEmployees, type BusinessWorkspaceState,
} from '../../client/src/components/business/v2/live/businessWorkspaceState';
import { BusinessPageView, type BusinessPageViewProps } from '../../client/src/components/business/v2/page/BusinessPageView';

/** Per test and hook: a real run build or a real HTTP server (DECISIONS pass 19). Locally well under 1 s each. */
export const T = 30_000;

// ---------- The real run ----------

export type RealRun = {
  run: Run;
  travel: TravelProvider;
  /** The five moments of the issue, read from the run: start, inside an evening leg, midnight, inside a morning leg, end. */
  moments: { name: string; timeMin: number }[];
  at: (timeMin: number) => Moment;
};

export type Moment = {
  timeMin: number;
  /** The run with the clock moved as a `seek` does. */
  run: Run;
  snapshot: Snapshot;
  dashboard: (businessId: string) => BusinessDashboard;
  shipment: (shipmentId: string) => ShipmentView;
};

let cached: RealRun | null = null;

/** A minute strictly inside the first leg (by pickup time) of the given trip direction. */
function insideLeg(run: Run, suffix: '-eve' | '-morn'): number | null {
  const legs = run.assignments.plans.flatMap((p) => p.legs)
    .filter((l) => l.tripId.endsWith(suffix) && l.stops.length >= 2)
    .map((l) => ({ from: l.stops[0].serviceStartMin, to: l.stops[l.stops.length - 1].serviceStartMin }))
    .filter((l) => l.to - l.from >= 2)
    .sort((a, b) => a.from - b.from);
  // The middle of the leg: past the first stop's handling, before the last stop.
  return legs.length > 0 ? Math.floor((legs[0].from + legs[0].to) / 2) : null;
}

/** Builds the default NYC run once per test file (module state lives per file in vitest). */
export function realRun(): RealRun {
  if (cached) return cached;
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache');
  const travel = createCachedProvider(files);
  const run = buildDefaultRun({ travel, places: files.matrix.places, fixtures: readNycFixtures(NYC_FIXTURES_DIR) });
  const { simStartMin, simEndMin } = run.scenario.settings;
  const evening = insideLeg(run, '-eve');
  const morning = insideLeg(run, '-morn');
  if (evening === null || morning === null) throw new Error('the default run has no evening or no morning leg');
  const moments = [
    { name: 'start', timeMin: simStartMin },
    { name: 'inside the evening leg', timeMin: evening },
    { name: 'midnight', timeMin: 1440 },
    { name: 'inside the morning leg', timeMin: morning },
    { name: 'end', timeMin: simEndMin },
  ];

  const at = (timeMin: number): Moment => {
    const plan = planControl(run, { action: 'seek', timeMin });
    if (plan.kind !== 'apply') throw new Error(`seek ${timeMin} refused: ${JSON.stringify(plan.fieldErrors)}`);
    const moved: Run = { ...run, clock: plan.clock };
    const snapshot = snapshotAt(moved, moved.clock.timeMin, travel);
    return {
      timeMin,
      run: moved,
      snapshot,
      dashboard: (id) => {
        const d = businessDashboard(moved, snapshot, id);
        if (!d) throw new Error(`no dashboard for ${id}`);
        return JSON.parse(JSON.stringify(d)) as BusinessDashboard; // what the wire carries
      },
      shipment: (id) => {
        const v = shipmentView(moved, snapshot, id);
        if (!v) throw new Error(`no shipment view for ${id}`);
        return JSON.parse(JSON.stringify(v)) as ShipmentView;
      },
    };
  };
  cached = { run, travel, moments, at };
  return cached;
}

// ---------- The page, fed like useBusinessWorkspace feeds it ----------

/** What the hook loads besides the dashboard: GET /businesses, GET /employees and the map's run ID. */
export type Directory = { runId: string; businesses: NetworkBusiness[]; employees: Employee[] };
export const directoryOf = (run: Run): Directory =>
  ({ runId: run.runId, businesses: run.scenario.businesses, employees: run.scenario.employees });

/** The hook state after the directories and one dashboard poll arrived (the real reducer of useBusinessWorkspace). */
export function workspaceState(dir: Directory | Run, dashboard: BusinessDashboard): BusinessWorkspaceState {
  const d = 'scenario' in dir ? directoryOf(dir) : dir;
  let s = businessWorkspaceReducer(initialBusinessWorkspaceState, {
    type: 'directories', businesses: d.businesses, employees: toDirectoryEmployees(d.employees),
  });
  s = businessWorkspaceReducer(s, { type: 'dashboard', dashboard, runId: d.runId });
  return s;
}

const noop = () => {};
const never = async (): Promise<ShipmentResponse> => { throw new Error('not called in a static render'); };

export function renderPage(state: BusinessWorkspaceState, p: Partial<BusinessPageViewProps> = {}): string {
  const props: BusinessPageViewProps = {
    state, shipmentId: null, createShipment: never, matchShipment: never, refetchNow: async () => {},
    dismissRunChanged: noop, onOpenShipment: noop, onCloseShipment: noop,
    businessHref: (id) => `/nyc/business/${id}`, ...p,
  };
  return renderToStaticMarkup(createElement(BusinessPageView, props));
}

/** Visible text of static markup, entities decoded, whitespace collapsed. */
export const text = (html: string) => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

/** Words that must never reach a user on the real run. */
// Case-sensitive for the leaked values (so "Financial District" is not "NaN"), any case for the two words.
export const FORBIDDEN = [/\bundefined\b/g, /\bNaN\b/g, /\bnull\b/g, /\bInvalid\b/g, /\bhubs?\b/gi, /synthetic/gi];

/** The forbidden words found in the visible text and in every attribute value. */
export function forbiddenIn(html: string): string[] {
  const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  return [text(html), ...attrs].flatMap((s) => FORBIDDEN.flatMap((re) => s.match(re) ?? []));
}

/** Every `<tag ...>` element matching `attr` (e.g. `class="bw-row"`), outer HTML up to its closing tag. */
export function elements(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>[\\s\\S]*?</${tag}>`, 'g');
  return html.match(re) ?? [];
}

// ---------- A real server on a copy of fixtures/nyc ----------

export type RealApi = Awaited<ReturnType<typeof startRealApi>>;

/**
 * createV2Runtime on a copy of fixtures/nyc (all five files) in a temp folder, no key, Google `fetch` that
 * throws. The global `fetch` is stubbed so the client's relative `/api/...` URLs reach this server; every
 * other URL is refused. Call `close` in afterAll.
 */
export async function startRealApi() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'business-v2-real-'));
  const fixturesDir = path.join(root, 'fixtures', 'nyc');
  fs.mkdirSync(fixturesDir, { recursive: true });
  for (const name of fs.readdirSync(NYC_FIXTURES_DIR)) {
    fs.copyFileSync(path.join(NYC_FIXTURES_DIR, name), path.join(fixturesDir, name));
  }
  const googleCalls: string[] = [];
  const runtime = createV2Runtime({
    fixturesDir,
    statePath: path.join(root, 'data', 'state-v2.json'),
    key: null,
    fetch: async (url) => {
      googleCalls.push(String(url).split('?')[0]);
      throw new Error('the real Business tests must not reach the network');
    },
  });
  if (runtime.status !== 'ready' || !runtime.deps.store) {
    throw new Error(`/api/v2 did not load on the copy of fixtures/nyc: ${runtime.reason ?? 'no store'}`);
  }
  const app = createApp({ clientDist: path.join(root, 'no-dist'), v2: runtime.deps });
  const server: Server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('/api/')) return Promise.reject(new Error(`unexpected fetch of ${url}`));
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    return realFetch(origin + url, init);
  });

  return {
    root,
    fixturesDir,
    runtime,
    /** `METHOD /api/...` of every request the client sent. */
    requests,
    googleCalls,
    close: async () => {
      vi.unstubAllGlobals();
      await new Promise((resolve) => server.close(resolve));
      await runtime.shutdown();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
