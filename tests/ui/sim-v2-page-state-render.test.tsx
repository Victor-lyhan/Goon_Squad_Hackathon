// #459: the MVP II simulator page renders the selection in the URL (three kinds, package wins,
// stale IDs kept), and below 900 px renders only the desktop-only notice (no map, no data hook).
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  BACK_TO_NETWORK, MISSING_EMPLOYEE_TEXT, MISSING_PACKAGE_TEXT,
} from '../../client/src/components/sim/v2/compose/simPageView';
import { INITIAL_SIM_DATA, type SimDataState } from '../../client/src/components/sim/v2/live/simDataModel';
import type { SimulatorV2 } from '../../client/src/components/sim/v2/live/useSimulatorV2';
import { DESKTOP_ONLY_TEXT } from '../../client/src/components/sim/v2/page/DesktopOnlyNotice';
import type { MatchMediaFn } from '../../client/src/components/sim/v2/page/simPageState';
import SimulatorV2Page, { SimulatorV2Workspace } from '../../client/src/pages/v2/SimulatorV2';
import { makeMap, makeSim } from './sim-v2-network-fixture';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

function readyHook(over: Partial<SimDataState> = {}): SimulatorV2 {
  return {
    ...INITIAL_SIM_DATA, view: 'ready', sim: makeSim(), map: makeMap(), ...over,
    control: vi.fn(async () => null), generate: vi.fn(async () => null), resetPlanning: vi.fn(async () => null),
    recompute: vi.fn(async () => null), compare: vi.fn(async () => null), refetch: vi.fn(), dismissActionError: vi.fn(),
  };
}

const renderAt = (url: string, sim: SimulatorV2 = readyHook()) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><SimulatorV2Workspace sim={sim} /></MemoryRouter>);

describe('URL -> selection on the page', () => {
  it('no param: the network view with the run summary', () => {
    const html = renderAt('/nyc/simulator');
    expect(html).not.toContain('spc-entity');
    expect(html).not.toContain('spc-journey');
    expect(text(html)).not.toContain(BACK_TO_NETWORK);
  });

  it('?employee= selects the employee', () => {
    const html = renderAt('/nyc/simulator?employee=emp-1');
    expect(html).toContain('spc-entity');
    expect(text(html)).toContain('Maya Ortiz');
    expect(text(html)).toContain('Commuter · works at Chelsea Print Studio');
  });

  it('?business= selects the business', () => {
    const html = renderAt('/nyc/simulator?business=biz-etsy&debug=1');
    expect(text(html)).toContain('Network business · DUMBO, Brooklyn');
  });

  it('?package= opens the journey, and wins over ?employee= given with it', () => {
    for (const url of ['/nyc/simulator?package=shp-2', '/nyc/simulator?employee=emp-1&package=shp-2', '/simulator?business=biz-etsy&package=shp-2']) {
      const html = renderAt(url);
      expect(html).toContain('spc-journey');
      expect(html).not.toContain('spc-entity');
      expect(text(html)).toContain('Ceramic samples');
      expect(text(html)).toContain(BACK_TO_NETWORK);
    }
  });

  it('a stale ID is passed down, so the body says it is not in the current city and offers Back to network', () => {
    const pkg = text(renderAt('/nyc/simulator?package=shp-from-an-old-run'));
    expect(pkg).toContain(MISSING_PACKAGE_TEXT);
    expect(pkg).toContain(BACK_TO_NETWORK);
    const emp = text(renderAt('/nyc/simulator?employee=emp-404'));
    expect(emp).toContain(MISSING_EMPLOYEE_TEXT);
    expect(emp).toContain(BACK_TO_NETWORK);
  });

  it('the page no longer uses initialSelectionFromSearch', () => {
    const src = readFileSync('client/src/pages/v2/SimulatorV2.tsx', 'utf8');
    expect(src).not.toContain('initialSelectionFromSearch');
    expect(src).not.toContain('useState');
  });
});

describe('below 900 px', () => {
  const media = (matches: boolean): MatchMediaFn => () => ({ matches });

  it('renders only the desktop-only notice: no workspace, no map, no data hook', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/nyc/simulator?package=shp-2']}><SimulatorV2Page matchMedia={media(true)} /></MemoryRouter>,
    );
    expect(text(html)).toContain(DESKTOP_ONLY_TEXT);
    expect(html).not.toContain('spc-map');
    expect(html).not.toContain('sim-desktop-content');
    // The data hook's component renders the loading screen first; it is not mounted at all.
    expect(text(html)).not.toContain('Loading the simulator');
  });

  it('at 900 px and above the live workspace mounts (loading before the first poll)', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/nyc/simulator?package=shp-2']}><SimulatorV2Page matchMedia={media(false)} /></MemoryRouter>,
    );
    expect(text(html)).toContain('Loading the simulator…');
    expect(text(html)).not.toContain(DESKTOP_ONLY_TEXT);
  });
});
