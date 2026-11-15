// Issue 957, the bold redesign of the Employee page ("night-shift transit ops"). It takes the place of
// the issue 941 design pass, whose bold row it replaces:
//   - the next job (the first row of the assigned list, in the server's order) is a boarding pass: pickup
//     and drop-off are the two stations of one route line, each clock large, the reward on the stub, and
//     the page's one orange action;
//   - the pass stands on an ink band that is as wide as the window; the rest is quiet, on paper, no cards;
//   - the commute is one route strip per trip with a home and a work station.
// Read from the stylesheets and the rendered workspace. The palette rules are in
// employee-v2-night-shift-css.test.ts.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import { deliveryRows } from '../../client/src/components/employee/v2/employeeWorkspaceModel';
import { TIME_UNAVAILABLE, momentText, splitMoment } from '../../client/src/components/employee/v2/jobDetailV2Model';
import { all, parseCss, parseHtml, textOf, type CssRule, type El } from './employee-v2-qa-helpers';
import { businesses, dashboard, directView, emptyDashboard, noMorning, relayView } from './employee-v2-workspace-sample';

const DIR = 'client/src/components/employee/v2/';
const cssOf = (file: string) => parseCss(readFileSync(DIR + file, 'utf8'));
const selectors = (r: CssRule) => r.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
/** The value a selector gets outside every media query. */
const base = (rules: CssRule[], selector: string, prop: string) => rules
  .filter((r) => r.media.length === 0 && selectors(r).includes(selector))
  .flatMap((r) => r.decls).filter((d) => d.prop === prop).at(-1)?.value;
const inMedia = (rules: CssRule[], media: RegExp, selector: string, prop: string) => rules
  .filter((r) => r.media.some((m) => media.test(m)) && selectors(r).includes(selector))
  .flatMap((r) => r.decls).filter((d) => d.prop === prop).at(-1)?.value;

const work = cssOf('EmployeeWorkspace.css');
const page = cssOf('page/employeePage.css');
const job = cssOf('JobDetailV2.css');
const form = cssOf('CommuteForm.css');

const INK = 'var(--ink, #0B0F17)';
const PAPER = 'var(--paper, #F4F2EC)';
const ON_INK = 'var(--on-ink, #F4F2EC)';
const TEXT = 'var(--paper-text, #14171F)';
const SIGNAL = 'var(--signal, #FF6A1A)';
const DISPLAY = "var(--font-display, 'Archivo Variable', 'Inter', system-ui, sans-serif)";
const PHONE = /max-width:\s*480px/;
const NARROW = /max-width:\s*600px/;

const cls = (e: El) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);
const byClass = (root: El, name: string) => all(root, (e) => cls(e).includes(name));
const render = (d = dashboard, extra: Record<string, unknown> = {}) =>
  parseHtml(renderToStaticMarkup(createElement(EmployeeWorkspace, { dashboard: d, businesses, ...extra })));
const assignedOf = (root: El) => all(root, (e) => e.tag === 'section' && e.attrs['aria-labelledby'] === 'ew-assigned-heading')[0];

