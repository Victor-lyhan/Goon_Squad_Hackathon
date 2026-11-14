// @vitest-environment jsdom
// #579: a change of run (Random city, an import, a new planning cycle) resets the simulator view.
// IDs are numbered per run, so the old run's focus and URL selection are cleared; a new `version`
// of the same run (a live delivery request, a commute save, a re-match, playback) keeps both, and a
// deep link on the first load keeps its selection. The routed page (`SimulatorV2Workspace`, the
// selection in a MemoryRouter URL) runs in a real DOM on the fake data hook of sim-v2-dom-helpers;
// the Google map is replaced by a recorder that lists the places it is given.
import { act, createElement, useEffect, useMemo, useSyncExternalStore } from 'react';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapPlace } from '../../client/src/components/map/types';
import type { SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import { SimulatorV2Workspace } from '../../client/src/pages/v2/SimulatorV2';
import { button, byLabel, click, mount, select, textOf, type Mounted } from './kitDom';
import {
  FakeSimServer, T, journeySteps, packageRow, panelToggle, readyState, rightBody,
} from './sim-v2-dom-helpers';

// The map as a recorder: the place IDs it was given, split by kind.
vi.mock('../../client/src/components/map/GoogleBaseMap', () => ({
  GoogleBaseMap: ({ places }: { places: MapPlace[] }) => createElement('div', {
    'data-testid': 'fake-map',
    'data-businesses': places.filter((p) => p.kind === 'business').map((p) => p.id).join(' '),
    'data-homes': places.filter((p) => p.kind === 'home').map((p) => p.id).join(' '),
  }),
}));

afterEach(() => { vi.unstubAllEnvs(); });

// ---------- Data ----------

/**
 * The sample run as another run: another `runId`, other employee, business and home IDs (`-n2`),
 * the same shipment IDs on purpose (IDs are numbered per run: `shp-2` is now another package).
 */
function newRunState(base: SimDataState = readyState(1000)): SimDataState {
  const json = JSON.stringify(base)
    .replace(/"run-1"/g, '"run-2"')
    .replace(/"((?:emp|biz|home)-[a-z0-9-]+)"/g, '"$1-n2"')
    .replace(/((?:emp)-[0-9]+)-(eve|morn)"/g, '$1-n2-$2"'); // trip IDs follow their employee
  return JSON.parse(json) as SimDataState;
}

/** The same run with a higher `version` (a live delivery request or a commute save). */
function nextVersion(s: SimDataState): SimDataState {
  const sim = s.sim!;
  return { ...s, sim: { ...sim, version: sim.version + 1, snapshot: { ...sim.snapshot, version: sim.version + 1 } } };
}

// ---------- Mount ----------

type Page = Mounted & { server: FakeSimServer; search: () => string; back: () => void };

function mountPage(state: SimDataState, search = ''): Page {
  const server = new FakeSimServer(state);
  let location = '';
  let navigate: NavigateFunction | null = null;
  function Probe() {
    const loc = useLocation();
    location = loc.search;
    const nav = useNavigate();
    useEffect(() => { navigate = nav; }, [nav]);
    return null;
  }
  function Harness() {
    const sim = useFakeHook(server);
    return createElement('div', null, createElement(SimulatorV2Workspace, { sim }), createElement(Probe));
  }
  const m = mount(createElement(MemoryRouter, { initialEntries: [`/simulator${search}`] }, createElement(Harness)));
  return {
    ...m, server,
    search: () => location,
    back: () => { act(() => { void navigate!(-1); }); },
  };
}

// The fake hook as sim-v2-dom-helpers builds it (the same value for the same state object).
function useFakeHook(server: FakeSimServer) {
  const state = useSyncExternalStore(server.subscribe, server.getState);
  return useMemo(() => server.hook(state), [server, state]);
}

// ---------- Queries ----------

const fakeMap = (c: ParentNode) => c.querySelector<HTMLElement>('[data-testid="fake-map"]')!;
const mapBusinesses = (c: ParentNode) => (fakeMap(c).dataset.businesses ?? '').split(' ').filter(Boolean);
const employeeSelect = (c: ParentNode) => byLabel(c, 'Focus on employee') as HTMLSelectElement;
const businessSelect = (c: ParentNode) => byLabel(c, 'Focus on business') as HTMLSelectElement;
const selectedText = (s: HTMLSelectElement) => textOf(s.options[s.selectedIndex]);

const RUN_1_BUSINESSES = ['biz-dumbo', 'biz-etsy', 'biz-other', 'biz-roast'];
const RUN_2_BUSINESSES = RUN_1_BUSINESSES.map((id) => `${id}-n2`);

describe('a focus of the old run', () => {
  it('goes back to "All" when the next poll is another run: the map gets every business again', () => {
    const p = mountPage(readyState(1000));
    const c = p.container;
    expect([...mapBusinesses(c)].sort()).toEqual(RUN_1_BUSINESSES);

    select(employeeSelect(c), 'Ana Ruiz');
    expect(employeeSelect(c).value).toBe('emp-1');
    expect([...mapBusinesses(c)].sort()).toEqual(['biz-dumbo', 'biz-etsy']); // Ana's focus

    p.server.poll(newRunState());
    expect(employeeSelect(c).value).toBe('');
    expect(selectedText(employeeSelect(c))).toBe('All employees');
    expect([...mapBusinesses(c)].sort()).toEqual(RUN_2_BUSINESSES);
    expect(button(c, 'Show everything').disabled).toBe(true);
    expect(p.server.calls).toEqual([]); // nothing is sent to the server
  }, T);

  it('a business focus too', () => {
    const p = mountPage(readyState(1000));
    select(businessSelect(p.container), 'Midtown Office');
    expect([...mapBusinesses(p.container)].sort()).toEqual(['biz-dumbo', 'biz-other']); // it sends shp-3 to DUMBO

    p.server.poll(newRunState());
    expect(selectedText(businessSelect(p.container))).toBe('All businesses');
    expect([...mapBusinesses(p.container)].sort()).toEqual(RUN_2_BUSINESSES);
  }, T);

  it('stays on a new version of the same run (a live delivery request, a commute save, a re-match)', () => {
    const p = mountPage(readyState(1000));
    select(employeeSelect(p.container), 'Ana Ruiz');
    p.server.poll(nextVersion(p.server.state));
    p.server.poll(nextVersion(p.server.state));
    expect(employeeSelect(p.container).value).toBe('emp-1');
    expect([...mapBusinesses(p.container)].sort()).toEqual(['biz-dumbo', 'biz-etsy']);
  }, T);

  it('the layer toggles and a collapsed panel stay as they were', () => {
    const p = mountPage(readyState(1000));
    const c = p.container;
    const homes = () => c.querySelector<HTMLInputElement>('input[name="layer-homes"]')!;
    expect(homes().checked).toBe(true);
    click(homes());
    click(panelToggle(c, 'right'));
    expect(panelToggle(c, 'right').getAttribute('aria-expanded')).toBe('false');

    p.server.poll(newRunState());
    expect(homes().checked).toBe(false);
    expect(panelToggle(c, 'right').getAttribute('aria-expanded')).toBe('false');
  }, T);
});

describe('a selection of the old run in the URL', () => {
  it('an open journey: the URL loses ?package= (replace, so Back does not return to it) and the network view is back', () => {
    const p = mountPage(readyState(1000));
    const c = p.container;
    click(packageRow(c, 'Coffee samples'));
    expect(p.search()).toBe('?package=shp-2');
    expect(journeySteps(c)).toHaveLength(4);
    expect(c.querySelector('.sw-journey')).not.toBeNull();

    // The new run has a shp-2 too, but it is another package: it must not open.
    p.server.poll(newRunState());
    expect(p.search()).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
    expect(c.querySelector('.sw-journey')).toBeNull();
    expect(rightBody(c).querySelector('[role="alert"]')).toBeNull();
    expect([...mapBusinesses(c)].sort()).toEqual(RUN_2_BUSINESSES);

    // The journey's entry was replaced: Back goes to the page before it, never to the stale journey.
    p.back();
    expect(p.search()).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
  }, T);

  it.each([['employee', 'emp-2'], ['business', 'biz-etsy']] as const)(
    '?%s= is removed too, other params are kept', (kind, id) => {
      const p = mountPage(readyState(1000), `?${kind}=${id}&tour=1`);
      expect(p.search()).toBe(`?${kind}=${id}&tour=1`);
      p.server.poll(newRunState());
      expect(p.search()).toBe('?tour=1');
    }, T);

  it('stays on a new version of the same run: "create a delivery, watch it in the simulator" keeps its journey', () => {
    const p = mountPage(readyState(1000));
    click(packageRow(p.container, 'Coffee samples'));
    p.server.poll(nextVersion(p.server.state));
    p.server.poll(nextVersion(p.server.state));
    expect(p.search()).toBe('?package=shp-2');
    expect(journeySteps(p.container)).toHaveLength(4);
  }, T);

  it('a deep link keeps its selection on the first load, before and after the first poll', () => {
    const loading: SimDataState = { ...readyState(1000), view: 'loading', sim: null, map: null };
    const p = mountPage(loading, '?package=shp-2');
    p.server.poll(readyState(1000));
    expect(p.search()).toBe('?package=shp-2');
    expect(journeySteps(p.container)).toHaveLength(4);

    const q = mountPage(readyState(1000), '?package=shp-2');
    expect(q.search()).toBe('?package=shp-2');
    expect(journeySteps(q.container)).toHaveLength(4);
  }, T);

  it('a selection made on the new run is kept on its next polls', () => {
    const p = mountPage(readyState(1000), '?package=shp-2');
    p.server.poll(newRunState());
    expect(p.search()).toBe('');
    click(packageRow(p.container, 'Coffee samples'));
    expect(p.search()).toBe('?package=shp-2');
    p.server.poll(nextVersion(p.server.state));
    expect(p.search()).toBe('?package=shp-2');
    expect(journeySteps(p.container)).toHaveLength(4);
  }, T);
});
