// @vitest-environment jsdom
// The MVP II simulator page's keyboard map in a real DOM (#519): the routed page
// (SimulatorV2Workspace in a MemoryRouter) with its window listener. Space sends play or pause, `.`
// sends next event, Esc leaves the journey or clears a selection, and none of them acts while the
// focus is in a text field (package search, seed). The selection is read back from the URL.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byLabel, button, click, press } from './kitDom';
import {
  FakeSimServer, T, currentSearch, journeySteps, leftBody, mountPage, packageRow, readyState, runAt,
} from './sim-v2-dom-helpers';

const google = vi.hoisted(() => ({ loads: 0 }));
vi.mock('@googlemaps/js-api-loader', () => ({
  setOptions: () => { google.loads += 1; },
  importLibrary: () => { google.loads += 1; return new Promise(() => {}); },
}));

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_MAPS_BROWSER_KEY', '');
  google.loads = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  expect(google.loads).toBe(0);
});

/** A key pressed with the focus on the page itself (nothing focused). */
function pageKey(key: string) {
  (document.activeElement as HTMLElement | null)?.blur?.();
  press(key, document.body);
}

describe('Space and the next-event key', () => {
  it('Space sends play, then pause once the server says the clock is playing', () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server);
    pageKey(' ');
    expect(server.controls()).toEqual([{ action: 'play' }]);
    expect(server.state.sim?.clock.playing).toBe(true); // the fake server applied it
    pageKey(' ');
    expect(server.controls()).toEqual([{ action: 'play' }, { action: 'pause' }]);
  }, T);

  it('"." sends next event; with no next event left it sends nothing', () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server);
    pageKey('.');
    expect(server.controls()).toEqual([{ action: 'next_event' }]);

    server.poll({ ...server.state, sim: runAt(2000) }); // nextEventMin is null from 1950 on
    pageKey('.');
    expect(server.controls()).toEqual([{ action: 'next_event' }]);
  }, T);

  it('works in journey mode too, and with Ctrl or Cmd held nothing is sent', () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server, '?package=shp-2');
    expect(journeySteps(document.body)).toHaveLength(4);
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true }));
    expect(server.controls()).toEqual([]);
    pageKey(' ');
    pageKey('.');
    expect(server.controls()).toEqual([{ action: 'play' }, { action: 'next_event' }]);
    expect(currentSearch(server)).toBe('?package=shp-2');
  }, T);
});

describe('Esc', () => {
  it('leaves the package journey: the URL drops ?package= and the network shows', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    click(packageRow(c, 'Coffee samples'));
    expect(currentSearch(server)).toBe('?package=shp-2');
    expect(journeySteps(c)).toHaveLength(4);

    pageKey('Escape');
    expect(currentSearch(server)).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
    expect(server.searches).toEqual(['', '?package=shp-2', '']);
    expect(server.controls()).toEqual([]);
  }, T);

  it('clears a business selection in network mode, and does nothing with no selection', () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server, '?business=biz-roast');
    pageKey('Escape');
    expect(currentSearch(server)).toBe('');
    pageKey('Escape');
    expect(server.searches).toEqual(['?business=biz-roast', '']);
  }, T);

  // A mouse click focuses the button it hits, so after clicking a package row the focus is still on
  // that row. The page's key map used to claim Esc from a focused <button> and do nothing; #511
  // (PR #537) fixed it in page/keyMap.ts (isTextTarget: only text fields keep Esc) and
  // page/simPageState.ts. This guards that fix on the real page.
  it('Esc right after a click on a package row (focus still on the row) leaves the journey', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    click(packageRow(c, 'Coffee samples'));
    expect(document.activeElement).toBe(packageRow(c, 'Coffee samples'));
    press('Escape', document.activeElement!);
    expect(currentSearch(server)).toBe('');
  }, T);

  it('"Back to network" also clears the URL', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    click(button(c.querySelector('.spc-journey__foot')!, /Back to network/));
    expect(currentSearch(server)).toBe('');
  }, T);
});

describe('keys in a text field act on the field only', () => {
  const fields = [
    ['package search', (c: ParentNode) => byLabel(leftBody(c), 'Search packages')],
    ['seed', (c: ParentNode) => byLabel(leftBody(c), 'Seed')],
  ] as const;

  it.each(fields)('%s: Space, "." and Esc send nothing and keep the journey', (_name, field) => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    const input = field(c);
    input.focus();
    expect(document.activeElement).toBe(input);
    for (const key of [' ', '.', 'Escape']) press(key, input);
    expect(server.controls()).toEqual([]);
    expect(currentSearch(server)).toBe('?package=shp-2');
    expect(journeySteps(c)).toHaveLength(4);
  }, T);

  it('a focused package row keeps Space for itself (no play sent)', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    const row = packageRow(c, 'Signed contracts');
    row.focus();
    press(' ', row);
    expect(server.controls()).toEqual([]);
  }, T);
});
