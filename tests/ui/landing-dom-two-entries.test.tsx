// @vitest-environment jsdom
// #824: the homepage holds two demo entries, "Watch a package" and the link to the study page ("The numbers"
// in #796, the "See the numbers" button since the #833 redesign, checked again in headless Chrome). The page was
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
  it('Tab visits the header, then Watch a package, Business, Employee and See the numbers, and each stop is a named link', async () => {
    const sim = (await (await fetch('/api/v2/simulator')).json()) as SimulatorResponse;
    const story = sim.shipments.filter((s) => s.label === WATCH_PACKAGE_LABEL);
    expect(story).toHaveLength(1);

    const { container } = mount(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    const ready = () => !!container.querySelector('main a.workspace-entry[href^="/employee/"]')
      && !!container.querySelector('header a.shell-nav-link[href^="/employee/"]')
      && !container.querySelector('main .workspace-entry.is-disabled');
    for (let i = 0; i < 400 && !ready(); i++) await flush();
    expect(ready()).toBe(true);

    const stops = tabOrder(container);
    expect(stops.map((el) => textOf(el))).toEqual([
      'Skip to main content', 'Relay', 'Business', 'Employee', 'Simulator',
      WATCH_LABEL, 'BusinessSend a package and track it', 'EmployeeSet a commute and see your deliveries', STUDY_LABEL,
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
    expect(watch.closest('.landing-hero')).not.toBeNull();
    expect(numbers.closest('.landing-hero')).toBeNull();
    expect(numbers.closest('.landing-numbers')).not.toBeNull(); // under the study's figure (#955)
  }, T);
});

describe('landing.css keeps what the browser check found (#824)', () => {
  const css = readFileSync('client/src/styles/landing.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('each link of the page has a solid focus ring of 2 px or more, set off from its box', () => {
    for (const selector of ['.watch-button:focus-visible', 'a.workspace-entry:focus-visible', '.numbers-button:focus-visible']) {
      const ring = rule(selector);
      const width = /outline: (\d+)px solid var\(--(?:paper-text|hero-light), #[0-9A-F]{6}\)/.exec(ring);
      expect(width, selector).not.toBeNull();
      expect(Number(width![1]), selector).toBeGreaterThanOrEqual(2);
      expect(Number(/outline-offset: (\d+)px/.exec(ring)?.[1]), selector).toBeGreaterThanOrEqual(2);
    }
    // In the ink hero the rings are light: the button is orange, and its ring sits 3 px off it, on the ink.
    // "See the numbers" is filled with ink on the paper, so its ring is ink, 3 px off it too (#955).
    expect(rule('.watch-button')).toMatch(/background: var\(--hero-package, #FF6A1A\)/);
    expect(rule('.watch-button:focus-visible')).toMatch(/outline: 3px solid var\(--hero-light, #F4F2EC\)/);
    expect(rule('a.workspace-entry:focus-visible')).toMatch(/outline: 2px solid var\(--hero-light, #F4F2EC\)/);
    expect(rule('.numbers-button')).toMatch(/background: var\(--paper-text, #14171F\)/);
    expect(rule('.numbers-button:focus-visible')).toMatch(/outline: 3px solid var\(--paper-text, #14171F\)/);
    expect(css).not.toMatch(/outline(-width|-style)?:\s*(none|0)\b/);
  });

  it('only the map box takes anything out of the page flow or cuts anything off, and no link is inside it', () => {
    // Every block with a link is laid out top to bottom, so two of them cannot overlap and a focus ring (drawn
    // outside the box) is never clipped. The drawing fills its own box behind the key; that box has no link.
    const rules = [...css.replace(/@keyframes [^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const MAP = /^\.(landing-hero-map|hero-[a-z-]+)(, \.hero-[a-z-]+)*$/;
    const outOfFlow = /(^|[;\s])(position|float|transform|translate|z-index|inset|clip-path|contain|top|left|right|bottom|overflow(-x|-y)?)\s*:/;
    // #955: the route line's marks are drawn as ::before and ::after of a step or a section. They hold no
    // link and are placed inside their own box, which stays in the flow (position: relative and nothing
    // else). The hero's column is in the flow too; it is only drawn over the map (z-index), because the
    // title's long line ends on the map's faded edge.
    const MARK = /::(before|after)$/;
    const hits = rules.filter((r) => outOfFlow.test(r.body) && !MAP.test(r.selector) && !MARK.test(r.selector));
    expect(hits.map((r) => r.selector)).toEqual(['.landing-hero-inner', '.landing-steps li', '.landing-numbers']);
    for (const r of hits) {
      const placed = [...r.body.matchAll(/(?:^|[;\s])(position|float|transform|translate|z-index|inset|clip-path|contain|top|left|right|bottom|overflow(?:-x|-y)?)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2]}`);
      expect(placed, r.selector).toEqual(r.selector === '.landing-hero-inner' ? ['position: relative', 'z-index: 1'] : ['position: relative']);
    }
    // A mark is as small as a station or as thin as a line, and never over a link: the steps and the
    // figure's heading have none, and the section's line lies in its top padding.
    for (const r of rules.filter((x) => MARK.test(x.selector))) expect(r.selector).toMatch(/^\.landing-(steps li|numbers)/);
    expect(readFileSync('client/src/pages/Landing.tsx', 'utf8')).toMatch(/<ol className="landing-steps">\s*\{HOW_STEPS\.map\(\(step\) => \(\s*<li key=\{step\}>\s*<span className="landing-step-text">\{step\}<\/span>\s*<\/li>/);
    expect(rules.filter((r) => /overflow(-x|-y)?:\s*(hidden|clip)/.test(r.body)).map((r) => r.selector)).toEqual(['.landing-hero-map']);
    expect(css).not.toMatch(/overflow(-x|-y)?:\s*(scroll|auto)/);
    expect(css).not.toMatch(/margin[a-z-]*:[^;]*[\s:]-\d/); // no negative margin (the - of a token name does not count)
    const map = readFileSync('client/src/pages/LandingHeroMap.tsx', 'utf8');
    expect(map).not.toMatch(/<a[\s>]|<Link|<button|tabIndex|href/);
  });

  it('"See the numbers" keeps its own row with room around it: under the figure\'s line, with a gap', () => {
    expect(rule('.landing-numbers-note')).toMatch(/margin: var\(--space-6, 24px\) 0;/);
    expect(rule('.numbers-button')).toMatch(/display: inline-flex/);
    expect(rule('.numbers-button')).toMatch(/min-height: 48px/);
  });
});
