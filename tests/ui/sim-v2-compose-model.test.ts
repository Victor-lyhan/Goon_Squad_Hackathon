// #426: the simulator page's pure view model over the merged pieces (live data, network, journey).
import { describe, expect, it } from 'vitest';
import {
  BACK_TO_NETWORK, DEFAULT_SCENARIO, MAP_PENDING_TEXT, MISSING_BUSINESS_TEXT, MISSING_PACKAGE_TEXT, SIM_WINDOW,
  initialSelectionFromSearch, panTargetFor, selectionAfterMapClick, simPageView, type SimReadyView,
} from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA, TRAVEL_DATA_MISSING_MESSAGE, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { buildNetworkView } from '../../client/src/components/sim/v2/network/networkModel';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';
import { DEFAULT_LAYERS, toggleLayer } from '../../client/src/components/sim/v2/workspaceModel';
import { mapOf, simAt as dataSimAt } from './sim-v2-data-fixtures';
import { makeMap, makeSim } from './sim-v2-network-fixture';
import { T, map as journeyMap, simAt as journeySimAt } from './sim-v2-journey-sample';

const ready = (over: Partial<SimDataState> = {}): SimDataState => ({
  ...INITIAL_SIM_DATA, view: 'ready', sim: makeSim(), map: makeMap(), ...over,
});
const view = (data: SimDataState, selection: Selection = null, extra: Partial<Parameters<typeof simPageView>[0]> = {}) =>
  simPageView({ data, selection, layers: DEFAULT_LAYERS, ...extra });
const asReady = (v: ReturnType<typeof simPageView>): SimReadyView => {
  expect(v.view).toBe('ready');
  return v as SimReadyView;
};

describe('simPageView: data states', () => {
  it('loading before the first response', () => {
    expect(view(INITIAL_SIM_DATA)).toEqual({ view: 'loading', reconnecting: false });
  });

  it("unavailable carries the hook's 503 message", () => {
    const v = view({ ...INITIAL_SIM_DATA, view: 'unavailable', unavailable: { code: 'travel_data_missing', message: TRAVEL_DATA_MISSING_MESSAGE } });
    expect(v.view).toBe('unavailable');
    expect(v.view === 'unavailable' && v.message).toContain('NYC travel data is not loaded on this server yet.');
  });

  it('error carries the message and the reconnecting flag', () => {
    const v = view({ ...INITIAL_SIM_DATA, view: 'error', error: "Can't reach the Relay server. Retrying every second.", reconnecting: true });
    expect(v).toEqual({ view: 'error', message: "Can't reach the Relay server. Retrying every second.", reconnecting: true });
  });

  it('reconnecting keeps the last good data on screen', () => {
    const v = asReady(view(ready({ reconnecting: true })));
    expect(v.reconnecting).toBe(true);
    expect(v.packages).toHaveLength(3);
    expect(v.map.places.length).toBeGreaterThan(0);
  });

  it('ready before the map arrives: controls and rows from the poll, places pending', () => {
    const sim = dataSimAt('run-1', 1, []); // the data fixture fills only the fields the data layer reads
    const v = asReady(view({ ...INITIAL_SIM_DATA, view: 'ready', sim, map: null }));
    expect(v.mapPending).toBe(true);
    expect(v.map.places).toEqual([]);
    expect(v.controls.clock).toBe(sim.clock);
    const withRow = asReady(view({ ...ready(), map: null }));
    expect(withRow.packages.every((p) => p.routeLabel === MAP_PENDING_TEXT)).toBe(true);
    // A selection waits for the map instead of claiming the item is missing.
    expect(asReady(view({ ...ready(), map: null }, { kind: 'package', id: 'shp-1' })).right.kind).toBe('pending');
    expect(asReady(view({ ...ready(), map: null }, { kind: 'business', id: 'biz-etsy' })).right.kind).toBe('pending');
    // Once the map lands it is used as is.
    expect(asReady(view({ ...INITIAL_SIM_DATA, view: 'ready', sim, map: mapOf('run-1') })).mapPending).toBe(false);
  });
});

