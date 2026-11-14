// @vitest-environment jsdom
// The simulator page's keyboard map in a real DOM (#519): the routed page (SimulatorV2Workspace in
// a MemoryRouter) with its window listener. Space is the one Play/Pause button (#648: the server
// clock with no package, the journey with one), Esc leaves the journey or clears a selection, and
// neither acts while the focus is in a text field (the package search). `.` does nothing any more.
// The selection is read back from the URL.
// #607: the focus dropdown does not keep the keys (a click leaves the focus on it); Space on a
// button stays that control's own.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byLabel, button, click, press, select, textOf } from './kitDom';
import {
  FakeSimServer, T, currentSearch, journeySteps, leftBody, mountPage, packageRow, playPause, readyState,
} from './sim-v2-dom-helpers';

/** Lets the answers of the fake server (promises) land, on real timers. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

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

describe('Space', () => {
  it('with no package: Space sends play, then pause once the server says the clock is playing', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    pageKey(' ');
    await settle();
    expect(server.controls()).toEqual([{ action: 'play' }]);
    expect(server.state.sim?.clock.playing).toBe(true); // the fake server applied it
    expect(textOf(playPause(c))).toBe('Pause');
    pageKey(' ');
    await settle();
    expect(server.controls()).toEqual([{ action: 'play' }, { action: 'pause' }]);
  }, T);

  it('"." sends nothing (#648): the next-event key went with its button', async () => {
    const server = new FakeSimServer(readyState(1000));
    mountPage(server);
    pageKey('.');
    await settle();
    expect(server.calls).toEqual([]);
  }, T);

  it('with a package: Space plays its journey (a seek, not the server clock); with Ctrl or Cmd held nothing is sent', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    expect(journeySteps(document.body)).toHaveLength(4);
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', metaKey: true, bubbles: true }));
    expect(server.controls()).toEqual([]);
    pageKey(' ');
    await settle();
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1039 }]);
    expect(textOf(playPause(c))).toBe('Pause');
    pageKey(' '); // pauses: nothing more is sent
    await settle();
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1039 }]);
    expect(textOf(playPause(c))).toBe('Play');
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

// #607: a click on the focus dropdown or a package row leaves the focus on it. These are not text
// fields, so the page's keys still work from them.
describe('keys after the focus dropdown or a package row was used', () => {
  const focusDropdown = (c: ParentNode) => byLabel(leftBody(c), 'Focus on employee') as HTMLSelectElement;

  it('after the focus dropdown was used: Space plays the journey and Esc leaves it', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?package=shp-2');
    const dropdown = focusDropdown(c);
    select(dropdown, dropdown.options[1].text);
    expect(document.activeElement).toBe(dropdown);
    expect(dropdown.selectedIndex).toBe(1);

    press(' ', dropdown);
    await settle();
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1039 }]);
    press('Escape', dropdown); // the first Esc pauses the journey
    expect(currentSearch(server)).toBe('?package=shp-2');
    press('Escape', dropdown);
    expect(currentSearch(server)).toBe('');
    expect(journeySteps(c)).toHaveLength(0);
    expect(focusDropdown(c).selectedIndex).toBe(1); // the focus choice is kept
    expect(server.controls()).toHaveLength(1);
  }, T);

  it('in network mode Esc from the focus dropdown clears the selection in one step', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server, '?business=biz-roast');
    const dropdown = focusDropdown(c);
    dropdown.focus();
    press('Escape', dropdown);
    expect(currentSearch(server)).toBe('');
    expect(server.searches).toEqual(['?business=biz-roast', '']); // one step, not two
    expect(server.controls()).toEqual([]);
  }, T);

  it('"." right after a click on a package row (focus on the row) sends nothing', async () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountPage(server);
    click(packageRow(c, 'Coffee samples'));
    press('.', document.activeElement!);
    await settle();
    expect(server.controls()).toEqual([]);
    expect(currentSearch(server)).toBe('?package=shp-2');
  }, T);
});

describe('keys in a text field act on the field only', () => {
  const fields = [
    ['package search', (c: ParentNode) => byLabel(leftBody(c), 'Search packages')],
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