describe('the next job is a boarding pass (issue 957)', () => {
  const root = render();
  const assigned = assignedOf(root);
  const rows = byClass(assigned, 'ew-row');

  it('is the first row of the assigned list, in the server\'s order, and the only pass on the page', () => {
    expect(rows.map((r) => r.attrs['data-job-id'])).toEqual(dashboard.assigned.map((v) => v.job.id)); // not re-sorted
    expect(rows[0].attrs.class).toBe('ew-row ew-pass');
    expect(rows[0].tag).toBe('li');
    for (const r of rows.slice(1)) expect(r.attrs.class).toBe('ew-row');
    expect(byClass(root, 'ew-pass')).toHaveLength(1); // none in the completed list
    expect(cls(assigned)).toContain('ew-next');
    // Reordering the API's list moves the pass with it.
    const swapped = render({ ...dashboard, assigned: [relayView, directView] });
    expect(byClass(swapped, 'ew-pass')[0].attrs['data-job-id']).toBe(relayView.job.id);
  });

  it('pickup and drop-off are two stops with the day small, the clock large and the place under the line', () => {
    const stops = byClass(rows[0], 'ew-pass-stop');
    expect(stops.map((s) => textOf(all(s, (e) => e.tag === 'dt')[0]))).toEqual(['Pickup', 'Drop-off']);
    // A delivery time keeps its day: the stop's text is the row's own "Day 1, 5:30 PM · Acme Studio".
    const [row] = deliveryRows([directView], businesses, 'Astoria');
    const flat = (e: El): string => e.children.map((c) => (typeof c === 'string' ? c : flat(c))).join('');
    expect(stops.map((s) => flat(all(s, (e) => e.tag === 'dd')[0]))).toEqual([row.pickup, row.dropoff]);
    expect(row.pickup).toBe('Day 1, 5:30 PM · Acme Studio');
    const times = byClass(rows[0], 'ew-pass-time');
    expect(times.map(flat)).toEqual([row.pickupTime, row.dropoffTime]);
    expect(byClass(rows[0], 'ew-pass-day').map(flat)).toEqual(['Day 1, ', 'Day 1, ']);
    expect(times.map((t) => t.children.filter((c) => typeof c === 'string').join(''))).toEqual(['5:30 PM', '6:06 PM']);
    expect(byClass(rows[0], 'ew-pass-place').map(textOf)).toEqual(['Acme Studio', 'Cafe Luna']);
    // The " · " between the time and the place is there for a screen reader only.
    expect(all(rows[0], (e) => cls(e).includes('ew-sr')).map(flat)).toEqual([' · ', ' · ']);
  });

  it('the stub carries the reward, the extra time and the two links, View job first', () => {
    const stub = byClass(rows[0], 'ew-pass-stub')[0];
    expect(textOf(stub)).toBe('Reward $8.00 Extra time +7 min View job Watch in simulator');
    expect(textOf(byClass(stub, 'ew-pass-reward')[0])).toBe('$8.00');
    const links = all(stub, (e) => e.tag === 'a');
    expect(links.map(textOf)).toEqual(['View job', 'Watch in simulator']);
    expect(links[0].attrs.href).toBe(`/employee/emp-001?job=${directView.job.id}`);
    expect(links[0].attrs['data-row-focus']).toBe(''); // focus comes back here when the job view closes
    expect(links[1].attrs.href).toBe('/simulator?package=shp-001&play=1');
  });

  it('says which carrier and which status it shows, as pictures of what the row says in words', () => {
    // First leg of a plan: carrier A (blue); second leg: carrier B (green), as the simulator draws the legs.
    expect(rows[0].attrs['data-carrier']).toBe('a');
    expect(deliveryRows([relayView], businesses, 'Astoria')[0].carrier).toBe('b');
    expect(byClass(render({ ...dashboard, assigned: [relayView] }), 'ew-pass')[0].attrs['data-carrier']).toBe('b');
    // The status is the API's, word for word.
    for (const status of ['assigned', 'in_progress'] as const) {
      const pass = byClass(render({ ...dashboard, assigned: [{ ...directView, status }] }), 'ew-pass')[0];
      expect(pass.attrs['data-status']).toBe(status);
      expect(textOf(byClass(pass, 'ew-status')[0])).toBe(status === 'assigned' ? 'Assigned' : 'In progress');
    }
    // The package square is a picture only.
    const parcel = byClass(rows[0], 'ew-pass-parcel');
    expect(parcel).toHaveLength(1);
    expect(parcel[0].attrs['aria-hidden']).toBe('true');
    expect(parcel[0].children).toEqual([]);
  });

  it('a "New" tag sits on the pass or on a quiet row, whichever job is new', () => {
    for (const view of [directView, relayView]) {
      const r = render(dashboard, { newJobIds: [view.job.id] });
      const tags = byClass(r, 'ew-new');
      expect(tags).toHaveLength(1);
      const li = all(r, (e) => e.attrs['data-job-id'] === view.job.id)[0];
      expect(byClass(li, 'ew-new')).toHaveLength(1);
    }
  });

  it('splitMoment cuts a moment where its clock starts and puts nothing in or out', () => {
    for (const min of [1050, 1950, 2159, 930]) {
      const { day, clock } = splitMoment(momentText(min));
      expect(day + clock).toBe(momentText(min));
      expect(day).toMatch(/^Day [12], $/);
      expect(clock).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    }
    expect(splitMoment(TIME_UNAVAILABLE)).toEqual({ day: '', clock: TIME_UNAVAILABLE });
  });
});

