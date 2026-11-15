// #714: faults found by opening /, the Business and the Employee workspace in headless Chrome at 1440 px
// and 390 px. Each rule below fixes one of them; this file keeps the fix from being undone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCss, type CssRule } from './employee-v2-qa-helpers';

const rules = (path: string): CssRule[] => parseCss(readFileSync(path, 'utf8'));
const BUSINESS = 'client/src/components/business/v2';
const EMPLOYEE = 'client/src/components/employee/v2';

/** The value the last matching rule gives `prop` for `selector`, inside a media query that matches `media` (or outside any). */
function value(all: CssRule[], selector: string, prop: string, media?: RegExp): string | undefined {
  const hits = all.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)
    && (media ? r.media.some((m) => media.test(m)) : r.media.length === 0));
  return hits.flatMap((r) => r.decls).filter((d) => d.prop === prop).pop()?.value;
}

describe('shell.css (#714)', () => {
  const css = readFileSync('client/src/ui/shell.css', 'utf8');
  it('has no rule left for the Help link (deleted in #623)', () => {
    expect(css).not.toContain('shell-help');
  });
  it('the active nav item is underlined by a straight bar: the link has no rounded corner (#868: it is as high as the bar)', () => {
    const all = rules('client/src/ui/shell.css');
    expect(value(all, '.shell-nav-link', 'border-radius')).toBeUndefined();
    expect(value(all, '.shell-nav-link', 'border-width')).toBe('2px 0');
    expect(value(all, ".shell-nav a.shell-nav-link[aria-current='page']", 'border-bottom-color')).toBe('var(--accent, #1D5075)');
    expect(value(all, ".shell-nav a.shell-nav-link[aria-current='page']", 'border-radius')).toBeUndefined();
  });
});

describe('landing.css (#714)', () => {
  const all = rules('client/src/styles/landing.css');
  it('at projector widths the Watch button is bigger than an entry under it', () => {
    // Since #879 these are the button's base rule, not one for 600 px and up: it is 72 px high (it was 64)
    // and as wide as the entries wherever 320 px fit.
    expect(value(all, '.watch-button', 'min-height')).toBe('72px');
    expect(value(all, '.watch-button', 'min-width')).toBe('min(320px, 100%)');
    expect(value(all, '.watch-button', 'font-size')).toBe('20px');
    // An entry: 2 × 8 px padding and two lines of text, so about 59 px high.
    expect(value(all, '.workspace-entry', 'padding')).toBe('var(--space-2, 8px) var(--space-4, 16px)');
  });
});

describe('Business CSS (#714)', () => {
  it('mono numbers are never bolder than the heaviest IBM Plex Mono the app loads', () => {
    const loaded = [...readFileSync('client/src/styles/fonts.css', 'utf8').matchAll(/ibm-plex-mono\/latin-(\d+)\.css/g)].map((m) => Number(m[1]));
    const heaviest = Math.max(...loaded);
    expect(Number(value(rules(`${BUSINESS}/activity/activity.css`), '.ba-totals__value', 'font-weight'))).toBeLessThanOrEqual(heaviest);
    // A relay stop is bold; its time is mono, so it gets its own weight.
    expect(Number(value(rules(`${BUSINESS}/deliveryDetails.css`), '.bd-stop--relay .bd-mono', 'font-weight'))).toBeLessThanOrEqual(heaviest);
  });

  it('at 390 px the details panel and the New delivery form keep their side borders', () => {
    for (const [file, selector] of [['deliveryDetails.css', '.bd-panel'], ['newDelivery.css', '.nd']] as const) {
      for (const r of rules(`${BUSINESS}/${file}`)) {
        if (!r.selector.split(',').map((s) => s.trim()).includes(selector)) continue;
        for (const d of r.decls) expect(`${selector} { ${d.prop}: ${d.value} }`).not.toMatch(/border(-left|-right)?(-width)?: 0\b/);
      }
    }
  });

  it('at 390 px Close stays a small button at the end of the head row', () => {
    const narrow = rules(`${BUSINESS}/deliveryDetails.css`).filter((r) => r.media.some((m) => /max-width:\s*480px/.test(m)));
    const grow = narrow.findIndex((r) => r.selector === '.bd-btn' && r.decls.some((d) => d.prop === 'flex'));
    const close = narrow.findIndex((r) => r.selector === '.bd-head__top .bd-btn' && r.decls.some((d) => d.prop === 'flex' && d.value === 'none'));
    expect(grow).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(grow);
  });

  it('in a stacked row the status label keeps its own width', () => {
    expect(value(rules(`${BUSINESS}/businessWorkspace.css`), '.bw-table td .bw-status', 'justify-self', /max-width:\s*640px/)).toBe('start');
  });

  it('a stop time under the route map wraps as one box', () => {
    expect(value(rules(`${BUSINESS}/route/deliveryRoute.css`), '.bdr__time', 'display')).toBe('inline-block');
  });
});

describe('Employee CSS (#714)', () => {
  const all = rules(`${EMPLOYEE}/JobDetailV2.css`);
  it('the job card is as wide as the page column and keeps its side borders at 390 px', () => {
    expect(value(all, '.job-v2', 'max-width')).toBe('100%');
    for (const r of all.filter((x) => x.selector === '.job-v2')) {
      for (const d of r.decls) expect(`${d.prop}: ${d.value}`).not.toMatch(/border(-left|-right)?(-width)?: 0\b/);
    }
  });
  it('the section headings are 600, a weight Inter is loaded at', () => {
    expect(value(all, '.job-v2__h3', 'font-weight')).toBe('600');
  });
});
