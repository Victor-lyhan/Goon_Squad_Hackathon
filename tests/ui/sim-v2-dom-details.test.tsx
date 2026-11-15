// @vitest-environment jsdom
// #832: the simulator's left and right panels in a real DOM. One line per item; the secondary detail
// (route, relay point, reason, exact times and minutes, rewards, ids, stops, long explanations) is
// under a "Details" toggle: a real button, closed at first, that stays open across a poll. Nothing is
// taken away: the links and rows folded under a toggle still work once it is open. With every toggle
// closed, no sentence shown in either panel is over 12 words.
// The map runs in its no-key state: the Google loader is replaced by a recorder that must stay unused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, textOf } from './kitDom';
import {
  FakeSimServer, T, journeySteps, leftBody, mountBody, packageRow, readyState, rightBody, samePollAgain,
} from './sim-v2-dom-helpers';
import type { Selection } from '../../client/src/components/sim/v2/network/selectionModel';

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

const toggles = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button.sw-details-toggle')];
const toggle = (root: ParentNode, name: string) => {
  const found = toggles(root).filter((b) => b.getAttribute('aria-label') === name);
  if (found.length !== 1) throw new Error(`toggle(): ${found.length} "${name}"`);
  return found[0];
};
/** What a toggle controls: every element its `aria-controls` names. */
const controlled = (b: HTMLButtonElement) => (b.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)
  .map((id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`aria-controls names a missing element: ${id}`);
    return el;
  });
const isShown = (el: Element) => el.closest('[hidden]') === null;

/** The text a sighted user sees in `root`: no `hidden` subtree, no option list, no visually hidden text. */
function shownText(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const el of copy.querySelectorAll('[hidden], option, .jt-sr, .cmp-sr-only, .sw-visually-hidden')) el.remove();
  // Block ends become sentence ends, so two short lines are not read as one long sentence.
  for (const el of copy.querySelectorAll('p, li, dt, dd, h1, h2, h3, button, label, div, th, td')) el.append(' | ');
  return textOf(copy);
}
const longSentences = (root: Element) => shownText(root).split(/[.!?…|]+/)
  .map((s) => s.trim()).filter((s) => s.split(/\s+/).filter((w) => /\w/.test(w)).length > 12);

const STATES: [name: string, selection: Selection][] = [
  ['network', null],
  ['relay journey', { kind: 'package', id: 'shp-2' }],
  ['direct journey', { kind: 'package', id: 'shp-1' }],
  ['unmatched package', { kind: 'package', id: 'shp-3' }],
  ['business', { kind: 'business', id: 'biz-dumbo' }],
  ['employee', { kind: 'employee', id: 'emp-2' }],
];

describe('#832: every Details toggle is a real button, closed at first', () => {
  it.each(STATES)('%s: closed, named, and controls elements that are hidden', (_name, selection) => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), selection);
    const all = toggles(c);
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.type).toBe('button');
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(textOf(b)).toContain('Details');
      expect(b.getAttribute('aria-label') ?? 'Details').toMatch(/^Details/);
      const targets = controlled(b);
      expect(targets.length).toBeGreaterThan(0);
    }
    // Each folded piece is out of sight: nothing marked as detail is shown.
    const folded = [...c.querySelectorAll('[data-details-body]')];
    expect(folded.length).toBeGreaterThan(0);
    for (const el of folded) expect(isShown(el)).toBe(false);
  }, T);

  it.each(STATES)('%s: with every toggle closed, no sentence in either panel is over 12 words', (_name, selection) => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), selection);
    expect(longSentences(leftBody(c))).toEqual([]);
    expect(longSentences(rightBody(c))).toEqual([]);
  }, T);
});

describe('#832: the left panel', () => {
  it('a package is one line; Details shows each route line and stays open across a poll', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server);
    const row = packageRow(c, 'Coffee samples');
    const route = row.querySelector('.sw-pkg-route')!;
    // The status word alone, on one line with the name; the kind and the route are the detail.
    expect(textOf(row.querySelector('.sw-pkg-status')!)).toBe('Scheduled');
    expect(textOf(route)).toBe('Relay via Brooklyn Roasting · DUMBO Studio → Etsy');
    expect(isShown(route)).toBe(false);

    const details = toggle(leftBody(c), 'Details: packages');
    click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect([...c.querySelectorAll('.sw-pkg-route')].every(isShown)).toBe(true);
    // The unmatched row's reason is on its detail line.
    expect(textOf(packageRow(c, 'Archive box').querySelector('.sw-pkg-route')!)).toContain('No commuter passes both businesses');

    server.poll(samePollAgain(server.state));
    expect(toggle(leftBody(c), 'Details: packages').getAttribute('aria-expanded')).toBe('true');
    expect(isShown(packageRow(c, 'Coffee samples').querySelector('.sw-pkg-route')!)).toBe(true);

    click(toggle(leftBody(c), 'Details: packages'));
    expect(isShown(packageRow(c, 'Coffee samples').querySelector('.sw-pkg-route')!)).toBe(false);
    // The row still opens the journey.
    click(packageRow(c, 'Coffee samples'));
    expect(server.selections).toEqual([{ kind: 'package', id: 'shp-2' }]);
  }, T);

  it('the comparison: one short sentence; the explanations are under Details', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)));
    const details = toggle(leftBody(c), 'Details: comparison');
    const [body] = controlled(details);
    expect(textOf(body)).toContain('Projection only.');
    expect(isShown(body)).toBe(false);
    click(details);
    expect(isShown(body)).toBe(true);
  }, T);
});

