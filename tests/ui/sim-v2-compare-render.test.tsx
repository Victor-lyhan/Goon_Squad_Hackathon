import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMPARE_TITLE, CompareSection } from '../../client/src/components/sim/v2/compare/CompareSection';
import { compareRows } from '../../client/src/components/sim/v2/compare/compareModelV2';
import type { CompareResponse } from '../../shared/v2/api';
import { allUnmatchedCompare, equalSidesCompare, relayGainCompare } from './sim-v2-compare-fixture';

const noop = () => {};
const render = (props: Partial<Parameters<typeof CompareSection>[0]> = {}) =>
  renderToStaticMarkup(<CompareSection response={null} loading={false} error={null} onRun={noop} {...props} />);
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const clean = (html: string) => {
  expect(html).not.toMatch(/\bhubs?\b/i);
  expect(html).not.toMatch(/synthetic/i);
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('undefined');
};

describe('CompareSection states', () => {
  it('not run yet: one sentence and an enabled "Compare" button', () => {
    const html = render();
    clean(html);
    expect(html).toContain(COMPARE_TITLE);
    expect(html).toContain('relay point');
    expect(html).not.toContain('<table');
    const [btn] = buttons(html);
    expect(buttons(html)).toHaveLength(1);
    expect(btn[1]).toContain('type="button"');
    expect(btn[1]).not.toContain('disabled');
    expect(text(btn[2])).toBe('Compare');
  });

  it('respects the disabled prop', () => {
    const [btn] = buttons(render({ disabled: true }));
    expect(btn[1]).toContain('disabled');
  });

  it('loading: the button is disabled and busy, no table', () => {
    const html = render({ loading: true, response: relayGainCompare() });
    clean(html);
    expect(html).not.toContain('<table');
    expect(html).toContain('aria-busy="true"');
    const [btn] = buttons(html);
    expect(btn[1]).toContain('disabled');
    expect(text(btn[2])).toContain('Compare');
  });

  it('error: the message in an alert and a "Try again" button', () => {
    const html = render({ error: 'NYC travel data is not loaded on this server yet.' });
    clean(html);
    expect(html).toMatch(/<p[^>]*role="alert"[^>]*>NYC travel data is not loaded on this server yet\.<\/p>/);
    const [btn] = buttons(html);
    expect(text(btn[2])).toBe('Try again');
    expect(btn[1]).not.toContain('disabled');
  });

  it('result: a two-column table (not cards) with one row per model row', () => {
    const response = relayGainCompare();
    const html = render({ response });
    clean(html);
    expect(html).not.toMatch(/ui-card|class="card/);
    expect(html).toContain('<table class="cmp-table">');
    const head = html.match(/<thead>([\s\S]*?)<\/thead>/)![1];
    expect([...head.matchAll(/<th scope="col">/g)]).toHaveLength(3);
    expect(text(head)).toBe('Measure Direct only With relay points');
    const rows = [...html.matchAll(/<tr class="cmp-row[^"]*">([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    const model = compareRows(response);
    expect(rows).toHaveLength(model.length);
    rows.forEach((row, i) => {
      expect(row).toContain(`<th scope="row">${model[i].label}</th>`);
      const nums = [...row.matchAll(/<td class="cmp-num">([^<]*)<\/td>/g)].map((m) => m[1]);
      expect(nums).toEqual([model[i].direct, model[i].relay]);
    });
    expect(html).toContain('+1 matched with relay points');
    expect(text(buttons(html)[0][2])).toBe('Compare again');
  });

  it.each([
    ['all unmatched', allUnmatchedCompare],
    ['equal sides', equalSidesCompare],
  ])('result (%s) has no empty number cell', (_name, build: () => CompareResponse) => {
    const html = render({ response: build() });
    clean(html);
    expect(html).not.toMatch(/<td class="cmp-num"><\/td>/);
    expect(html).toContain('Relay points add no matches in this scenario');
  });
});

describe('compare.css fits a 280 px panel', () => {
  const css = readFileSync(resolve(__dirname, '../../client/src/components/sim/v2/compare/compare.css'), 'utf8');

  it('has no fixed width or min-width above 280 px', () => {
    for (const m of css.matchAll(/(?:^|[;{\s])(min-width|width|flex-basis)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      expect(Number(m[2]), `${m[1]}: ${m[2]}px`).toBeLessThanOrEqual(280);
    }
    // No widths in other absolute units that could sneak past the px check.
    expect(css).not.toMatch(/(?:^|[;{\s])(?:min-)?width\s*:\s*[\d.]+(?:rem|em|vw|ch)\b/);
  });

  it('long cell text wraps instead of forcing a horizontal scroll', () => {
    const cell = css.match(/\.cmp-table th,\s*\.cmp-table td\s*\{([^}]*)\}/)![1];
    expect(cell).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css.match(/\.cmp-table\s*\{([^}]*)\}/)![1]).toMatch(/table-layout:\s*fixed/);
  });

  it('the table uses width: 100% with token borders and radius, numbers in IBM Plex Mono', () => {
    const table = css.match(/\.cmp-table\s*\{([^}]*)\}/)![1];
    expect(table).toMatch(/width:\s*100%/);
    expect(table).toMatch(/border:\s*1px solid var\(--border/);
    expect(table).toMatch(/border-radius:\s*var\(--radius,\s*2px\)/);
    const num = css.match(/\.cmp-num\s*\{([^}]*)\}/)![1];
    expect(num).toMatch(/font-family:\s*var\(--font-mono,\s*'IBM Plex Mono'/);
  });
});