describe('simPageView: network mode', () => {
  it('map props come from buildNetworkView; the summary is the response metrics object', () => {
    const data = ready();
    const v = asReady(view(data));
    const nv = buildNetworkView({ map: data.map!, sim: data.sim! });
    expect(v.mode).toBe('network');
    expect(v.journeyTitle).toBeNull();
    expect(v.map).toEqual({ ...nv, visible: DEFAULT_LAYERS, stops: [], fitTo: 'places' });
    expect(v.right).toEqual({ kind: 'summary', metrics: data.sim!.snapshot.metrics });
    expect(v.right.kind === 'summary' && v.right.metrics).toBe(data.sim!.snapshot.metrics);
  });

  it('package rows: label, route label and status label, read from the response', () => {
    const v = asReady(view(ready()));
    expect(v.packages).toEqual([
      { id: 'shp-1', label: 'Astoria product proofs', routeLabel: 'Chelsea Print Studio → Sunrise Bakery', statusLabel: 'Picked up, on the way' },
      { id: 'shp-2', label: 'Ceramic samples', routeLabel: 'Sunrise Bakery → Chelsea Print Studio', statusLabel: 'Picked up, on the way' },
      { id: 'shp-3', label: 'Spare keys', routeLabel: 'Etsy → Sunrise Bakery', statusLabel: 'Unmatched' },
    ]);
  });

  it('controls: clock, next event, busy, the sim window and the default scenario', () => {
    const data = ready({ busy: true });
    const v = asReady(view(data));
    expect(v.controls).toEqual({
      clock: data.sim!.clock, nextEventMin: 1100, busy: true, ...SIM_WINDOW, scenario: DEFAULT_SCENARIO,
    });
    expect(DEFAULT_SCENARIO).toEqual({ preset: 'demo', seed: 42, employees: 60, packages: 24, maxExtraMin: 8 });
  });

  it('focus options are names sorted by label', () => {
    const v = asReady(view(ready()));
    expect(v.focusOptions.employees.map((o) => o.label)).toEqual(['Li Chen', 'Maya Ortiz', 'Sam Rivera']);
    expect(v.focusOptions.businesses.map((o) => o.label)).toEqual(['Chelsea Print Studio', 'Etsy', 'Sunrise Bakery']);
  });

  it('focus and a layer toggle change the map props', () => {
    const data = ready();
    const all = asReady(view(data));
    const focused = asReady(view(data, null, { focus: { kind: 'employee', id: 'emp-1' } }));
    expect(focused.map.places.length).toBeLessThan(all.map.places.length);
    expect(focused.map.routes.length).toBeLessThan(all.map.routes.length);
    const nv = buildNetworkView({ map: data.map!, sim: data.sim!, focus: { kind: 'employee', id: 'emp-1' } });
    expect(focused.map.places).toEqual(nv.places);

    const noHomes = asReady(view(data, null, { layers: toggleLayer(DEFAULT_LAYERS, 'homes') }));
    expect(noHomes.map.visible).toEqual({ routes: true, businesses: true, homes: false, packages: true });
    expect(all.map.visible.homes).toBe(true);
  });

  it('an employee selection shows name and role and highlights their items', () => {
    const v = asReady(view(ready(), { kind: 'employee', id: 'emp-1' }));
    expect(v.right).toEqual({ kind: 'entity', entity: 'employee', name: 'Maya Ortiz', role: 'Commuter · works at Chelsea Print Studio' });
    expect(v.map.selectedIds).toContain('emp-1');
  });

  it('a business that is not in the run says so', () => {
    const v = asReady(view(ready(), { kind: 'business', id: 'biz-gone' }));
    expect(v.mode).toBe('network');
    expect(v.right).toEqual({ kind: 'missing', message: MISSING_BUSINESS_TEXT });
  });
});