describe('#832: the right panel', () => {
  it('journey: one line per step with its time in mono; Details shows carriers and step details, across a poll', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, { kind: 'package', id: 'shp-2' });
    const steps = journeySteps(c);
    expect(steps).toHaveLength(4);
    for (const s of steps) {
      expect(textOf(s.querySelector('.jt-step__time')!)).toMatch(/^Day \d, \d{1,2}:\d{2} [AP]M$/);
      expect(isShown(s.querySelector('.jt-step__more')!)).toBe(false);
    }
    const carriers = c.querySelector('.jt__legs')!;
    expect(isShown(carriers)).toBe(false);

    const details = toggle(rightBody(c), 'Details: Coffee samples');
    expect(controlled(details).map((el) => el.className)).toEqual(['jt__legs', 'jt__steps']);
    click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(isShown(carriers)).toBe(true);
    expect(textOf(carriers)).toContain('min extra');
    expect(journeySteps(c).every((s) => isShown(s.querySelector('.jt-step__more')!))).toBe(true);

    server.poll(samePollAgain(server.state));
    expect(toggle(rightBody(c), 'Details: Coffee samples').getAttribute('aria-expanded')).toBe('true');
    expect(isShown(c.querySelector('.jt__legs')!)).toBe(true);

    // A step still seeks.
    click(journeySteps(c)[1]);
    expect(server.seeks()).toEqual([1062]);
  }, T);

  it('journey legend: what the marker and the line widths mean is under its own Details', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), { kind: 'package', id: 'shp-2' });
    const details = toggle(rightBody(c), 'Details: journey legend');
    const [body] = controlled(details);
    expect(textOf(body)).toContain('Thick: carrying the package');
    expect(isShown(body)).toBe(false);
    click(details);
    expect(isShown(body)).toBe(true);
  }, T);

  it('unmatched package: the status is shown, the reason is under Details', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), { kind: 'package', id: 'shp-3' });
    const reason = c.querySelector('.jt__reason')!;
    expect(textOf(rightBody(c))).toContain('Status Unmatched');
    expect(isShown(reason)).toBe(false);
    click(toggle(rightBody(c), 'Details: Archive box'));
    expect(isShown(reason)).toBe(true);
    expect(textOf(reason)).toContain('No commuter passes both businesses');
  }, T);

  it('business: a package row is one line; its carrier link, under Details, still selects the carrier', () => {
    const server = new FakeSimServer(readyState(1000));
    const { container: c } = mountBody(server, { kind: 'business', id: 'biz-dumbo' });
    const row = c.querySelector('[data-testid="insp-row-shp-1"]')!;
    const figs = row.querySelector('[data-testid="insp-figs-shp-1"]')!;
    expect(isShown(figs)).toBe(false);
    click(toggle(row, 'Details: Signed contracts'));
    expect(isShown(figs)).toBe(true);
    expect(textOf(figs)).toMatch(/Reward \$\d/);
    click(row.querySelector<HTMLButtonElement>('button[aria-label="Inspect carrier Ana Ruiz"]')!);
    expect(server.selections).toEqual([{ kind: 'employee', id: 'emp-1' }]);
  }, T);

  it('business: the address is under the header Details', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), { kind: 'business', id: 'biz-dumbo' });
    const address = c.querySelector('[data-testid="insp-def-address"]')!;
    expect(isShown(address)).toBe(false);
    expect(textOf(c.querySelector('[data-testid="insp-def-commuters"] .insp-mono')!)).toMatch(/^\d+$/);
    click(toggle(rightBody(c), 'Details: DUMBO Studio'));
    expect(isShown(address)).toBe(true);
  }, T);

  it('employee: a leg is one line; each leg\'s stops are under Details, and no ID anywhere (#883)', () => {
    const { container: c } = mountBody(new FakeSimServer(readyState(1000)), { kind: 'employee', id: 'emp-2' });
    expect(c.querySelector('[data-testid="insp-def-ident"]')).toBeNull();
    expect(rightBody(c).textContent).not.toMatch(/emp-2/i);
    const stops = c.querySelector('.insp-stops')!;
    expect(isShown(stops)).toBe(false);
    const leg = c.querySelector('.insp-leg')!;
    click(toggles(leg)[0]);
    expect(isShown(stops)).toBe(true);
    expect(isShown(leg.querySelector('.insp-leg-nums')!)).toBe(true);
  }, T);
});
