// Helper for the MVP II simulator views on the REAL default NYC run (#512).
// - `realSim()` builds the default run once per test file from the committed fixtures/nyc, with no key and no
//   network: readNycFixtures + buildDefaultRun (server/api/v2/bootRun.ts), travel from createCachedProvider over
//   the committed cache, the real `snapshotAt`, then simulatorResponse / mapResponse (server/api/v2/views.ts).
//   Nothing is written anywhere.
// - `at(t)` moves the clock the way POST /api/v2/simulator/control `seek` does (planControl) and answers the two
//   responses at that minute, JSON round-tripped like the wire.
// - `render(...)` renders the page body (SimPageBody) with a hook value holding those responses.
// Story IDs, names and counts are never pinned here (DECISIONS pass 54): every expectation is read from the run.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { Run, TravelProvider } from '../../shared/v2/types';
import { NYC_FIXTURES_DIR, buildDefaultRun, readNycFixtures } from '../../server/api/v2/bootRun';
import { planControl } from '../../server/api/v2/controlOps';
import { mapResponse, simulatorResponse } from '../../server/api/v2/views';
import { readTravelFiles } from '../../server/geo/cache';
import { NYC_BOX } from '../../server/geo/cacheReport';
import { createCachedProvider } from '../../server/geo/providers';
import { snapshotAt } from '../../server/domain/v2/simulation';
import { SimPageBody } from '../../client/src/components/sim/v2/compose/SimPageBody';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';

/** Per test and hook: one real run build plus renders. Locally well under 1 s; 30 s is far above 10x. */
export const T = 30_000;

export { NYC_BOX };

export type Moment = {
  name: string;
  timeMin: number;
  sim: SimulatorResponse;
  map: MapResponse;
  /** The data hook's state once the poll and the map arrived. */
  data: SimDataState;
};

export type RealSim = {
  run: Run;
  travel: TravelProvider;
  /** The five moments of the issue: 930, one minute inside the evening leg, 1440, one minute inside the morning leg, 2160. */
  moments: Moment[];
  at: (timeMin: number, name?: string) => Moment;
};

let cached: RealSim | null = null;

/**
 * One minute inside the first leg (by first pickup) of the given trip direction: one minute after its
 * first stop's service starts, so the carrier is on the leg.
 */
function oneMinuteInside(run: Run, suffix: '-eve' | '-morn'): number | null {
  const starts = run.assignments.plans.flatMap((p) => p.legs)
    .filter((l) => l.tripId.endsWith(suffix) && l.stops.length > 0)
    .map((l) => l.stops[0].arrivalMin)
    .sort((a, b) => a - b);
  return starts.length > 0 ? starts[0] + 1 : null;
}

const wire = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

export function realSim(): RealSim {
  if (cached) return cached;
  const files = readTravelFiles(NYC_FIXTURES_DIR);
  if (!files) throw new Error('fixtures/nyc has no travel cache');
  const travel = createCachedProvider(files);
  const run = buildDefaultRun({ travel, places: files.matrix.places, fixtures: readNycFixtures(NYC_FIXTURES_DIR) });
  const map = wire(mapResponse(run, travel));

  const at = (timeMin: number, name = `minute ${timeMin}`): Moment => {
    const plan = planControl(run, { action: 'seek', timeMin });
    if (plan.kind !== 'apply') throw new Error(`seek ${timeMin} refused: ${JSON.stringify(plan.fieldErrors)}`);
    const moved: Run = { ...run, clock: plan.clock };
    const sim = wire(simulatorResponse(moved, snapshotAt(moved, moved.clock.timeMin, travel)));
    return { name, timeMin, sim, map, data: { ...INITIAL_SIM_DATA, view: 'ready', sim, map } };
  };

  const evening = oneMinuteInside(run, '-eve');
  const morning = oneMinuteInside(run, '-morn');
  if (evening === null || morning === null) throw new Error('the default run has no evening or no morning leg');
  const moments = [
    at(930, 'minute 930'),
    at(evening, 'one minute inside the evening leg'),
    at(1440, 'minute 1440'),
    at(morning, 'one minute inside the morning leg'),
    at(2160, 'minute 2160'),
  ];
  cached = { run, travel, moments, at };
  return cached;
}

// ---------- Rendering ----------

export function hookOf(data: SimDataState): SimulatorV2 {
  return {
    ...data,
    control: vi.fn(async () => null),
    generate: vi.fn(async () => null),
    resetPlanning: vi.fn(async () => null),
    recompute: vi.fn(async () => null),
    compare: vi.fn(async () => null),
    refetch: vi.fn(),
    dismissActionError: vi.fn(),
  };
}

/** Static markup of the page body for one moment and one selection (what the browser shows on first paint). */
export function renderBody(moment: Moment, selection: Selection = null): string {
  return renderToStaticMarkup(createElement(SimPageBody, {
    sim: hookOf(moment.data), selection, onSelectionChange: () => {},
  }));
}

/** Visible text of static markup, entities decoded, whitespace collapsed. */
export const text = (html: string) => html
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

// Case-sensitive for the leaked values (so "Financial District" is not "NaN"), any case for "hub".
export const FORBIDDEN = [/\bundefined\b/g, /\bNaN\b/g, /\bnull\b/g, /\bInvalid\b/g, /\bhubs?\b/gi];

/** The forbidden words found in the visible text and in every attribute value. */
export function forbiddenIn(html: string): string[] {
  const attrs = [...html.matchAll(/="([^"]*)"/g)].map((m) => m[1]);
  return [text(html), ...attrs].flatMap((s) => FORBIDDEN.flatMap((re) => s.match(re) ?? []));
}

/** Every `<tag ...>` element whose opening tag contains `attr`, outer HTML up to the first matching close. */
export function elements(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>[\\s\\S]*?</${tag}>`, 'g');
  return html.match(re) ?? [];
}

/** React's static markup escapes text; compare names the same way. */
export const escaped = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// ---------- Geometry ----------

/** Great-circle distance in meters. */
export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const inNyc = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && p.lat >= NYC_BOX.south && p.lat <= NYC_BOX.north && p.lng >= NYC_BOX.west && p.lng <= NYC_BOX.east;
