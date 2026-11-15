// @vitest-environment jsdom
// The MVP II simulator page in a real DOM (#519): pick a package from the left panel's list, see its
// numbered journey and the selection reported, leave it with "Back to network" or Esc, seek from a
// journey step, keep typed input across a 1 s poll, the "isn't in this run" message for a
// package a new run does not have, and a collapsed panel that leaves the tab order.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MISSING_PACKAGE_TEXT } from '../../client/src/components/sim/v2/compose/simPageView';
import { button, buttons, byLabel, click, press, textOf, typeInto } from './kitDom';
import {
  FakeSimServer, T, emptyRunState, journeySteps, leftBody, mountBody, panelToggle, packageLabels, packageRow, readyState,
  rightBody, samePollAgain, tabbable,
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
  expect(google.loads).toBe(0); // nothing loaded from Google in any test
});

const COFFEE = 'Coffee samples'; // shp-2, the relay package
const searchBox = (c: ParentNode) => byLabel(c, 'Search packages') as HTMLInputElement;
const chip = (c: ParentNode, label: string) => {
  const found = [...c.querySelectorAll<HTMLButtonElement>('.pk-status button')]
    .filter((b) => textOf(b.querySelector('span')!) === label);
  if (found.length !== 1) throw new Error(`chip(): ${found.length} "${label}"`);
  return found[0];
};

describe('selecting a package from the list', () => {
  it('opens its journey with the numbered steps and reports the selection; the map shows its no-key note', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server);
    expect(textOf(c)).toContain('Google Maps key missing.');
    expect(packageLabels(c)).toEqual(expect.arrayContaining(['Signed contracts', COFFEE, 'Archive box']));
    expect(journeySteps(c)).toHaveLength(0);

    click(packageRow(c, COFFEE));
    expect(server.selections).toEqual([{ kind: 'package', id: 'shp-2' }]);
    expect(packageRow(c, COFFEE).getAttribute('aria-current')).toBe('true');

    const steps = journeySteps(c);
    expect(steps.map((s) => textOf(s.querySelector('.jt-step__label')!))).toEqual([
      'Step 1: Pickup at sender', 'Step 2: Drop at relay point',
      'Step 3: Pickup at relay point', 'Step 4: Delivered to recipient',
    ]);
    expect(steps.map((s) => textOf(s.querySelector('.jt-step__n')!))).toEqual(['1', '2', '3', '4']);
    expect(textOf(steps[1])).toContain('Brooklyn Roasting');
    // The left panel shows the journey header with its own exit; the right panel has the timeline's.
    expect(textOf(c.querySelector('.sw-journey')!)).toContain(COFFEE);
    expect(buttons(c, /Back to network/)).toHaveLength(2);
    expect(server.calls).toEqual([]); // selecting sends nothing to the server
  }, T);

  it('"Back to network" in either panel clears the selection', () => {
    for (const where of ['.sw-journey', '.spc-journey__foot'] as const) {
      const server = new FakeSimServer(readyState(1000));
      const m = mountBody(server);
      click(packageRow(m.container, COFFEE));
      click(button(m.container.querySelector(where)!, /Back to network/));
      expect(server.selections).toEqual([{ kind: 'package', id: 'shp-2' }, null]);
      expect(journeySteps(m.container)).toHaveLength(0);
      expect(m.container.querySelector('.sw-journey')).toBeNull();
      m.unmount();
    }
  }, T);

  it('Esc clears it too, with the focus on the page or still on the clicked row', () => {
    for (const where of ['page', 'row'] as const) {
      const server = new FakeSimServer(readyState(1000));
      const m = mountBody(server);
      click(packageRow(m.container, COFFEE));
      expect(document.activeElement).toBe(packageRow(m.container, COFFEE));
      if (where === 'page') (document.activeElement as HTMLElement).blur();
      press('Escape', document.activeElement ?? document.body);
      expect(server.selections).toEqual([{ kind: 'package', id: 'shp-2' }, null]);
      expect(journeySteps(m.container)).toHaveLength(0);
      m.unmount();
    }
  }, T);

  it("a click on a journey step sends a seek to that step's minute", () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, { kind: 'package', id: 'shp-2' });
    // The sample's service ends: 1042 pickup, 1062 drop, 1952 relay pickup, 1977 delivered.
    click(journeySteps(c)[2]);
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1952 }]);
    click(journeySteps(c)[0]);
    expect(server.controls()).toEqual([{ action: 'seek', timeMin: 1952 }, { action: 'seek', timeMin: 1042 }]);
    expect(server.selections).toEqual([]); // still the same package
  }, T);
});

describe('a 1 s poll', () => {
  it('with the same version keeps the search text and the status filter', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server);
    const left = leftBody(c);

    click(chip(left, 'Unmatched'));
    expect(chip(left, 'Unmatched').getAttribute('aria-pressed')).toBe('true');
    typeInto(searchBox(left), 'archive');
    expect(packageLabels(c)).toEqual(['Archive box']);

    server.poll(samePollAgain(server.state));
    server.poll(samePollAgain(server.state));

    expect(searchBox(left).value).toBe('archive');
    expect(chip(left, 'Unmatched').getAttribute('aria-pressed')).toBe('true');
    expect(packageLabels(c)).toEqual(['Archive box']);
    expect(server.calls).toEqual([]);
  }, T);

  it('a selected package missing from a new run shows "isn\'t in this run" with a way back', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, { kind: 'package', id: 'shp-2' });
    expect(journeySteps(c)).toHaveLength(4);

    server.poll(emptyRunState());
    const right = rightBody(c);
    expect(textOf(right.querySelector('[role="alert"]')!)).toBe(MISSING_PACKAGE_TEXT);
    expect(MISSING_PACKAGE_TEXT).toBe("That package isn't in this run.");
    expect(journeySteps(c)).toHaveLength(0);
    click(button(right, /Back to network/));
    expect(server.selections).toEqual([null]);
    expect(right.querySelector('[role="alert"]')).toBeNull();
  }, T);
});

describe('collapsing a panel', () => {
  it.each([['Controls', 'left', leftBody], ['Inspector', 'right', rightBody]] as const)(
    '%s: its controls leave the tab order and focus stays on the toggle; expanding brings them back',
    (title, side, body) => {
      const server = new FakeSimServer(readyState(1000));
      const { container: c } = mountBody(server, { kind: 'package', id: 'shp-2' });
      const toggle = panelToggle(c, side);
      expect(textOf(toggle)).toContain(title);
      expect(tabbable(body(c)).length).toBeGreaterThan(3);

      click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(body(c).hidden).toBe(true);
      expect(tabbable(body(c))).toEqual([]);
      expect(document.activeElement).toBe(toggle);
      expect(toggle.isConnected).toBe(true);

      click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(tabbable(body(c)).length).toBeGreaterThan(3);
      expect(document.activeElement).toBe(toggle);
    },
    T,
  );
});
