// @vitest-environment jsdom
// #824: the homepage holds two demo entries now, "Watch a package" and "The numbers" (#796). The page was
// opened in headless Chrome in production mode (npm run build + npm start) at 1440 and 390 px and nothing
// broke: no sideways scroll, no overlap, a ring on every tab stop, both links work and Back returns to `/`.
// This file keeps the parts of that result a later edit could undo without any other test going red:
// - the whole page, header included, on the real NYC run: the order Tab visits, with both entries in it;
// - landing.css: every link of the page has a focus ring that sits outside its box, and no rule can lay one
//   block of the page over another or cut a ring off.
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppShell } from '../../client/src/App';
import { STUDY_HREF, STUDY_LABEL, WATCH_LABEL } from '../../client/src/pages/Landing';
import { WATCH_PACKAGE_LABEL } from '../../client/src/pages/landingModel';
import type { SimulatorResponse } from '../../shared/v2/api';
import { startRealApi, type RealApi } from './business-v2-real-helper';
import { flush, mount, tabOrder, textOf } from './kitDom';

const T = 60_000;
let api: RealApi;
beforeAll(async () => { api = await startRealApi(); }, T);
afterAll(async () => { await api?.close(); }, T);
beforeEach(() => { localStorage.clear(); });

describe('the homepage in the app shell, on the real NYC run (#824)', () => {
  it('Tab visits the header, then Watch a package, Business, Employee and The numbers, and each stop is a named link', async () => {
    const sim = (await (await fetch('/api/v2/simulator')).json()) as SimulatorResponse;
    const story = sim.shipments.filter((s) => s.label === WATCH_PACKAGE_LABEL);
    expect(story).toHaveLength(1);

    const { container } = mount(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    const ready = () => !!container.querySelector('main a.workspace-entry[href^="/employee/"]')
      && !!container.querySelector('header a.shell-nav-link[href^="/employee/"]')
      && !container.querySelector('.op-summary-value.is-placeholder');
    for (let i = 0; i < 400 && !ready(); i++) await flush();
    expect(ready()).toBe(true);

    const stops = tabOrder(container);
    expect(stops.map((el) => textOf(el))).toEqual([
      'Skip to main content', 'Relay', 'Business', 'Employee', 'Simulator',
      WATCH_LABEL, 'BusinessSend a package and track it→', 'EmployeeSet a commute and see your deliveries→', STUDY_LABEL,
    ]);
    // Plain links in document order: no tabindex moves one of them, so the order on screen is the Tab order.
    expect(container.querySelector('[tabindex]:not([tabindex="-1"])')).toBeNull();
    for (const el of stops) {
      expect(el.tagName, textOf(el)).toBe('A');
      expect(el.getAttribute('href'), textOf(el)).toBeTruthy();
      expect(el.getAttribute('aria-hidden'), textOf(el)).toBeNull();
    }

    const main = stops.slice(5).map((el) => el.getAttribute('href'));
    expect(main[0]).toBe(`/simulator?package=${story[0].id}&play=1`); // the Navy Yard package (pass 63)
    expect(main[1]).toMatch(/^\/business\/[^/]+$/);
    expect(main[2]).toMatch(/^\/employee\/[^/]+$/);
    expect(main[3]).toBe(STUDY_HREF);
    // The two demo entries are separate elements of the page: neither is inside the other's block.
    const [watch, numbers] = [stops[5], stops[8]];
    expect(watch.contains(numbers) || numbers.contains(watch)).toBe(false);
    expect(watch.closest('.landing-intro')).not.toBeNull();
    expect(numbers.closest('.landing-intro')).toBeNull();
  }, T);
});

describe('landing.css keeps what the browser check found (#824)', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('each link of the page has a solid focus ring of 2 px or more, set off from its box', () => {
    for (const selector of ['.watch-button:focus-visible', 'a.workspace-entry:focus-visible', '.landing-more-link:focus-visible']) {
      const ring = rule(selector);
      const width = /outline: (\d+)px solid var\(--(?:text|accent), #[0-9A-F]{6}\)/.exec(ring);
      expect(width, selector).not.toBeNull();
      expect(Number(width![1]), selector).toBeGreaterThanOrEqual(2);
      expect(Number(/outline-offset: (\d+)px/.exec(ring)?.[1]), selector).toBeGreaterThanOrEqual(2);
    }
    // The button is filled with the accent, so its ring is ink: an accent ring would not show against it.
    expect(rule('.watch-button')).toMatch(/background: var\(--accent, #1D5075\)/);
    expect(rule('.watch-button:focus-visible')).toMatch(/outline: 3px solid var\(--text, #171C24\)/);
    expect(css).not.toMatch(/outline(-width|-style)?:\s*(none|0)\b/);
  });

  it('no rule takes a block out of the page flow or cuts off what sticks out of a box', () => {
    // Every block of the page is laid out top to bottom; with none of these, two of them cannot overlap and a
    // focus ring (drawn outside the box) is never clipped.
    expect(css).not.toMatch(/(^|[;{\s])(position|float|transform|translate|z-index|inset|clip-path|contain)\s*:/);
    expect(css).not.toMatch(/overflow(-x|-y)?:\s*(hidden|clip|scroll|auto)/);
    expect(css).not.toMatch(/margin[a-z-]*:[^;]*[\s:]-\d/); // no negative margin (the - of a token name does not count)
    expect(css).not.toMatch(/(^|[;{\s])(top|left|right|bottom):/);
  });

  it('"The numbers" keeps its own row with room around it: a margin above and a padded tap area', () => {
    expect(rule('.landing-more')).toMatch(/margin: var\(--space-2, 8px\) 0 0/);
    expect(rule('.landing-more-link')).toMatch(/display: inline-block/);
    expect(rule('.landing-more-link')).toMatch(/padding: var\(--space-2, 8px\) 0/);
    // and the stats line under it starts after a gap and a rule
    expect(rule('.op-summary')).toMatch(/margin-top: var\(--space-8, 32px\)/);
  });
});