describe('the pass is the one bold element (issue 957)', () => {
  const ACTION = '.ew-pass .ew-row-links a:first-child';

  it('a paper ticket with two columns: the route, and a stub past a dashed perforation with two notches', () => {
    expect(base(work, '.ew-pass-ticket', 'background')).toBe(PAPER);
    expect(base(work, '.ew-pass-ticket', 'color')).toBe(TEXT);
    expect(base(work, '.ew-pass-ticket', 'grid-template-columns')).toBe('minmax(0, 1fr) 216px');
    expect(base(work, '.ew-pass-stub', 'border-left')).toBe('1px dashed var(--paper-muted, #5A5F6B)');
    // The notches are ink discs, half on the ticket and half on the band behind it.
    const notches = work.find((r) => selectors(r).includes('.ew-pass-stub::before'))!;
    expect(selectors(notches)).toEqual(['.ew-pass-stub::before', '.ew-pass-stub::after']);
    expect(notches.decls.find((d) => d.prop === 'background')?.value).toBe(INK);
    expect(notches.decls.find((d) => d.prop === 'border-radius')?.value).toBe('50%');
  });

  it('the clocks and the reward are large in Archivo, with figures of one width', () => {
    expect(base(work, '.ew-pass-time', 'font-family')).toBe(DISPLAY);
    expect(base(work, '.ew-pass-time', 'font-size')).toBe('52px');
    expect(base(work, '.ew-pass-time', 'font-weight')).toBe('800');
    expect(base(work, '.ew-pass-time', 'font-stretch')).toBe('78%'); // heavy and condensed, like the homepage's title
    expect(base(work, '.ew-pass-time', 'font-variant-numeric')).toBe('tabular-nums');
    expect(base(work, '.ew-pass-reward', 'font-family')).toBe(DISPLAY);
    expect(base(work, '.ew-pass-reward', 'font-size')).toBe('44px');
    // The day inside the clock's element is small, in the body font.
    expect(base(work, '.ew-pass-day', 'font-size')).toBe('var(--text-sm, 13px)');
    expect(base(work, '.ew-pass-day', 'font-family')).toMatch(/^var\(--font-sans, /);
  });

  it('the two stations hang under one line in the carrier colour; the orange is the package', () => {
    expect(base(work, '.ew-pass-route', 'grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr)'); // two halves of one line
    expect(base(work, '.ew-pass-place', 'border-top')).toBe('4px solid var(--carrier-a, #3D8BFF)');
    expect(base(work, '.ew-pass[data-carrier="b"] .ew-pass-place', 'border-top-color')).toBe('var(--carrier-b, #22C08A)');
    expect(base(work, '.ew-pass-place::before', 'border-radius')).toBe('50%');
    // Assigned: the package waits at the pickup station. In progress: it is on the line. Completed: at the drop-off.
    const waiting = '.ew-pass[data-status="assigned"] .ew-pass-stop:first-child .ew-pass-place::before';
    expect(base(work, waiting, 'background')).toBe(SIGNAL);
    expect(base(work, '.ew-pass[data-status="completed"] .ew-pass-stop:last-child .ew-pass-place::before', 'background')).toBe(SIGNAL);
    expect(base(work, '.ew-pass-parcel', 'display')).toBe('none');
    expect(base(work, '.ew-pass[data-status="in_progress"] .ew-pass-parcel', 'display')).toBe('block');
    expect(base(work, '.ew-pass[data-status="in_progress"] .ew-pass-parcel', 'background')).toBe(SIGNAL);
  });

  it('View job on the pass is the page\'s only orange action, with ink words, 44 px tall', () => {
    expect(base(work, ACTION, 'background')).toBe(SIGNAL);
    expect(base(work, ACTION, 'color')).toBe(INK);
    expect(base(work, ACTION, 'min-height')).toBe('44px');
    expect(base(work, `${ACTION}:hover`, 'background')).toBe('var(--signal-hover, #FF8748)');
    // No other control of the workspace, the page or the form is filled with the orange.
    const fills = [...work, ...page, ...form]
      .filter((r) => r.decls.some((d) => d.prop === 'background' && d.value === SIGNAL))
      .map((r) => r.selector.replace(/\s+/g, ' '))
      .filter((s) => !s.includes('.ew-pass-place') && !s.includes('.ew-pass-parcel') && s !== '.ew-new');
    expect(fills).toEqual([ACTION]);
    // Save commute is filled with ink, not the orange: the orange is the package's.
    expect(base(form, '.cf-btn-primary', 'background')).toBe(INK);
    // On the job view the one orange action is "Watch this package".
    expect(base(job, '.job-v2__link', 'background')).toBe(SIGNAL);
    expect(base(job, '.job-v2__link', 'color')).toBe(INK);
    expect(base(job, '.job-v2__button', 'background')).toBe('none');
  });

  it('on a narrow screen the stub goes under the ticket and the day gets its own line', () => {
    expect(inMedia(work, NARROW, '.ew-pass-ticket', 'grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(inMedia(work, NARROW, '.ew-pass-stub', 'border-left')).toBe('0');
    expect(inMedia(work, NARROW, '.ew-pass-stub', 'border-top')).toBe('1px dashed var(--paper-muted, #5A5F6B)');
    expect(inMedia(work, NARROW, '.ew-pass-time', 'font-size')).toBe('38px');
    expect(inMedia(work, NARROW, '.ew-pass-day', 'display')).toBe('block');
  });
});

describe('the ink band and the paper under it (issue 957)', () => {
  it('four blocks carry the ink and are as wide as the window, with their content back in the column', () => {
    const band = work.find((r) => selectors(r).includes('.ew-top') && r.decls.some((d) => d.prop === 'background'))!;
    expect(selectors(band)).toEqual(['.ew-top', '.ew-next > .ew-section-head', '.ew-next .ew-pass', '.ew-next > .ew-empty']);
    const decl = (prop: string) => band.decls.find((d) => d.prop === prop)?.value;
    expect(decl('background')).toBe(INK);
    expect(decl('color')).toBe(ON_INK);
    expect(decl('margin-left')).toBe('calc(50% - 50vw)');
    expect(decl('margin-right')).toBe('calc(50% - 50vw)');
    expect(decl('padding-left')).toBe('calc(50vw - 50%)');
    expect(decl('padding-right')).toBe('calc(50vw - 50%)');
    // The same on a job screen, where the band is the employee's name alone.
    expect(base(page, '.ep-name', 'background')).toBe(INK);
    expect(base(page, '.ep-name', 'margin')).toBe('0 calc(50% - 50vw)');
    // The page starts right under the app header, and its ground is paper on the whole window.
    expect(base(page, '.ep', 'margin')).toBe('calc(-1 * var(--space-4, 16px)) auto 0');
    expect(base(page, 'body:has(.ep)', 'background')).toBe(PAPER);
    expect(page[0].selector).toBe('.ep'); // the page's own root is still the stylesheet's first rule
  });

  it('the band holds the name, the earnings and the assigned list; the commute and the completed list follow', () => {
    const root = render();
    const top = byClass(root, 'ew-top')[0];
    expect(all(top, (e) => e.tag === 'h1').map(textOf)).toEqual(['Maya Chen']);
    expect(textOf(byClass(top, 'ew-header')[0])).toBe('Maya Chen Acme Studio, Flatiron'); // no middle dot
    // The earnings keep their region and its name; the heading is for a screen reader, the labels say it on screen.
    const money = all(top, (e) => e.tag === 'section')[0];
    expect(money.attrs['aria-labelledby']).toBe('ew-earnings-heading');
    expect(all(money, (e) => e.tag === 'h2')[0].attrs).toMatchObject({ id: 'ew-earnings-heading', class: 'ew-sr' });
    expect(textOf(money)).toBe('Earnings Earned $5.00 Projected $20.00');
    const ew = byClass(root, 'ew')[0];
    const blocks = ew.children.filter((c): c is El => typeof c !== 'string').map((e) => e.attrs['aria-labelledby'] ?? e.attrs.class);
    expect(blocks).toEqual(['ew-top', 'ew-assigned-heading', 'ew-commute-heading', 'ew-completed-heading', 'ew-sr ew-announce']);
  });

  it('with no assigned job the band ends with the two sentences, in its own colours', () => {
    const root = render(emptyDashboard);
    const empty = byClass(assignedOf(root), 'ew-empty');
    expect(empty).toHaveLength(1);
    expect(byClass(root, 'ew-pass')).toHaveLength(0);
    expect(base(work, '.ew-next > .ew-empty', 'color')).toBe('var(--on-ink-muted, #A3A9B5)');
    expect(base(work, '.ew-next > .ew-empty .ew-empty-title', 'color')).toBe(ON_INK);
    expect(base(work, '.ew-empty-title', 'display')).toBe('block');
  });

  it('a section on paper starts at a route-line divider with a station dot, 40 px after the one before', () => {
    expect(base(work, '.ew-section', 'margin-top')).toBe('40px');
    expect(base(page, '.ep-editor', 'margin-top')).toBe('40px');
    for (const [rules, head] of [[work, '.ew-section-head'], [page, '.ep-editor-head']] as const) {
      expect(base(rules, head, 'border-bottom')).toBe('1px solid var(--paper-line, #DCD8CE)');
      expect(base(rules, head, 'min-height')).toBe('52px');
      expect(base(rules, `${head}::after`, 'border-radius')).toBe('50%');
      expect(base(rules, `${head}::after`, 'background')).toBe(TEXT);
    }
    // No card: a section has no border, no ground and no radius of its own.
    for (const prop of ['border', 'background', 'border-radius']) expect(base(work, '.ew-section', prop), prop).toBeUndefined();
    // In the band the heading stands right above the pass, with no line (it would run across the whole window).
    expect(base(work, '.ew-next > .ew-section-head', 'border-bottom')).toBe('0');
    expect(base(work, '.ew-next > .ew-section-head::after', 'content')).toBe('none');
    // The locked line is right above the commute it is about.
    expect(base(work, '.ew-locked + .ew-section', 'margin-top')).toBe('var(--space-4, 16px)');
    expect(base(page, '.ew-locked + .ep-editor', 'margin-top')).toBe('var(--space-4, 16px)');
  });

  it('the loading line is plain muted text', () => {
    expect(base(page, 'p.ep-state', 'color')).toBe('var(--paper-muted, #5A5F6B)');
    for (const prop of ['border', 'background']) expect(base(page, '.ep-state', prop), prop).toBeUndefined();
  });
});

describe('the commute is a route strip per trip (issue 957)', () => {
  it('a strip is two stations under one line: work filled, home open, the same in both directions', () => {
    expect(base(work, '.ew-trip-route', 'grid-template-columns')).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    expect(base(work, '.ew-station', 'border-top')).toBe(`2px solid ${TEXT}`);
    expect(base(work, '.ew-station::before', 'border-radius')).toBe('50%');
    expect(base(work, '.ew-station::before', 'background')).toBe(PAPER); // home: open
    expect(base(work, '.ew-station.is-work::before', 'background')).toBe(TEXT); // work: filled
    expect(base(work, '.ew-station:last-child', 'text-align')).toBe('right');
    const strips = byClass(render(), 'ew-trip-route').map((s) => byClass(s, 'ew-station').map((e) => `${textOf(e)} ${cls(e)[1]}`));
    expect(strips).toEqual([
      ['Acme Studio is-work', 'Astoria is-home'], // evening: work to home
      ['Astoria is-home', 'Acme Studio is-work'], // morning: home to work
    ]);
  });

  it('a trip that is switched off keeps its strip, dashed and muted, with the reason in words', () => {
    const off = byClass(render(noMorning), 'ew-trip').filter((t) => cls(t).includes('is-off'));
    expect(off).toHaveLength(1);
    expect(textOf(off[0])).toBe('Morning Not available in the morning Astoria to Acme Studio');
    expect(base(work, '.ew-trip.is-off .ew-station', 'border-top-style')).toBe('dashed');
    expect(base(work, '.ew-trip.is-off .ew-station', 'color')).toBe('var(--paper-muted, #5A5F6B)');
  });

  it('the two strips are side by side from 640 px, one under the other below', () => {
    const wide = /min-width:\s*640px/;
    expect(base(work, '.ew-trips', 'grid-template-columns')).toBe('minmax(0, 1fr)');
    const rule = work.find((r) => r.media.some((m) => wide.test(m)) && selectors(r).includes('.ew-trips'))!;
    expect(selectors(rule)).toEqual(['.ew-trips', '.ew-commute-facts']);
    expect(rule.decls).toEqual([{ prop: 'grid-template-columns', value: 'repeat(2, minmax(0, 1fr))' }]);
  });
});

describe('buttons and links (issue 957)', () => {
  it('a secondary button is an ink outline, 36 px tall and 44 px on a phone; the two look the same', () => {
    for (const prop of ['min-height', 'padding', 'border', 'background', 'color', 'font-weight']) {
      expect(base(page, '.ep-btn', prop), prop).toBe(base(work, '.ew-btn', prop));
    }
    expect(base(work, '.ew-btn', 'min-height')).toBe('36px');
    expect(base(work, '.ew-btn', 'border')).toBe(`1px solid ${TEXT}`);
    expect(inMedia(work, PHONE, '.ew-btn', 'min-height')).toBe('44px');
    expect(inMedia(page, PHONE, '.ep-btn', 'min-height')).toBe('44px');
    // Switched off, both look the same.
    for (const prop of ['color', 'border-color', 'cursor']) {
      expect(base(page, '.ep-btn:disabled', prop), prop).toBe(base(work, '.ew-btn:disabled', prop));
    }
  });

  it('the two actions of the job view are 44 px tall at every width', () => {
    const jobButtons = job.find((r) => r.media.length === 0 && selectors(r).includes('.job-v2__link'))!;
    expect(selectors(jobButtons)).toEqual(['.job-v2__link', '.job-v2__button']);
    expect(jobButtons.decls.find((d) => d.prop === 'min-height')?.value).toBe('44px');
  });

  it('a row\'s two links are 44 px targets on a phone, on the pass too', () => {
    expect(inMedia(work, PHONE, '.ew-row-links a', 'min-height')).toBe('44px');
    expect(inMedia(work, PHONE, '.ew-pass .ew-row-links a:last-child', 'min-height')).toBe('44px');
  });
});
