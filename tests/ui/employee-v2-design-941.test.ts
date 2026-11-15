// Issue 941, the Employee page design pass: the next job (the first row of the assigned list) is the
// one bold element, the page has one filled button, the buttons share a height, spacing sits on 8 px
// steps and the loading line is plain text. Read from the stylesheets and the rendered workspace.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmployeeWorkspace } from '../../client/src/components/employee/v2/EmployeeWorkspace';
import { all, parseCss, parseHtml, type CssRule } from './employee-v2-qa-helpers';
import { businesses, dashboard } from './employee-v2-workspace-sample';

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
const NEXT = '.ew-section[aria-labelledby="ew-assigned-heading"] .ew-row:first-child';

describe('Employee page design pass (issue 941)', () => {
  it('the next job is the first row of the assigned list, and the markup the rule needs is there', () => {
    const root = parseHtml(renderToStaticMarkup(createElement(EmployeeWorkspace, { dashboard, businesses })));
    const assigned = all(root, (e) => e.tag === 'section' && e.attrs['aria-labelledby'] === 'ew-assigned-heading');
    expect(assigned.length).toBe(1);
    const rows = all(assigned[0], (e) => e.attrs.class === 'ew-row');
    expect(rows.length).toBe(dashboard.assigned.length);
    expect(rows[0].attrs['data-job-id']).toBe(dashboard.assigned[0].job.id); // the server's order, not re-sorted
    const links = all(rows[0], (e) => e.tag === 'a');
    expect(links[0].children.join('')).toBe('View job'); // the link the filled style lands on
  });

  it('the next job is the bold element: accent bar, large title, and the only filled button', () => {
    expect(base(work, NEXT, 'border-left')).toBe('4px solid var(--accent, #1D5075)');
    expect(base(work, NEXT, 'background')).toBe('var(--accent-soft, #E8EEF1)');
    expect(base(work, `${NEXT} .ew-row-head .ew-strong`, 'font-size')).toBe('var(--text-lg, 18px)');
    const filled = `${NEXT} .ew-row-links a:first-child`;
    expect(base(work, filled, 'background')).toBe('var(--accent, #1D5075)');
    expect(base(work, filled, 'color')).toBe('var(--panel, #FFFFFF)');
    // No other rule of the workspace or the page fills a control with the accent.
    const fills = [...work, ...page].filter((r) => r.decls.some((d) => d.prop === 'background' && d.value === 'var(--accent, #1D5075)'));
    expect(fills.map((r) => r.selector.replace(/\s+/g, ' '))).toEqual([filled]);
    // The words of the bold row start where the other rows' do: 4 px bar + 12 px = 16 px.
    expect(base(work, NEXT, 'padding')).toMatch(/var\(--space-3, 12px\)$/);
    expect(base(work, '.ew-row', 'padding')).toBe('var(--space-4, 16px)');
  });

  it('every button is 36 px tall on a wide screen and 44 px on a phone', () => {
    expect(base(work, '.ew-btn', 'min-height')).toBe('36px');
    expect(base(page, '.ep-btn', 'min-height')).toBe('36px');
    expect(base(work, `${NEXT} .ew-row-links a:first-child`, 'min-height')).toBe('36px');
    const jobButtons = job.find((r) => r.media.length === 0 && selectors(r).includes('.job-v2__link'))!;
    expect(selectors(jobButtons)).toEqual(['.job-v2__link', '.job-v2__button']);
    expect(jobButtons.decls.find((d) => d.prop === 'min-height')?.value).toBe('36px');
    const phone = /max-width:\s*480px/;
    expect(inMedia(job, phone, '.job-v2__link', 'min-height')).toBe('44px');
    expect(inMedia(work, phone, `${NEXT} .ew-row-links a:first-child`, 'min-height')).toBe('44px');
    // Switched off, both secondary buttons look the same.
    for (const prop of ['color', 'border-color', 'cursor']) {
      expect(base(page, '.ep-btn:disabled', prop), prop).toBe(base(work, '.ew-btn:disabled', prop));
    }
    expect(base(page, '.ep-btn', 'padding')).toBe(base(work, '.ew-btn', 'padding'));
  });

  it('blocks are 16 px inside and 24 px apart, and the four block heads are the same height', () => {
    expect(base(work, '.ew-section', 'margin-bottom')).toBe('var(--space-6, 24px)');
    expect(base(page, '.ep-editor', 'margin-bottom')).toBe('var(--space-6, 24px)');
    expect(base(work, '.ew-section-head', 'min-height')).toBe('56px');
    for (const s of ['.ew-empty', '.ew-earnings']) expect(base(work, s, 'padding')).toBe('var(--space-4, 16px)');
    expect(base(page, '.ep-editor', 'padding')).toBe('var(--space-4, 16px)');
  });

  it('a trip is one line on a wide screen, numbers on the right; stacked below 640 px', () => {
    const wide = /min-width:\s*640px/;
    expect(inMedia(work, wide, '.ew-trip', 'grid-template-columns')).toBe('72px minmax(0, 1fr) auto');
    expect(inMedia(work, wide, '.ew-trip-data', 'grid-column')).toBe('3');
    expect(base(work, '.ew-trip-data', 'grid-column')).toBe('2');
  });

  it('the loading line is plain muted text; an empty list says what is missing on its own line', () => {
    expect(base(page, 'p.ep-state', 'border')).toBe('0');
    expect(base(page, 'p.ep-state', 'background')).toBe('none');
    expect(base(page, 'p.ep-state', 'color')).toBe('var(--muted, #5B6472)');
    expect(base(work, '.ew-empty-title', 'display')).toBe('block');
  });
});
