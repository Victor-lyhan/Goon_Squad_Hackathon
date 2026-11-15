// Helpers for the MVP II simulator page in a real DOM (#519): a fake data hook that records every
// action call, and mounts of `SimPageBody` (selection reported through onSelectionChange) and of the
// routed `SimulatorV2Workspace` (selection in the URL, the page's keyboard map on the window).
//
// The fake server holds one `SimDataState` and answers like the real hook: a write resolves to the
// applied SimulatorResponse (or null when `refuse` is set). A `seek` moves the clock to the requested
// minute with the status the test's server table gives; the browser computes nothing.
// Data comes from the hand-built samples: `sim-v2-journey-sample.ts` (a direct, a relay and an
// unmatched package) and `sim-v2-data-fixtures.ts` (an empty run with another runId).
import { act, createElement, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { vi } from 'vitest';
import type { MapResponse, SimulatorResponse } from '../../shared/v2/api';
import type { SimControlRequest } from '../../shared/v2/schemas';
import type { ShipmentProgress } from '../../shared/v2/types';
import { SimPageBody } from '../../client/src/components/sim/v2/compose/SimPageBody';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import { SimulatorV2Workspace } from '../../client/src/pages/v2/SimulatorV2';
import { mount, textOf, type Mounted } from './kitDom';
import { mapOf, simAt as emptyRunAt } from './sim-v2-data-fixtures';
import { map as sampleMap, simAt as sampleSimAt } from './sim-v2-journey-sample';

/** Every test in the sim-v2-dom files gets this timeout. */
export const T = 10_000;

// ---------- Sample data ----------

/**
 * What the fake server says shp-2 (the relay package) is at `timeMin`: picked up at 1042, dropped at
 * the relay point at 1062, picked up there at 1952, delivered at 1977 (the sample plan's service ends).
 */
export function relayStatusAt(timeMin: number): ShipmentProgress {
  if (timeMin < 1042) return 'scheduled';
  if (timeMin < 1062) return 'picked_up';
  if (timeMin < 1952) return 'at_hub';
  if (timeMin < 1977) return 'out_for_delivery';
  return 'delivered';
}

/** The sample run at `timeMin`. */
export function runAt(timeMin: number, over: Partial<SimulatorResponse> = {}): SimulatorResponse {
  const base = sampleSimAt(timeMin, { 'shp-2': relayStatusAt(timeMin) });
  // The fake server moves every marker a little each minute, so a journey step has movement to draw.
  const drift = (timeMin - 1000) * 0.00002;
  const snapshot = {
    ...base.snapshot,
    markers: base.snapshot.markers.map((m) => ({ ...m, lat: m.lat + drift })),
    packagePositions: Object.fromEntries(Object.entries(base.snapshot.packagePositions)
      .map(([id, p]) => [id, { lat: p.lat + drift, lng: p.lng }])),
  };
  return { ...base, snapshot, nextEventMin: timeMin < 1950 ? 1950 : null, ...over };
}

export const sampleMapResponse: MapResponse = sampleMap;

/** A ready data state on the sample run. */
export const readyState = (timeMin = 1000, over: Partial<SimDataState> = {}): SimDataState =>
  ({ ...INITIAL_SIM_DATA, view: 'ready', sim: runAt(timeMin), map: sampleMap, ...over });

/**
 * A ready data state on another run with no plans and no packages (from sim-v2-data-fixtures; its
 * bare `{ id }` plans are left out because the page reads a plan's legs).
 */
export function emptyRunState(): SimDataState {
  const base = emptyRunAt('run-2', 1, []);
  // A hybrid snapshot, in three layers (later wins):
  //  1. runAt(1000).snapshot: the sample run's snapshot, for every field the page reads that the small
  //     fixture lacks (the fixture's snapshot is only `{ runId, version, timeMin }`);
  //  2. base.snapshot: the fixture's runId ('run-2'), version (1) and timeMin (1001) override those;
  //  3. the four explicit fields: emptied so nothing from the sample run (markers, package positions,
  //     events, shipment statuses) leaks into a run that has no packages.
  const sim = { ...base, snapshot: { ...runAt(1000).snapshot, ...base.snapshot, markers: [], packagePositions: {}, occurredEvents: [], shipmentStatus: {} } };
  return { ...INITIAL_SIM_DATA, view: 'ready', sim, map: mapOf('run-2') };
}

/** The same poll again as new objects (a 1 s poll with an unchanged `version`). */
export const samePollAgain = (s: SimDataState): SimDataState => structuredClone(s);

// ---------- The fake data hook ----------

export type Call =
  | { name: 'control'; req: SimControlRequest }
  | { name: 'compare' | 'refetch' | 'dismissActionError'; req?: unknown };

export class FakeSimServer {
  state: SimDataState;
  readonly calls: Call[] = [];
  /** Every selection the body reported (SimPageBody mounts only). */
  readonly selections: Selection[] = [];
  /** Every URL search string the page showed (SimulatorV2Workspace mounts only). */
  readonly searches: string[] = [];
  /** How the page got to each entry of `searches`: 'POP' (the first URL, Back), 'PUSH' or 'REPLACE'. */
  readonly navigations: string[] = [];
  /** When true every write answers null, like the hook after a refused request. */
  refuse = false;
  private listeners = new Set<() => void>();

  constructor(state: SimDataState) {
    this.state = state;
  }

  /** The control requests sent, in order. */
  controls(): SimControlRequest[] {
    return this.calls.flatMap((c) => (c.name === 'control' ? [c.req] : []));
  }

  seeks(): number[] {
    return this.controls().flatMap((r) => (r.action === 'seek' ? [r.timeMin] : []));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getState = () => this.state;

  /** Replaces the state outside React (wrap in act, or use `poll`). */
  set(state: SimDataState) {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

  /** A poll arrives. */
  poll(state: SimDataState) {
    act(() => { this.set(state); });
  }

  async control(req: SimControlRequest): Promise<SimulatorResponse | null> {
    this.calls.push({ name: 'control', req });
    if (this.refuse) return null;
    const cur = this.state.sim;
    if (!cur) return null;
    let next: SimulatorResponse;
    if (req.action === 'seek') next = runAt(req.timeMin, { runId: cur.runId, clock: { ...runAt(req.timeMin).clock, speed: cur.clock.speed } });
    else if (req.action === 'play' || req.action === 'pause') next = { ...cur, clock: { ...cur.clock, playing: req.action === 'play' } };
    else if (req.action === 'speed') next = { ...cur, clock: { ...cur.clock, speed: req.speed } };
    else if (req.action === 'reset_playback') next = runAt(930, { runId: cur.runId, clock: { ...runAt(930).clock, playing: false, speed: cur.clock.speed } });
    else next = cur;
    this.set({ ...this.state, sim: next });
    return next;
  }

  /** The hook value for the current state; actions record their call. */
  hook(state: SimDataState): SimulatorV2 {
    const log = (name: Exclude<Call['name'], 'control'>, req?: unknown) => { this.calls.push({ name, req } as Call); };
    return {
      ...state,
      control: (req) => this.control(req),
      compare: async () => { log('compare'); return null; },
      refetch: () => log('refetch'),
      dismissActionError: () => log('dismissActionError'),
    };
  }
}

function useFakeHook(server: FakeSimServer): SimulatorV2 {
  const state = useSyncExternalStore(server.subscribe, server.getState);
  // A poll with an equal state object gives the same hook value, like useSimulatorV2 (pass 46).
  return useMemo(() => server.hook(state), [server, state]);
}

// ---------- Mounts ----------

function BodyHarness({ server, initial }: { server: FakeSimServer; initial: Selection }) {
  const sim = useFakeHook(server);
  const [selection, setSelection] = useState<Selection>(initial);
  return createElement(SimPageBody, {
    sim, selection,
    onSelectionChange: (s: Selection) => { server.selections.push(s); setSelection(s); },
  });
}

/** `SimPageBody` with a selection kept in a parent, every change recorded in `server.selections`. */
export function mountBody(server: FakeSimServer, initial: Selection = null): Mounted {
  return mount(createElement(BodyHarness, { server, initial }));
}

function LocationProbe({ server }: { server: FakeSimServer }) {
  const { search } = useLocation();
  const how = useNavigationType();
  if (server.searches[server.searches.length - 1] !== search) {
    server.searches.push(search);
    server.navigations.push(how);
  }
  return null;
}

function PageHarness({ server }: { server: FakeSimServer }) {
  const sim = useFakeHook(server);
  return createElement('div', null,
    createElement(SimulatorV2Workspace, { sim }),
    createElement(LocationProbe, { server }));
}

/** The routed page (URL selection, keyboard map on the window) at `/nyc/simulator<search>`. */
export function mountPage(server: FakeSimServer, search = ''): Mounted {
  const el: ReactElement = createElement(MemoryRouter, { initialEntries: [`/nyc/simulator${search}`] },
    createElement(PageHarness, { server }));
  return mount(el);
}

/** The URL search the page shows now. */
export const currentSearch = (server: FakeSimServer) => server.searches[server.searches.length - 1] ?? '';

// ---------- Timers ----------

/** Advances fake timers by `ms`, settling the seeks' promises and React's updates on the way. */
export async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Settles pending promises under fake timers (kitDom's `flush` waits on a real timeout). */
export async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

// ---------- Queries ----------

/** The collapse toggle of the left ("Controls") or right ("Inspector") panel. */
export const panelToggle = (c: ParentNode, side: 'left' | 'right') =>
  c.querySelector<HTMLButtonElement>(`.sw-${side} .sw-toggle`)!;

export const leftBody = (c: ParentNode) => c.querySelector<HTMLElement>('#sim-v2-left-body')!;
export const rightBody = (c: ParentNode) => c.querySelector<HTMLElement>('#sim-v2-right-body')!;

/** The package row buttons of the left panel, by their label. */
export function packageRow(c: ParentNode, label: string): HTMLButtonElement {
  const rows = [...c.querySelectorAll<HTMLButtonElement>('ul.sw-pkgs button.sw-pkg')]
    .filter((b) => textOf(b.querySelector('.sw-pkg-label')!) === label);
  if (rows.length !== 1) throw new Error(`packageRow(): ${rows.length} rows "${label}"`);
  return rows[0];
}

export const packageLabels = (c: ParentNode) =>
  [...c.querySelectorAll('ul.sw-pkgs .sw-pkg-label')].map((e) => textOf(e));

/** The numbered step buttons of the journey timeline. */
export const journeySteps = (c: ParentNode) => [...c.querySelectorAll<HTMLButtonElement>('.jt__steps .jt-step__button')];

/** The floating playback group at the bottom center of the map (#831): Play/Pause and "Back to start" (#852: nothing else shown). */
export function playbar(c: ParentNode): HTMLElement {
  const all = [...c.querySelectorAll<HTMLElement>('.sw-map .spc-playbar')];
  if (all.length !== 1) throw new Error(`playbar(): ${all.length} playback groups on the map`);
  return all[0];
}

/** The one Play/Pause button (#648), whatever it reads now. It is on the map (#831) and nowhere else on the page. */
export function playPause(c: ParentNode): HTMLButtonElement {
  const all = [...c.querySelectorAll<HTMLButtonElement>('.ctl-playback button.ctl-primary')];
  if (all.length !== 1) throw new Error(`playPause(): ${all.length} Play/Pause buttons`);
  if (!playbar(c).contains(all[0])) throw new Error('playPause(): the button is not in the map\'s playback group');
  return all[0];
}

/** The step announcement of the Play/Pause button: its live region, visually hidden since #852. */
export const playStatus = (c: ParentNode) => c.querySelector<HTMLElement>('.ctl-playback [role="status"]');

/** The "Overnight at <relay point>" card over the map, or null while it is not shown. */
export const overnightCard = (c: ParentNode) => c.querySelector<HTMLElement>('.spc-overnight');

/** Elements a Tab key could reach: focusable and not inside a `hidden` subtree or disabled. */
export function tabbable(root: ParentNode): HTMLElement[] {
  const sel = 'a[href], button, input, select, textarea, [tabindex]';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) =>
    el.closest('[hidden]') === null
    && !(el as HTMLButtonElement).disabled
    && el.getAttribute('tabindex') !== '-1');
}

/** Installs a `window.matchMedia` stub; `reduced` answers the reduced-motion query. Returns the restore. */
export function stubMatchMedia({ reduced = false }: { reduced?: boolean } = {}) {
  const queries: string[] = [];
  const fn = (query: string) => {
    queries.push(query);
    return {
      matches: reduced && query.includes('prefers-reduced-motion: reduce'),
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    };
  };
  vi.stubGlobal('matchMedia', fn);
  return { queries };
}