describe('simPageView: network → business → package journey → back', () => {
  const data: SimDataState = { ...INITIAL_SIM_DATA, view: 'ready', sim: journeySimAt(T.overnight, { 'shp-2': 'at_hub' }), map: journeyMap };

  it('walks the whole flow through the map click rules', () => {
    // 1. network
    let selection: Selection = null;
    const v0 = asReady(view(data, selection));
    expect(v0.mode).toBe('network');
    expect(v0.map.selectedIds).toEqual([]);

    // 2. click a business: highlight and name
    selection = selectionAfterMapClick('biz-roast', selection, data);
    expect(selection).toEqual({ kind: 'business', id: 'biz-roast' });
    const v1 = asReady(view(data, selection));
    expect(v1.mode).toBe('network');
    expect(v1.right).toEqual({ kind: 'entity', entity: 'business', name: 'Brooklyn Roasting', role: 'Network business · DUMBO, Brooklyn' });
    expect(v1.map.selectedIds).toContain('biz-roast');
    expect(v1.map.selectedIds).toContain('shp-2'); // it holds the package as relay point

    // 3. click the package marker: journey mode
    selection = selectionAfterMapClick('shp-2', selection, data);
    expect(selection).toEqual({ kind: 'package', id: 'shp-2' });
    const v2 = asReady(view(data, selection));
    expect(v2.mode).toBe('journey');
    expect(v2.journeyTitle).toBe('Coffee samples');
    expect(v2.selectedPackageId).toBe('shp-2');
    if (v2.right.kind !== 'journey') throw new Error('expected a journey');
    const j = v2.right.journey;
    expect(j.steps.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(v2.map.stops.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(new Set(v2.map.routes.filter((r) => r.kind === 'leg').map((r) => r.tone))).toEqual(new Set(['leg1', 'leg2']));
    expect(v2.map.places).toBe(j.places);
    expect(v2.map.movers).toBe(j.movers);
    expect(v2.map.fitTo).toEqual(j.bounds);
    expect(typeof v2.map.fitTo).toBe('object');
    expect(v2.map.places.map((p) => p.id)).not.toContain('biz-other'); // everything else is hidden
    expect(v2.map.selectedIds).toEqual([]);

    // In journey mode stray clicks keep the journey; another package switches it.
    expect(selectionAfterMapClick(null, selection, data)).toBe(selection);
    expect(selectionAfterMapClick('stop-shp-2-1', selection, data)).toBe(selection);
    expect(selectionAfterMapClick('biz-etsy', selection, data)).toBe(selection);
    expect(selectionAfterMapClick('shp-1', selection, data)).toEqual({ kind: 'package', id: 'shp-1' });

    // 4. back to network
    selection = null;
    const v3 = asReady(view(data, selection));
    expect(v3.mode).toBe('network');
    expect(v3.right.kind).toBe('summary');
  });

  it('an empty map click in network mode clears the selection', () => {
    expect(selectionAfterMapClick(null, { kind: 'business', id: 'biz-roast' }, data)).toBeNull();
  });

  it('the package list opens the same journey as the marker', () => {
    const fromRow = asReady(view(data, { kind: 'package', id: 'shp-2' }));
    expect(fromRow.right.kind).toBe('journey');
  });

  it('the step click pans to the step place, with a fresh key each time', () => {
    const v = view(data, { kind: 'package', id: 'shp-2' });
    expect(panTargetFor(v, 'biz-roast', 1)).toEqual({ lat: 40.7041, lng: -73.9867, key: 'biz-roast#1' });
    expect(panTargetFor(v, 'biz-roast', 2)?.key).toBe('biz-roast#2');
    expect(panTargetFor(v, 'biz-nowhere', 3)).toBeNull();
    expect(panTargetFor(view(data), 'biz-roast', 4)).toBeNull();
  });
});

describe('simPageView: unmatched and unknown packages', () => {
  it("an unmatched package shows the server's reason and highlights its businesses", () => {
    const v = asReady(view(ready(), { kind: 'package', id: 'shp-3' }));
    expect(v.mode).toBe('journey');
    expect(v.journeyTitle).toBe('Spare keys');
    expect(v.right.kind).toBe('unmatched');
    expect(v.right.kind === 'unmatched' && v.right.journey.reason).toBe('No commute passes both businesses in time.');
    expect(v.map.selectedIds).toEqual(expect.arrayContaining(['shp-3', 'biz-etsy', 'biz-bakery']));
  });

  it('a package ID that is not in the run: message, journey frame with Back to network, unselected map', () => {
    const data = ready();
    const v = asReady(view(data, { kind: 'package', id: 'shp-404' }));
    expect(v.mode).toBe('journey');
    expect(v.right).toEqual({ kind: 'missing', message: MISSING_PACKAGE_TEXT });
    expect(MISSING_PACKAGE_TEXT).toBe('This package is not in the current scenario');
    expect(BACK_TO_NETWORK).toBe('Back to network');
    expect(v.selectedPackageId).toBeUndefined();
    expect(v.map.selectedIds).toEqual([]);
    expect(v.map.places).toEqual(buildNetworkView({ map: data.map!, sim: data.sim! }).places);
  });
});

describe('initialSelectionFromSearch', () => {
  it('?package= opens the journey; nothing else selects', () => {
    expect(initialSelectionFromSearch('?package=shp-2')).toEqual({ kind: 'package', id: 'shp-2' });
    expect(initialSelectionFromSearch(new URLSearchParams('package=shp-7&employee=emp-1'))).toEqual({ kind: 'package', id: 'shp-7' });
    expect(initialSelectionFromSearch('')).toBeNull();
    expect(initialSelectionFromSearch('?package=')).toBeNull();
    expect(initialSelectionFromSearch('?employee=emp-1')).toBeNull();
  });
});
